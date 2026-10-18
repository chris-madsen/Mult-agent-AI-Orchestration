import { strict as assert } from 'node:assert';
import { readFile, readdir, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../src/adapters/file-artifact-store.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { authorizeAndAudit } from '../src/application/policy-service.js';
import { authorizeOutbound, defaultLocalPolicy } from '../src/domain/policy.js';
import type { AuditSink, ExactRead, WorkspaceFilePort, WorkspaceStore } from '../src/application/ports.js';
import { observeWorkspace, readVerified, registerWorkspace } from '../src/application/workspace-service.js';
import { makeFileWorkspaceStore } from '../src/application/file-workspace-store.js';
import { makeMcpGateway } from '../src/gateway/mcp-gateway.js';
import { domainError } from '../src/domain/errors.js';
import { err, isOk, ok, type Result } from '../src/domain/result.js';
import {
  ingestRepoPath,
  makeContentDigest,
  makeWorkingTreeVersion,
  makeWorkspaceId,
  type FileObservation,
  type RepoPath,
  type WorkspaceRecord,
} from '../src/domain/workspace.js';

const run = <Value>(effect: Effect.Effect<Value>) => Effect.runPromise(effect);

const requireContract = (condition: boolean, message: string): asserts condition => {
  assert.equal(condition, true, message);
};

const ensureContract = (condition: boolean, message: string): asserts condition => {
  assert.equal(condition, true, message);
};

const mustOk = <Value, ErrorValue>(result: Result<Value, ErrorValue>): Value => {
  requireContract(result._tag === 'Ok', 'postcondition: expected Ok result');
  return result.value;
};

const mustErr = <Value, ErrorValue>(result: Result<Value, ErrorValue>): ErrorValue => {
  requireContract(result._tag === 'Err', 'postcondition: expected Err result');
  return result.error;
};

const ids = () => {
  let sequence = 0;
  return {
    newWorkspaceId: () => `workspace-contract-${++sequence}`,
    newRequestId: () => `request-contract-${++sequence}`,
  };
};

const clock = { nowMs: () => 1_700_000_000_000 };

const workspaceId = mustOk(makeWorkspaceId('workspace-contract'));
const emptyRecord: WorkspaceRecord = {
  workspaceId,
  rootPath: '/repo',
  observationEpoch: 0,
  createdAtMs: clock.nowMs(),
};

test('BTC-01 value objects enforce preconditions and canonical forms', () => {
  const canonicalId = mustOk(makeWorkspaceId('  workspace-1  '));
  ensureContract(canonicalId === 'workspace-1', 'postcondition: workspace id is trimmed');
  assert.equal(mustErr(makeWorkspaceId('   ')).code, 'INVALID_INPUT');
  assert.equal(mustErr(makeContentDigest('A'.repeat(64))).code, 'INVALID_INPUT');

  const validPath = mustOk(ingestRepoPath('src/domain.ts'));
  ensureContract(validPath === 'src/domain.ts', 'postcondition: safe repo path is preserved');
  assert.equal(mustErr(ingestRepoPath('')).code, 'INVALID_INPUT');
  for (const unsafePath of ['.', 'src/./domain.ts', 'src/../secret', '/etc/passwd', 'src\\domain.ts']) {
    assert.equal(mustErr(ingestRepoPath(unsafePath)).code, 'PATH_ESCAPE');
  }
});

test('BTC-02 invalid reads fail before the file port is called', async () => {
  let readCalls = 0;
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(ok({ headRevision: 'head', files: [], removedPaths: [] })),
    readExact: (): Effect.Effect<Result<ExactRead, ReturnType<typeof domainError>>> => {
      readCalls += 1;
      return Effect.succeed(err(domainError('FILE_NOT_FOUND', 'repo_path', 'unexpected read')));
    },
  };
  const store: WorkspaceStore = {
    get: () => Effect.succeed(ok(emptyRecord)),
    findByRoot: () => Effect.succeed(ok(emptyRecord)),
    save: () => Effect.succeed(ok(undefined)),
  };
  const ports = { clock, ids: ids(), files, store };

  const unsafePath = await run(readVerified(ports, workspaceId, 'src/../secret.ts', '0'.repeat(64)));
  assert.equal(unsafePath._tag, 'Err');
  if (isOk(unsafePath)) return;
  assert.equal(unsafePath.error.code, 'PATH_ESCAPE');
  assert.equal(readCalls, 0);

  const invalidDigest = await run(readVerified(ports, workspaceId, 'src/safe.ts', 'not-a-digest'));
  assert.equal(invalidDigest._tag, 'Err');
  assert.equal(readCalls, 0);
});

test('BTC-03 accepted working-tree versions preserve collection boundaries', () => {
  const observation: FileObservation = {
    repoPath: mustOk(ingestRepoPath('src/index.ts')),
    digest: mustOk(makeContentDigest('a'.repeat(64))),
    sizeBytes: 12,
    state: 'tracked',
    observedAtMs: clock.nowMs(),
  };
  const files = [observation];
  const removedPaths: RepoPath[] = [];
  const version = mustOk(makeWorkingTreeVersion('head-1', 1, files, removedPaths));
  files.length = 0;
  removedPaths.push(mustOk(ingestRepoPath('src/removed.ts')));

  ensureContract(version.observationEpoch === 1, 'invariant: epoch remains positive');
  ensureContract(version.files.length === 1, 'postcondition: files are copied at ingest');
  ensureContract(version.removedPaths.length === 0, 'postcondition: removed paths are copied at ingest');
  assert.equal(mustErr(makeWorkingTreeVersion('head-1', 0, [], [])).code, 'INVALID_INPUT');
  assert.equal(mustErr(makeWorkingTreeVersion('head-1', 1.5, [], [])).code, 'INVALID_INPUT');
});

test('BTC-04 observation epoch is monotone and workspace state is not mutated by registration', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-bertrand-observation-'));
  const root = join(parent, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const stable = true;\n', 'utf8');
  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };

  const registered = await run(registerWorkspace(service, { rootPath: root }));
  const registeredRecord = mustOk(registered);
  assert.equal(registeredRecord.observationEpoch, 0);
  const first = mustOk(await run(observeWorkspace(service, registeredRecord.workspaceId)));
  const second = mustOk(await run(observeWorkspace(service, registeredRecord.workspaceId)));

  ensureContract(first.observationEpoch === 1, 'postcondition: first observation starts at epoch one');
  ensureContract(second.observationEpoch === 2, 'invariant: observation epoch is monotone');
  ensureContract(second.lastObservation?.observationEpoch === second.observationEpoch, 'invariant: record and version epochs agree');
  assert.equal(second.rootPath, registeredRecord.rootPath);
  assert.equal(await readFile(join(root, 'src', 'index.ts'), 'utf8'), 'export const stable = true;\n');
});

test('BTC-05 policy contracts fail closed for secrets and cross-workspace actions', () => {
  const policy = defaultLocalPolicy(workspaceId);
  const allowed = authorizeOutbound({
    workspaceId,
    operation: 'inspect',
    destination: 'local',
    dataClasses: ['public'],
    paths: ['src/index.ts'],
    secretDetected: false,
  }, policy);
  assert.equal(mustOk(allowed).outcome, 'allowed');

  const secret = authorizeOutbound({
    workspaceId,
    operation: 'inspect',
    destination: 'local',
    dataClasses: ['secret'],
    paths: ['src/index.ts'],
    secretDetected: false,
  }, policy);
  assert.equal(mustOk(secret).reasonCode, 'SECRET_DETECTED');

  const foreign = authorizeOutbound({
    workspaceId: mustOk(makeWorkspaceId('foreign-workspace')),
    operation: 'inspect',
    destination: 'local',
    dataClasses: ['public'],
    paths: ['src/index.ts'],
    secretDetected: false,
  }, policy);
  assert.equal(mustErr(foreign).code, 'POLICY_DENIED');

  const cloudPolicy = {
    ...policy,
    cloudOptIn: true,
    allowedCloudProviders: ['vertex'] as const,
  };
  assert.equal(mustOk(authorizeOutbound({
    workspaceId,
    operation: 'embed',
    destination: 'vertex',
    dataClasses: ['public'],
    paths: ['src/index.ts'],
    secretDetected: false,
  }, cloudPolicy)).outcome, 'allowed');
  assert.equal(mustOk(authorizeOutbound({
    workspaceId,
    operation: 'embed',
    destination: 'jev',
    dataClasses: ['public'],
    paths: ['src/index.ts'],
    secretDetected: false,
  }, cloudPolicy)).reasonCode, 'POLICY_DENIED');
});

test('BTC-06 audit failure fails closed without exposing policy payloads', async () => {
  const audit: AuditSink = {
    append: () => Effect.succeed(err(domainError('AUDIT_FAILED', 'audit', 'injected audit outage'))),
  };
  const result = await run(authorizeAndAudit(
    defaultLocalPolicy(workspaceId),
    {
      workspaceId,
      operation: 'embed',
      destination: 'local',
      dataClasses: ['secret'],
      paths: ['secrets/application.env'],
      secretDetected: true,
    },
    'correlation-secret-free',
    { clock, audit },
  ));
  const failure = mustErr(result);
  assert.equal(failure.code, 'AUDIT_FAILED');
  assert.doesNotMatch(JSON.stringify(failure), /application-secret-value/u);
});

test('BTC-07 artifact postconditions guarantee contiguous lossless ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-bertrand-artifacts-'));
  const store = makeFileArtifactStore(directory);
  const source = Buffer.from(Array.from({ length: 37 }, (_, index) => `record-${index}\n`).join(''), 'utf8');
  const reference = mustOk(await run(store.storeExact(source)));
  const pages: Buffer[] = [];
  let cursor: string | undefined;
  let expectedOffset = 0;

  do {
    const page = mustOk(await run(store.readRange(reference.handle, cursor, 11)));
    ensureContract(page.offset === expectedOffset, 'invariant: ranges are contiguous');
    ensureContract(page.totalBytes === source.byteLength, 'postcondition: total size is stable');
    pages.push(Buffer.from(page.bytes));
    expectedOffset += page.bytes.byteLength;
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  ensureContract(expectedOffset === source.byteLength, 'postcondition: ranges cover the artifact');
  assert.deepEqual(Buffer.concat(pages), source);
  assert.equal(mustErr(await run(store.readRange(reference.handle, String(source.byteLength + 1), 11))).code, 'INVALID_HANDLE');
});

test('BTC-08 gateway rejects invalid input and never simulates provider success', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-bertrand-gateway-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  const service = {
    clock,
    ids: ids(),
    files: makeNodeWorkspacePort({ allowedRoots: [parent] }),
    store: makeFileWorkspaceStore(join(root, '.ace', 'state.json')),
  };
  const registered = mustOk(await run(registerWorkspace(service, { rootPath: root })));
  const gateway = makeMcpGateway({
    ...service,
    artifacts: makeFileArtifactStore(join(root, '.ace', 'artifacts')),
  });

  const invalid = await run(gateway.handle({ name: 'ace_context', arguments: { workspace_id: 42 } }));
  assert.equal(invalid.status, 'error');
  if (invalid.status === 'error') assert.equal(invalid.error.code, 'INVALID_INPUT');

  const unavailable = await run(gateway.handle({
    name: 'ace_memory_search',
    arguments: { workspace_id: registered.workspaceId, query: 'find context' },
  }));
  assert.equal(unavailable.status, 'not_ready');
  if (unavailable.status === 'not_ready') {
    assert.equal(unavailable.code, 'NOT_READY');
    assert.match(unavailable.detail, /no provider success is simulated/u);
  }
});

test('BTC-09 domain layer does not import adapters or perform platform I/O', async () => {
  const root = join(process.cwd(), 'src', 'domain');
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
    }));
  };
  await walk(root);
  const forbidden = ['../adapters', '../application', 'node:fs', 'node:child_process', 'node:crypto'];
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      if (source.includes(pattern)) offenders.push(`${relative(process.cwd(), file)} -> ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});
