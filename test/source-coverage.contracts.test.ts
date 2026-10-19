import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { makeQdrantContextProvider } from '../src/adapters/qdrant-context-provider.js';
import {
  initialSourceCoverage,
  requiredIncompleteSources,
  resolveSourceRequirements,
  setSourceCoverage,
  sourceCoverageComplete,
  type SourceRequirements,
} from '../src/domain/source-coverage.js';
import { domainError } from '../src/domain/errors.js';
import { err, ok, type Result } from '../src/domain/result.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
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
    documentation: { requirement: 'required', allowed: true },
    memory: { requirement: 'required', allowed: true },
  });

  const enriched = resolveSourceRequirements(['documentation', 'memory'], { includeCode: true });
  assert.deepEqual(enriched, {
    code: { requirement: 'optional', allowed: true },
    structural: { requirement: 'optional', allowed: true },
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
