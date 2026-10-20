#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
const configuredCollection = process.env.ACE_QDRANT_CRASH_COLLECTION?.trim();
const collection = configuredCollection && configuredCollection.length > 0
  ? configuredCollection
  : `ace_ca_crash_${randomUUID().replaceAll('-', '')}`;
const ownsCollection = configuredCollection === undefined || configuredCollection.length === 0;
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
  ACE_ALLOW_LOCAL_FALLBACK: 'false',
  ACE_QDRANT_URL: qdrantUrl,
  ACE_QDRANT_COLLECTION: collection,
  // Intentionally absent: ACE_QDRANT_COLLECTION_EXCLUSIVE_OWNER.
  // Shared explicit collection must therefore skip automatic GC.
  ACE_PROVIDER_TRACE_FILE: traceFile,
  ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER
    ?? resolve(import.meta.dirname, 'fastembed-worker.sh'),
  ACE_TREE_SITTER_HELPER: process.env.ACE_TREE_SITTER_HELPER
    ?? resolve(import.meta.dirname, 'tree-sitter-structural.py'),
  ACE_TREE_SITTER_PYTHON: process.env.ACE_TREE_SITTER_PYTHON
    ?? resolve('.venv-system/bin/python'),
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

  const query = async (queryText) => {
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
    assert.equal(response.result?.isError, undefined, JSON.stringify(response));
    const context = response.result?.structuredContent;
    assert.equal(context?.complete, true, JSON.stringify(context));
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

const findSingleManifest = async (stateDir) => {
  const rootDir = join(stateDir, 'qdrant-snapshots', 'manifests');
  const entries = await readdir(rootDir, { recursive: true });
  const jsonFiles = entries.filter((entry) => String(entry).endsWith('.json'));
  assert.equal(jsonFiles.length, 1, `expected one manifest in ${stateDir}, got ${jsonFiles.length}`);
  const path = join(rootDir, String(jsonFiles[0]));
  return JSON.parse(await readFile(path, 'utf8'));
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
  const initialHit = assertEvidence(initial, 'src/stable.ts', 'stable-sentinel-v1');

  await mutateToV2();
  const crash = await runCrashWriter();
  const building = await findSingleManifest(writerState);
  assert.equal(building.status, 'building',
    'writer killed before publication must leave an unpublished building manifest');

  const afterCrash = await reader.query('stableSnapshotSentinel stable-sentinel-v1');
  const afterCrashHit = assertEvidence(afterCrash, 'src/stable.ts', 'stable-sentinel-v1');
  assert.equal(afterCrashHit.sourceDigest, initialHit.sourceDigest,
    'unchanged S1 symbol must remain bound to the same exact source bytes');

  restartedWriter = makeProtocolProcess('writer-c', writerState, traces.restartedWriter);
  await restartedWriter.initialize();
  const v2 = await restartedWriter.query('mutableSnapshotSentinel mutable-sentinel-v2');
  assertEvidence(v2, 'src/mutable.ts', 'mutable-sentinel-v2');

  const published = await findSingleManifest(writerState);
  assert.equal(published.status, 'published',
    'restart must finish and atomically publish the previously interrupted snapshot');

  const afterPublish = await reader.query('stableSnapshotSentinel stable-sentinel-v1');
  const afterPublishHit = assertEvidence(afterPublish, 'src/stable.ts', 'stable-sentinel-v1');
  assert.equal(afterPublishHit.sourceDigest, initialHit.sourceDigest,
    'publishing S2 must not destroy the active reader S1 snapshot');

  const [readerOwner, writerOwner] = await Promise.all([
    readFile(join(readerState, 'qdrant-snapshots', 'state-owner-id'), 'utf8'),
    readFile(join(writerState, 'qdrant-snapshots', 'state-owner-id'), 'utf8'),
  ]);
  assert.notEqual(readerOwner.trim(), writerOwner.trim(),
    'different ACE_STATE_DIR roots must have distinct persistent state-owner identities');
  assert.match(reader.stderr(), /cleanup skipped: explicit ACE_QDRANT_COLLECTION/u);
  assert.match(restartedWriter.stderr(), /cleanup skipped: explicit ACE_QDRANT_COLLECTION/u);

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
      collection,
      version: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
    },
    runtime: {
      node: process.version,
      embeddingWorker: basename(process.env.ACE_EMBEDDING_WORKER?.trim()
        || resolve(import.meta.dirname, 'fastembed-worker.sh')),
      treeSitterHelper: basename(process.env.ACE_TREE_SITTER_HELPER?.trim()
        || resolve(import.meta.dirname, 'tree-sitter-structural.py')),
    },
    checks: {
      readerS1BeforeWriter: 'PASS',
      writerKilledAfterQdrantVerifyBeforePublish: crash.signal === 'SIGKILL' ? 'PASS' : 'FAIL',
      interruptedManifestStayedBuilding: building.status === 'building' ? 'PASS' : 'FAIL',
      readerS1AfterWriterCrash: 'PASS',
      restartPublishedS2: published.status === 'published' ? 'PASS' : 'FAIL',
      readerS1AfterS2Publish: 'PASS',
      stateOwnersDistinct: readerOwner.trim() !== writerOwner.trim() ? 'PASS' : 'FAIL',
      sharedExplicitCollectionGcSkipped: 'PASS',
    },
    requestIds: {
      readerInitial: initial.requestId,
      readerAfterCrash: afterCrash.requestId,
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
  if (ownsCollection) {
    try {
      await fetch(
        qdrantUrl.replace(/\/$/u, '') + '/collections/' + encodeURIComponent(collection),
        { method: 'DELETE' },
      );
    } catch {
      // Best effort only. Unique generated collection names avoid deleting shared data.
    }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
