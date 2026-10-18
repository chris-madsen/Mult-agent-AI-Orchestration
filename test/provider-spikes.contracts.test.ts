import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeLocalHashEmbedding } from '../src/adapters/local-hash-embedding.js';
import { exportCodexHistory } from '../src/adapters/codex-session-history.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

test('local embedding is deterministic, normalized and dimension-checked', () => {
  const provider = makeLocalHashEmbedding({ dimensions: 32 });
  assert.equal(provider._tag, 'Ok');
  if (provider._tag === 'Err') return;
  const first = provider.value.embed('local code query');
  const second = provider.value.embed('local code query');
  assert.equal(first._tag, 'Ok');
  assert.deepEqual(first, second);
  if (first._tag === 'Ok') assert.ok(Math.abs(Math.sqrt(first.value.reduce((sum, value) => sum + (value * value), 0)) - 1) < 1e-9);
  assert.equal(provider.value.embed(' ')._tag, 'Err');
});

test('Codex history exporter preserves exact JSONL bytes and cursor identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-history-'));
  const path = join(root, 'history.jsonl');
  const content = '{"session_id":"s-1","ts":1700000000,"text":"Use local Qdrant"}\n{"session_id":"s-2","ts":1700000001,"text":"Keep raw sessions"}\n';
  await writeFile(path, content, 'utf8');
  const workspace = makeWorkspaceId('history-workspace');
  assert.equal(workspace._tag, 'Ok');
  if (workspace._tag === 'Err') return;
  const exported = await exportCodexHistory(path, workspace.value, 1700000100000);
  assert.equal(exported._tag, 'Ok');
  if (exported._tag === 'Err') return;
  assert.equal(exported.value.episodes.length, 2);
  assert.equal(exported.value.cursors[0]?.byteStart, 0);
  assert.equal(Buffer.from(exported.value.episodes[1]?.content ?? []).toString('utf8'), '{"session_id":"s-2","ts":1700000001,"text":"Keep raw sessions"}\n');
  assert.equal(exported.value.episodes[0]?.sourcePointer.includes('#1:0-'), true);
});
