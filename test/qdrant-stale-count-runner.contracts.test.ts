import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real Qdrant stale-count runner is syntactically valid and uses two real MCP starts', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/qdrant-stale-count-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/qdrant-stale-count-e2e.mjs', 'utf8');
  for (const token of [
    'dist/bin/ace-mcp.js',
    "ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true'",
    'await runOnce(\'first\')',
    'await deleteOnePoint(first.metrics)',
    'await runOnce(\'second\')',
    "second.metrics.indexMode, 'rebuilt'",
    'equalCountWrongMembershipMeasured: false',
  ]) assert.ok(script.includes(token), token);
});

test('stale-count runner requires current evidence after rebuild and keeps claims closed', async () => {
  const script = await readFile('scripts/qdrant-stale-count-e2e.mjs', 'utf8');
  assert.match(script, /assert\.equal\(evidence\.freshness, 'current'\)/u);
  assert.match(script, /staleCountRecoveryMeasured: true/u);
  assert.match(script, /productionApproved: false/u);
  assert.match(script, /tokenSavings5x: false/u);
  assert.match(script, /graphitiLocalOnly: false/u);
});
