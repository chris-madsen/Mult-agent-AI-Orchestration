#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const timeoutMs = Number(process.env.ACE_QDRANT_CRASH_E2E_TIMEOUT_MS ?? 20 * 60_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 60 * 60_000) {
  throw new Error('ACE_QDRANT_CRASH_E2E_TIMEOUT_MS must be between 60000 and 3600000');
}

const [outputArg] = process.argv.slice(2);
if (process.argv.length > 3) {
  throw new Error('Usage: node scripts/qdrant-snapshot-crash-e2e.mjs [output.json]');
}

const root = await mkdtemp(join(tmpdir(), 'ace-qdrant-crash-'));
const workspace = join(root, 'workspace');
const readerState = join(root, 'reader-state');
const writerState = join(root, 'writer-state');
const traces = {
  reader: join(root, 'reader-provider-trace.jsonl'),
  crashedWriter: join(root, 'crashed-writer-provider-trace.jsonl'),
  restartedWriter: join(root, 'restarted-writer-provider-trace.jsonl'),
};
const workspaceId = `qdrant-crash-${randomUUID()}`;
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8',
}).trim().toLowerCase();

const git = (args) => execFileSync('git', args, {
  cwd: workspace,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const fixtureV1 = async () => {
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(
    join(workspace, 'src', 'stable.ts'),
    'export function stableSnapshotSentinel(): string { return "stable-sentinel-v1"; }\n',
    'utf8',
  );
  await writeFile(
    join(workspace, 'src', 'mutable.ts'),
    'export function mutableSnapshotSentinel(): string { return "mutable-sentinel-v1"; }\n',
    'utf8',
  );
  git(['init', '--quiet']);
  git(['add', '.']);
  git([
    '-c', 'user.name=ACE Crash Fixture',
    '-c', 'user.email=ace-crash@example.invalid',
    'commit', '--quiet', '-m', 'snapshot v1',
  ]);
};

const mutateToV2 = async () => {
  await writeFile(
    join(workspace, 'src', 'mutable.ts'),
    'export function mutableSnapshotSentinel(): string { return "mutable-sentinel-v2"; }\n',
    'utf8',
  );
};

const baseEnv = (stateDir, traceFile, failpoint = false) => ({
  ...process.env,
  ACE_WORKSPACE_ROOT: workspace,
  ACE_ALLOWED_ROOTS: root,
  ACE_STATE_DIR: stateDir,
  ACE_WORKSPACE_ID: workspaceId,
  ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
  ACE_QDRANT_URL: qdrantUrl,
  ACE_PROVIDER_TRACE_FILE: traceFile,
  ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER
    ?? resolve(import.meta.dirname, 'fastembed-worker.sh'),
  ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND
    ?? resolve(import.meta.dirname, '../node_modules/.bin/ast-grep'),
  ...(failpoint ? {
    ACE_ENABLE_TEST_FAILPOINTS: 'true',
    ACE_TEST_FAILPOINT: 'after_qdrant_verify_before_publish',
  } : {
    ACE_ENABLE_TEST_FAILPOINTS: 'false',
    ACE_TEST_FAILPOINT: '',
  }),
});

const makeProtocolProcess = (label, stateDir, traceFile) => {
  const child = spawn(process.execPath, ['dist/bin/ace-mcp.js'], {
    cwd: repository,
    env: baseEnv(stateDir, traceFile),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  let nextId = 1;
  let stopped = false;
  const waiters = new Map();

  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const raw = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (raw.trim().length === 0) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (cause) {
        for (const waiter of waiters.values()) waiter.reject(new Error(`${label} invalid MCP JSON: ${String(cause)}`));
        waiters.clear();
        continue;
      }
      const waiter = waiters.get(message.id);
      if (waiter !== undefined) {
        waiters.delete(message.id);
        waiter.resolve(message);
      }
    }
  });

  child.once('exit', (code, signal) => {
    if (stopped) return;
    for (const waiter of waiters.values()) {
      waiter.reject(new Error(`${label} exited before MCP response code=${code} signal=${signal}: ${stderr.slice(-4000)}`));
    }
    waiters.clear();
  });

  const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      waiters.delete(id);
      rejectRequest(new Error(`${label} MCP request timed out: ${stderr.slice(-4000)}`));
    }, timeoutMs);
    waiters.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolveRequest(message);
      },
      reject: (cause) => {
        clearTimeout(timer);
        rejectRequest(cause);
      },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const initialize = async () => {
    const response = await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'ace-qdrant-crash-e2e', version: '1' },
    });
    assert.equal(response.error, undefined, JSON.stringify(response));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  };

  const query = async (queryText, allowPartial = false) => {
    const response = await request('tools/call', {
      name: 'ace_context',
      arguments: {
        workspace_id: workspaceId,
        query: queryText,
        include_docs: false,
        include_memory: false,
      },
    });
    assert.equal(response.error, undefined, JSON.stringify(response));
    if (!allowPartial) assert.equal(response.result?.isError, undefined, JSON.stringify(response));
    const context = response.result?.structuredContent;
    if (!allowPartial) assert.equal(context?.complete, true, JSON.stringify(context));
    return context;
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolveStop) => {
      const force = setTimeout(() => {
        child.kill('SIGKILL');
        resolveStop();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(force);
        resolveStop();
      });
      child.stdin.end();
      child.kill('SIGTERM');
    });
  };

  return { child, initialize, query, stop, stderr: () => stderr };
};

const parseStartupMetrics = (stderr) => {
  const line = stderr.split('\n').reverse().find((item) => item.includes('ace-mcp real retrieval workspace_id='));
  if (line === undefined) throw new Error(`missing real retrieval metrics: ${stderr.slice(-4000)}`);
  const values = {};
  for (const match of line.matchAll(/([a-z_]+)=([^\s]+)/gu)) values[match[1]] = match[2];
  const required = (name) => {
    const value = values[name];
    if (value === undefined || value.length === 0) throw new Error(`missing startup metric ${name}`);
    return value;
  };
  const digest = (name) => {
    const value = required(name);
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`invalid startup digest ${name}`);
    return value;
  };
  return {
    indexKey: digest('index_key'),
    retrievalFingerprint: digest('retrieval_fingerprint'),
    collection: required('collection'),
    publicationMode: required('publication_mode'),
    indexMode: required('index_mode'),
  };
};

const parseVerifiedCandidate = (stderr) => {
  const line = stderr.split('\n').reverse().find((item) => item.includes('ace-mcp qdrant candidate verified'));
  if (line === undefined) throw new Error(`missing verified Qdrant candidate metrics: ${stderr.slice(-4000)}`);
  const value = (name) => {
    const match = new RegExp(`${name}=([^\\s]+)`, 'u').exec(line)?.[1];
    if (match === undefined) throw new Error(`missing candidate metric ${name}: ${line}`);
    return match;
  };
  return {
    indexKey: value('index_key'),
    collection: value('collection'),
    publicationMode: value('publication_mode'),
  };
};

const qdrantCollectionExists = async (collection) => {
  const response = await fetch(`${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(collection)}`);
  if (!response.ok) throw new Error(`Qdrant collection inspection failed: HTTP ${response.status}`);
  return true;
};

const runCrashWriter = async () => {
  const child = spawn(process.execPath, ['dist/bin/ace-mcp.js'], {
    cwd: repository,
    env: baseEnv(writerState, traces.crashedWriter, true),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.resume();

  const outcome = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectExit(new Error(`crash writer did not reach failpoint: ${stderr.slice(-4000)}`));
    }, timeoutMs);
    child.once('error', (cause) => {
      clearTimeout(timer);
      rejectExit(cause);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });

  assert.match(stderr, /ace test failpoint reached name=after_qdrant_verify_before_publish/u);
  assert.equal(outcome.signal, 'SIGKILL', `expected SIGKILL, got ${JSON.stringify(outcome)}`);
  return { ...outcome, stderr };
};

const assertEvidence = (context, citationPart, contentPart) => {
  assert.ok(Array.isArray(context.evidence), 'ContextBundle evidence must be an array');
  const hit = context.evidence.find((item) =>
    typeof item?.citation === 'string'
    && item.citation.includes(citationPart)
    && typeof item?.content === 'string'
    && item.content.includes(contentPart));
  assert.notEqual(hit, undefined, `expected evidence ${citationPart} / ${contentPart}: ${JSON.stringify(context)}`);
  assert.equal(hit?.freshness, 'current');
  return hit;
};

const assertCurrentOrNotReady = (response, citationPart, contentPart) => {
  if (response.status === 'not_ready') {
    assert.equal(response.capability, 'workspace_manifest', JSON.stringify(response));
    return 'not_ready';
  }
  const context = response.status === 'ok' ? response.result : response;
  assert.equal(context?.complete, true, JSON.stringify(response));
  assertEvidence(context, citationPart, contentPart);
  return 'complete';
};

const hashFileIfPresent = async (path) => {
  try {
    const bytes = await readFile(path);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return undefined;
  }
};

let reader;
let restartedWriter;
try {
  await fixtureV1();
  const fixtureCommit = git(['rev-parse', 'HEAD']);

  reader = makeProtocolProcess('reader-a', readerState, traces.reader);
  await reader.initialize();
  const initial = await reader.query('stableSnapshotSentinel stable-sentinel-v1');
  assertEvidence(initial, 'src/stable.ts', 'stable-sentinel-v1');
  const readerMetrics = parseStartupMetrics(reader.stderr());
  assert.equal(readerMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(await qdrantCollectionExists(readerMetrics.collection), true,
    'stable collection must exist before the interrupted writer');

  await mutateToV2();
  const crash = await runCrashWriter();
  const crashedWriterMetrics = parseVerifiedCandidate(crash.stderr);
  assert.equal(crashedWriterMetrics.collection, readerMetrics.collection,
    'interrupted writer must use the stable workspace collection');

  const afterCrash = await reader.query('stableSnapshotSentinel stable-sentinel-v1', true);
  const afterCrashStatus = assertCurrentOrNotReady(afterCrash, 'src/stable.ts', 'stable-sentinel-v1');
  const afterCrashMutable = await reader.query('mutableSnapshotSentinel mutable-sentinel-v2', true);
  const afterCrashMutableStatus = assertCurrentOrNotReady(
    afterCrashMutable,
    'src/mutable.ts',
    'mutable-sentinel-v2',
  );

  restartedWriter = makeProtocolProcess('writer-c', writerState, traces.restartedWriter);
  await restartedWriter.initialize();
  const v2 = await restartedWriter.query('mutableSnapshotSentinel mutable-sentinel-v2');
  assertEvidence(v2, 'src/mutable.ts', 'mutable-sentinel-v2');
  const restartedWriterMetrics = parseStartupMetrics(restartedWriter.stderr());
  assert.equal(restartedWriterMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(restartedWriterMetrics.collection, readerMetrics.collection,
    'changed source must mutate the stable workspace collection');
  assert.equal(await qdrantCollectionExists(restartedWriterMetrics.collection), true,
    'restart must retain the stable workspace collection');

  const afterPublish = await reader.query('stableSnapshotSentinel stable-sentinel-v1', true);
  const afterPublishStatus = assertCurrentOrNotReady(afterPublish, 'src/stable.ts', 'stable-sentinel-v1');

  const providerTraceDigests = {
    reader: await hashFileIfPresent(traces.reader),
    crashedWriter: await hashFileIfPresent(traces.crashedWriter),
    restartedWriter: await hashFileIfPresent(traces.restartedWriter),
  };

  const evidence = {
    schemaVersion: 1,
    evidence: 'real-qdrant-snapshot-crash-lifecycle',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    fixtureCommit,
    qdrant: {
      urlKind: qdrantUrl.startsWith('http://127.0.0.1') || qdrantUrl.startsWith('http://localhost')
        ? 'local-loopback'
        : 'configured-local-host',
      publicationMode: readerMetrics.publicationMode,
      stableCollection: readerMetrics.collection,
      crashedWriterCollection: crashedWriterMetrics.collection,
      restartedWriterCollection: restartedWriterMetrics.collection,
      version: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
    },
    runtime: {
      node: process.version,
      embeddingWorker: basename(process.env.ACE_EMBEDDING_WORKER?.trim()
        || resolve(import.meta.dirname, 'fastembed-worker.sh')),
      astGrepCommand: basename(process.env.ACE_AST_GREP_COMMAND?.trim()
        || resolve(import.meta.dirname, '../node_modules/.bin/ast-grep')),
    },
    checks: {
      readerS1BeforeWriter: 'PASS',
      writerKilledAfterQdrantVerifyBeforePublish: crash.signal === 'SIGKILL' ? 'PASS' : 'FAIL',
      stableCollectionIdentityDuringInterruptedBuild: crashedWriterMetrics.collection === readerMetrics.collection ? 'PASS' : 'FAIL',
      readerDirtyTreeOutcome: afterCrashStatus === 'complete' ? 'PASS_RECONCILED' : 'PASS_NOT_READY',
      readerChangedPathAfterCrash: afterCrashMutableStatus === 'complete' ? 'PASS_CURRENT' : 'PASS_NOT_READY',
      restartPublishedS2: (await qdrantCollectionExists(restartedWriterMetrics.collection)) ? 'PASS' : 'FAIL',
      readerPostPublishOutcome: afterPublishStatus === 'complete' ? 'PASS_RECONCILED' : 'PASS_NOT_READY',
      stableCollectionReused: readerMetrics.collection === restartedWriterMetrics.collection ? 'PASS' : 'FAIL',
    },
    requestIds: {
      readerInitial: initial.requestId,
      readerAfterCrash: afterCrash.requestId,
      readerChangedPathAfterCrash: afterCrashMutable.requestId,
      writerV2: v2.requestId,
      readerAfterPublish: afterPublish.requestId,
    },
    providerTraceDigests,
    note: 'This is bounded real-provider C-A/W04 evidence only. It does not approve provider identities, performance budgets, DBC-13 or production release.',
  };

  if (outputArg !== undefined) {
    const output = resolve(outputArg);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    for (const [name, source] of Object.entries(traces)) {
      try {
        await copyFile(source, join(dirname(output), `${name}-provider-trace.jsonl`));
      } catch {
        // A crash before the first trace event is allowed; the digest remains undefined.
      }
    }
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally {
  if (restartedWriter !== undefined) await restartedWriter.stop().catch(() => undefined);
  if (reader !== undefined) await reader.stop().catch(() => undefined);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
