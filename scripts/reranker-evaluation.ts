import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeProcessRerankerPort } from '../src/adapters/process-reranker.js';
import {
  evaluateRerankerRun,
  frozenRerankerModelCandidates,
  type RerankerEvaluationRun,
  type RerankerFixture,
} from '../src/domain/reranker-evaluation.js';

const [fixtureArg, outputArg, ...optionArgs] = process.argv.slice(2);
if (fixtureArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/reranker-evaluation.ts <fixture.json> <output.json> [--model <id>] [--worker <command>] [--worker-args-json <json>] [--license-reference <url>] [--license-status <status>] [--model-revision <revision>] [--artifact-identity <identity>] [--source-commit <commit>]');
}
const optionValue = (name: string): string | undefined => {
  const index = optionArgs.indexOf(name);
  if (index < 0) return undefined;
  const value = optionArgs[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};
const model = (optionValue('--model') ?? process.env.ACE_RERANKER_MODEL)?.trim();
const licenseReference = (optionValue('--license-reference') ?? process.env.ACE_RERANKER_LICENSE_REFERENCE)?.trim();
if (model === undefined || model.length === 0) throw new Error('ACE_RERANKER_MODEL is required');
if (licenseReference === undefined || licenseReference.length === 0) {
  throw new Error('ACE_RERANKER_LICENSE_REFERENCE is required for evidence');
}
const worker = (optionValue('--worker') ?? process.env.ACE_RERANKER_WORKER)?.trim()
  || resolve('scripts/fastembed-reranker-worker.sh');
let workerArgs: readonly string[] = [];
const workerArgsJson = optionValue('--worker-args-json') ?? process.env.ACE_RERANKER_WORKER_ARGS_JSON;
if (workerArgsJson?.trim()) {
  const decoded: unknown = JSON.parse(workerArgsJson);
  if (!Array.isArray(decoded) || !decoded.every((item) => typeof item === 'string')) {
    throw new Error('ACE_RERANKER_WORKER_ARGS_JSON must be a JSON string array');
  }
  workerArgs = decoded;
}
const timeoutMs = Number(process.env.ACE_RERANKER_TIMEOUT_MS ?? '120000');
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) {
  throw new Error('ACE_RERANKER_TIMEOUT_MS must be an integer between 100 and 3600000');
}

const fixtureBytes = await readFile(resolve(fixtureArg));
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as RerankerFixture;
if (fixture.status === 'frozen_reranker_holdout'
  && !frozenRerankerModelCandidates.includes(model as typeof frozenRerankerModelCandidates[number])) {
  throw new Error(`model is not in the frozen reranker candidate list: ${model}`);
}
const env: Record<string, string> = { ACE_RERANKER_MODEL: model };
for (const name of [
  'ACE_RERANKER_PYTHON',
  'ACE_RERANKER_THREADS',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]) {
  const value = process.env[name]?.trim();
  if (value !== undefined && value.length > 0) env[name] = value;
}

const reranker = makeProcessRerankerPort({
  command: worker,
  args: workerArgs,
  timeoutMs,
  expectedModel: model,
  env,
});
try {
  const startupStarted = performance.now();
  const probe = await Effect.runPromise(reranker.probe());
  if (probe._tag === 'Err') {
    throw new Error(`${probe.error.code}: ${probe.error.path}: ${probe.error.message}`);
  }
  const identity = reranker.identity();
  if (identity === undefined) throw new Error('reranker identity receipt is unavailable after successful probe');
  const startupMs = Math.max(0, performance.now() - startupStarted);
  const rssBytes = identity.rssBytes ?? (reranker.pid === undefined
    ? undefined
    : await (async (): Promise<number | undefined> => {
      try {
        const status = await readFile(`/proc/${reranker.pid}/status`, 'utf8');
        const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status);
        return match?.[1] === undefined ? undefined : Number(match[1]) * 1024;
      } catch {
        return undefined;
      }
    })());

  const observations: RerankerEvaluationRun['observations'][number][] = [];
  for (const item of fixture.cases) {
    const started = performance.now();
    const result = await Effect.runPromise(reranker.rerank({
      query: item.query,
      documents: item.documents,
      requestId: `reranker-eval-${item.id}`,
    }));
    const latencyMs = Math.max(0, performance.now() - started);
    if (result._tag === 'Err') {
      throw new Error(`${item.id}: ${result.error.code}: ${result.error.message}`);
    }
    observations.push({
      caseId: item.id,
      rankedDocumentIndexes: result.value.map((score) => score.index),
      latencyMs,
    });
  }
  const modelRevision = (optionValue('--model-revision') ?? process.env.ACE_RERANKER_MODEL_REVISION)?.trim();
  const artifactIdentity = (optionValue('--artifact-identity') ?? process.env.ACE_RERANKER_ARTIFACT_IDENTITY)?.trim();
  const sourceCommit = (optionValue('--source-commit') ?? process.env.ACE_EVIDENCE_SOURCE_COMMIT)?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const licenseEvidence = (optionValue('--license-status') ?? process.env.ACE_RERANKER_LICENSE_STATUS)?.trim() || licenseReference;
  const run: RerankerEvaluationRun = {
    fixtureSha256,
    observations,
    role: 'candidate',
    sourceCommit,
    runnerVersion: 'ace-reranker-evaluation/v2',
    providerIdentity: `${identity.provider}|model=${identity.model}|runtime=${identity.runtimeBuild}@${identity.runtimeVersion}`,
    ...(modelRevision === undefined ? {} : { modelRevision }),
    ...(artifactIdentity === undefined ? {} : { artifactIdentity }),
    licenseEvidence,
    modelId: model,
    startupMs,
    ...(rssBytes === undefined ? {} : { rssBytes }),
  };
  const metrics = evaluateRerankerRun(fixture, run);
  if (metrics._tag === 'Err') {
    throw new Error(`${metrics.error.code}: ${metrics.error.path}: ${metrics.error.message}`);
  }
  const boundSourceCommit = run.sourceCommit as string;
  await writeFile(resolve(outputArg), JSON.stringify({
    schemaVersion: 1,
    sourceCommit: boundSourceCommit,
    fixture: fixtureArg,
    fixtureSha256,
    fixtureStatus: fixture.status,
    providerIdentity: identity,
    licenseReference,
    runIdentity: {
      role: run.role ?? null,
      runnerVersion: run.runnerVersion,
      modelRevision: run.modelRevision ?? null,
      artifactIdentity: run.artifactIdentity ?? null,
      licenseEvidence: run.licenseEvidence ?? null,
      modelId: run.modelId ?? null,
      startupMs: run.startupMs ?? null,
      rssBytes: run.rssBytes ?? null,
    },
    metrics: metrics.value,
    observations,
    note: 'Evaluation evidence only. This report does not select or approve a production reranker.',
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    output: outputArg,
    model: identity.model,
    fixtureSha256,
    recallAt1: metrics.value.recallAt1,
    latencyP95Ms: metrics.value.latencyP95Ms,
  }) + '\n');
} finally {
  reranker.close();
}
