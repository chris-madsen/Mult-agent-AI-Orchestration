import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('retrieval composition benchmark runs both composition arms and fails closed', async () => {
  const source = await readFile('scripts/retrieval-composition-benchmark.ts', 'utf8');
  assert.match(source, /legacy-hybrid/u);
  assert.match(source, /repo-map-qdrant-lsp-v2/u);
  assert.match(source, /native/u);
  assert.match(source, /repomap-only/u);
  assert.match(source, /--manifest/u);
  assert.match(source, /ACE_RETRIEVAL_COMPOSITION/u);
  assert.match(source, /status: 'BLOCKED'/u);
  assert.match(source, /all four arms/u);
});
