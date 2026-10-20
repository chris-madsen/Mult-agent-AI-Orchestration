import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { ok, type Result } from '../src/domain/result.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId, type ContentDigest, type RepoPath } from '../src/domain/workspace.js';
import {
  createCodeIndex,
  evidenceFromCandidate,
  indexCandidate,
  makeCandidateId,
  makeCodeCandidate,
  makeRequestId,
  mergeEvidence,
  searchCode,
  type CodeCandidate,
} from '../src/domain/retrieval.js';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeLocalContextProvider } from '../src/adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import {
  makeGraphitiProjectionPort,
  makeQdrantCodeCandidatePort,
  makeVertexDocumentationPort,
} from '../src/adapters/http-provider-boundaries.js';
import { makeHarborRunner, makeNodeCommandPort, type CommandPort } from '../src/adapters/harbor-runner.js';
import { selectJevRouteOverHttp } from '../src/adapters/jev-route-provider.js';
import {
  beginProjection,
  decisionStateAt,
  finishProjection,
  makeDecisionRecord,
  makeEpisodeId,
  searchMemory,
  transitionDecision,
  validateDecisionGraph,
  unsupportedMemoryImporter,
  type SessionEpisode,
} from '../src/domain/memory.js';
import { compareRoutes, deterministicRoute, routeEvidence, selectRoute, unsupportedJevRouter } from '../src/domain/routing.js';
import type { SourceRequirements } from '../src/domain/source-coverage.js';
import { makeMcpGateway } from '../src/gateway/mcp-gateway.js';
import type { ArtifactStore, HttpPort, WorkspaceFilePort, WorkspaceStore } from '../src/application/ports.js';

const mustOk = <Value, ErrorValue>(result: Result<Value, ErrorValue>): Value => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};

const mustErr = <Value, ErrorValue>(result: Result<Value, ErrorValue>): ErrorValue => {
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') throw new Error('expected error');
  return result.error;
};

const workspaceId = mustOk(makeWorkspaceId('retrieval-workspace'));
const digest = (text: string): ContentDigest => createHash('sha256').update(text).digest('hex') as ContentDigest;
const candidate = (text = 'export function save(value: string) { return value; }'): CodeCandidate => mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('candidate-save')),
  workspaceId,
  repoPath: 'src/save.ts' as RepoPath,
  range: { startLine: 1, endLine: 1 },
  symbolName: 'save',
  text,
  sourceDigest: digest(text),
  generation: 1 as CodeCandidate['generation'],
  indexedAtMs: 1_700_000_000_000,
}));

test('RVC-01 local lexical retrieval ranks exact symbols and marks stale candidates', () => {
  let index = mustOk(createCodeIndex(1));
  index = mustOk(indexCandidate(index, candidate()));
  const current = searchCode(index, workspaceId, 'save function', { digestFor: () => digest('changed source') });
  assert.equal(current[0]?.freshness, 'stale');
  assert.equal(current[0]?.score, 100 + 1);
  assert.equal(current[0]?.candidate.repoPath, 'src/save.ts');
  assert.equal(mustErr(indexCandidate(index, candidate())).code, 'INVALID_RETRIEVAL');
});

test('RVC-02 context merge deduplicates but exposes non-current evidence', () => {
  const requestId = mustOk(makeRequestId('request-1'));
  const item = evidenceFromCandidate({ candidate: candidate(), score: 100, freshness: 'changed_during_request' }, 'evidence-1' as never);
  const bundle = mergeEvidence(requestId, 'save', [item, item], ['LSP unavailable']);
  assert.equal(bundle.evidence.length, 1);
  assert.equal(bundle.complete, false);
  assert.deepEqual(bundle.partialSources, ['code']);
  assert.ok(bundle.warnings.some((warning) => warning.includes('LSP')));
});

test('CORE-01 warnings and verified cross-source conflicts do not masquerade as missing evidence', () => {
  const request = mustOk(makeRequestId('core-evidence'));
  const code = { ...evidenceFromCandidate({ candidate: candidate(), score: 100, freshness: 'current' as const }, 'code-1' as never), conflictKey: 'retry-limit', conflictValue: '3' };
  const document = { ...code, evidenceId: 'document-1' as never, source: 'documentation' as const, citation: 'ADR:retry', conflictValue: '5' };
  const merged = mergeEvidence(request, 'retry-limit', [code, document], ['informational']);
  assert.equal(merged.complete, true);
  assert.equal(merged.conflicts?.length, 1);
  assert.deepEqual(merged.partialSources, []);
  assert.ok(merged.warnings.some((warning) => warning.startsWith('conflict:')));
  const differentProof = { ...code, evidenceId: 'code-derived' as never, proofClass: 'derived' as const, expansionHandle: 'handle-2' };
  assert.equal(mergeEvidence(request, 'retry', [code, differentProof]).evidence.length, 2);
});

test('CORE-02 short and Unicode lexical identifiers remain searchable', () => {
  const index = mustOk(createCodeIndex(1, [candidate('export function x() { return "мир"; }')]));
  assert.equal(searchCode(index, workspaceId, 'x', { digestFor: () => undefined }).length, 1);
  assert.equal(searchCode(index, workspaceId, 'мир', { digestFor: () => undefined }).length, 1);
});
test('RVC-03 filesystem indexer uses exact workspace reads and exposes stale source after mutation', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-index-'));
  const root = join(parent, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'save.ts'), 'export function save(value: string) { return value; }\n', 'utf8');
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const built = await Effect.runPromise(buildLocalCodeIndex(files, workspaceId, root, { generation: 1 }));
  const result = mustOk(built);
  assert.equal(result.index.candidates.length, 1);
  assert.equal(result.index.candidates[0]?.symbolName, 'save');
  await writeFile(join(root, 'src', 'save.ts'), 'export function save(value: string) { return value.trim(); }\n', 'utf8');
  const observed = await Effect.runPromise(files.snapshot(root, 1_700_000_000_000));
  const current = mustOk(observed);
  const digestByPath = new Map(current.files.map((item) => [item.repoPath, item.digest]));
  const ranked = searchCode(result.index, workspaceId, 'save', { digestFor: (_workspace, path) => digestByPath.get(path) });
  assert.equal(ranked[0]?.freshness, 'stale');
  const provider = makeLocalContextProvider({
    workspaceId,
    rootPath: root,
    index: result.index,
    files,
    newRequestId: () => 'local-request-1',
  });
  const bundle = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeDocs: true,
    includeMemory: false,
  })));
  assert.equal(bundle.complete, false);
  assert.equal(bundle.evidence[0]?.freshness, 'stale');
  assert.ok(bundle.warnings.includes('documentation provider unavailable'));
});

test('MVC-01 archive preserves exact bytes, is idempotent, and tombstones deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-memory-'));
  const archive = await makeAsyncFileMemoryArchive(root);
  const content = Buffer.from('{"role":"user","text":"Qdrant was proposed"}\n', 'utf8');
  const episodeId = mustOk(makeEpisodeId('episode-1'));
  const episode: SessionEpisode = {
    episodeId,
    workspaceId,
    sessionId: 'session-1',
    sourcePointer: 'codex://session-1/event-1',
    occurredAtMs: 1_700_000_000_000,
    importedAtMs: 1_700_000_000_100,
    contentDigest: digest(content.toString('utf8')),
    content,
    searchText: 'Qdrant was proposed',
    tombstoned: false,
  };
  assert.equal((await archive.importEpisode(episode))._tag, 'Ok');
  const invalid = await archive.importEpisode({ ...episode, contentDigest: digest('different') });
  assert.equal(invalid._tag, 'Err');
  if (invalid._tag === 'Err') assert.equal(invalid.error.code, 'DIGEST_MISMATCH');
  const second = await archive.importEpisode(episode);
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Ok') assert.equal(second.value.created, false);
  const read = await archive.readEpisode(episodeId);
  assert.equal(read._tag, 'Ok');
  if (read._tag === 'Ok') assert.equal(Buffer.compare(Buffer.from(read.value.content), content), 0);
  assert.equal((await archive.deleteEpisode(episodeId))._tag, 'Ok');
  assert.equal((await archive.readEpisode(episodeId))._tag, 'Err');
  if ((await archive.readEpisode(episodeId))._tag === 'Err') assert.equal((await archive.readEpisode(episodeId)).error.code, 'ARCHIVE_TOMBSTONED');
});

test('MVC-02 decision promotion requires confirmation and preserves successor history', () => {
  const record = mustOk(makeDecisionRecord({
    decisionId: 'decision-a' as never,
    workspaceId,
    subject: 'retrieval index',
    proposal: 'use local lexical index',
    validFromMs: 1_700_000_000_000,
    sourceEpisodeIds: ['episode-1' as never],
  }));
  assert.equal(record.state, 'Proposed');
  const accepted = mustOk(transitionDecision(record, {
    type: 'confirm', atMs: 1_700_000_000_001, approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-1' as never],
  }));
  const superseded = mustOk(transitionDecision(accepted, {
    type: 'supersede', atMs: 1_700_000_000_002, successorId: 'decision-b' as never,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-1' as never],
  }));
  assert.equal(superseded.state, 'Superseded');
  assert.equal(superseded.successorId, 'decision-b');
  assert.equal(accepted.transitions?.[0]?.approvalIdentity, 'owner:alice');
  assert.deepEqual(accepted.transitions?.[0]?.sourceEpisodeIds, ['episode-1']);
  assert.equal(Object.isFrozen(accepted.transitions), true);
  assert.equal(Object.isFrozen(accepted.transitions?.[0]), true);
  assert.equal(Object.isFrozen(accepted.transitions?.[0]?.sourceEpisodeIds), true);
  assert.equal(mustErr(makeDecisionRecord({ ...record, state: 'Accepted' })).code, 'INVALID_MEMORY');
  assert.equal(mustErr(transitionDecision(accepted, {
    type: 'supersede', atMs: 1_700_000_000_002, successorId: accepted.decisionId,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-1' as never],
  })).code, 'INVALID_MEMORY');
});

test('MVC-03 memory search is as-of and reports conflicting accepted claims', () => {
  const first: SessionEpisode = {
    episodeId: 'episode-1' as never, workspaceId, sessionId: 's1', sourcePointer: 'codex://s1/1',
    occurredAtMs: 10, importedAtMs: 10, contentDigest: digest('Qdrant'), content: new Uint8Array([1]), searchText: 'Qdrant decision', tombstoned: false,
  };
  const second = { ...first, episodeId: 'episode-2' as never, occurredAtMs: 20, sourcePointer: 'codex://s1/2', searchText: 'local decision' };
  const a = mustOk(makeDecisionRecord({ decisionId: 'a' as never, workspaceId, subject: 'index', proposal: 'Qdrant', validFromMs: 1, sourceEpisodeIds: [first.episodeId] }));
  const b = mustOk(makeDecisionRecord({ decisionId: 'b' as never, workspaceId, subject: 'index', proposal: 'local', validFromMs: 1, sourceEpisodeIds: [second.episodeId] }));
  const acceptedA = mustOk(transitionDecision(a, {
    type: 'confirm', atMs: 12, approvalIdentity: 'owner:alice', sourceEpisodeIds: [first.episodeId],
  }));
  const acceptedB = mustOk(transitionDecision(b, {
    type: 'confirm', atMs: 13, approvalIdentity: 'owner:alice', sourceEpisodeIds: [second.episodeId],
  }));
  const result = searchMemory([first, second], 'decision', 15, [acceptedA, acceptedB]);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.episode.episodeId, first.episodeId);
  assert.equal(result.hits[0]?.decisionState, 'Accepted');
  assert.equal(result.conflicts.length, 2);
  const beforeAcceptance = searchMemory([first], 'decision', 11, [acceptedA]);
  assert.equal(beforeAcceptance.hits[0]?.decisionState, 'Proposed');
  assert.equal(decisionStateAt(acceptedA, 11).state, 'Proposed');
});

test('RTE-01 deterministic routing handles exact symbols and ambiguous memory questions', () => {
  const exact = deterministicRoute({ requestId: 'r1', query: 'inspect save in src/save.ts', privateCode: true, jevOptIn: false });
  assert.deepEqual(exact.sources, ['code', 'structural']);
  const ambiguous = deterministicRoute({ requestId: 'r2', query: 'why did we choose the retrieval architecture?', privateCode: true, jevOptIn: false });
  assert.deepEqual(ambiguous.sources, ['documentation', 'memory']);
});

test('RTE-02 private Jev is blocked without opt-in and wrong routes fail quality', () => {
  const request = { requestId: 'r3', query: 'why is save implemented this way?', privateCode: true, jevOptIn: true };
  const decision = mustOk(selectRoute(request, unsupportedJevRouter('Jev contract not verified')));
  assert.equal(decision.outcome, 'unavailable');
  const comparison = compareRoutes(request, ['code', 'memory'], decision);
  assert.equal(comparison.qualityAccepted, false);
  assert.equal(comparison.candidateMissedSources.length, 2);
  assert.equal(routeEvidence(comparison)._tag, 'Ok');
  const noOptIn = mustOk(selectRoute({ ...request, jevOptIn: false }, unsupportedJevRouter('must not be called')));
  assert.equal(noOptIn.plan?.strategy, 'deterministic');
});

test('MVC-04 projection replay is idempotent by episode and extractor version', () => {
  const episodeId = mustOk(makeEpisodeId('episode-1'));
  const first = mustOk(beginProjection([], episodeId, 'extractor-1'));
  const replay = mustOk(beginProjection([first], episodeId, 'extractor-1'));
  assert.equal(replay.key, first.key);
  assert.equal(finishProjection(first, 'projected').attempts, 1);
  assert.equal(unsupportedMemoryImporter('Codex export contract is not verified')._tag, 'Err');
});

test('RTE-03 MCP gateway returns injected local context and memory providers', async () => {
  const store: WorkspaceStore = {
    get: () => Effect.succeed({ _tag: 'Ok', value: {
      workspaceId,
      rootPath: '/repo',
      observationEpoch: 1,
      createdAtMs: 1,
    } }),
    findByRoot: () => Effect.succeed({ _tag: 'Ok', value: undefined }),
    save: () => Effect.succeed({ _tag: 'Ok', value: undefined }),
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed({ _tag: 'Ok', value: '/repo' }),
    snapshot: () => Effect.succeed({ _tag: 'Ok', value: { headRevision: 'head', files: [], removedPaths: [] } }),
    readExact: () => Effect.succeed({ _tag: 'Err', error: { code: 'FILE_NOT_FOUND', path: 'file', message: 'not used' } }),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed({ _tag: 'Err', error: { code: 'PERSISTENCE_FAILED', path: 'artifact', message: 'not used' } }),
    readRange: () => Effect.succeed({ _tag: 'Err', error: { code: 'ARTIFACT_NOT_FOUND', path: 'artifact', message: 'not used' } }),
  };
  let lastContextInput: {
    readonly includeCode?: boolean;
    readonly includeDocs: boolean;
    readonly includeMemory: boolean;
    readonly sourceRequirements?: SourceRequirements;
  } | undefined;
  const gateway = makeMcpGateway({
    clock: { nowMs: () => 1 },
    ids: { newWorkspaceId: () => 'workspace', newRequestId: () => 'request' },
    files,
    store,
    artifacts,
    context: { search: (input) => {
      lastContextInput = input;
      return Effect.succeed({ _tag: 'Ok', value: { requestId: 'request-1', query: input.query, evidence: [], warnings: [], partialSources: [], complete: true } });
    } },
    memory: { search: () => Effect.succeed({ _tag: 'Ok', value: { hits: [], conflicts: [] } }) },
  });
  const context = await Effect.runPromise(gateway.handle({ name: 'ace_context', arguments: { workspace_id: workspaceId, query: 'save' } }));
  assert.equal(context.status, 'ok');
  assert.deepEqual(lastContextInput === undefined ? undefined : {
    includeCode: lastContextInput.includeCode,
    includeDocs: lastContextInput.includeDocs,
    includeMemory: lastContextInput.includeMemory,
    sourceRequirements: lastContextInput.sourceRequirements,
  }, {
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'not_requested', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  });

  await Effect.runPromise(gateway.handle({
    name: 'ace_context',
    arguments: { workspace_id: workspaceId, query: 'why did we choose this architecture decision?' },
  }));
  assert.deepEqual(lastContextInput === undefined ? undefined : {
    includeCode: lastContextInput.includeCode,
    includeDocs: lastContextInput.includeDocs,
    includeMemory: lastContextInput.includeMemory,
    sourceRequirements: lastContextInput.sourceRequirements,
  }, {
    includeCode: false,
    includeDocs: true,
    includeMemory: true,
    sourceRequirements: {
      code: { requirement: 'not_requested', allowed: true },
      structural: { requirement: 'not_requested', allowed: true },
      documentation: { requirement: 'required', allowed: true },
      memory: { requirement: 'required', allowed: true },
    },
  });

  await Effect.runPromise(gateway.handle({
    name: 'ace_context',
    arguments: {
      workspace_id: workspaceId,
      query: 'why did we choose this architecture decision?',
      include_docs: false,
      include_memory: false,
    },
  }));
  assert.deepEqual(lastContextInput === undefined ? undefined : {
    includeCode: lastContextInput.includeCode,
    includeDocs: lastContextInput.includeDocs,
    includeMemory: lastContextInput.includeMemory,
    sourceRequirements: lastContextInput.sourceRequirements,
  }, {
    includeCode: false,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'not_requested', allowed: true },
      structural: { requirement: 'not_requested', allowed: true },
      documentation: { requirement: 'required', allowed: false },
      memory: { requirement: 'required', allowed: false },
    },
  });

  await Effect.runPromise(gateway.handle({
    name: 'ace_context',
    arguments: {
      workspace_id: workspaceId,
      query: 'why did we choose this architecture decision?',
      include_code: true,
      include_docs: false,
      include_memory: false,
    },
  }));
  assert.deepEqual(lastContextInput === undefined ? undefined : {
    includeCode: lastContextInput.includeCode,
    includeDocs: lastContextInput.includeDocs,
    includeMemory: lastContextInput.includeMemory,
    sourceRequirements: lastContextInput.sourceRequirements,
  }, {
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'optional', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'required', allowed: false },
      memory: { requirement: 'required', allowed: false },
    },
  });

  const memory = await Effect.runPromise(gateway.handle({ name: 'ace_memory_search', arguments: { workspace_id: workspaceId, query: 'decision' } }));
  assert.equal(memory.status, 'ok');
});

test('RTE-04 workspace status distinguishes ready, degraded, disabled and not-ready capabilities', async () => {
  const store: WorkspaceStore = {
    get: () => Effect.succeed(ok({
      workspaceId,
      rootPath: '/repo',
      observationEpoch: 4,
      createdAtMs: 1,
    })),
    findByRoot: () => Effect.succeed(ok(undefined)),
    save: () => Effect.succeed(ok(undefined)),
  };
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(ok({ headRevision: 'head', files: [], removedPaths: [] })),
    readExact: () => Effect.succeed({ _tag: 'Err', error: { code: 'FILE_NOT_FOUND', path: 'file', message: 'not used' } }),
  };
  const artifacts: ArtifactStore = {
    storeExact: () => Effect.succeed({ _tag: 'Err', error: { code: 'PERSISTENCE_FAILED', path: 'artifact', message: 'not used' } }),
    readRange: () => Effect.succeed({ _tag: 'Err', error: { code: 'ARTIFACT_NOT_FOUND', path: 'artifact', message: 'not used' } }),
  };
  const readiness = {
    worktree: { state: 'ready' as const, reason: 'authenticated_host_helper_ready' },
    code_retrieval: { state: 'degraded' as const, reason: 'index_coverage_partial' },
    unified_context: { state: 'degraded' as const, reason: 'index_coverage_partial' },
    project_memory: { state: 'not_ready' as const, reason: 'graphiti_startup_failed' },
    documentation: { state: 'disabled' as const, reason: 'cloud_docs_opt_in_false' },
  };
  const gateway = makeMcpGateway({
    clock: { nowMs: () => 1 },
    ids: { newWorkspaceId: () => 'workspace', newRequestId: () => 'request' },
    files,
    store,
    artifacts,
    readiness: () => readiness,
  });
  const response = await Effect.runPromise(gateway.handle({
    name: 'ace_workspace_status',
    arguments: { workspace_id: workspaceId },
  }));
  assert.equal(response.status, 'ok');
  if (response.status !== 'ok') return;
  assert.equal(response.result.index_status, 'degraded');
  assert.deepEqual(response.result.capabilities, readiness);
});

test('EXT-01 Qdrant boundary maps valid points but never claims freshness', async () => {
  const requests: string[] = [];
  const http: HttpPort = {
    request: (request) => {
      requests.push(request.url);
      return Effect.succeed(ok({
        status: 200,
        body: {
          result: [{
            score: 0.91,
            payload: {
              candidate_id: 'qdrant-candidate',
              workspace_id: workspaceId,
              repo_path: 'src/save.ts',
              source_digest: 'a'.repeat(64),
              text: 'export function save() {}',
              start_line: 1,
              end_line: 1,
              generation: 2,
            },
          }],
        },
      }));
    },
  };
  const port = makeQdrantCodeCandidatePort({ baseUrl: 'http://127.0.0.1:6333', collection: 'code', http });
  const result = mustOk(await Effect.runPromise(port.search({ workspaceId, vector: [0.1, 0.2], limit: 3 })));
  assert.equal(result[0]?.freshness, 'unknown');
  assert.equal(requests.length, 1);
  assert.equal(mustErr(await Effect.runPromise(port.search({ workspaceId, vector: [], limit: 0 }))).code, 'INVALID_INPUT');
});

test('EXT-02 Vertex and Graphiti boundaries deny before HTTP without policy/token approval', async () => {
  let requests = 0;
  const http: HttpPort = {
    request: () => {
      requests += 1;
      return Effect.succeed(ok({ status: 200, body: {} }));
    },
  };
  const deniedVertex = makeVertexDocumentationPort({
    endpoint: 'https://vertex.invalid',
    http,
    policy: defaultLocalPolicy(workspaceId),
    accessToken: () => 'must-not-be-used',
  });
  assert.equal(mustErr(await Effect.runPromise(deniedVertex.search({ workspaceId, query: 'ADR rationale', topK: 3 }))).code, 'POLICY_DENIED');
  const allowedPolicy = {
    ...defaultLocalPolicy(workspaceId),
    cloudOptIn: true,
    allowedCloudProviders: ['vertex', 'other_external'] as const,
    allowedCloudDataClassesByProvider: {
      vertex: ['project_document'] as const,
      other_external: ['private_conversation'] as const,
    },
  };
  const missingTokenVertex = makeVertexDocumentationPort({ endpoint: 'https://vertex.invalid', http, policy: allowedPolicy, accessToken: () => undefined });
  assert.equal(mustErr(await Effect.runPromise(missingTokenVertex.search({ workspaceId, query: 'ADR rationale', topK: 3 }))).code, 'AUTH_REQUIRED');
  const episodeId = mustOk(makeEpisodeId('episode-external'));
  const graphiti = makeGraphitiProjectionPort({ endpoint: 'https://graphiti.invalid', http, policy: allowedPolicy, workspaceId, accessToken: () => undefined });
  assert.equal(mustErr(await Effect.runPromise(graphiti.purge(episodeId))).code, 'AUTH_REQUIRED');
  assert.equal(requests, 0);
  const successHttp: HttpPort = {
    request: (request) => Effect.succeed(ok(request.method === 'POST'
      ? { status: 200, body: { documents: [{ evidence_id: 'doc-1', citation: 'ADR-003#decision', content: 'Use local-first retrieval.' }] } }
      : { status: 204, body: {} })),
  };
  const vertex = makeVertexDocumentationPort({ endpoint: 'https://vertex.invalid', http: successHttp, policy: allowedPolicy, accessToken: () => 'token' });
  const documents = mustOk(await Effect.runPromise(vertex.search({ workspaceId, query: 'retrieval rationale', topK: 2 })));
  assert.equal(documents[0]?.citation, 'ADR-003#decision');
  const projected = makeGraphitiProjectionPort({ endpoint: 'https://graphiti.invalid', http: successHttp, policy: allowedPolicy, workspaceId, accessToken: () => 'token' });
  const receipt = mustOk(await Effect.runPromise(projected.project({ episodeId, occurredAtMs: 1_700_000_000_000, extractorVersion: 'extractor-1', claims: [{ subject: 'index', predicate: 'uses', object: 'local' }] })));
  assert.equal(receipt.status, 'projected');
  assert.equal((await Effect.runPromise(projected.purge(episodeId)))._tag, 'Ok');
});

test('EXT-03 Harbor runner retains failed runs and raw JSONL without counting failure as success', async () => {
  const command: CommandPort = {
    run: async () => ok({ exitCode: 17, stdout: '{"type":"task.failed","reason":"wrong patch"}\n', stderr: 'failure details' }),
  };
  const runner = makeHarborRunner(command, 'harbor');
  const failed = mustOk(await Effect.runPromise(runner.run(['run', '--dataset', 'ace@1'])));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 17);
  assert.equal(failed.jsonLines.length, 1);
  assert.equal(mustErr(await Effect.runPromise(runner.run([]))).code, 'INVALID_INPUT');
  const unavailable = mustErr(await Effect.runPromise(makeHarborRunner(makeNodeCommandPort(), '/definitely/missing/harbor').run(['--version'], 1000)));
  assert.equal(unavailable.code, 'UNSUPPORTED_PROVIDER');
});

test('EXT-04 Jev HTTP selector is policy-gated and validates the experimental route', async () => {
  let requests = 0;
  const http: HttpPort = {
    request: () => {
      requests += 1;
      return Effect.succeed(ok({ status: 200, body: { sources: ['memory', 'code'], fallback_sources: ['structural'], rationale: 'measured candidate' } }));
    },
  };
  const request = { requestId: 'jev-1', query: 'private decision', privateCode: true, jevOptIn: true };
  const denied = await Effect.runPromise(selectJevRouteOverHttp({ endpoint: 'https://jev.invalid', http, policy: defaultLocalPolicy(workspaceId), accessToken: () => 'secret' }, request));
  assert.ok(['AUTH_REQUIRED', 'POLICY_DENIED'].includes(mustErr(denied).code));
  assert.equal(requests, 0);
  const policy = {
    ...defaultLocalPolicy(workspaceId),
    cloudOptIn: true,
    allowedCloudProviders: ['jev'] as const,
    allowedCloudDataClassesByProvider: { jev: ['private_source'] as const },
  };
  const selected = mustOk(await Effect.runPromise(selectJevRouteOverHttp({ endpoint: 'https://jev.invalid', http, policy, accessToken: () => 'token' }, request)));
  assert.equal(selected.strategy, 'jev_experimental');
  assert.deepEqual(selected.sources, ['memory', 'code']);
  assert.equal(requests, 1);
});


test('MVC-05 legacy mutated decisions are explicitly uncertain for historical as-of search', () => {
  const legacy = {
    decisionId: 'legacy' as never,
    workspaceId,
    subject: 'runtime',
    proposal: 'old choice',
    state: 'Accepted' as const,
    validFromMs: 1,
    sourceEpisodeIds: ['episode-legacy' as never],
  };
  assert.equal(decisionStateAt(legacy, 2).historicalUncertainty, true);
  assert.equal(decisionStateAt(legacy, 2).state, undefined);
});

test('MVC-06 decision graph rejects missing successors and cycles', () => {
  const base = mustOk(makeDecisionRecord({
    decisionId: 'graph-a' as never,
    workspaceId,
    subject: 'graph',
    proposal: 'a',
    validFromMs: 1,
    sourceEpisodeIds: ['episode-a' as never],
  }));
  const accepted = mustOk(transitionDecision(base, {
    type: 'confirm', atMs: 2, approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-a' as never],
  }));
  const missing = mustOk(transitionDecision(accepted, {
    type: 'supersede', atMs: 3, successorId: 'graph-b' as never,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-a' as never],
  }));
  assert.equal(validateDecisionGraph([missing])._tag, 'Err');
  const b = {
    ...base,
    decisionId: 'graph-b' as never,
    proposal: 'b',
    successorId: 'graph-a' as never,
    state: 'Superseded' as const,
  };
  assert.equal(validateDecisionGraph([{ ...missing, successorId: 'graph-b' as never }, b])._tag, 'Err');
});

test('C-E rejects missing transition provenance and non-monotone decision history', () => {
  const record = mustOk(makeDecisionRecord({
    decisionId: 'event-order' as never, workspaceId, subject: 'index', proposal: 'use local',
    validFromMs: 10, sourceEpisodeIds: ['episode-order' as never],
  }));
  assert.equal(mustErr(transitionDecision(record, {
    type: 'confirm', atMs: 11, approvalIdentity: ' ', sourceEpisodeIds: [],
  })).code, 'INVALID_MEMORY');
  const accepted = mustOk(transitionDecision(record, {
    type: 'confirm', atMs: 11, approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-order' as never],
  }));
  assert.equal(mustErr(transitionDecision(accepted, {
    type: 'supersede', atMs: 11, successorId: 'event-order-next' as never,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-order' as never],
  })).code, 'INVALID_MEMORY');
  const malformed = { ...accepted, transitions: [...(accepted.transitions ?? []), {
    type: 'supersede' as const, atMs: 10, successorId: 'event-order-next' as never,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['episode-order' as never],
  }] };
  assert.equal(decisionStateAt(malformed, 20).historicalUncertainty, true);
});

test('C-E keeps successors in one workspace/subject timeline and isolates cross-workspace evidence', () => {
  const otherWorkspace = mustOk(makeWorkspaceId('memory-other-workspace'));
  const base = mustOk(makeDecisionRecord({
    decisionId: 'scope-a' as never, workspaceId, subject: 'scope', proposal: 'a', validFromMs: 1,
    sourceEpisodeIds: ['scope-episode' as never],
  }));
  const accepted = mustOk(transitionDecision(base, {
    type: 'confirm', atMs: 2, approvalIdentity: 'owner:alice', sourceEpisodeIds: ['scope-episode' as never],
  }));
  const superseded = mustOk(transitionDecision(accepted, {
    type: 'supersede', atMs: 5, successorId: 'scope-b' as never,
    approvalIdentity: 'owner:alice', sourceEpisodeIds: ['scope-episode' as never],
  }));
  const wrongScope = {
    ...base, decisionId: 'scope-b' as never, workspaceId: otherWorkspace,
    state: 'Proposed' as const, validFromMs: 5,
  };
  assert.equal(validateDecisionGraph([superseded, wrongScope])._tag, 'Err');
  const episode: SessionEpisode = {
    episodeId: 'scope-episode' as never, workspaceId, sessionId: 'scope-session', sourcePointer: 'codex://scope/1',
    occurredAtMs: 1, importedAtMs: 100, contentDigest: digest('scope'), content: new Uint8Array([1]),
    searchText: 'scope decision', tombstoned: false,
  };
  const foreignDecision = { ...base, workspaceId: otherWorkspace, state: 'Accepted' as const };
  const result = searchMemory([episode], 'decision', 10, [foreignDecision]);
  assert.equal(result.hits[0]?.decisionState, undefined);
});
