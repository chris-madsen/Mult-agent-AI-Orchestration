import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real Qdrant crash runner is syntactically valid and uses the production ACE path', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/qdrant-snapshot-crash-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/qdrant-snapshot-crash-e2e.mjs', 'utf8');
  for (const token of [
    "ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true'",
    'dist/bin/ace-mcp.js',
    'after_qdrant_verify_before_publish',
    '/aliases',
    'currentAliasStayedOnS1DuringInterruptedBuild',
    'real-qdrant-snapshot-crash-lifecycle',
  ]) assert.ok(script.includes(token), token);
});

test('interrupted-writer runner proves alias-not-switched recovery and active S1 survival', async () => {
  const script = await readFile('scripts/qdrant-snapshot-crash-e2e.mjs', 'utf8');
  assert.match(script, /currentAliasStayedOnS1DuringInterruptedBuild/u);
  assert.match(script, /restartPublishedS2/u);
  assert.match(script, /reader\.query\('stableSnapshotSentinel stable-sentinel-v1'\)/u);
  assert.match(script, /reader\.query\('stableSnapshotSentinel stable-sentinel-v1', true\)/u);
  assert.match(script, /reader must expose partial coverage/u);
  assert.match(script, /restartedWriter\.query\('mutableSnapshotSentinel mutable-sentinel-v2'\)/u);
  assert.match(script, /current alias/u);
  assert.match(script, /immutableCollectionsAreDistinct/u);
});

test('runtime failpoint is double-opt-in and release config capture refuses failpoint environments', async () => {
  const runtime = await readFile('src/bin/ace-mcp.ts', 'utf8');
  assert.match(runtime, /ACE_TEST_FAILPOINT requires ACE_ENABLE_TEST_FAILPOINTS=true/u);
  assert.match(runtime, /process\.kill\(process\.pid, 'SIGKILL'\)/u);
  assert.match(runtime, /after_qdrant_verify_before_publish/u);

  const releaseCapture = await readFile('scripts/runtime-config-evidence.ts', 'utf8');
  assert.match(releaseCapture, /ACE_ENABLE_TEST_FAILPOINTS/u);
  assert.match(releaseCapture, /ACE_TEST_FAILPOINT/u);
  assert.match(releaseCapture, /refuses environments with ACE test failpoints enabled/u);
});

test('runner never claims production readiness or DBC-13 closure from one crash scenario', async () => {
  const script = await readFile('scripts/qdrant-snapshot-crash-e2e.mjs', 'utf8');
  assert.match(script, /does not approve provider identities, performance budgets, DBC-13 or production release/u);
});
