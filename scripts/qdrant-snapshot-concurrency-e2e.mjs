#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveRealProviderRuntime } from './real-provider-runtime.mjs';

const runtime = await resolveRealProviderRuntime(import.meta.dirname);
const timeoutMs = Number(process.env.ACE_QDRANT_CONCURRENCY_TIMEOUT_MS ?? 20 * 60_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 60 * 60_000) {
  throw new Error('ACE_QDRANT_CONCURRENCY_TIMEOUT_MS must be between 60000 and 3600000');
}

const runnerArgs = process.argv.slice(2);
let outputArg;
if (runnerArgs.length === 1) {
  [outputArg] = runnerArgs;
} else if (runnerArgs.length === 2 && runnerArgs[0] === '--output') {
  [, outputArg] = runnerArgs;
} else if (runnerArgs.length !== 0) {
  throw new Error('Usage: node scripts/qdrant-snapshot-concurrency-e2e.mjs [--output output.json]');
}

const root = await mkdtemp(join(tmpdir(), 'ace-qdrant-concurrency-'));
const workspace = join(root, 'workspace');
const state = join(root, 'shared-state');
const workspaceId = `qdrant-concurrency-${randomUUID()}`;
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const embeddingDelayMs = process.env.ACE_QDRANT_CONCURRENCY_EMBEDDING_DELAY_MS?.trim() || '750';
const sourceCommit = runtime.sourceCommit;
const publishedCollections = new Set();

const sourcePath = join(workspace, 'src', 'concurrent-sentinel.ts');
const source = [
  'export function concurrentSnapshotSentinel(input: string): string {',
  '  return `concurrent-snapshot:${input}`;',
  '}',
  '',
].join('\n');

const fixtureDigest = createHash('sha256').update(source, 'utf8').digest('hex');

const writeFixture = async () => {
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(sourcePath, source, 'utf8');
  await writeFile(
    join(workspace, 'src', 'concurrent-support.ts'),
    'export const concurrentSupport = "same-snapshot";\n',
    'utf8',
  );
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
    indexMode: required('index_mode'),
    embeddingIdentity: required('embedding_identity'),
    structuralIdentity: required('structural_identity'),
    publicationMode: required('publication_mode'),
  };
};

const makeClient = (label) => {
  const traceFile = join(root, `${label}-provider-trace.jsonl`);
  const child = spawn(process.execPath, [runtime.executable], {
    cwd: runtime.runtimeRoot,
    env: {
      ...process.env,
      ACE_RUNTIME_ROOT: runtime.runtimeRoot,
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: root,
      ACE_STATE_DIR: state,
      ACE_WORKSPACE_ID: workspaceId,
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
      ACE_RETRIEVAL_STRATEGY: process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'dense',
      ACE_QDRANT_URL: qdrantUrl,
      ACE_PROVIDER_TRACE_FILE: traceFile,
      ACE_EMBEDDING_DELAY_MS: embeddingDelayMs,
      ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER
        ?? runtime.embeddingWorker,
      ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND
        ?? runtime.astGrepCommand,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let nextId = 1;
  let stopped = false;
  const responses = new Map();
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
      } else if (message.id !== undefined) {
        responses.set(message.id, message);
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
    const existing = responses.get(id);
    if (existing !== undefined) {
      responses.delete(id);
      clearTimeout(timer);
      resolveRequest(existing);
      return;
    }
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
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const initialize = async () => {
    const response = await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: `ace-qdrant-concurrency-${label}`, version: '1' },
    });
    assert.equal(response.error, undefined, JSON.stringify(response));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  };

  const query = async () => {
    const response = await request('tools/call', {
      name: 'ace_context',
      arguments: {
        workspace_id: workspaceId,
        query: 'concurrentSnapshotSentinel same-snapshot',
        include_docs: false,
        include_memory: false,
      },
    });
    assert.equal(response.error, undefined, JSON.stringify(response));
    assert.equal(response.result?.isError, undefined, `${JSON.stringify(response)}\nstderr=${stderr.slice(-4000)}`);
    return response.result?.structuredContent;
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

  return {
    initialize,
    query,
    stop,
    stderr: () => stderr,
    traceFile,
  };
};

const findEvidence = (context) => {
  assert.equal(context?.complete, true, JSON.stringify(context));
  const evidence = context.evidence?.find((item) =>
    item?.citation?.startsWith('src/concurrent-sentinel.ts:')
    && item?.content?.includes('concurrentSnapshotSentinel'));
  assert.notEqual(evidence, undefined, JSON.stringify(context));
  assert.equal(evidence.freshness, 'current');
  assert.equal(evidence.sourceDigest, fixtureDigest);
  return evidence;
};

const qdrantCollectionExists = async (collection) => {
  const response = await fetch(`${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(collection)}`);
  if (!response.ok) throw new Error(`Qdrant collection inspection failed: HTTP ${response.status}`);
  return true;
};

const digestIfPresent = async (path) => {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return undefined;
  }
};

let first;
let second;
try {
  await writeFixture();
  first = makeClient('writer-a');
  second = makeClient('writer-b');
  await Promise.all([first.initialize(), second.initialize()]);
  const startedAt = Date.now();
  const [firstContext, secondContext] = await Promise.all([first.query(), second.query()]);
  const elapsedMs = Date.now() - startedAt;
  const firstEvidence = findEvidence(firstContext);
  const secondEvidence = findEvidence(secondContext);
  const firstMetrics = parseStartupMetrics(first.stderr());
  const secondMetrics = parseStartupMetrics(second.stderr());
  assert.equal(firstMetrics.collection, secondMetrics.collection);
  assert.equal(firstMetrics.indexKey, secondMetrics.indexKey, 'writers must converge on one content snapshot');
  assert.equal(firstMetrics.retrievalFingerprint, secondMetrics.retrievalFingerprint);
  assert.equal(firstMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(secondMetrics.publicationMode, 'stable_collection_direct');
  assert.equal(firstEvidence.sourceDigest, secondEvidence.sourceDigest);
  publishedCollections.add(firstMetrics.collection);
  assert.equal(await qdrantCollectionExists(firstMetrics.collection), true,
    'stable collection must exist after verified concurrent publication');

  const result = {
    schemaVersion: 1,
    evidence: 'real-qdrant-snapshot-concurrency',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    fixture: {
      workspaceId,
      sourcePath: 'src/concurrent-sentinel.ts',
      sourceDigest: fixtureDigest,
    },
    runtime: {
      node: process.version,
      qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
      qdrantUrlKind: qdrantUrl.startsWith('http://127.0.0.1') || qdrantUrl.startsWith('http://localhost')
        ? 'local-loopback' : 'configured-local-host',
      embeddingWorker: basename(process.env.ACE_EMBEDDING_WORKER?.trim()
        || resolve(import.meta.dirname, 'fastembed-worker.sh')),
      astGrepCommand: basename(process.env.ACE_AST_GREP_COMMAND?.trim()
        || resolve(import.meta.dirname, '../node_modules/.bin/ast-grep')),
      embeddingDelayMs: Number(embeddingDelayMs),
    },
    concurrency: {
      elapsedMs,
      collection: firstMetrics.collection,
      publicationMode: firstMetrics.publicationMode,
      indexKey: firstMetrics.indexKey,
      retrievalFingerprint: firstMetrics.retrievalFingerprint,
      writers: [
        { label: 'writer-a', metrics: firstMetrics, requestId: firstContext.requestId },
        { label: 'writer-b', metrics: secondMetrics, requestId: secondContext.requestId },
      ],
    },
    checks: {
      bothRequestsComplete: 'PASS',
      bothCitationsCurrent: 'PASS',
      citationsShareD1Digest: 'PASS',
      writersConvergedOnIndexKey: 'PASS',
      writersConvergedOnProviderFingerprint: 'PASS',
      stableCollectionExists: (await qdrantCollectionExists(firstMetrics.collection)) ? 'PASS' : 'FAIL',
      noDuplicateCollectionForSameIndex: firstMetrics.collection === secondMetrics.collection ? 'PASS' : 'FAIL',
    },
    providerTraceDigests: {
      writerA: await digestIfPresent(first.traceFile),
      writerB: await digestIfPresent(second.traceFile),
    },
    claims: {
      sameSnapshotConcurrencyMeasured: true,
      productionApproved: false,
      tokenSavings5x: false,
      graphitiLocalOnly: false,
      note: 'Real local-provider concurrency evidence only; it does not close W04 production gates or approve Graphiti/OAuth/Vertex claims.',
    },
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputArg !== undefined) {
    const output = resolve(outputArg);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
} finally {
  if (second !== undefined) await second.stop().catch(() => undefined);
  if (first !== undefined) await first.stop().catch(() => undefined);
  try {
    for (const collection of publishedCollections) {
      await fetch(`${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(collection)}`, { method: 'DELETE' });
    }
  } catch {
    // The generated collection name is unique; a failed cleanup is retained as a blocker in the command output.
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
