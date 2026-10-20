import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real Qdrant embedding-timeout runner is syntactically valid and double opts into test delay', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/qdrant-embedding-timeout-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/qdrant-embedding-timeout-e2e.mjs', 'utf8');
  for (const token of [
    'dist/bin/ace-mcp.js',
    "ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true'",
    "ACE_ENABLE_TEST_FAILPOINTS: 'true'",
    "ACE_EMBEDDING_DELAY_MS: '1000'",
    "ACE_EMBEDDING_TIMEOUT_MS: '100'",
    'embedding_provider_unavailable',
    'contextDidNotSimulateSuccess',
  ]) assert.ok(script.includes(token), token);
});

test('timeout runner keeps cancellation and production claims explicitly separate', async () => {
  const script = await readFile('scripts/qdrant-embedding-timeout-e2e.mjs', 'utf8');
  assert.match(script, /cancellationMeasured: false/u);
  assert.match(script, /productionApproved: false/u);
  assert.match(script, /tokenSavings5x: false/u);
  assert.match(script, /graphitiLocalOnly: false/u);
  assert.match(script, /MCP request cancellation during pre-serve startup remains an explicit architecture gap/u);
});
