import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

test('Git-dependent provider runners execute the verified runtime bundle and reject a dead child promptly', async () => {
  const roots = await makeSeparatedRunnerRoots();
  await writeFile(
    join(roots.runtimeRoot, 'dist/bin/ace-mcp.js'),
    'process.stderr.write(`runtime-root-executed strategy=${process.env.ACE_RETRIEVAL_STRATEGY}\\n`); process.exit(23);\n',
    'utf8',
  );
  try {
    const cases = [
      { script: 'scripts/real-provider-e2e.mjs', args: [], env: { ACE_REAL_PROVIDER_TIMEOUT_MS: '10000' } },
      { script: 'scripts/qdrant-snapshot-crash-e2e.mjs', args: [], env: { ACE_QDRANT_CRASH_E2E_TIMEOUT_MS: '60000' } },
      { script: 'scripts/qdrant-snapshot-concurrency-e2e.mjs', args: [], env: { ACE_QDRANT_CONCURRENCY_TIMEOUT_MS: '60000' } },
    ];
    for (const fixture of cases) {
      const result = spawnSync(process.execPath, [fixture.script, ...fixture.args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5_000,
        env: {
          ...process.env,
          ACE_SOURCE_ROOT: roots.sourceRoot,
          ACE_RUNTIME_ROOT: roots.runtimeRoot,
          ...fixture.env,
        },
      });
      assert.equal(result.error, undefined, `${fixture.script}: ${result.error?.message ?? ''}`);
      assert.notEqual(result.status, 0, fixture.script);
      assert.match(result.stderr, /runtime-root-executed strategy=dense/u, fixture.script);
    }
  } finally {
    await rm(roots.parent, { recursive: true, force: true });
  }
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

test('managed provider cleanup terminates a stubborn descendant process', async () => {
  if (process.platform === 'win32') return;
  const parent = await mkdtemp(join(tmpdir(), 'ace-managed-process-'));
  const marker = join(parent, 'grandchild.pid');
  const helperUrl = pathToFileURL(join(process.cwd(), 'scripts/real-provider-process.mjs')).href;
  const childProgram = String.raw`
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: 'ignore',
    });
    writeFileSync(process.env.ACE_TEST_GRANDCHILD_MARKER, String(grandchild.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `;
  const probe = String.raw`
    import { readFile } from 'node:fs/promises';
    import { spawnRealProviderProcess, stopRealProviderProcess } from ${JSON.stringify(helperUrl)};
    const child = spawnRealProviderProcess(process.execPath, ['-e', ${JSON.stringify(childProgram)}], {
      env: { ...process.env, ACE_TEST_GRANDCHILD_MARKER: ${JSON.stringify(marker)} },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let grandchildPid;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        grandchildPid = Number(await readFile(${JSON.stringify(marker)}, 'utf8'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (!Number.isSafeInteger(grandchildPid)) throw new Error('grandchild did not start');
    await stopRealProviderProcess(child, { termTimeoutMs: 50, killTimeoutMs: 1000 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch {
        process.exit(0);
      }
    }
    throw new Error('grandchild survived managed cleanup');
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('retained provider traces are finalized after process shutdown', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-provider-traces-'));
  const trace = join(parent, 'writer.jsonl');
  const retained = join(parent, 'retained');
  await writeFile(trace, 'before-stop\n', 'utf8');
  const helperUrl = pathToFileURL(join(process.cwd(), 'scripts/real-provider-evidence.mjs')).href;
  const probe = String.raw`
    import assert from 'node:assert/strict';
    import { appendFile, readFile } from 'node:fs/promises';
    import { stopAndRetainProviderTraces } from ${JSON.stringify(helperUrl)};
    const result = await stopAndRetainProviderTraces([{
      label: 'writer-a',
      traceFile: ${JSON.stringify(trace)},
      stop: async () => { await appendFile(${JSON.stringify(trace)}, 'after-stop\n', 'utf8'); },
    }], ${JSON.stringify(retained)});
    assert.equal(result['writer-a'], 'b32c02cc0970427ba12b631a025f7698a8402c632919ca8daa89f3a075b6c7cf');
    assert.equal(await readFile(${JSON.stringify(join(retained, 'writer-a-provider-trace.jsonl'))}, 'utf8'), 'before-stop\nafter-stop\n');
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('restart runner waits for one runtime process to exit before starting the next', async () => {
  const roots = await makeSeparatedRunnerRoots();
  const lifecycleRoot = join(roots.parent, 'lifecycle');
  await mkdir(lifecycleRoot);
  const executable = String.raw`
    const { createHash } = require('node:crypto');
    const { appendFileSync, closeSync, openSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');
    const { join } = require('node:path');
    const readline = require('node:readline');
    const root = process.env.ACE_TEST_LIFECYCLE_ROOT;
    const lock = join(root, 'active.lock');
    const log = join(root, 'runtime.log');
    let lockFd;
    try {
      lockFd = openSync(lock, 'wx');
      writeFileSync(lockFd, String(process.pid));
      closeSync(lockFd);
    } catch {
      process.stderr.write('OVERLAPPING_RUNTIME_START\n');
      process.exit(41);
    }
    const countPath = join(root, 'count');
    let generation = 1;
    try { generation = Number(readFileSync(countPath, 'utf8')) + 1; } catch {}
    writeFileSync(countPath, String(generation));
    appendFileSync(log, 'start ' + generation + '\n');
    const source = readFileSync(join(process.env.ACE_WORKSPACE_ROOT, 'versioned.ts'));
    const digest = createHash('sha256').update(source).digest('hex');
    const indexMode = generation === 2 ? 'warm_reused' : 'rebuilt';
    process.stderr.write(
      'ace-mcp real retrieval workspace_id=' + process.env.ACE_WORKSPACE_ID
      + ' generation=' + generation
      + ' source_snapshot_digest=' + digest
      + ' index_key=' + digest
      + ' index_mode=' + indexMode
      + ' collection=fake_stable publication_mode=stable_collection_direct\n'
    );
    const keepAlive = setInterval(() => {}, 1000);
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', (line) => {
      appendFileSync(log, 'line ' + generation + ' ' + line + '\n');
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      const structuredContent = message.method === 'tools/call'
        ? { complete: true, evidence: [{ sourceDigest: digest }] }
        : undefined;
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message.id, result: structuredContent === undefined ? {} : { structuredContent },
      }) + '\n');
    });
    process.on('SIGTERM', () => {
      appendFileSync(log, 'term ' + generation + '\n');
      setTimeout(() => {
        clearInterval(keepAlive);
        try { unlinkSync(lock); } catch {}
        process.exit(0);
      }, 250);
    });
  `;
  await writeFile(join(roots.runtimeRoot, 'dist/bin/ace-mcp.js'), executable, 'utf8');
  try {
    const result = spawnSync(process.execPath, ['scripts/real-provider-restart-e2e.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        ACE_SOURCE_ROOT: roots.sourceRoot,
        ACE_RUNTIME_ROOT: roots.runtimeRoot,
        ACE_TEST_LIFECYCLE_ROOT: lifecycleRoot,
        ACE_QDRANT_URL: 'http://127.0.0.1:6339',
      },
    });
    const observedCount = await readFile(join(lifecycleRoot, 'count'), 'utf8').catch(() => 'missing');
    const runtimeLog = await readFile(join(lifecycleRoot, 'runtime.log'), 'utf8').catch(() => 'missing');
    assert.equal(result.status, 0, `count=${observedCount}\nlog=${runtimeLog}\n${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`);
    assert.doesNotMatch(result.stderr, /OVERLAPPING_RUNTIME_START/u);
    assert.equal(await readFile(join(lifecycleRoot, 'count'), 'utf8'), '3');
  } finally {
    try {
      const activePid = Number(await readFile(join(lifecycleRoot, 'active.lock'), 'utf8'));
      if (Number.isSafeInteger(activePid)) process.kill(activePid, 'SIGKILL');
    } catch {
      // The healthy path removes the active-process marker before returning.
    }
    await rm(roots.parent, { recursive: true, force: true });
  }
});
