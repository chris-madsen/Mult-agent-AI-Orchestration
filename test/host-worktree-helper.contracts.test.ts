import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import {
  makeHostWorkspacePort,
  makeHostWorktreeHelperService,
  makeMtlsHostHelperTransport,
  type HostHelperTransport,
} from '../src/adapters/host-worktree-helper.js';
import { ok } from '../src/domain/result.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const mustOk = <T, E>(result: { readonly _tag: 'Ok'; readonly value: T } | { readonly _tag: 'Err'; readonly error: E }): T => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};

test('host helper maps workspace ID to its configured root and never accepts caller roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-host-helper-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'service.ts'), 'export const live = true;\n');
  const service = mustOk(await makeHostWorktreeHelperService({ 'workspace-a': root }));

  const canonical = mustOk(await service.handle({ operation: 'canonicalize', workspaceId: 'workspace-a' }));
  assert.ok('logicalRoot' in canonical);
  if ('logicalRoot' in canonical) {
    assert.match(canonical.logicalRoot, /^\/ace-host-workspace\/[a-f0-9]{24}$/u);
    assert.equal(canonical.logicalRoot.includes(root), false);
  }

  const snapshot = mustOk(await service.handle({
    operation: 'snapshot',
    workspaceId: 'workspace-a',
    observedAtMs: 123,
  }));
  assert.ok('snapshot' in snapshot);
  if ('snapshot' in snapshot) {
    assert.equal(snapshot.snapshot.files.some((file) => file.repoPath === 'src/service.ts'), true);
  }

  const exact = mustOk(await service.handle({
    operation: 'read_exact',
    workspaceId: 'workspace-a',
    repoPath: 'src/service.ts',
  }));
  assert.ok('bytesBase64' in exact);
  if ('bytesBase64' in exact) {
    assert.equal(Buffer.from(exact.bytesBase64, 'base64').toString('utf8'), 'export const live = true;\n');
  }

  const escaped = await service.handle({
    operation: 'read_exact',
    workspaceId: 'workspace-a',
    repoPath: '../outside.ts',
  });
  assert.equal(escaped._tag, 'Err');
  if (escaped._tag === 'Err') assert.equal(escaped.error.code, 'PATH_ESCAPE');

  const unknown = await service.handle({ operation: 'canonicalize', workspaceId: 'workspace-b' });
  assert.equal(unknown._tag, 'Err');
  if (unknown._tag === 'Err') assert.equal(unknown.error.code, 'WORKSPACE_NOT_FOUND');
});

test('host workspace client independently rejects bytes that do not match helper digest', async () => {
  const workspaceId = mustOk(makeWorkspaceId('workspace-client'));
  const expected = Buffer.from('verified bytes');
  const wrong = Buffer.from('tampered bytes');
  const transport: HostHelperTransport = {
    invoke: (request) => {
      if (request.operation === 'canonicalize') return Promise.resolve(ok({ logicalRoot: '/ace-host-workspace/test' }));
      if (request.operation === 'snapshot') {
        return Promise.resolve(ok({ snapshot: { headRevision: 'unavailable', files: [], removedPaths: [], gitStatus: 'not_repository' } }));
      }
      return Promise.resolve(ok({
        bytesBase64: wrong.toString('base64'),
        digest: createHash('sha256').update(expected).digest('hex'),
      }));
    },
  };
  const files = makeHostWorkspacePort(workspaceId, transport);
  const root = await Effect.runPromise(files.canonicalizeRoot('/caller/root/is/ignored'));
  assert.equal(root._tag, 'Ok');
  const read = await Effect.runPromise(files.readExact('/ace-host-workspace/test', 'src/a.ts' as never));
  assert.equal(read._tag, 'Err');
  if (read._tag === 'Err') assert.equal(read.error.code, 'DIGEST_MISMATCH');
});

test('host workspace client accepts explicit non-Git change observations', async () => {
  const workspaceId = mustOk(makeWorkspaceId('workspace-non-git'));
  const transport: HostHelperTransport = {
    invoke: (request) => {
      if (request.operation === 'observe_changes') {
        return Promise.resolve(ok({
          changeObservation: {
            headRevision: 'unavailable',
            changedPaths: ['src/a.ts' as never],
            addedPaths: [],
            deletedPaths: [],
            renamed: [],
            untrackedPaths: ['src/a.ts' as never],
          },
        }));
      }
      if (request.operation === 'canonicalize') {
        return Promise.resolve(ok({ logicalRoot: '/ace-host-workspace/non-git' }));
      }
      if (request.operation === 'snapshot') {
        return Promise.resolve(ok({
          snapshot: { headRevision: 'unavailable', files: [], removedPaths: [], gitStatus: 'not_repository' },
        }));
      }
      return Promise.resolve(ok({
        bytesBase64: Buffer.from('x').toString('base64'),
        digest: createHash('sha256').update('x').digest('hex'),
      }));
    },
  };
  const files = makeHostWorkspacePort(workspaceId, transport);
  const observed = await Effect.runPromise(files.observeChanges('/ignored', {
    headRevision: 'unavailable',
    files: [],
  }));
  assert.equal(observed._tag, 'Ok');
  if (observed._tag === 'Ok') {
    assert.equal(observed.value.headRevision, 'unavailable');
    assert.deepEqual(observed.value.changedPaths, ['src/a.ts']);
  }
});

test('host helper transport refuses plaintext HTTP before reading TLS credentials', async () => {
  const result = await makeMtlsHostHelperTransport({
    endpoint: 'http://127.0.0.1:7443/v1/worktree',
    caFile: '/missing/ca',
    certificateFile: '/missing/cert',
    privateKeyFile: '/missing/key',
  });
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
});


test('host helper transport reloads mTLS files so rotated or removed projected Secrets take effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-host-helper-mtls-'));
  const caFile = join(root, 'ca.crt');
  const certificateFile = join(root, 'tls.crt');
  const privateKeyFile = join(root, 'tls.key');
  await Promise.all([
    writeFile(caFile, 'fixture-ca-v1'),
    writeFile(certificateFile, 'fixture-cert-v1'),
    writeFile(privateKeyFile, 'fixture-key-v1'),
  ]);

  const transport = await makeMtlsHostHelperTransport({
    endpoint: 'https://127.0.0.1:7443/v1/worktree',
    caFile,
    certificateFile,
    privateKeyFile,
    timeoutMs: 50,
  });
  assert.equal(transport._tag, 'Ok');
  if (transport._tag === 'Err') throw new Error(transport.error.message);

  await unlink(certificateFile);
  const afterRotationRemoval = await transport.value.invoke({
    operation: 'canonicalize',
    workspaceId: 'workspace-a',
  });
  assert.equal(afterRotationRemoval._tag, 'Err');
  if (afterRotationRemoval._tag === 'Err') {
    assert.equal(afterRotationRemoval.error.code, 'AUTH_REQUIRED');
    assert.equal(afterRotationRemoval.error.path, 'worktree_helper_tls');
  }
});
