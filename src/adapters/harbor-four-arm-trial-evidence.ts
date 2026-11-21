import { createHash } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { open, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HarborFourArmName } from '../domain/harbor-four-arm.js';
import {
  parseHarborFourArmAttemptLedgerEvent,
  type HarborFourArmAttemptLedgerEvent,
  type HarborFourArmLedgerKind,
  type HarborFourArmTrialObservation,
} from '../domain/harbor-four-arm-evidence.js';

// The Gateway-only adapter intentionally reads native projection decisions,
// not optional model-selected tool events. Projection is NOT proof of final model
// egress; successfulAceCalls stays zero until a separately verified final-send
// correlation schema is supported. No fake acceptance metrics are generated.
type JsonRecord = Readonly<Record<string, unknown>>;

const object = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

const readJson = async (path: string): Promise<JsonRecord> => {
  const value = object(JSON.parse(await readFile(path, 'utf8')) as unknown);
  if (value === undefined) throw new Error(`BLOCKED: Harbor JSON must be an object: ${path}`);
  return value;
};

export const readHarborFourArmTrialDirectories = async (aggregatePath: string): Promise<readonly string[]> => {
  const aggregate = await readJson(aggregatePath);
  const count = integer(aggregate.n_total_trials ?? aggregate.nTotalTrials);
  if (count === null || count < 1) throw new Error('BLOCKED: aggregate trial count missing or invalid');
  const parent = dirname(resolve(aggregatePath));
  const entries = await readdir(parent, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name)).sort();
  if (dirs.length !== count) throw new Error('BLOCKED: trial directories do not match aggregate count');
  const start = await Promise.all(dirs.map(async (path) => {
    const data = await readJson(join(path, 'result.json'));
    return { path, time: typeof data.started_at === 'string' ? Date.parse(data.started_at) : NaN };
  }));
  if (start.every((entry) => Number.isFinite(entry.time))) {
    start.sort((left, right) => left.time - right.time);
    if (start.some((entry, i) => i > 0 && entry.time === start[i - 1]?.time)) {
      throw new Error('BLOCKED: ambiguous trial timestamp ordering');
    }
    return start.map((entry) => entry.path);
  }
  return dirs;
};

const readResponsesProjections = async (
  arm: HarborFourArmName,
  directory: string,
): Promise<readonly JsonRecord[]> => {
  const path = join(directory, 'agent', 'ace-responses-projection.jsonl');
  if (!existsSync(path)) {
    if (arm === 'native') return [];
    throw new Error(`BLOCKED: missing native Responses projection evidence at ${path}; do not infer ACE delivery`);
  }
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (arm === 'native' && lines.length > 0) {
    throw new Error('BLOCKED: native baseline contains ACE projection evidence');
  }
  const requests = new Set<string>();
  return lines.map((line, index) => {
    const parsed = object(JSON.parse(line) as unknown);
    const decision = object(parsed?.decision) ?? parsed;
    const kind = decision?.kind;
    const requestId = nonEmpty(parsed?.requestId);
    if (!parsed || parsed.schemaVersion !== 'ace.context.v3'
      || !decision || !['PREPARED', 'BLOCK'].includes(String(kind)) || requestId === undefined) {
      throw new Error(`BLOCKED: malformed native Responses projection evidence ${index + 1}`);
    }
    if (requests.has(requestId)) throw new Error('BLOCKED: duplicate native Responses projection request identity');
    requests.add(requestId);
    return parsed;
  });
};

const readTrial = async (
  arm: HarborFourArmName,
  directory: string,
): Promise<HarborFourArmTrialObservation> => {
  const file = join(directory, 'result.json');
  const record = await readJson(file);
  const taskName = nonEmpty(record.task_name ?? record.trial_name);
  if (taskName === undefined) throw new Error('BLOCKED: missing Harbor trial task name');
  const verifier = object(record.verifier_result);
  const rewards = object(verifier?.rewards);
  const reward = rewards?.reward;
  const exception = object(record.exception_info);
  const failed = record.exception_info !== null && record.exception_info !== undefined;
  const timedOut = record.timed_out === true || exception?.type === 'VerifierTimeoutError';
  if ((typeof reward !== 'number' || !Number.isFinite(reward)) && !failed && !timedOut) {
    throw new Error('BLOCKED: raw verifier reward is missing');
  }
  const agent = object(record.agent_result);
  const began = typeof record.started_at === 'string' ? Date.parse(record.started_at) : NaN;
  const finished = typeof record.finished_at === 'string' ? Date.parse(record.finished_at) : NaN;
  const projections = await readResponsesProjections(arm, directory);
  return {
    arm,
    trialId: nonEmpty(record.trial_id) ?? basename(directory),
    taskName,
    success: !failed && !timedOut && reward === 1,
    timedOut: timedOut ? true : typeof record.timed_out === 'boolean' ? record.timed_out : null,
    // Gateway projection requests are not model-invoked ACE calls and cannot
    // establish that a provider actually received the rewritten request.
    observedAceCalls: 0,
    successfulAceCalls: 0,
    observedAceToolCalls: 0,
    successfulAceToolCalls: 0,
    gatewayProjectionRequestIds: projections.map((projection) => String(projection.requestId)),
    rawInputTokens: integer(agent?.n_input_tokens),
    rawOutputTokens: integer(agent?.n_output_tokens),
    cachedInputTokens: integer(agent?.n_cache_tokens),
    nativeFileReads: null,
    uniqueContextBytes: null,
    newContextBytes: null,
    reusedContextBytes: null,
    duplicateContextAvoided: null,
    latencyMs: Number.isFinite(began) && Number.isFinite(finished) && finished >= began ? finished - began : null,
    successfulRequestIds: [],
    evidenceReceiptIds: [],
    reusedReceiptIds: [],
  };
};

export const readHarborFourArmTrialObservations = async (
  arm: HarborFourArmName,
  aggregatePath: string,
): Promise<readonly HarborFourArmTrialObservation[]> =>
  Promise.all((await readHarborFourArmTrialDirectories(aggregatePath)).map((directory) => readTrial(arm, directory)));


export interface HarborFourArmLedgerArtifacts {
  readonly artifacts: readonly { readonly path: string; readonly sha256: string }[];
  readonly events: readonly HarborFourArmAttemptLedgerEvent[];
}

/**
 * AR10: read the EXISTING rawTracePaths/usageEventPaths/failedRunPaths as
 * versioned, internal, redacted Harbor observation events. Retain UNKNOWN
 * when none are present; never promote a file hash into a provider attempt.
 */
export const readHarborFourArmLedgerArtifacts = async (
  workspaceRoot: string,
  paths: readonly string[],
  expectedKind: HarborFourArmLedgerKind,
): Promise<HarborFourArmLedgerArtifacts> => {
  const root = await realpath(workspaceRoot);
  const artifacts: { path: string; sha256: string }[] = [];
  const events: HarborFourArmAttemptLedgerEvent[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path.trim().length === 0 || isAbsolute(path)) {
      throw new Error('BLOCKED: Harbor evidence artifact path must be workspace-relative');
    }
    const pathname = resolve(root, path);
    const inside = (candidate: string): boolean => {
      const child = relative(root, candidate);
      return child.length > 0 && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
    };
    if (!inside(pathname)) {
      throw new Error('BLOCKED: Harbor evidence artifact escapes the frozen workspace');
    }
    if (seen.has(pathname)) throw new Error('BLOCKED: duplicate Harbor event artifact path');
    seen.add(pathname);
    // Do not check one pathname and read it again after an attacker can swap
    // it. Open with NOFOLLOW, then verify and read the same OS file handle.
    // The current Harbor/Qdrant evidence runtime is Linux; refuse a platform
    // without an authoritative /proc/self/fd target rather than weakening it.
    if (process.platform !== 'linux') {
      throw new Error('BLOCKED: Harbor file-descriptor evidence verification requires Linux');
    }
    const handle = await open(pathname, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const openedPath = await realpath('/proc/self/fd/' + handle.fd);
      if (!inside(openedPath)) {
        throw new Error('BLOCKED: Harbor evidence artifact escapes the frozen workspace');
      }
      const info = await handle.stat();
      if (!info.isFile() || info.size > 8 * 1024 * 1024) {
        throw new Error('BLOCKED: Harbor evidence artifact must be a bounded regular file');
      }
      bytes = await handle.readFile();
      if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
        throw new Error('BLOCKED: Harbor evidence artifact is empty or oversized');
      }
    } finally {
      await handle.close();
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    if (lines.length === 0) throw new Error('BLOCKED: Harbor evidence artifact has no events');
    for (const [index, line] of lines.entries()) {
      let parsed: unknown;
      try { parsed = JSON.parse(line) as unknown; } catch {
        throw new Error('BLOCKED: malformed Harbor event JSONL line ' + (index + 1));
      }
      const result = parseHarborFourArmAttemptLedgerEvent(parsed, expectedKind);
      if (result._tag === 'Err') {
        throw new Error('BLOCKED: invalid Harbor ' + expectedKind + ' event ' + (index + 1)
          + ': ' + result.error.path + ': ' + result.error.message);
      }
      events.push(result.value);
    }
    artifacts.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { artifacts, events };
};
