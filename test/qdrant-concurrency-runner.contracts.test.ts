import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real Qdrant concurrency runner is syntactically valid and uses two production MCP writers', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/qdrant-snapshot-concurrency-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/qdrant-snapshot-concurrency-e2e.mjs', 'utf8');
  for (const token of [
    "ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true'",
    'ACE_STATE_DIR: state',
    'Promise.all([first.query(), second.query()])',
    'writersConvergedOnIndexKey',
    'stableCollectionExists',
    'publication_mode',
  ]) assert.ok(script.includes(token), token);
});

test('concurrency runner checks current D1 citations and keeps production claims closed', async () => {
  const script = await readFile('scripts/qdrant-snapshot-concurrency-e2e.mjs', 'utf8');
  for (const token of [
    "assert.equal(evidence.freshness, 'current')",
    'assert.equal(evidence.sourceDigest, fixtureDigest)',
    'qdrantCollectionExists',
    'productionApproved: false',
    'tokenSavings5x: false',
    'graphitiLocalOnly: false',
  ]) assert.ok(script.includes(token), token);
});
