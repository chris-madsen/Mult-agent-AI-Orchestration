import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readHarborFeedbackTrialObservations } from '../src/adapters/harbor-feedback-trial-evidence.js';
import { readHermesContextEvidenceJsonl } from '../src/adapters/hermes-context-evidence.js';
import { assessHarborAcceptance } from '../src/domain/harbor-evaluation-policy.js';
import { evaluateNativeResponsesFinalWireEvidence } from '../src/domain/provider-trace-receipt.js';
import {
  reconcileFeedbackTrials,
  validateFeedbackExperimentManifest,
  validateFeedbackTaskManifest,
  type FeedbackArtifactHash,
  type FeedbackExperimentManifest,
  type FeedbackFinalWireAttemptBinding,
  type FeedbackTaskIdentity,
  type FeedbackTaskManifest,
  type FeedbackTrialObservation,
} from '../src/domain/feedback-loop-experiment.js';
import {
  evaluateHermesAgentLoopEvidence,
  summarizeHermesSessionExport,
  verifyFinalWireEvidenceEnvelope,
  type VerifiedFinalWireReceipt,
} from './real-provider-evidence.mjs';

type JsonObject = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const privateAgentArtifactBasenames = new Set([
  'hermes-session.jsonl',
  'hermes.txt',
  'ace-responses-projection.jsonl',
  'hermes-context-receipts.jsonl',
  'ace-final-wire-evidence.jsonl',
]);

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/collect-feedback-loop.ts <task-manifest.json> <experiment-manifest.json> <native-result.json> <ace-result.json> <output-dir> [--final-wire-public-key <public-key.pem>]',
  );
};

const readJson = async (path: string): Promise<JsonObject> => {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const value = object(parsed);
  if (value === undefined) throw new Error(`BLOCKED: ${path} must contain a JSON object`);
  return value;
};

const trialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  const aggregate = await readJson(aggregatePath);
  const count = aggregate.n_total_trials ?? aggregate.nTotalTrials;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`BLOCKED: aggregate Harbor result is missing a positive n_total_trials: ${aggregatePath}`);
  }
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name));
  if (directories.length !== count) {
    throw new Error(`BLOCKED: aggregate n_total_trials=${count} does not match raw trial directories=${directories.length}`);
  }
  // Do not silently discard missing/corrupt trial results. Every raw trial
  // must match the frozen aggregate before reconciliation or token claims.
  const trials = await Promise.all(directories.map(async (directory) => {
    const result = await readJson(join(directory, 'result.json'));
    const startedAt = typeof result.started_at === 'string' ? Date.parse(result.started_at) : Number.NaN;
    const trialId = nonEmpty(result.trial_id) ? result.trial_id : basename(directory);
    return { directory, trialId, startedAt };
  }));
  const seen = new Set<string>();
  for (const trial of trials) {
    if (seen.has(trial.trialId)) throw new Error(`BLOCKED: duplicate Harbor trial ID ${trial.trialId}`);
    seen.add(trial.trialId);
  }
  if (trials.every((item) => Number.isFinite(item.startedAt))) trials.sort((left, right) => left.startedAt - right.startedAt);
  else trials.sort((left, right) => left.directory.localeCompare(right.directory));
  return trials.map((item) => item.directory);
};

const walkFiles = async (root: string): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`BLOCKED: non-regular Harbor artifact is not safely capturable: ${path}`);
  }
  return files;
};

const copyDirectory = async (source: string, destination: string): Promise<readonly FeedbackArtifactHash[]> => {
  const files = await walkFiles(source);
  const hashes: FeedbackArtifactHash[] = [];
  for (const file of files) {
    if (privateAgentArtifactBasenames.has(basename(file))) continue;
    const target = join(destination, relative(source, file));
    await mkdir(dirname(target), { recursive: true });
    const bytes = await readFile(file);
    // Write the exact bytes used for the digest; copying after hashing could
    // silently associate a changed source file with the old hash.
    await writeFile(target, bytes);
    hashes.push({ path: relative(destination, target).split(/\\/u).join('/'), sha256: sha256(bytes) });
  }
  return hashes.sort((left, right) => left.path.localeCompare(right.path));
};

const providerTraceFiles = async (trialDirectory: string): Promise<readonly string[]> => {
  const files = await walkFiles(trialDirectory);
  return files.filter((path) => basename(path) === 'provider-trace.jsonl');
};

const providerTraceRequestIds = async (trialDirectory: string): Promise<readonly string[]> => {
  const ids = new Set<string>();
  for (const path of await providerTraceFiles(trialDirectory)) {
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      try {
        const event = object(JSON.parse(line) as unknown);
        if (typeof event?.requestId === 'string' && event.requestId.trim().length > 0) ids.add(event.requestId);
      } catch {
        throw new Error(`BLOCKED: malformed provider trace line in ${path}`);
      }
    }
  }
  return [...ids].sort();
};

const finalWireAttemptBindingsFor = (
  evidence: Readonly<Record<string, unknown>> | undefined,
): readonly FeedbackFinalWireAttemptBinding[] => {
  const rawIndex = evidence?.signatureCheckedFinalWireReceiptIndex;
  if (rawIndex === undefined) return [];
  if (!Array.isArray(rawIndex)) throw new Error('BLOCKED: C07 final-wire receipt index is malformed');
  const bindings: FeedbackFinalWireAttemptBinding[] = [];
  for (const [index, value] of rawIndex.entries()) {
    const receipt = object(value);
    if (receipt === undefined || !nonEmpty(receipt.requestId) || !nonEmpty(receipt.attemptId)) {
      throw new Error(`BLOCKED: C07 final-wire receipt index entry ${index} is malformed`);
    }
    if (receipt.status === 'REAL_PROVIDER_CANDIDATE'
      && receipt.acknowledgementKind === 'real_provider'
      && Number.isSafeInteger(receipt.acknowledgementStatusCode)
      && (receipt.acknowledgementStatusCode as number) >= 200
      && (receipt.acknowledgementStatusCode as number) < 300) {
      bindings.push({ requestId: receipt.requestId, attemptId: receipt.attemptId, status: 'REAL_PROVIDER_CANDIDATE' });
    } else if (receipt.status === 'REAL_PROVIDER_CANDIDATE') {
      throw new Error(`BLOCKED: C07 candidate receipt index entry ${index} lacks a successful real-provider acknowledgement`);
    } else if (receipt.status !== 'NOT_CERTIFIED' && receipt.status !== 'MOCK_WIRE_VERIFIED') {
      throw new Error(`BLOCKED: C07 final-wire receipt index entry ${index} has an unknown status`);
    }
  }
  return bindings;
};

const canonicalPathIsWithin = (root: string, canonicalPath: string): boolean => {
  const rel = relative(root, canonicalPath);
  return rel.length === 0 || !(isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'));
};

const jsonLines = async (path: string, label: string): Promise<readonly JsonObject[]> => {
  const values: JsonObject[] = [];
  for (const [index, line] of (await readFile(path, 'utf8')).split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`BLOCKED: malformed ${label} JSONL at line ${index + 1}`);
    }
    const record = object(parsed);
    if (record === undefined) throw new Error(`BLOCKED: ${label} JSONL record must be an object`);
    values.push(record);
  }
  return values;
};

const gatewayRequestsFor = async (trialDirectory: string): Promise<{
  readonly requests: readonly JsonObject[];
  readonly sha256?: string;
}> => {
  const matches = (await walkFiles(trialDirectory)).filter((path) => basename(path) === 'ace-responses-projection.jsonl');
  if (matches.length === 0) return { requests: [] };
  // A trial with multiple projection journals is ambiguous: choosing the
  // first silently drops prepared/blocked requests and can falsely correlate
  // only a subset with final-wire evidence. Require a single journal until
  // this consumer has a durable cross-file journal identity.
  if (matches.length !== 1) throw new Error('BLOCKED: multiple Gateway projection evidence journals');
  const bytes = await readFile(matches[0]!);
  const requests: JsonObject[] = [];
  const seen = new Set<string>();
  for (const [index, line] of bytes.toString('utf8').split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`BLOCKED: malformed Gateway projection evidence at line ${index + 1}`);
    }
    const record = object(parsed);
    const decision = object(record?.decision) ?? record;
    if (record?.schemaVersion !== 'ace.context.v3' || decision === undefined
      || !['PREPARED', 'BLOCK'].includes(String(decision.kind))
      || !nonEmpty(record.requestId) || seen.has(record.requestId)) {
      throw new Error(`BLOCKED: Gateway projection evidence is malformed or duplicated at line ${index + 1}`);
    }
    seen.add(record.requestId);
    const attestation = object(record.attestation);
    const agentSessionId = nonEmpty(record.agentSessionId) ?? nonEmpty(attestation?.sessionId);
    requests.push({
      requestId: record.requestId,
      kind: decision.kind,
      ...(agentSessionId === undefined ? {} : { agentSessionId }),
    });
  }
  return { requests, sha256: sha256(bytes) };
};

const agentLoopEvidenceFor = async (
  trialDirectory: string,
  taskOutcome: 'pass' | 'fail' | 'unknown',
  verificationPublicKeyPem: string | undefined,
  expectedAceSourceCommit: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const files = await walkFiles(trialDirectory);
  const sessionFiles = files.filter((path) => basename(path) === 'hermes-session.jsonl');
  if (sessionFiles.length === 0) {
    return { schemaVersion: 1, status: 'NOT_RUN', reasonCodes: ['HERMES_SESSION_EXPORT_NOT_FOUND'] };
  }
  if (sessionFiles.length !== 1) {
    return { schemaVersion: 1, status: 'BLOCKED', reasonCodes: ['AMBIGUOUS_HERMES_SESSION_EXPORT_COUNT'] };
  }
  let repositoryRoot: string;
  try {
    repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return { schemaVersion: 1, status: 'BLOCKED', reasonCodes: ['REPOSITORY_ROOT_UNVERIFIED'] };
  }
  const sessionPath = sessionFiles[0] as string;
  let canonicalRepositoryRoot: string;
  let canonicalSessionPath: string;
  try {
    [canonicalRepositoryRoot, canonicalSessionPath] = await Promise.all([
      realpath(repositoryRoot),
      realpath(sessionPath),
    ]);
  } catch {
    return { schemaVersion: 1, status: 'BLOCKED', reasonCodes: ['HERMES_SESSION_PATH_UNVERIFIED'] };
  }
  if (canonicalPathIsWithin(canonicalRepositoryRoot, canonicalSessionPath)) {
    return { schemaVersion: 1, status: 'BLOCKED', reasonCodes: ['RAW_HERMES_TRACE_MUST_REMAIN_OUTSIDE_REPOSITORY'] };
  }

  let sessionSummary: ReturnType<typeof summarizeHermesSessionExport>;
  try {
    sessionSummary = summarizeHermesSessionExport(await readFile(canonicalSessionPath));
  } catch {
    return { schemaVersion: 1, status: 'BLOCKED', reasonCodes: ['HERMES_SESSION_EXPORT_INVALID'] };
  }
  let gatewayEvidence: Awaited<ReturnType<typeof gatewayRequestsFor>>;
  try {
    gatewayEvidence = await gatewayRequestsFor(trialDirectory);
  } catch {
    return { schemaVersion: 1, status: 'BLOCKED', sessionIdSha256: sessionSummary.sessionIdSha256,
      rawTraceSha256: sessionSummary.rawTraceSha256, reasonCodes: ['GATEWAY_PROJECTION_EVIDENCE_INVALID'] };
  }
  const gatewayRequestIndex = gatewayEvidence.requests.map((request) => ({
    requestId: request.requestId,
    kind: request.kind,
    ...(nonEmpty(request.agentSessionId) === undefined ? {} : {
      agentSessionIdSha256: createHash('sha256')
        .update(`hermes-agent-loop:${request.agentSessionId as string}`, 'utf8').digest('hex'),
    }),
  }));

  const finalWireFiles = files.filter((path) => basename(path) === 'ace-final-wire-evidence.jsonl');
  const finalWireEnvelopes: JsonObject[] = [];
  try {
    for (const path of finalWireFiles) finalWireEnvelopes.push(...await jsonLines(path, 'final-wire evidence'));
  } catch {
    return { schemaVersion: 1, status: 'BLOCKED', sessionIdSha256: sessionSummary.sessionIdSha256,
      rawTraceSha256: sessionSummary.rawTraceSha256, reasonCodes: ['FINAL_WIRE_EVIDENCE_INVALID'] };
  }
  const signatureCheckedFinalWireReceipts: VerifiedFinalWireReceipt[] = [];
  if (finalWireEnvelopes.length > 0 && verificationPublicKeyPem !== undefined) {
    for (const envelope of finalWireEnvelopes) {
      try {
        const verified = verifyFinalWireEvidenceEnvelope(
          envelope,
          verificationPublicKeyPem,
          evaluateNativeResponsesFinalWireEvidence,
        );
        if (verified.receipt.sourceCommit !== expectedAceSourceCommit) {
          return { schemaVersion: 1, status: 'BLOCKED', sessionIdSha256: sessionSummary.sessionIdSha256,
            rawTraceSha256: sessionSummary.rawTraceSha256, reasonCodes: ['FINAL_WIRE_SOURCE_COMMIT_MISMATCH'] };
        }
        signatureCheckedFinalWireReceipts.push(verified.receipt);
      } catch {
        return { schemaVersion: 1, status: 'BLOCKED', sessionIdSha256: sessionSummary.sessionIdSha256,
          rawTraceSha256: sessionSummary.rawTraceSha256, reasonCodes: ['FINAL_WIRE_SIGNATURE_OR_CONTRACT_INVALID'] };
      }
    }
  }
  const evaluated = evaluateHermesAgentLoopEvidence({
    sessionSummary,
    gatewayRequests: gatewayEvidence.requests,
    signatureCheckedFinalWireReceipts,
    taskOutcome,
  });
  const signatureCheckedFinalWireReceiptIndex = signatureCheckedFinalWireReceipts.map((receipt) => ({
    requestId: receipt.requestId,
    attemptId: receipt.attemptId,
    status: receipt.status,
    sourceCommit: receipt.sourceCommit,
    bifrostCommit: receipt.bifrostCommit,
    bifrostPluginSha256: receipt.bifrostPluginSha256,
    aceRuntimeSha256: receipt.aceRuntimeSha256,
    pluginOrderSha256: receipt.pluginOrderSha256,
    protocol: receipt.protocol,
    provider: receipt.provider,
    model: receipt.model,
    acknowledgementKind: receipt.providerAcknowledgement.kind,
    acknowledgementStatusCode: receipt.providerAcknowledgement.statusCode,
    providerRequestIdSha256: createHash('sha256').update(receipt.providerAcknowledgement.providerRequestId, 'utf8').digest('hex'),
  }));
  return {
    ...evaluated,
    gatewayRequestIndex,
    signatureCheckedFinalWireReceiptIndex,
    ...(gatewayEvidence.sha256 === undefined ? {} : { gatewayProjectionSha256: gatewayEvidence.sha256 }),
    finalWireEnvelopeCount: finalWireEnvelopes.length,
    finalWireVerificationKeyProvided: verificationPublicKeyPem !== undefined,
    rawSessionTraceCopied: false,
  };
};

const taskFor = (tasks: readonly FeedbackTaskIdentity[], taskName: string): FeedbackTaskIdentity => {
  const task = tasks.find((candidate) => candidate.id === taskName);
  if (task === undefined) throw new Error(`BLOCKED: Harbor task ${taskName} is not present in frozen task-manifest.json`);
  return task;
};

const rawUsage = (result: JsonObject): {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly costUsd?: number;
} => {
  const agent = object(result.agent_result);
  const inputTokens = typeof agent?.n_input_tokens === 'number' ? agent.n_input_tokens : undefined;
  const cachedInputTokens = typeof agent?.n_cache_tokens === 'number' ? agent.n_cache_tokens : undefined;
  const outputTokens = typeof agent?.n_output_tokens === 'number' ? agent.n_output_tokens : undefined;
  const reasoningOutputTokens = typeof agent?.n_reasoning_tokens === 'number'
    ? agent.n_reasoning_tokens
    : typeof agent?.reasoning_output_tokens === 'number' ? agent.reasoning_output_tokens : undefined;
  const costUsd = typeof agent?.cost_usd === 'number' ? agent.cost_usd : undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
};

const observationsFor = async (
  arm: 'native' | 'ace_optional',
  aggregatePath: string,
  taskManifest: FeedbackTaskManifest,
  outputRoot: string,
  verificationPublicKeyPem: string | undefined,
  experimentManifest: FeedbackExperimentManifest,
): Promise<{
  readonly observations: readonly FeedbackTrialObservation[];
  readonly providerTraceLines: readonly string[];
  readonly agentLoopEvidence: readonly Readonly<Record<string, unknown>>[];
}> => {
  const parsed = await readHarborFeedbackTrialObservations(arm, aggregatePath);
  const directories = await trialDirectories(aggregatePath);
  if (parsed.length !== directories.length) throw new Error(`BLOCKED: ${arm} raw trial count does not match Harbor directories`);
  const trialDirById = new Map<string, string>();
  for (const directory of directories) {
    const result = await readJson(join(directory, 'result.json'));
    const trialId = nonEmpty(result.trial_id) ? result.trial_id : basename(directory);
    if (trialDirById.has(trialId)) throw new Error(`BLOCKED: duplicate ${arm} trial ID ${trialId}`);
    trialDirById.set(trialId, directory);
  }
  const observations: FeedbackTrialObservation[] = [];
  const providerTraceLines: string[] = [];
  const agentLoopEvidence: Readonly<Record<string, unknown>>[] = [];
  for (const trial of parsed) {
    const directory = trialDirById.get(trial.trialId);
    if (directory === undefined) throw new Error(`BLOCKED: missing ${arm} trial directory for ${trial.trialId}`);
    const task = taskFor(taskManifest.tasks, trial.taskName);
    const trialAgentLoopEvidence = arm === 'ace_optional'
      ? await agentLoopEvidenceFor(
        directory,
        trial.success ? 'pass' : 'fail',
        verificationPublicKeyPem,
        experimentManifest.sourceCommit,
      )
      : undefined;
    if (trialAgentLoopEvidence !== undefined) {
      agentLoopEvidence.push({
        taskId: task.id,
        trialId: trial.trialId,
        sourceRevision: task.sourceRevision,
        sourceDigest: task.sourceDigest,
        evidence: trialAgentLoopEvidence,
      });
    }
    const finalWireAttemptBindings = finalWireAttemptBindingsFor(trialAgentLoopEvidence);
    // Task names are data from the Harbor dataset, not safe filesystem segments.
    const safeTaskDirectory = Buffer.from(task.id, 'utf8').toString('base64url');
    const destination = join(outputRoot, arm === 'native' ? 'raw-agent-native' : 'raw-agent-ace', safeTaskDirectory);
    const artifacts = await copyDirectory(directory, destination);
    const result = await readJson(join(directory, 'result.json'));
    const contextEvidenceFiles = (await walkFiles(directory)).filter((path) => basename(path) === 'hermes-context-receipts.jsonl');
    const hermesContextEvidence = [];
    for (const evidenceFile of contextEvidenceFiles) {
      hermesContextEvidence.push(...await readHermesContextEvidenceJsonl(evidenceFile));
    }
    const contextTransformRequestIds = [...new Set(hermesContextEvidence.map((item) => item.requestId))];
    const traceFiles = await providerTraceFiles(directory);
    for (const traceFile of traceFiles) providerTraceLines.push(await readFile(traceFile, 'utf8'));
    const observedRequestIds = [...new Set(trial.successfulRequestIds)];
    observations.push({
      arm,
      taskId: task.id,
      trialId: trial.trialId,
      sourceRevision: task.sourceRevision,
      sourceDigest: task.sourceDigest,
      taskDigest: task.taskDigest,
      quality: trial.success ? 'pass' : 'fail',
      usage: rawUsage(result),
      ...(trial.latencyMs === null ? {} : { durationMs: trial.latencyMs }),
      ...(trial.nativeFileReads === null ? {} : { nativeFileReads: trial.nativeFileReads }),
      observedAceCalls: arm === 'native' ? 0 : trial.observedAceCalls + contextTransformRequestIds.length,
      observedAceContextCalls: arm === 'native' ? 0 : trial.observedAceContextCalls,
      observedAceRequestIds: arm === 'native' ? [] : observedRequestIds,
      gatewayProjectionRequestIds: arm === 'native' ? [] : trial.gatewayProjectionRequestIds ?? [],
      finalWireAttemptBindings: arm === 'native' ? [] : finalWireAttemptBindings,
      ...(arm === 'native' || contextTransformRequestIds.length === 0 ? {} : { contextTransformRequestIds }),
      ...(arm === 'native' || hermesContextEvidence.length === 0 ? {} : { hermesContextEvidence }),
      providerTraceRequestIds: arm === 'native' ? [] : await providerTraceRequestIds(directory),
      nativeResponsesStreamReceipts: arm === 'native' ? [] : trial.nativeResponsesStreamReceipts,
      rawArtifactHashes: artifacts,
    });
  }
  return { observations, providerTraceLines, agentLoopEvidence };
};

const parseArgs = (): {
  readonly taskManifestPath: string;
  readonly experimentManifestPath: string;
  readonly nativeResultPath: string;
  readonly aceResultPath: string;
  readonly outputDirectory: string;
  readonly finalWirePublicKeyPath?: string;
} => {
  const [taskManifest, experimentManifest, nativeResult, aceResult, outputDirectory, ...extra] = process.argv.slice(2);
  if ([taskManifest, experimentManifest, nativeResult, aceResult, outputDirectory].some((value) => value === undefined)) return usage();
  if (extra.length > 2 || extra.length > 0 && (extra[0] !== '--final-wire-public-key' || extra[1] === undefined)) return usage();
  return {
    taskManifestPath: resolve(taskManifest as string),
    experimentManifestPath: resolve(experimentManifest as string),
    nativeResultPath: resolve(nativeResult as string),
    aceResultPath: resolve(aceResult as string),
    outputDirectory: resolve(outputDirectory as string),
    ...(extra[1] === undefined ? {} : { finalWirePublicKeyPath: resolve(extra[1]) }),
  };
};

const writeBlocked = async (outputDirectory: string, reason: string): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'metrics.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    const verificationPublicKeyPem = args.finalWirePublicKeyPath === undefined
      ? undefined
      : await readFile(args.finalWirePublicKeyPath, 'utf8');
    const taskManifestBytes = await readFile(args.taskManifestPath);
    const taskManifestValue = JSON.parse(taskManifestBytes.toString('utf8')) as unknown;
    const taskManifest = validateFeedbackTaskManifest(taskManifestValue);
    if (taskManifest._tag === 'Err') throw new Error(`BLOCKED: ${taskManifest.error.path}: ${taskManifest.error.message}`);
    const experimentManifestValue = await readJson(args.experimentManifestPath);
    const experimentManifest = validateFeedbackExperimentManifest(experimentManifestValue);
    if (experimentManifest._tag === 'Err') throw new Error(`BLOCKED: ${experimentManifest.error.path}: ${experimentManifest.error.message}`);
    const actualTaskManifestSha256 = sha256(taskManifestBytes);
    if (actualTaskManifestSha256 !== experimentManifest.value.taskManifestSha256) throw new Error('BLOCKED: task manifest SHA-256 does not match experiment manifest');
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'task-manifest.json'), taskManifestBytes);
    const native = await observationsFor('native', args.nativeResultPath, taskManifest.value, args.outputDirectory, verificationPublicKeyPem, experimentManifest.value);
    const ace = await observationsFor('ace_optional', args.aceResultPath, taskManifest.value, args.outputDirectory, verificationPublicKeyPem, experimentManifest.value);
    const report = reconcileFeedbackTrials({ taskManifest: taskManifest.value, native: native.observations, ace: ace.observations });
    if (report._tag === 'Err') throw new Error(`BLOCKED: ${report.error.path}: ${report.error.message}`);
    const finalWireAttemptBindings = ace.observations.flatMap((observation) => observation.finalWireAttemptBindings ?? []);
    const streamReceipts = ace.observations.flatMap((observation) => observation.nativeResponsesStreamReceipts ?? []);
    const unmatchedStreamReceiptCount = streamReceipts.filter((receipt) => !finalWireAttemptBindings.some((attempt) =>
      attempt.requestId === receipt.requestId && attempt.attemptId === receipt.attemptId)).length;
    const agentEvidenceRecords = ace.agentLoopEvidence
      .map((item) => object(item.evidence))
      .filter((item): item is JsonObject => item !== undefined);
    const c07Blocked = agentEvidenceRecords.some((evidence) => evidence.status === 'BLOCKED');
    const finalWireEvidenceStatus = finalWireAttemptBindings.length > 0
      ? 'REAL_PROVIDER_CANDIDATE'
      : c07Blocked ? 'NOT_CERTIFIED' : 'NOT_RUN';
    const completedEvidenceStages = [] as const;
    const externalCostTelemetry = 'unknown' as const;
    const forcedToolUse = 'unknown' as const;
    const acceptanceStatus = assessHarborAcceptance({
      report: report.value,
      taskManifest: taskManifest.value,
      experimentManifest: experimentManifest.value,
      taskManifestSha256: actualTaskManifestSha256,
      finalWireEvidenceStatus,
      completedEvidenceStages,
      externalCostTelemetry,
      forcedToolUse,
    });
    const acceptanceBlockers = [
      ...(taskManifest.value.selection !== 'holdout' ? ['FROZEN_HOLDOUT_NOT_SELECTED'] : []),
      ...(report.value.status !== 'PASS' ? ['PAIRED_QUALITY_OR_USAGE_NOT_ACCEPTED'] : []),
      ...(report.value.aceCorrelatedCalls === 0 ? ['MODEL_BOUND_ACE_DELIVERY_NOT_VERIFIED'] : []),
      ...(finalWireEvidenceStatus === 'NOT_RUN' ? ['FINAL_WIRE_RECEIPTS_NOT_RUN']
        : finalWireEvidenceStatus === 'NOT_CERTIFIED' ? ['FINAL_WIRE_RECEIPTS_NOT_CERTIFIED'] : []),
      ...(streamReceipts.length === 0 ? ['STREAM_TERMINAL_RECEIPTS_NOT_RUN'] : ['STREAM_RECEIPTS_REMAIN_UNSIGNED']),
      ...(unmatchedStreamReceiptCount > 0 ? ['STREAM_RECEIPT_ATTEMPT_BINDING_UNKNOWN'] : []),
      ...(externalCostTelemetry === 'unknown' ? ['NON_MODEL_EXTERNAL_COSTS_UNKNOWN'] : []),
      ...(forcedToolUse === 'unknown' ? ['TOOLSET_PARITY_UNKNOWN'] : []),
      'INDEPENDENT_ACCEPTANCE_STAGES_NOT_RECORDED',
      'OWNER_RELEASE_APPROVAL_NOT_RECORDED',
    ];
    const fiveXClaimAllowed = acceptanceStatus === 'measured-not-necessarily-5x'
      && report.value.tokenRatio !== null && report.value.tokenRatio >= 5;
    const traceLines = [...native.providerTraceLines, ...ace.providerTraceLines];
    await writeFile(resolve(args.outputDirectory, 'provider-trace.jsonl'), traceLines.join('').endsWith('\n') ? traceLines.join('') : `${traceLines.join('')}\n`);
    await mkdir(resolve(args.outputDirectory, 'receipts'), { recursive: true });
    const metricsBytes = Buffer.from(`${JSON.stringify(report.value, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'metrics.json'), metricsBytes);
    const agentLoopStatuses = ace.agentLoopEvidence.map((item) => object(item.evidence)?.status);
    const agentLoopStatus = agentLoopStatuses.some((status) => status === 'BLOCKED')
      ? 'BLOCKED'
      : agentLoopStatuses.some((status) => status === 'CANDIDATE') ? 'CANDIDATE'
        : agentLoopStatuses.every((status) => status === 'NOT_RUN') ? 'NOT_RUN' : 'BLOCKED';
    const agentLoopEvidence = {
      schemaVersion: 1,
      status: agentLoopStatus,
      runtimeIdentity: {
        sourceCommit: experimentManifest.value.sourceCommit,
        agent: experimentManifest.value.agent,
        agentVersion: experimentManifest.value.agentVersion,
        model: experimentManifest.value.model,
        reasoningEffort: experimentManifest.value.reasoningEffort,
        bifrostEndpointSha256: experimentManifest.value.bifrostEndpointSha256 ?? null,
        tokenWindowAndProviderCounter: 'NOT_RUN',
      },
      trials: ace.agentLoopEvidence,
      limitations: [
        'Original Hermes session exports remain outside the collection output; only their SHA-256 and redacted structural index are retained.',
        'Caller session IDs are correlation only; no host transcript or compaction attestation is present.',
        'A candidate final-wire receipt is not real-agent acceptance or owner approval.',
      ],
    };
    const agentLoopBytes = Buffer.from(`${JSON.stringify(agentLoopEvidence, null, 2)}\n`, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'agent-loop-evidence.json'), agentLoopBytes);
    const manifest = {
      schemaVersion: 1,
      status: report.value.status,
      experiment: experimentManifest.value,
      taskManifestSha256: actualTaskManifestSha256,
      metricsSha256: sha256(metricsBytes),
      nativeResponsesEvidence: {
        finalWireEvidenceStatus,
        finalWireReceiptCount: finalWireAttemptBindings.length,
        streamReceiptCount: streamReceipts.length,
        unmatchedStreamReceiptCount,
        streamOutcomes: {
          completed: streamReceipts.filter((receipt) => receipt.streamStatus === 'completed').length,
          failed: streamReceipts.filter((receipt) => receipt.streamStatus === 'failed').length,
          incomplete: streamReceipts.filter((receipt) => receipt.streamStatus === 'incomplete').length,
          cancelled: streamReceipts.filter((receipt) => receipt.streamStatus === 'cancelled').length,
          truncated: streamReceipts.filter((receipt) => receipt.streamStatus === 'truncated').length,
          partial: streamReceipts.filter((receipt) => receipt.streamStatus === 'partial').length,
        },
        unknownUsageReceipts: streamReceipts.filter((receipt) => receipt.usage.status === 'unknown').length,
        trustLimitation: 'Final-wire artifacts, when present, remain candidates until signer/runtime provenance is independently accepted; stream receipts are unsigned NOT_CERTIFIED summaries.',
      },
      costTelemetry: {
        modelProvider: {
          status: report.value.nativeCostUsd === null || report.value.aceCostUsd === null ? 'unknown' : 'reported',
          source: 'Harbor agent_result.cost_usd',
          nativeUsd: report.value.nativeCostUsd,
          aceUsd: report.value.aceCostUsd,
        },
        nonModelExternalAndInfrastructure: { status: 'unknown', amountUsd: null },
        totalExternal: { status: 'unknown', amountUsd: null },
      },
      acceptance: {
        status: acceptanceStatus,
        fiveXClaimAllowed,
        completedEvidenceStages,
        finalWireEvidenceStatus,
        externalCostTelemetry,
        forcedToolUse,
        blockers: [...new Set(acceptanceBlockers)],
      },
      agentLoopEvidence: {
        path: 'agent-loop-evidence.json',
        sha256: sha256(agentLoopBytes),
        status: agentLoopStatus,
      },
      rawArtifactHashes: [
        { arm: 'evidence', path: 'agent-loop-evidence.json', sha256: sha256(agentLoopBytes) },
        ...native.observations.flatMap((observation) => observation.rawArtifactHashes.map((artifact) => ({
          arm: 'native',
          path: `raw-agent-native/${Buffer.from(observation.taskId, 'utf8').toString('base64url')}/${artifact.path}`,
          sha256: artifact.sha256,
        }))),
        ...ace.observations.flatMap((observation) => observation.rawArtifactHashes.map((artifact) => ({
          arm: 'ace_optional',
          path: `raw-agent-ace/${Buffer.from(observation.taskId, 'utf8').toString('base64url')}/${artifact.path}`,
          sha256: artifact.sha256,
        }))),
      ],
      rawArtifactRoot: args.outputDirectory,
      limitations: [...new Set([
        ...(report.value.status === 'PASS' ? [] : ['Unknown values are retained and excluded from token ratio claims.']),
        ...acceptanceBlockers,
        'Agent-loop evidence status is separate from feedback metrics and cannot certify a real Hermes/provider trial.',
      ])],
    };
    await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      status: report.value.status,
      acceptance: acceptanceStatus,
      fiveXClaimAllowed,
      agentLoopEvidenceStatus: agentLoopStatus,
      output: args.outputDirectory,
      metrics: resolve(args.outputDirectory, 'metrics.json'),
    })}\n`);
    if (report.value.status === 'BLOCKED' || report.value.status === 'QUALITY_REGRESSION') process.exitCode = 2;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'feedback collector failed';
    await writeBlocked(args.outputDirectory, reason);
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
