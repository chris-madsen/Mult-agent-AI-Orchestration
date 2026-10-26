import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real index scale runner is syntactically valid and preserves the production provider path', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/index-scale-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/index-scale-e2e.mjs', 'utf8');
  assert.match(script, /ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true'/u);
  assert.doesNotMatch(script, /ACE_ALLOW_LOCAL_FALLBACK/u);
  assert.match(script, /phase: 'cold'|runOnce\(workspace, state, workspaceId, 'cold'\)/u);
  assert.match(script, /runOnce\(workspace, state, workspaceId, 'warm'\)/u);
  assert.match(script, /runOnce\(workspace, state, workspaceId, 'change-only', async \(\) =>/u);
  assert.match(script, /if \(beforeQuery !== undefined\) await beforeQuery\(\)/u);
  assert.match(script, /const stopChild = async/u);
  assert.match(script, /await stopChild\(\)/u);
  assert.match(script, /maxRetries: 10/u);
  assert.match(script, /ACE_INDEX_SCALE_PHASE_TIMEOUT_MS/u);
  assert.match(script, /retrieval_fingerprint/u);
  assert.match(script, /index_key/u);
  assert.doesNotMatch(script, /snapshot_identity/u);
});

test('scale runner fixture exercises changed, renamed, deleted and genuinely untracked paths', async () => {
  const script = await readFile('scripts/index-scale-e2e.mjs', 'utf8');
  assert.match(script, /await rename\(filePath\(workspace, 1\), renamed\)/u);
  assert.match(script, /await unlink\(filePath\(workspace, 2\)\)/u);
  assert.match(script, /untracked-extra\.ts/u);
  assert.match(script, /git\(workspace, \['status', '--porcelain=v1'\]\)/u);
  assert.match(script, /deltaRenamed >= 1/u);
  assert.match(script, /deltaDeleted >= 1/u);
  assert.match(script, /deltaAdded >= 1/u);
  assert.match(script, /changed\.metrics\.indexKey, cold\.metrics\.indexKey/u);
  assert.match(script, /d2Digest/u);
  assert.match(script, /d2Evidence\.sourceDigest/u);
  assert.match(script, /query: 'needleScaleTarget'/u);
});

test('scale runner records machine-readable timing/cache/delta metrics without calling them production proof', async () => {
  const script = await readFile('scripts/index-scale-e2e.mjs', 'utf8');
  for (const token of [
    'elapsedMs',
    'requestElapsedMs',
    'reusedVectors',
    'warmReuseVerified',
    'changeOnlyMeasured',
    'changeOnlyRequestLatencyMeasured',
  ]) assert.ok(script.includes(token), token);
  assert.match(script, /Production acceptance still requires/u);
});
