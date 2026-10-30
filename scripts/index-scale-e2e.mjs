#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnRealProviderProcess, stopRealProviderProcess } from './real-provider-process.mjs';
import { resolveRealProviderRuntime } from './real-provider-runtime.mjs';

const runtime = await resolveRealProviderRuntime(import.meta.dirname);

const parseArgs = (argv) => {
  const parsed = { files: undefined, changed: 10, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--files' && value !== undefined) {
      parsed.files = Number(value);
      index += 1;
    } else if (arg === '--changed' && value !== undefined) {
      parsed.changed = Number(value);
      index += 1;
    } else if (arg === '--output' && value !== undefined) {
      parsed.output = value;
      index += 1;
    } else {
      throw new Error(`unknown/incomplete argument: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(parsed.files) || parsed.files < 100) {
    throw new Error('--files must be an integer >= 100');
  }
  if (!Number.isSafeInteger(parsed.changed) || parsed.changed < 1 || parsed.changed > parsed.files - 4) {
    throw new Error('--changed must be an integer >= 1 and leave room for rename/delete/untracked fixtures');
  }
  return parsed;
};

const options = parseArgs(process.argv.slice(2));
const phaseTimeoutMs = Number(process.env.ACE_INDEX_SCALE_PHASE_TIMEOUT_MS ?? 30 * 60_000);
if (!Number.isSafeInteger(phaseTimeoutMs) || phaseTimeoutMs < 60_000 || phaseTimeoutMs > 60 * 60_000) {
  throw new Error('ACE_INDEX_SCALE_PHASE_TIMEOUT_MS must be an integer between 60000 and 3600000');
}
const pad = String(options.files - 1).length;
const fileName = (index) => `item-${String(index).padStart(pad, '0')}.ts`;
const filePath = (workspace, index) => join(workspace, 'src', fileName(index));
const sha256File = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

const writeFixtureFiles = async (workspace) => {
  await mkdir(join(workspace, 'src'), { recursive: true });
  const batchSize = 128;
  for (let start = 0; start < options.files; start += batchSize) {
    const end = Math.min(options.files, start + batchSize);
    await Promise.all(Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      const marker = index === 0 ? ' needleScaleTarget' : '';
      const symbol = index === 0
        ? 'needleScaleTarget'
        : `scaleItem${String(index).padStart(pad, '0')}`;
      return writeFile(
        filePath(workspace, index),
        `// scale fixture${marker}\nexport function ${symbol}(): number { return ${index}; }\n`,
        'utf8',
      );
    }));
  }
};

const git = (workspace, args) => execFileSync('git', args, {
  cwd: workspace,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const initializeGit = (workspace) => {
  git(workspace, ['init', '--quiet']);
  git(workspace, ['add', '.']);
  git(workspace, [
    '-c', 'user.name=ACE Scale Fixture',
    '-c', 'user.email=ace-scale@example.invalid',
    'commit', '--quiet', '-m', 'baseline scale fixture',
  ]);
};

const parseStartupMetrics = (stderr) => {
  const line = stderr.split('\n').reverse().find((item) => item.includes('ace-mcp real retrieval workspace_id='));
  if (line === undefined) {
    throw new Error(`ACE startup did not emit real retrieval metrics: ${stderr.slice(-4000)}`);
  }
  const values = {};
  for (const match of line.matchAll(/([a-z_]+)=([^\s]+)/gu)) values[match[1]] = match[2];
  const integer = (name) => {
    const value = Number(values[name]);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid/missing startup metric ${name}`);
    return value;
  };
  const digest = (name) => {
    const value = values[name];
    if (!/^[a-f0-9]{64}$/u.test(value ?? '')) throw new Error(`invalid/missing startup digest ${name}`);
    return value;
  };
  return {
    generation: integer('generation'),
    indexedPaths: integer('indexed_paths'),
    candidates: integer('candidates'),
    coverageFailed: integer('coverage_failed'),
    deltaAdded: integer('delta_added'),
    deltaChanged: integer('delta_changed'),
    deltaDeleted: integer('delta_deleted'),
    deltaRenamed: integer('delta_renamed'),
    deltaUnchanged: integer('delta_unchanged'),
    reusedVectors: integer('reused_vectors'),
    indexMode: values.index_mode,
    collection: values.collection,
    embeddingIdentity: values.embedding_identity,
    structuralIdentity: values.structural_identity,
    retrievalFingerprint: digest('retrieval_fingerprint'),
    indexKey: digest('index_key'),
  };
};

const runOnce = (workspace, state, workspaceId, phase, beforeQuery) => new Promise((resolveRun, rejectRun) => {
  const startedNs = process.hrtime.bigint();
  const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
  const child = spawnRealProviderProcess(process.execPath, [runtime.executable], {
    cwd: runtime.runtimeRoot,
    env: {
      ...process.env,
      ACE_RUNTIME_ROOT: runtime.runtimeRoot,
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: resolve(workspace, '..'),
      ACE_STATE_DIR: state,
      ACE_WORKSPACE_ID: workspaceId,
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
      ACE_RETRIEVAL_STRATEGY: process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'dense',
      ACE_QDRANT_URL: qdrantUrl,
      ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER
        ?? runtime.embeddingWorker,
      ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND
        ?? runtime.astGrepCommand,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const responses = new Map();
  const waiters = new Map();
  let settled = false;
  const stopChild = () => stopRealProviderProcess(child, { termTimeoutMs: 5_000 });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    const timeoutError = new Error(`${phase} MCP request timed out: ${stderr.slice(-4000)}`);
    void stopChild().then(
      () => rejectRun(timeoutError),
      (stopError) => rejectRun(new AggregateError([timeoutError, stopError], `${phase} MCP timed out and cleanup was incomplete`)),
    );
  }, phaseTimeoutMs);

  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    for (;;) {
      const newline = stdout.indexOf('\n');
      if (newline < 0) break;
      const raw = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(raw);
      } catch (cause) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const parseError = new Error(`invalid MCP JSON during ${phase}: ${String(cause)}`);
          void stopChild().then(
            () => rejectRun(parseError),
            (stopError) => rejectRun(new AggregateError([parseError, stopError], `${phase} MCP emitted invalid JSON and cleanup was incomplete`)),
          );
        }
        return;
      }
      const waiter = waiters.get(message.id);
      if (waiter !== undefined) {
        waiters.delete(message.id);
        waiter(message);
      } else {
        responses.set(message.id, message);
      }
    }
  });

  const request = (id, message) => new Promise((resolveRequest) => {
    const existing = responses.get(id);
    if (existing !== undefined) {
      responses.delete(id);
      resolveRequest(existing);
      return;
    }
    waiters.set(id, resolveRequest);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });

  child.once('error', (cause) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectRun(cause);
  });
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectRun(new Error(`${phase} MCP exited prematurely: ${code}: ${stderr.slice(-4000)}`));
  });

  void (async () => {
    try {
      await request(1, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'ace-index-scale-e2e', version: '1' },
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      if (beforeQuery !== undefined) await beforeQuery();
      const requestStartedNs = process.hrtime.bigint();
      const response = await request(2, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'ace_context',
          arguments: {
            workspace_id: workspaceId,
            query: 'needleScaleTarget',
            include_docs: false,
            include_memory: false,
          },
        },
      });
      assert.equal(response.result?.isError, undefined, JSON.stringify(response));
      const context = response.result?.structuredContent;
      assert.equal(context?.complete, true, JSON.stringify(context));
      const completedNs = process.hrtime.bigint();
      const elapsedMs = Number(completedNs - startedNs) / 1_000_000;
      const requestElapsedMs = Number(completedNs - requestStartedNs) / 1_000_000;
      const metrics = parseStartupMetrics(stderr);

      settled = true;
      clearTimeout(timer);
      await stopChild();
      resolveRun({
        phase,
        elapsedMs,
        requestElapsedMs,
        metrics,
        response: {
          requestId: context?.requestId,
          complete: context?.complete,
          evidenceCount: Array.isArray(context?.evidence) ? context.evidence.length : 0,
          codeEvidence: Array.isArray(context?.evidence)
            ? context.evidence
              .filter((evidence) => evidence?.source === 'code')
              .map((evidence) => ({
                citation: evidence.citation,
                sourceDigest: evidence.sourceDigest,
                freshness: evidence.freshness,
              }))
            : [],
        },
      });
    } catch (cause) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await stopChild();
      rejectRun(cause);
    }
  })();
});

const mutateFixture = async (workspace) => {
  await writeFile(
    filePath(workspace, 0),
    '// scale fixture needleScaleTarget changed\nexport function needleScaleTarget(): number { return 1000001; }\n',
    'utf8',
  );

  const renamed = join(workspace, 'src', `renamed-${fileName(1)}`);
  await rename(filePath(workspace, 1), renamed);
  await unlink(filePath(workspace, 2));

  // item 0 above is the first modified existing file. Add exactly
  // changed-1 additional modifications so --changed N has literal meaning.
  for (let offset = 0; offset < options.changed - 1; offset += 1) {
    const index = 3 + offset;
    await writeFile(
      filePath(workspace, index),
      `// scale fixture modified\nexport function scaleItemModified${index}(): number { return ${index + 1}; }\n`,
      'utf8',
    );
  }

  await writeFile(
    join(workspace, 'src', 'untracked-extra.ts'),
    '// intentionally untracked\nexport function untrackedScaleExtra(): string { return "extra"; }\n',
    'utf8',
  );
};

const root = await mkdtemp(join(tmpdir(), 'ace-index-scale-'));
const workspace = join(root, 'workspace');
const state = join(root, 'state');
const workspaceId = `index-scale-${options.files}-${randomUUID()}`;

try {
  await writeFixtureFiles(workspace);
  initializeGit(workspace);
  const sourceCommit = runtime.sourceCommit;

  const d1Path = `src/${fileName(0)}`;
  const d1Digest = await sha256File(filePath(workspace, 0));
  const cold = await runOnce(workspace, state, workspaceId, 'cold');
  const warm = await runOnce(workspace, state, workspaceId, 'warm');

  const citationFor = (phase, path) => phase.response.codeEvidence.find((evidence) =>
    evidence.citation.startsWith(`${path}:`));
  const requireCitation = (phase, path) => {
    const citation = citationFor(phase, path);
    assert.ok(citation !== undefined,
      `${phase.phase} must cite ${path}; observed=${JSON.stringify(phase.response.codeEvidence)}`);
    return citation;
  };
  assert.equal(requireCitation(cold, d1Path).sourceDigest, d1Digest,
    'cold code citation must carry the exact D1 source digest');
  assert.equal(requireCitation(warm, d1Path).sourceDigest, d1Digest,
    'warm code citation must carry the exact D1 source digest');
  assert.equal(cold.metrics.indexKey, warm.metrics.indexKey,
    'unchanged warm run must retain the exact content-derived index key');

  assert.equal(warm.metrics.indexMode, 'warm_reused',
    'unchanged warm run must reuse the published content-derived snapshot');
  assert.equal(warm.metrics.deltaChanged, 0);
  assert.equal(warm.metrics.deltaAdded, 0);
  assert.equal(warm.metrics.deltaDeleted, 0);
  assert.equal(warm.metrics.deltaRenamed, 0);

  let d2Digest;
  const changed = await runOnce(workspace, state, workspaceId, 'change-only', async () => {
    // The process has already completed warm startup on D1. Mutate only after
    // MCP initialization so this request exercises WorkspaceSync incremental
    // reconciliation instead of another startup full build.
    await mutateFixture(workspace);
    const dirtyStatus = git(workspace, ['status', '--porcelain=v1']);
    assert.ok(dirtyStatus.includes('?? src/untracked-extra.ts'), 'fixture must contain a real untracked file');
    d2Digest = await sha256File(filePath(workspace, 0));
  });
  assert.equal(typeof d2Digest, 'string');
  assert.notEqual(changed.metrics.indexKey, cold.metrics.indexKey,
    'change-only phase must publish a different content-derived index key');
  const d2Evidence = requireCitation(changed, d1Path);
  assert.equal(d2Evidence.sourceDigest, d2Digest,
    'change-only code citation must carry the exact D2 source digest');
  assert.equal(d2Evidence.freshness, 'current',
    'change-only code citation must be verified against current D2 bytes');
  assert.equal(changed.metrics.indexMode, 'rebuilt');
  assert.ok(changed.metrics.deltaChanged >= options.changed,
    'change-only phase must observe the requested changed-file count');
  assert.ok(changed.metrics.deltaAdded >= 1, 'change-only phase must observe the untracked added file');
  assert.ok(changed.metrics.deltaDeleted >= 1, 'change-only phase must observe deletion');
  assert.ok(changed.metrics.deltaRenamed >= 1
    || (changed.metrics.deltaAdded >= 2 && changed.metrics.deltaDeleted >= 1),
  'change-only phase must observe rename or its safe delete-plus-add representation');

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit,
    runner: {
      commit: runtime.runnerCommit,
      cleanAtStart: runtime.runnerClean,
    },
    fixture: {
      baselineFiles: options.files,
      requestedChangedFiles: options.changed,
      gitDirty: true,
      d1Path,
      d1Digest,
      d2Digest,
    },
    runtime: {
      node: process.version,
      qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
      embeddingWorker: basename(process.env.ACE_EMBEDDING_WORKER?.trim()
        || resolve(import.meta.dirname, 'fastembed-worker.sh')),
      astGrepCommand: basename(process.env.ACE_AST_GREP_COMMAND?.trim()
        || resolve(import.meta.dirname, '../node_modules/.bin/ast-grep')),
    },
    phases: [cold, warm, changed],
    claims: {
      coldMeasured: true,
      warmReuseVerified: true,
      changeOnlyMeasured: true,
      changeOnlyRequestLatencyMeasured: true,
      contentIndexKeyTransitionVerified: true,
      d2CitationDigestVerified: true,
      renameDeleteUntrackedObserved: true,
      note: 'Cold/warm phases include process startup. The change-only phase mutates D1 after warm startup inside the same live ACE process; requestElapsedMs is the request-time incremental reconciliation latency. Production acceptance still requires selected provider identities, repeated measurements and retained evidence.',
    },
  };

  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (options.output !== undefined) {
    const output = resolve(options.output);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
