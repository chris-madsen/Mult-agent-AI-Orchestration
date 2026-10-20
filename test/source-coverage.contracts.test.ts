import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import {
  initialSourceCoverage,
  requiredIncompleteSources,
  resolveExplicitSourceRequirements,
  resolveSourceRequirements,
  setSourceCoverage,
  sourceCoverageComplete,
  type SourceRequirements,
} from '../src/domain/source-coverage.js';
import { domainError } from '../src/domain/errors.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { diffWorkspaceManifests, workspaceManifestFromSnapshot } from '../src/domain/workspace-manifest.js';
import type {
  ArtifactStore,
  CodeCandidatePort,
  DocumentationPort,
  MemorySearchPort,
  SemanticAnalysisPort,
  VectorEmbeddingPort,
  WorkspaceFilePort,
} from '../src/application/ports.js';

const mustOk = <T, E>(value: Result<T, E>): T => {
  assert.equal(value._tag, 'Ok');
  if (value._tag === 'Err') throw new Error(String(value.error));
  return value.value;
};

test('route requirements distinguish required, optional, denied and not-requested sources', () => {
  const rationale = resolveSourceRequirements(['documentation', 'memory']);
  assert.deepEqual(rationale, {
    code: { requirement: 'not_requested', allowed: true },
    structural: { requirement: 'not_requested', allowed: true },
    lsp: { requirement: 'not_requested', allowed: true },
    documentation: { requirement: 'required', allowed: true },
    memory: { requirement: 'required', allowed: true },
  });

  const enriched = resolveSourceRequirements(['documentation', 'memory'], { includeCode: true });
  assert.deepEqual(enriched, {
    code: { requirement: 'optional', allowed: true },
    structural: { requirement: 'optional', allowed: true },
    lsp: { requirement: 'optional', allowed: true },
    documentation: { requirement: 'required', allowed: true },
    memory: { requirement: 'required', allowed: true },
  });

  const denied = resolveSourceRequirements(['documentation', 'memory'], {
    includeDocs: false,
    includeMemory: false,
  });
  assert.deepEqual(denied.documentation, { requirement: 'required', allowed: false });
  assert.deepEqual(denied.memory, { requirement: 'required', allowed: false });
  const deniedCoverage = initialSourceCoverage(denied);
  assert.equal(deniedCoverage.find((item) => item.source === 'documentation')?.status, 'denied');
  assert.equal(sourceCoverageComplete(deniedCoverage), false);
});

test('only required source outcomes determine source-coverage completeness', () => {
  const requirements: SourceRequirements = {
    code: { requirement: 'required', allowed: true },
    structural: { requirement: 'optional', allowed: true },
    documentation: { requirement: 'optional', allowed: true },
    memory: { requirement: 'not_requested', allowed: true },
  };
  let coverage = initialSourceCoverage(requirements);
  coverage = setSourceCoverage(coverage, 'code', 'satisfied');
  coverage = setSourceCoverage(coverage, 'structural', 'unavailable', 'lsp_down');
  coverage = setSourceCoverage(coverage, 'documentation', 'partial', 'stale_docs');
  assert.equal(sourceCoverageComplete(coverage), true);
  assert.deepEqual(requiredIncompleteSources(coverage), []);

  coverage = setSourceCoverage(coverage, 'code', 'partial', 'source_changed');
  assert.equal(sourceCoverageComplete(coverage), false);
  assert.deepEqual(requiredIncompleteSources(coverage), ['code']);
});

test('explicit source obligations override deterministic routing and reject overlap', () => {
  const resolved = resolveExplicitSourceRequirements({
    required: ['documentation'],
    optional: ['code'],
  });
  assert.equal(resolved._tag, 'Ok');
  if (resolved._tag === 'Err') return;
  assert.deepEqual(resolved.value, {
    code: { requirement: 'optional', allowed: true },
    structural: { requirement: 'not_requested', allowed: true },
    lsp: { requirement: 'not_requested', allowed: true },
    documentation: { requirement: 'required', allowed: true },
    memory: { requirement: 'not_requested', allowed: true },
  });
  const denied = resolveExplicitSourceRequirements({ required: ['documentation'] }, { includeDocs: false });
  assert.equal(denied._tag, 'Ok');
  if (denied._tag === 'Ok') assert.deepEqual(denied.value.documentation, { requirement: 'required', allowed: false });
  const overlap = resolveExplicitSourceRequirements({ required: ['code'], optional: ['code'] });
  assert.equal(overlap._tag, 'Err');
  if (overlap._tag === 'Err') assert.equal(overlap.error.code, 'INVALID_INPUT');
});

test('workspace manifest is authoritative when watcher delivery is missing', () => {
  const initial = workspaceManifestFromSnapshot({
    headRevision: 'head-1',
    files: [{ repoPath: 'src/hit.ts' as never, digest: 'a'.repeat(64) as never, sizeBytes: 1, state: 'tracked', observedAtMs: 1 }],
    removedPaths: [],
  }, 'scope-a');
  const dirty = workspaceManifestFromSnapshot({
    headRevision: 'head-1',
    files: [{ repoPath: 'src/renamed.ts' as never, digest: 'a'.repeat(64) as never, sizeBytes: 1, state: 'tracked', observedAtMs: 2 }, {
      repoPath: 'src/new.ts' as never, digest: 'b'.repeat(64) as never, sizeBytes: 2, state: 'tracked', observedAtMs: 2,
    }],
    removedPaths: ['src/removed.ts' as never],
  }, 'scope-b');
  const delta = diffWorkspaceManifests(initial, dirty);
  assert.equal(delta.scopeChanged, true);
  assert.deepEqual(delta.renamed, [{ from: 'src/hit.ts', to: 'src/renamed.ts', sourceDigest: 'a'.repeat(64) }]);
  assert.deepEqual(delta.added, ['src/new.ts']);
  assert.deepEqual(delta.deleted, []);
  assert.equal(initial.contentIdentity === dirty.contentIdentity, false);
});

test('Qdrant context refuses an old complete result after a missed watcher event', async () => {
  let currentSnapshot = {
    headRevision: 'head-1',
    files: [{ repoPath: 'src/save.ts' as never, digest: digest as never, sizeBytes: source.length, state: 'tracked' as const, observedAtMs: 1 }],
    removedPaths: [],
  };
  const manifest = workspaceManifestFromSnapshot(currentSnapshot, 'scope-a');
  const reconciledFiles: WorkspaceFilePort = { ...files, snapshot: () => Effect.succeed(ok(currentSnapshot)) };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: reconciledFiles,
    qdrant,
    embeddings,
    artifacts,
    semantics,
    workspaceManifest: manifest,
    newRequestId: () => 'manifest-reconcile',
  });
  const first = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'not_requested', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  }));
  assert.equal(first._tag, 'Ok');
  currentSnapshot = {
    ...currentSnapshot,
    files: [{ ...currentSnapshot.files[0]!, digest: 'f'.repeat(64) as never }],
  };
  const dirty = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'not_requested', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  }));
  assert.equal(dirty._tag, 'Err');
  if (dirty._tag === 'Err') assert.equal(dirty.error.code, 'NOT_READY');
});

test('Qdrant context accepts an authoritative catch-up only after the hook returns the current manifest', async () => {
  let currentSnapshot = {
    headRevision: 'head-1',
    files: [{ repoPath: 'src/save.ts' as never, digest: digest as never, sizeBytes: source.length, state: 'tracked' as const, observedAtMs: 1 }],
    removedPaths: [],
  };
  let reconcileCalls = 0;
  const reconciledFiles: WorkspaceFilePort = { ...files, snapshot: () => Effect.succeed(ok(currentSnapshot)) };
  const initialManifest = workspaceManifestFromSnapshot(currentSnapshot, 'scope-a');
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: reconciledFiles,
    qdrant,
    embeddings,
    artifacts,
    semantics,
    workspaceManifest: initialManifest,
    newRequestId: () => 'manifest-catch-up',
    reconcile: (currentManifest) => {
      reconcileCalls += 1;
      return Effect.succeed(ok({
        workspaceId,
        rootPath: '/repo',
        files: reconciledFiles,
        qdrant,
        embeddings,
        artifacts,
        semantics,
        workspaceManifest: currentManifest,
        newRequestId: () => 'manifest-catch-up-after-reconcile',
      }));
    },
  });
  currentSnapshot = {
    ...currentSnapshot,
    files: [{ ...currentSnapshot.files[0]!, digest: 'f'.repeat(64) as never }],
  };
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'not_requested', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(reconcileCalls, 1);
});

test('Qdrant context rejects a reconciliation result whose manifest is already stale', async () => {
  let currentSnapshot = {
    headRevision: 'head-1',
    files: [{ repoPath: 'src/save.ts' as never, digest: digest as never, sizeBytes: source.length, state: 'tracked' as const, observedAtMs: 1 }],
    removedPaths: [],
  };
  const reconciledFiles: WorkspaceFilePort = { ...files, snapshot: () => Effect.succeed(ok(currentSnapshot)) };
  const initialManifest = workspaceManifestFromSnapshot(currentSnapshot, 'scope-a');
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files: reconciledFiles,
    qdrant,
    embeddings,
    artifacts,
    semantics,
    workspaceManifest: initialManifest,
    newRequestId: () => 'manifest-race',
    reconcile: () => Effect.succeed(ok({
      workspaceId,
      rootPath: '/repo',
      files: reconciledFiles,
      qdrant,
      embeddings,
      artifacts,
      semantics,
      workspaceManifest: initialManifest,
      newRequestId: () => 'manifest-race-after-reconcile',
    })),
  });
  currentSnapshot = {
    ...currentSnapshot,
    files: [{ ...currentSnapshot.files[0]!, digest: 'e'.repeat(64) as never }],
  };
  const result = await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeCode: true,
    includeDocs: false,
    includeMemory: false,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'NOT_READY');
});

const workspaceId = mustOk(makeWorkspaceId('coverage-workspace'));
const sourceLine = 'export function save(): string { return "ok"; }';
const source = Buffer.from(sourceLine + '\n');
const digest = createHash('sha256').update(source).digest('hex');
const candidate = mustOk(makeCodeCandidate({
  candidateId: mustOk(makeCandidateId('coverage-save')),
  workspaceId,
  repoPath: 'src/save.ts' as never,
  range: {
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: Buffer.byteLength(sourceLine, 'utf8') + 1,
  },
  symbolName: 'save',
  semanticAnchor: { line: 1, byteColumn: 17, endLine: 1, endByteColumn: 21 },
  text: sourceLine,
  sourceDigest: digest as never,
  generation: 1 as never,
  indexedAtMs: 1,
}));

const files: WorkspaceFilePort = {
  canonicalizeRoot: () => Effect.succeed(ok('/repo')),
  snapshot: () => { throw new Error('not used'); },
  readExact: () => Effect.succeed(ok({ bytes: source, digest: digest as never })),
};

const qdrant: CodeCandidatePort = {
  upsert: () => Effect.succeed(ok(undefined)),
  search: () => Effect.succeed(ok([{ candidate, score: 1, freshness: 'unknown' as const }])),
};

const embeddings: VectorEmbeddingPort = {
  embedMany: () => Effect.succeed(ok([[1, 0]])),
};

const artifacts: ArtifactStore = {
  storeExact: () => Effect.succeed(ok({ handle: 'coverage-source', digest: digest as never, sizeBytes: source.length })),
  readRange: () => Effect.succeed(err(domainError('ARTIFACT_NOT_FOUND', 'handle', 'not used'))),
};

const semantics: SemanticAnalysisPort = {
  definition: () => Effect.succeed(ok([{
    location: { repoPath: 'src/save.ts', startLine: 1, startColumn: 17, endLine: 1, endColumn: 21 },
    name: 'save',
    kind: 'function',
  }])),
  references: () => Effect.succeed(ok([])),
  typeInfo: () => Effect.succeed(ok(undefined)),
  diagnostics: () => Effect.succeed(ok([])),
};

const staleDocs: DocumentationPort = {
  search: () => Effect.succeed(ok([{
    evidenceId: 'coverage-doc' as never,
    source: 'documentation',
    citation: 'docs/architecture.md',
    content: 'Historical documentation evidence.',
    proofClass: 'derived',
    freshness: 'unknown',
  }])),
};

test('optional stale documentation enriches a required code answer without making it incomplete', async () => {
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings,
    artifacts,
    semantics,
    documentation: staleDocs,
    newRequestId: () => 'optional-docs',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'save',
    includeCode: true,
    includeDocs: true,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'optional', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  })));
  assert.equal(result.complete, true);
  assert.deepEqual(result.partialSources, []);
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'code')?.status, 'satisfied');
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'documentation')?.status, 'partial');
});

test('the same stale documentation makes the bundle incomplete when documentation is required', async () => {
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings,
    artifacts,
    semantics,
    documentation: staleDocs,
    newRequestId: () => 'required-docs',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'architecture rationale',
    includeCode: true,
    includeDocs: true,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'required', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  })));
  assert.equal(result.complete, false);
  assert.deepEqual(result.partialSources, ['documentation']);
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'documentation')?.status, 'partial');
});

test('managed mixed-source request returns truthful partial coverage when code provider is down but memory is healthy', async () => {
  let qdrantCalls = 0;
  const failingEmbeddings: VectorEmbeddingPort = {
    embedMany: () => Effect.succeed(err(domainError('EXTERNAL_UNAVAILABLE', 'embedding', 'offline'))),
  };
  const guardedQdrant: CodeCandidatePort = {
    upsert: () => Effect.succeed(ok(undefined)),
    search: () => {
      qdrantCalls += 1;
      return Effect.succeed(ok([]));
    },
  };
  const memory: MemorySearchPort = {
    search: () => Effect.succeed(ok({ hits: [], conflicts: [] })),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant: guardedQdrant,
    embeddings: failingEmbeddings,
    artifacts,
    semantics,
    memory,
    newRequestId: () => 'mixed-outage',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'implementation and decision',
    includeCode: true,
    includeDocs: false,
    includeMemory: true,
    sourceRequirements: {
      code: { requirement: 'required', allowed: true },
      structural: { requirement: 'optional', allowed: true },
      documentation: { requirement: 'not_requested', allowed: true },
      memory: { requirement: 'required', allowed: true },
    },
  })));
  assert.equal(qdrantCalls, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(result.partialSources, ['code']);
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'code')?.status, 'unavailable');
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'structural')?.status, 'unavailable');
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'memory')?.status, 'satisfied');
});

test('documentation policy denial remains denied rather than technical unavailable', async () => {
  let embeddingCalls = 0;
  const deniedDocs: DocumentationPort = {
    search: () => Effect.succeed(err(domainError('POLICY_DENIED', 'vertex', 'cloud disabled'))),
  };
  const provider = makeQdrantContextProvider({
    workspaceId,
    rootPath: '/repo',
    files,
    qdrant,
    embeddings: {
      embedMany: () => {
        embeddingCalls += 1;
        return Effect.succeed(ok([[1, 0]]));
      },
    },
    artifacts,
    semantics,
    documentation: deniedDocs,
    newRequestId: () => 'docs-policy-denied',
  });
  const result = mustOk(await Effect.runPromise(provider.search({
    workspaceId,
    query: 'architecture rationale',
    includeCode: false,
    includeDocs: true,
    includeMemory: false,
    sourceRequirements: {
      code: { requirement: 'not_requested', allowed: true },
      structural: { requirement: 'not_requested', allowed: true },
      documentation: { requirement: 'required', allowed: true },
      memory: { requirement: 'not_requested', allowed: true },
    },
  })));
  assert.equal(embeddingCalls, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(result.partialSources, ['documentation']);
  assert.equal(result.sourceCoverage?.find((item) => item.source === 'documentation')?.status, 'denied');
});
