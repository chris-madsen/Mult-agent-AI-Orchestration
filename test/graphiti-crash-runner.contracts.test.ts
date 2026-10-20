import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Graphiti crash worker and recovery runner are syntactically valid', () => {
  for (const script of [
    'scripts/graphiti-crash-worker.mjs',
    'scripts/graphiti-crash-recovery-e2e.mjs',
  ]) {
    execFileSync(process.execPath, ['--check', script], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
  }
});

test('Graphiti crash worker reproduces the provider-ack/outbox gap with real projection before SIGKILL', async () => {
  const worker = await readFile('scripts/graphiti-crash-worker.mjs', 'utf8');
  assert.match(worker, /archive\.importEpisode/u);
  assert.match(worker, /outbox\.begin/u);
  assert.match(worker, /graphiti\.projection\.project/u);
  assert.match(worker, /Intentionally do NOT persist the provider receipt/u);
  assert.match(worker, /after_graphiti_enqueue_before_outbox_receipt/u);
  assert.match(worker, /process\.kill\(process\.pid, 'SIGKILL'\)/u);
});

test('Graphiti recovery uses production ace-memory reconcile/delete and verifies recall provenance', async () => {
  const runner = await readFile('scripts/graphiti-crash-recovery-e2e.mjs', 'utf8');
  assert.match(runner, /dist\/bin\/ace-memory\.js', 'reconcile'/u);
  assert.match(runner, /dist\/bin\/ace-memory\.js', 'delete'/u);
  assert.match(runner, /receipt\.status === 'projected'/u);
  assert.match(runner, /graphiti\.memory\.search/u);
  assert.match(runner, /hit\.episode\.sourcePointer === archived\.value\.sourcePointer/u);
  assert.match(runner, /hit\.episode\.contentDigest === archived\.value\.contentDigest/u);
  assert.match(runner, /ARCHIVE_TOMBSTONED/u);
  assert.match(runner, /projectionState\.isPresent/u);
});

test('ace-memory emits safe provider traces for reconcile and delete evidence', async () => {
  const cli = await readFile('src/bin/ace-memory.ts', 'utf8');
  assert.match(cli, /makeFileProviderTrace/u);
  assert.match(cli, /ACE_PROVIDER_TRACE_FILE/u);
  assert.match(cli, /providerVersion/u);
});

test('one crash-recovery run is explicitly bounded evidence, not production approval', async () => {
  const runner = await readFile('scripts/graphiti-crash-recovery-e2e.mjs', 'utf8');
  assert.match(runner, /Bounded synthetic real-provider W07 crash-recovery evidence only/u);
  assert.match(runner, /does not approve inference providers, DBC-11, cost budgets or production release/u);
});
