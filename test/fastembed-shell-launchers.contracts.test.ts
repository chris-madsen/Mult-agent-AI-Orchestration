import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeProcessRerankerPort } from '../src/adapters/process-reranker.js';
import { makeProcessSparseEmbeddingPort } from '../src/adapters/process-sparse-embedding.js';

const rerankerShell = resolve('scripts/fastembed-reranker-worker.sh');
const sparseShell = resolve('scripts/fastembed-sparse-worker.sh');

test('FastEmbed shell workers have actual line breaks, Bash syntax and executable modes', {
  skip: process.platform === 'win32',
}, async () => {
  for (const path of [rerankerShell, sparseShell]) {
    const source = await readFile(path, 'utf8');
    assert.ok(source.startsWith('#!/usr/bin/env bash\nset -euo pipefail\n'),
      `${path}: Bash shebang must end with a real newline`);
    assert.equal(source.includes('\\nset -euo'), false, 'literal escaped newlines are not valid shell lines');
    assert.notEqual((await stat(path)).mode & 0o111, 0, `${path} must be executable`);
    execFileSync('bash', ['-n', path], { stdio: 'pipe' });
  }
});

test('real reranker shell launcher forwards requests to a stub worker', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-reranker-shell-'));
  const fakePython = join(root, 'fake-python');
  await writeFile(fakePython, `#!/usr/bin/env node
const readline = require('node:readline');
const model = process.argv[3];
console.log(JSON.stringify({ type: 'ready', identity: {
  provider: 'fake-fastembed', model,
  runtimeBuild: 'fixture#1', runtimeVersion: 'node/test',
} }));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, scores: request.documents.map((text) => text.includes('best') ? 0.9 : 0.1) }));
});
`, 'utf8');
  await chmod(fakePython, 0o755);
  const port = makeProcessRerankerPort({
    command: rerankerShell,
    expectedModel: 'fixture/cross-encoder',
    timeoutMs: 10_000,
    env: {
      ACE_RERANKER_PYTHON: fakePython,
      ACE_RERANKER_MODEL: 'fixture/cross-encoder',
    },
  });
  try {
    const observed = await Effect.runPromise(port.rerank({
      query: 'what is best',
      documents: ['ordinary', 'best match'],
    }));
    assert.equal(observed._tag, 'Ok');
    if (observed._tag === 'Ok') assert.deepEqual(observed.value.map((r) => r.index), [1, 0]);
  } finally {
    port.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('real sparse shell launcher starts an explicitly configured sparse worker', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-sparse-shell-'));
  const fakePython = join(root, 'fake-python');
  await writeFile(fakePython, `#!/usr/bin/env node
const readline = require('node:readline');
const model = process.argv[3];
console.log(JSON.stringify({ type: 'ready', identity: {
  provider: 'fake-sparse', model, preprocessing: 'fixture',
  artifactDigest: 'a'.repeat(64), runtimeBuild: 'fixture#1',
  runtimeVersion: 'node/test',
} }));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, vectors: request.texts.map(() => ({
    indices: [1], values: [0.75],
  })) }));
});
`, 'utf8');
  await chmod(fakePython, 0o755);
  const port = makeProcessSparseEmbeddingPort({
    command: sparseShell,
    expectedModel: 'Qdrant/bm25',
    timeoutMs: 10_000,
    env: {
      ACE_SPARSE_EMBEDDING_PYTHON: fakePython,
      ACE_SPARSE_EMBEDDING_MODEL: 'Qdrant/bm25',
    },
  });
  try {
    const result = await Effect.runPromise(port.embedQueries(['identifier search']));
    assert.equal(result._tag, 'Ok');
    if (result._tag === 'Ok') assert.deepEqual(result.value, [{ indices: [1], values: [0.75] }]);
  } finally {
    port.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('real sparse shell launcher forwards explicit preload configuration', {
  skip: process.platform === 'win32',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-sparse-preload-'));
  const fakePython = join(root, 'fake-python');
  await writeFile(fakePython, `#!/usr/bin/env node
const readline = require('node:readline');
const model = process.argv[3];
console.log(JSON.stringify({ type: 'ready', identity: {
  provider: 'fake-sparse', model, preprocessing: 'fixture',
  artifactDigest: 'a'.repeat(64), runtimeBuild: 'fixture#1',
  runtimeVersion: [process.env.LD_LIBRARY_PATH || 'missing', process.env.LD_PRELOAD || 'missing'].join('|'),
} }));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, vectors: request.texts.map(() => ({ indices: [1], values: [0.75] })) }));
});
`, 'utf8');
  await chmod(fakePython, 0o755);
  const libraryPath = '/tmp/ace-sparse-library-path';
  const preload = '/lib/x86_64-linux-gnu/libstdc++.so.6';
  const port = makeProcessSparseEmbeddingPort({
    command: sparseShell,
    expectedModel: 'Qdrant/bm25',
    timeoutMs: 10_000,
    env: {
      ACE_SPARSE_EMBEDDING_PYTHON: fakePython,
      ACE_SPARSE_EMBEDDING_MODEL: 'Qdrant/bm25',
      ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH: libraryPath,
      ACE_SPARSE_EMBEDDING_LD_PRELOAD: preload,
    },
  });
  try {
    const observed = await Effect.runPromise(port.probe());
    assert.equal(observed._tag, 'Ok');
    assert.equal(port.identity()?.runtimeVersion, `${libraryPath}|${preload}`);
  } finally {
    port.close();
    await rm(root, { recursive: true, force: true });
  }
});


test('ACE MCP runtime forwards explicit sparse LD library path into the sparse worker environment', async () => {
  const runtime = await readFile(resolve('src/bin/ace-mcp.ts'), 'utf8');
  assert.match(runtime, /ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH/u);
  assert.match(runtime, /Object\.fromEntries\(\[/u);
  assert.match(runtime, /makeProcessSparseEmbeddingPort\(/u);
});


test('feedback preflight probes the sparse provider required by hybrid retrieval', async () => {
  const preflight = await readFile(resolve('scripts/feedback-loop-preflight.ts'), 'utf8');
  assert.match(preflight, /fastembed-sparse-worker\.sh/u);
  assert.match(preflight, /sparseEmbedding/u);
});


test('sparse FastEmbed launcher contains one Nix library bootstrap block after merges', async () => {
  const source = await readFile(sparseShell, 'utf8');
  const bootstrapBranches = source.match(/elif \[\[ "\$\{python_command\}" == "\$\{default_python\}" \]\]; then/gu) ?? [];
  assert.equal(bootstrapBranches.length, 1);
});

test('FastEmbed launchers reject incompatible Nix libraries before exporting them', async () => {
  const [dense, sparse] = await Promise.all([
    readFile(resolve('scripts/fastembed-worker.sh'), 'utf8'),
    readFile(sparseShell, 'utf8'),
  ]);
  for (const source of [dense, sparse]) {
    assert.match(source, /candidate_library_path=/u);
    assert.match(source, /LD_LIBRARY_PATH="\$candidate_library_path" "\$\{python_command\}" -c 'import numpy'/u);
    assert.match(source, /else\n\s+unset LD_LIBRARY_PATH\n\s+fi/u);
  }
});
