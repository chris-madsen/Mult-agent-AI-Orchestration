import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const makeSeparatedRunnerRoots = async (runtimeCommit?: string): Promise<{
  readonly parent: string;
  readonly sourceRoot: string;
  readonly runtimeRoot: string;
  readonly sourceCommit: string;
}> => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-runner-roots-'));
  const sourceRoot = join(parent, 'source');
  const runtimeRoot = join(parent, 'runtime');
  await mkdir(sourceRoot);
  execFileSync('git', ['init', '--quiet'], { cwd: sourceRoot });
  await writeFile(join(sourceRoot, 'sentinel'), 'clean source\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: sourceRoot });
  execFileSync('git', [
    '-c', 'user.name=ACE Runner Test',
    '-c', 'user.email=ace-runner@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: sourceRoot });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
  await mkdir(join(runtimeRoot, 'dist/bin'), { recursive: true });
  await writeFile(join(runtimeRoot, 'dist/runtime-provenance.json'), JSON.stringify({
    sourceCommit: runtimeCommit ?? sourceCommit,
    sourceCleanAtBuild: true,
  }), 'utf8');
  return { parent, sourceRoot, runtimeRoot, sourceCommit };
};

test('real provider runner has a bounded, process-tree-safe cleanup path', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/real-provider-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/real-provider-e2e.mjs', 'utf8');
  for (const token of [
    'ACE_REAL_PROVIDER_TIMEOUT_MS',
    'detached: process.platform !== \'win32\'',
    'child.once(\'exit\'',
    'const stopChild = () =>',
    "signalChild('SIGTERM')",
    "signalChild('SIGKILL')",
    'await stopChild()',
    'process.kill(-child.pid, 0)',
    'const failChild =',
    'child.stdin.on(\'error\', failChild)',
    'clearTimeout(timer)',
    'let stopPromise;',
    'if (stopPromise !== undefined) return stopPromise;',
  ]) assert.ok(script.includes(token), token);
  assert.match(script, /stopPromise = \(async \(\) => \{[\s\S]*?\}\)\(\);[\s\S]*?return stopPromise;/u);
});

test('real provider runner rejects a dead MCP child instead of waiting for the request deadline', async () => {
  const script = await readFile('scripts/real-provider-e2e.mjs', 'utf8');
  assert.match(script, /for \(const waiter of waiters\.values\(\)\) waiter\.reject\(error\)/u);
  assert.match(script, /MCP child exited before response/u);
  assert.match(script, /MCP request \$\{id\} timed out after \$\{requestTimeoutMs\}ms/u);
  assert.match(script, /MCP child emitted malformed JSON/u);
  assert.match(script, /if \(stopped \|\| !directChildAlive\(\)\)/u);
});

test('real-provider runner executes the verified runtime bundle instead of source checkout dist', async () => {
  const roots = await makeSeparatedRunnerRoots();
  await writeFile(
    join(roots.runtimeRoot, 'dist/bin/ace-mcp.js'),
    "process.stderr.write('runtime-root-executed\\n'); process.exit(23);\n",
    'utf8',
  );
  try {
    const result = spawnSync(process.execPath, ['scripts/real-provider-e2e.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        ACE_SOURCE_ROOT: roots.sourceRoot,
        ACE_RUNTIME_ROOT: roots.runtimeRoot,
        ACE_REAL_PROVIDER_TIMEOUT_MS: '10000',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime-root-executed/u);
  } finally {
    await rm(roots.parent, { recursive: true, force: true });
  }
});

test('index scale runner uses the verified runtime root and dense default', async () => {
  const script = await readFile('scripts/index-scale-e2e.mjs', 'utf8');
  assert.match(script, /resolveRealProviderRuntime/u);
  assert.match(script, /runtime\.executable/u);
  assert.match(script, /ACE_RETRIEVAL_STRATEGY.*\|\| 'dense'/u);
});

test('Git-dependent runner rejects source and runtime commit drift before provider startup', async () => {
  const roots = await makeSeparatedRunnerRoots('f'.repeat(40));
  try {
    const result = spawnSync(process.execPath, ['scripts/qdrant-snapshot-crash-e2e.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        ACE_SOURCE_ROOT: roots.sourceRoot,
        ACE_RUNTIME_ROOT: roots.runtimeRoot,
        ACE_QDRANT_CRASH_E2E_TIMEOUT_MS: '60000',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BLOCKED: runtime source commit does not match ACE_SOURCE_ROOT HEAD/u);
  } finally {
    await rm(roots.parent, { recursive: true, force: true });
  }
});

test('real-provider runner rejects a dirty source worktree before provider startup', async () => {
  const roots = await makeSeparatedRunnerRoots();
  await writeFile(join(roots.sourceRoot, 'untracked'), 'not evidence-bound\n', 'utf8');
  await writeFile(
    join(roots.runtimeRoot, 'dist/bin/ace-mcp.js'),
    "process.stderr.write('provider-started-unexpectedly\\n'); process.exit(24);\n",
    'utf8',
  );
  try {
    const result = spawnSync(process.execPath, ['scripts/real-provider-e2e.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        ACE_SOURCE_ROOT: roots.sourceRoot,
        ACE_RUNTIME_ROOT: roots.runtimeRoot,
        ACE_REAL_PROVIDER_TIMEOUT_MS: '10000',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BLOCKED: ACE_SOURCE_ROOT must be clean/u);
    assert.doesNotMatch(result.stderr, /provider-started-unexpectedly/u);
  } finally {
    await rm(roots.parent, { recursive: true, force: true });
  }
});
