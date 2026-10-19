#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'ace-memory-process-'));
const worker = join(import.meta.dirname, 'memory-process-worker.mjs');
const runWorker = (args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [worker, ...args], { cwd: join(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.once('error', rejectRun);
  child.once('close', (code) => {
    if (code !== 0) return rejectRun(new Error(`memory worker failed code=${code}: ${stderr}`));
    try { resolveRun(JSON.parse(stdout)); } catch (error) { rejectRun(error); }
  });
});

const content = Buffer.from('{"shared":"original raw bytes"}\n');
const contentDigest = createHash('sha256').update(content).digest('hex');
const episode = (episodeId) => ({
  episodeId,
  workspaceId: 'memory-process-workspace',
  sessionId: 'shared-session',
  sourcePointer: `codex://process/${episodeId}`,
  occurredAtMs: 1_700_000_000_000,
  importedAtMs: 1_700_000_001_000,
  contentDigest,
  contentBase64: content.toString('base64'),
  searchText: 'shared content',
  tombstoned: false,
});

try {
  const history = join(root, 'history.jsonl');
  await writeFile(history, '{"session_id":"s1","ts":1700000000,"text":"first"}\n');
  const first = await runWorker(['export', root, history]);
  await appendFile(history, '{"session_id":"s1","ts":1700000001,"text":"second"}\n');
  const second = await runWorker(['export', root, history]);
  assert.equal(first.episodes.length, 1);
  assert.equal(second.episodes.length, 2);
  assert.equal(first.episodes[0].episodeId, second.episodes[0].episodeId);
  assert.notEqual(first.sourceDigest, second.sourceDigest);

  const [importA, importB] = await Promise.all([
    runWorker(['import', root, 'episode-a', JSON.stringify(episode('episode-a'))]),
    runWorker(['import', root, 'episode-b', JSON.stringify(episode('episode-b'))]),
  ]);
  assert.equal(importA.episodeId, 'episode-a');
  assert.equal(importB.episodeId, 'episode-b');
  await runWorker(['delete', root, 'episode-a']);
  const survivor = await runWorker(['read', root, 'episode-b']);
  assert.equal(survivor.status, 'ok');
  assert.equal(survivor.contentDigest, contentDigest);
  assert.equal(survivor.contentSha256, contentDigest);

  console.log(JSON.stringify({
    status: 'provider-pass',
    processes: 5,
    stable_episode_id: first.episodes[0].episodeId,
    appended_episode_id: second.episodes[1].episodeId,
    shared_digest_survives_delete: true,
    graphiti_projection: 'not_exercised',
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
