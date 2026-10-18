import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../src/adapters/file-artifact-store.js';
import { makeFileAuditSink } from '../src/adapters/file-audit-sink.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeFileWorkspaceStore } from '../src/application/file-workspace-store.js';
import { authorizeAndAudit } from '../src/application/policy-service.js';
import { type IdPort } from '../src/application/ports.js';
import { registerWorkspace, observeWorkspace, readVerified } from '../src/application/workspace-service.js';
import { makeMcpGateway } from '../src/gateway/mcp-gateway.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { isErr, isOk } from '../src/domain/result.js';

const run = <Value>(effect: Effect.Effect<Value>) => Effect.runPromise(effect);
const exec = promisify(execFile);

const ids = (): IdPort => {
  let sequence = 0;
  return {
    newWorkspaceId: () => `workspace-${++sequence}`,
    newRequestId: () => `request-${++sequence}`,
  };
};

const clock = { nowMs: () => 1_700_000_000_000 };

test('workspace registration, observation and digest verification are explicit', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-foundation-'));
  const root = join(parent, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'retry.ts'), 'export const retry = true;\n', 'utf8');

  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };

  const registered = await run(registerWorkspace(service, { rootPath: root }));
  assert.equal(registered._tag, 'Ok');
  if (isErr(registered)) return;
  assert.equal(registered.value.rootPath, root);

  const repeated = await run(registerWorkspace(service, { rootPath: root }));
  assert.equal(repeated._tag, 'Ok');
  if (isErr(repeated)) return;
  assert.equal(repeated.value.workspaceId, registered.value.workspaceId);

  const observed = await run(observeWorkspace(service, registered.value.workspaceId));
  assert.equal(observed._tag, 'Ok');
  if (isErr(observed) || observed.value.lastObservation === undefined) return;
  assert.equal(observed.value.observationEpoch, 1);
  const file = observed.value.lastObservation.files.find((item) => item.repoPath === 'src/retry.ts');
  assert.ok(file);

  const verified = await run(readVerified(service, registered.value.workspaceId, 'src/retry.ts', file.digest));
  assert.equal(verified._tag, 'Ok');
  if (isErr(verified)) return;
  assert.equal(Buffer.from(verified.value.bytes).toString('utf8'), 'export const retry = true;\n');

  await writeFile(join(root, 'src', 'retry.ts'), 'export const retry = false;\n', 'utf8');
  const stale = await run(readVerified(service, registered.value.workspaceId, 'src/retry.ts', file.digest));
  assert.equal(stale._tag, 'Err');
  if (isOk(stale)) return;
  assert.equal(stale.error.code, 'DIGEST_MISMATCH');
});

test('workspace snapshots remain usable for a non-git workspace', async () => {
  const parent = await mkdtemp(join('/dev/shm', 'ace-non-git-'));
  const root = join(parent, 'workspace');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'fixture.txt'), 'ACE smoke fixture: TODO\n', 'utf8');

  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const snapshot = await run(files.snapshot(root, 1_700_000_000_000));
  assert.equal(snapshot._tag, 'Ok');
  if (isErr(snapshot)) return;
  assert.equal(snapshot.value.headRevision, 'unavailable');
  assert.deepEqual(snapshot.value.removedPaths, []);
  assert.equal(snapshot.value.files[0]?.repoPath, 'fixture.txt');
  assert.equal(snapshot.value.files[0]?.state, 'unknown');
});

test('symlink escape is denied before source bytes are returned', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-escape-'));
  const root = join(parent, 'repo');
  const outside = join(parent, 'outside');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'private', 'utf8');
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));

  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };
  const registered = await run(registerWorkspace(service, { rootPath: root }));
  assert.equal(registered._tag, 'Ok');
  if (isErr(registered)) return;

  const result = await run(readVerified(service, registered.value.workspaceId, 'link.txt', '0'.repeat(64)));
  assert.equal(result._tag, 'Err');
  if (isOk(result)) return;
  assert.equal(result.error.code, 'PATH_ESCAPE');
});

test('workspace snapshots distinguish tracked, untracked and removed paths', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-git-state-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'config', 'user.email', 'ace@example.invalid']);
  await exec('git', ['-C', root, 'config', 'user.name', 'ACE Test']);
  await writeFile(join(root, 'tracked.ts'), 'export const tracked = true;\n', 'utf8');
  await exec('git', ['-C', root, 'add', 'tracked.ts']);
  await exec('git', ['-C', root, 'commit', '-q', '-m', 'fixture']);
  await writeFile(join(root, 'untracked.ts'), 'export const untracked = true;\n', 'utf8');
  await writeFile(join(root, 'tracked.ts'), 'export const tracked = false;\n', 'utf8');
  await writeFile(join(root, 'removed.ts'), 'export const removed = true;\n', 'utf8');
  await exec('git', ['-C', root, 'add', 'removed.ts']);
  await exec('git', ['-C', root, 'commit', '-q', '-m', 'removed fixture']);
  await unlink(join(root, 'removed.ts'));

  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };
  const registered = await run(registerWorkspace(service, { rootPath: root }));
  assert.equal(registered._tag, 'Ok');
  if (isErr(registered)) return;
  const observed = await run(observeWorkspace(service, registered.value.workspaceId));
  assert.equal(observed._tag, 'Ok');
  if (isErr(observed) || observed.value.lastObservation === undefined) return;
  const states = new Map(observed.value.lastObservation.files.map((file) => [file.repoPath, file.state]));
  assert.equal(states.get('tracked.ts'), 'tracked');
  assert.equal(states.get('untracked.ts'), 'untracked');
  assert.deepEqual(observed.value.lastObservation.removedPaths, ['removed.ts']);
});

test('exact artifacts support lossless pagination for long generated content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-artifacts-'));
  const store = makeFileArtifactStore(directory);
  const source = Buffer.from(Array.from({ length: 2500 }, (_, index) => `line-${index}\n`).join(''), 'utf8');
  const stored = await run(store.storeExact(source));
  assert.equal(stored._tag, 'Ok');
  if (isErr(stored)) return;

  const pages: Uint8Array[] = [];
  let cursor: string | undefined;
  do {
    const page = await run(store.readRange(stored.value.handle, cursor, 137));
    assert.equal(page._tag, 'Ok');
    if (isErr(page)) return;
    pages.push(page.value.bytes);
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);

  const restored = Buffer.concat(pages.map((page) => Buffer.from(page)));
  assert.deepEqual(restored, source);
  const complete = await run(store.readRange(stored.value.handle, undefined, undefined));
  assert.equal(complete._tag, 'Ok');
  if (isErr(complete)) return;
  assert.equal(complete.value.digest, stored.value.digest);
});

test('policy denies cloud and secret routes and writes a safe audit record', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-policy-'));
  const workspaceId = 'workspace-policy' as Parameters<typeof defaultLocalPolicy>[0];
  const policy = defaultLocalPolicy(workspaceId);
  const auditPath = join(parent, 'audit', 'security.jsonl');
  const audit = makeFileAuditSink(auditPath);

  const denied = await run(
    authorizeAndAudit(
      policy,
      {
        workspaceId,
        operation: 'embed',
        destination: 'vertex',
        dataClasses: ['private_source'],
        paths: ['src/private.ts'],
        secretDetected: false,
      },
      'correlation-1',
      { clock, audit },
    ),
  );
  assert.equal(denied._tag, 'Ok');
  if (isErr(denied)) return;
  assert.equal(denied.value.decision.outcome, 'denied');
  assert.equal(denied.value.decision.reasonCode, 'AUTH_REQUIRED');

  const secret = await run(
    authorizeAndAudit(
      policy,
      {
        workspaceId,
        operation: 'embed',
        destination: 'local',
        dataClasses: ['private_source'],
        paths: ['src/private.ts'],
        secretDetected: true,
      },
      'correlation-2',
      { clock, audit },
    ),
  );
  assert.equal(secret._tag, 'Ok');
  if (isErr(secret)) return;
  assert.equal(secret.value.decision.reasonCode, 'SECRET_DETECTED');

  const journal = await readFile(auditPath, 'utf8');
  assert.match(journal, /correlation-1/);
  assert.match(journal, /AUTH_REQUIRED/);
  assert.doesNotMatch(journal, /private-source-secret-value/);
});

test('gateway validates arguments, exposes exact expansion and refuses fake retrieval success', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-gateway-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };
  const registered = await run(registerWorkspace(service, { rootPath: root }));
  assert.equal(registered._tag, 'Ok');
  if (isErr(registered)) return;
  const artifacts = makeFileArtifactStore(join(root, '.ace', 'artifacts'));
  const stored = await run(artifacts.storeExact(Buffer.from('exact-content', 'utf8')));
  assert.equal(stored._tag, 'Ok');
  if (isErr(stored)) return;
  const gateway = makeMcpGateway({ ...service, artifacts });

  const invalid = await run(gateway.handle({ name: 'ace_context', arguments: { workspace_id: 42 } }));
  assert.equal(invalid.status, 'error');
  if (invalid.status !== 'error') return;
  assert.equal(invalid.error.code, 'INVALID_INPUT');

  const notReady = await run(
    gateway.handle({
      name: 'ace_context',
      arguments: { workspace_id: registered.value.workspaceId, query: 'find retry' },
    }),
  );
  assert.equal(notReady.status, 'not_ready');

  const expanded = await run(
    gateway.handle({ name: 'ace_expand', arguments: { handle: stored.value.handle } }),
  );
  assert.equal(expanded.status, 'ok');
  if (expanded.status !== 'ok') return;
  assert.equal(Buffer.from(String(expanded.result.content_base64), 'base64').toString('utf8'), 'exact-content');
});
