#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { makeAsyncFileMemoryArchive } from '../dist/adapters/file-memory-archive.js';
import { makeGraphitiMcpPort } from '../dist/adapters/graphiti-mcp.js';
import { makeFileProviderTrace } from '../dist/adapters/provider-trace.js';
import { defaultLocalPolicy } from '../dist/domain/policy.js';
import { makeEpisodeId } from '../dist/domain/memory.js';
import { makeWorkspaceId } from '../dist/domain/workspace.js';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

if (process.env.ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY !== 'true') {
  throw new Error('Set ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true; crash recovery is synthetic-fixture only.');
}

const [fixtureArg = 'benchmarks/fixtures/graphiti-memory-lifecycle-v1.json',
  outputArg = 'artifacts/graphiti-crash-recovery/evidence.json'] = process.argv.slice(2);
if (process.argv.slice(2).length > 2) {
  throw new Error('Usage: node scripts/graphiti-crash-recovery-e2e.mjs [fixture.json] [output.json]');
}

const fixturePath = resolve(fixtureArg);
const outputPath = resolve(outputArg);
await mkdir(dirname(outputPath), { recursive: true });
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
if (fixture.schema_version !== 1 || fixture.status !== 'frozen') {
  throw new Error('Graphiti crash recovery requires the committed frozen fixture');
}

const timeoutMs = Number(process.env.ACE_GRAPHITI_CRASH_TIMEOUT_MS ?? 120_000);
const pollAttempts = Number(process.env.ACE_GRAPHITI_CRASH_RECONCILE_ATTEMPTS ?? 120);
const pollDelayMs = Number(process.env.ACE_GRAPHITI_CRASH_RECONCILE_DELAY_MS ?? 500);
for (const [name, value, min, max] of [
  ['ACE_GRAPHITI_CRASH_TIMEOUT_MS', timeoutMs, 10_000, 600_000],
  ['ACE_GRAPHITI_CRASH_RECONCILE_ATTEMPTS', pollAttempts, 1, 1_000],
  ['ACE_GRAPHITI_CRASH_RECONCILE_DELAY_MS', pollDelayMs, 0, 60_000],
]) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} is outside its allowed range`);
  }
}

const root = await mkdtemp(resolve(tmpdir(), 'ace-graphiti-crash-recovery-'));
const archiveRoot = resolve(root, 'archive');
const workerTrace = resolve(dirname(outputPath), 'crash-worker-provider-trace.jsonl');
const recoveryTrace = resolve(dirname(outputPath), 'recovery-provider-trace.jsonl');
const workspaceValue = `graphiti-crash-${randomUUID()}`;
const episodeValue = `graphiti-crash-${randomUUID()}`;
const groupId = `ace-graphiti-crash-${randomUUID()}`;
const workspace = makeWorkspaceId(workspaceValue);
const episodeId = makeEpisodeId(episodeValue);
if (workspace._tag === 'Err' || episodeId._tag === 'Err') throw new Error('could not create isolated identifiers');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim().toLowerCase();
const command = required('ACE_GRAPHITI_COMMAND');
const argsRaw = required('ACE_GRAPHITI_ARGS_JSON');
const parsedArgs = JSON.parse(argsRaw);
if (!Array.isArray(parsedArgs) || !parsedArgs.every((item) => typeof item === 'string')) {
  throw new Error('ACE_GRAPHITI_ARGS_JSON must decode to a string array');
}

const baseEnv = {
  ...process.env,
  ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY: 'true',
  ACE_WORKSPACE_ID: workspace.value,
  ACE_MEMORY_ARCHIVE_ROOT: archiveRoot,
  ACE_GRAPHITI_COMMAND: command,
  ACE_GRAPHITI_ARGS_JSON: argsRaw,
  ACE_GRAPHITI_GROUP_ID: groupId,
  ACE_GRAPHITI_CRASH_EPISODE_ID: episodeId.value,
  ACE_GRAPHITI_CRASH_FIXTURE: fixturePath,
  ACE_MEMORY_PROJECTION_MAX_ATTEMPTS: process.env.ACE_MEMORY_PROJECTION_MAX_ATTEMPTS ?? '10',
  ACE_MEMORY_PROJECTION_BASE_DELAY_MS: process.env.ACE_MEMORY_PROJECTION_BASE_DELAY_MS ?? '100',
  ACE_MEMORY_PROJECTION_MAX_DELAY_MS: process.env.ACE_MEMORY_PROJECTION_MAX_DELAY_MS ?? '1000',
  ACE_MEMORY_PROJECTION_VERIFY_DELAY_MS: process.env.ACE_MEMORY_PROJECTION_VERIFY_DELAY_MS ?? '0',
};

const run = (label, executable, args, env, expectedSignal) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, args, {
    cwd: resolve(import.meta.dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: expectedSignal !== undefined,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const killProcessTree = () => {
    if (expectedSignal !== undefined && child.pid !== undefined && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    } else {
      child.kill('SIGKILL');
    }
  };
  const timer = setTimeout(() => {
    killProcessTree();
    rejectRun(new Error(`${label} timed out: ${stderr.slice(-4000)}`));
  }, timeoutMs);
  child.once('error', (cause) => {
    clearTimeout(timer);
    rejectRun(cause);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    if (expectedSignal !== undefined) {
      if (signal !== expectedSignal) {
        killProcessTree();
        rejectRun(new Error(`${label} expected signal ${expectedSignal}, got code=${code} signal=${signal}: ${stderr.slice(-4000)}`));
        return;
      }
      // The worker intentionally dies without finally/close. Kill any Graphiti
      // MCP subprocess that inherited the worker's detached process group so
      // the crash test does not leak orphan helper processes.
      killProcessTree();
    } else if (code !== 0) {
      rejectRun(new Error(`${label} failed code=${code} signal=${signal}: ${stderr.slice(-4000)}`));
      return;
    }
    resolveRun({ code, signal, stdout, stderr });
  });
});

const delay = (milliseconds) => new Promise((resolveDelay) => { setTimeout(resolveDelay, milliseconds); });

const readOnlyReceipt = async () => {
  const outboxRoot = join(archiveRoot, 'projection-outbox');
  const entries = (await readdir(outboxRoot)).filter((entry) => entry.endsWith('.json'));
  assert.equal(entries.length, 1, `expected one projection receipt, found ${entries.length}`);
  return JSON.parse(await readFile(join(outboxRoot, entries[0]), 'utf8'));
};

try {
  const crash = await run(
    'graphiti-crash-worker',
    process.execPath,
    ['scripts/graphiti-crash-worker.mjs'],
    {
      ...baseEnv,
      ACE_ENABLE_TEST_FAILPOINTS: 'true',
      ACE_TEST_FAILPOINT: 'after_graphiti_enqueue_before_outbox_receipt',
      ACE_PROVIDER_TRACE_FILE: workerTrace,
    },
    'SIGKILL',
  );
  assert.match(crash.stderr, /ace graphiti test failpoint reached name=after_graphiti_enqueue_before_outbox_receipt/u);
  const providerStatus = crash.stderr.match(/provider_status=([^\s]+)/u)?.[1] ?? 'unknown';

  const pending = await readOnlyReceipt();
  assert.equal(pending.status, 'pending',
    'SIGKILL before provider receipt persistence must leave the durable pre-enqueue intent pending');
  assert.equal(pending.attempts, 0);

  let reconcilePasses = 0;
  let projected;
  const reconcileOutputs = [];
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    reconcilePasses = attempt;
    const reconciled = await run(
      `ace-memory reconcile pass ${attempt}`,
      process.execPath,
      ['dist/bin/ace-memory.js', 'reconcile'],
      { ...baseEnv, ACE_PROVIDER_TRACE_FILE: recoveryTrace },
    );
    if (reconciled.stdout.trim().length > 0) reconcileOutputs.push(reconciled.stdout.trim());
    const receipt = await readOnlyReceipt();
    if (receipt.status === 'projected') {
      projected = receipt;
      break;
    }
    if (receipt.status === 'dead_letter') {
      throw new Error(`projection dead-lettered during crash recovery: ${JSON.stringify(receipt)}`);
    }
    if (attempt < pollAttempts && pollDelayMs > 0) await delay(pollDelayMs);
  }
  if (projected === undefined) throw new Error('projection never reached durable projected state after restart reconciliation');

  const archive = await makeAsyncFileMemoryArchive(archiveRoot);
  const graphiti = await makeGraphitiMcpPort({
    command,
    args: parsedArgs,
    groupId,
    workspaceId: workspace.value,
    policy: defaultLocalPolicy(workspace.value),
    archive,
    trace: makeFileProviderTrace(recoveryTrace),
    providerVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'graphiti-mcp/crash-recovery-e2e',
  });
  let provenanceHitCount = 0;
  try {
    const present = await Effect.runPromise(graphiti.projectionState.isPresent(episodeId.value));
    assert.equal(present._tag, 'Ok');
    if (present._tag === 'Err') throw new Error(present.error.message);
    assert.equal(present.value, true, 'reconciled projection must be observable in real Graphiti');

    if (graphiti.memory === undefined) throw new Error('Graphiti memory search unavailable after recovery');
    const recalled = await Effect.runPromise(graphiti.memory.search({
      workspaceId: workspace.value,
      query: fixture.query,
      includeOriginal: false,
      requestId: `graphiti-crash-recall-${randomUUID()}`,
    }));
    assert.equal(recalled._tag, 'Ok');
    if (recalled._tag === 'Err') throw new Error(recalled.error.message);
    const archived = await archive.readEpisode(episodeId.value);
    assert.equal(archived._tag, 'Ok');
    if (archived._tag === 'Err') throw new Error(archived.error.message);
    provenanceHitCount = recalled.value.hits.filter((hit) =>
      hit.episode.episodeId === episodeId.value
      && hit.episode.sourcePointer === archived.value.sourcePointer
      && hit.episode.contentDigest === archived.value.contentDigest).length;
    assert.ok(provenanceHitCount > 0,
      'recovered Graphiti recall must map back to the exact immutable ACE episode');
  } finally {
    await graphiti.close();
  }

  await run(
    'ace-memory delete after recovery',
    process.execPath,
    ['dist/bin/ace-memory.js', 'delete', episodeId.value],
    { ...baseEnv, ACE_PROVIDER_TRACE_FILE: recoveryTrace },
  );

  const tombstoned = await readOnlyReceipt();
  assert.equal(tombstoned.status, 'tombstoned');

  const archivedAfterDelete = await archive.readEpisode(episodeId.value);
  assert.equal(archivedAfterDelete._tag, 'Err');
  if (archivedAfterDelete._tag === 'Err') {
    assert.equal(archivedAfterDelete.error.code, 'ARCHIVE_TOMBSTONED');
  }

  const verificationGraphiti = await makeGraphitiMcpPort({
    command,
    args: parsedArgs,
    groupId,
    workspaceId: workspace.value,
    policy: defaultLocalPolicy(workspace.value),
    archive,
    trace: makeFileProviderTrace(recoveryTrace),
    providerVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'graphiti-mcp/crash-recovery-e2e',
  });
  try {
    const presentAfterDelete = await Effect.runPromise(verificationGraphiti.projectionState.isPresent(episodeId.value));
    assert.equal(presentAfterDelete._tag, 'Ok');
    if (presentAfterDelete._tag === 'Err') throw new Error(presentAfterDelete.error.message);
    assert.equal(presentAfterDelete.value, false, 'derived Graphiti projection must remain absent after verified purge');
  } finally {
    await verificationGraphiti.close();
  }

  const traceDigest = async (path) => {
    try {
      return createHash('sha256').update(await readFile(path)).digest('hex');
    } catch {
      return undefined;
    }
  };

  const evidence = {
    schemaVersion: 1,
    evidence: 'real-graphiti-crash-recovery',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    fixture: fixtureArg,
    fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    workspaceId: workspace.value,
    groupId,
    episodeId: episodeId.value,
    graphitiVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'unknown',
    inference: {
      llm: process.env.ACE_GRAPHITI_LLM_ID?.trim() || 'unknown',
      embedder: process.env.ACE_GRAPHITI_EMBEDDER_ID?.trim() || 'unknown',
      reranker: process.env.ACE_GRAPHITI_RERANKER_ID?.trim() || 'unknown',
    },
    crash: {
      signal: crash.signal,
      failpoint: 'after_graphiti_enqueue_before_outbox_receipt',
      providerStatusBeforeCrash: providerStatus,
      durableReceiptBeforeRecovery: { status: pending.status, attempts: pending.attempts },
    },
    recovery: {
      reconcilePasses,
      durableProjected: projected.status === 'projected',
      projectionAttempts: projected.attempts,
      provenanceHitCount,
      purgeVerified: true,
      archiveTombstoneVerified: true,
      outboxTombstoned: tombstoned.status === 'tombstoned',
    },
    traces: {
      crashWorkerSha256: await traceDigest(workerTrace),
      recoverySha256: await traceDigest(recoveryTrace),
    },
    reconcileOutputs,
    note: 'Bounded synthetic real-provider W07 crash-recovery evidence only. It does not approve inference providers, DBC-11, cost budgets or production release.',
  };
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ status: 'PASS', output: outputArg, reconcilePasses }) + '\n');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
