#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { ensureQdrantCollection } from '../src/adapters/qdrant-context-provider.js';
import { makeCandidateId, makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const [outputArg] = process.argv.slice(2);
if (process.argv.length > 3) {
  throw new Error('Usage: tsx scripts/qdrant-hybrid-wire-e2e.ts [output.json]');
}

const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const allowedHosts = (process.env.ACE_QDRANT_LOCAL_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const workspaceResult = makeWorkspaceId(`qdrant-hybrid-wire-${randomUUID()}`);
if (workspaceResult._tag === 'Err') throw new Error(workspaceResult.error.message);
const workspaceId = workspaceResult.value;
const collection = `ace_hybrid_wire_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const indexKey = createHash('sha256').update(collection, 'utf8').digest('hex');
const http = makeFetchHttpPort();
const qdrant = makeQdrantCodeCandidatePort({
  baseUrl: qdrantUrl,
  collection,
  http,
  allowedHosts,
  providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
});

const candidate = (id: string, repoPath: string, text: string) => {
  const madeId = makeCandidateId(id);
  if (madeId._tag === 'Err') throw new Error(madeId.error.message);
  const made = makeCodeCandidate({
    candidateId: madeId.value,
    workspaceId,
    repoPath: repoPath as never,
    range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: Buffer.byteLength(text, 'utf8') + 1 },
    symbolName: id,
    text,
    sourceDigest: createHash('sha256').update(text, 'utf8').digest('hex') as never,
    generation: 1 as never,
    indexedAtMs: Date.now(),
  });
  if (made._tag === 'Err') throw new Error(made.error.message);
  return made.value;
};

const denseWinner = candidate(
  'denseWinner',
  'src/dense.ts',
  'export function denseWinner() { return "semantic branch"; }',
);
const sparseWinner = candidate(
  'sparseWinner',
  'src/sparse.ts',
  'export function sparseWinner() { return "ACE_EXACT_SENTINEL"; }',
);

const cleanup = async (): Promise<void> => {
  try {
    await fetch(
      `${qdrantUrl.replace(/\/$/u, '')}/collections/${encodeURIComponent(collection)}`,
      { method: 'DELETE' },
    );
  } catch {
    // Unique collection names make failed best-effort cleanup non-destructive.
  }
};

try {
  const ensured = await Effect.runPromise(ensureQdrantCollection(
    http,
    qdrantUrl,
    collection,
    2,
    allowedHosts,
  ));
  assert.equal(ensured._tag, 'Ok', ensured._tag === 'Err' ? ensured.error.message : '');

  const upserted = await Effect.runPromise(qdrant.upsert([
    {
      candidate: denseWinner,
      vector: [1, 0],
      indexKey,
      embeddingKey: 'dense-a',
    },
    {
      candidate: sparseWinner,
      vector: [0, 1],
      indexKey,
      embeddingKey: 'dense-b',
    },
  ]));
  assert.equal(upserted._tag, 'Ok', upserted._tag === 'Err' ? upserted.error.message : '');

  const common = {
    workspaceId,
    queryText: 'ACE_EXACT_SENTINEL',
    limit: 2,
    generation: 1,
    indexKey,
  } as const;
  const dense = await Effect.runPromise(qdrant.search({
    ...common,
    strategy: 'dense',
    vector: [1, 0],
  }));
  assert.equal(dense._tag, 'Ok');
  if (dense._tag === 'Err') throw new Error(dense.error.message);
  assert.equal(dense.value[0]?.candidate.candidateId, denseWinner.candidateId);

  const sparse = await Effect.runPromise(qdrant.search({
    ...common,
    strategy: 'sparse',
  }));
  assert.equal(sparse._tag, 'Ok');
  if (sparse._tag === 'Err') throw new Error(sparse.error.message);
  assert.equal(sparse.value[0]?.candidate.candidateId, sparseWinner.candidateId);

  const hybrid = await Effect.runPromise(qdrant.search({
    ...common,
    strategy: 'hybrid_rrf',
    vector: [1, 0],
  }));
  assert.equal(hybrid._tag, 'Ok');
  if (hybrid._tag === 'Err') throw new Error(hybrid.error.message);
  const hybridIds = hybrid.value.map((item) => item.candidate.candidateId);
  assert.ok(hybridIds.includes(denseWinner.candidateId));
  assert.ok(hybridIds.includes(sparseWinner.candidateId));

  const result = {
    schemaVersion: 1,
    evidence: 'self-hosted-qdrant-native-bm25-wire',
    generatedAt: new Date().toISOString(),
    sourceCommit,
    runtime: {
      qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
      qdrantUrlKind: qdrantUrl.startsWith('http://127.0.0.1') || qdrantUrl.startsWith('http://localhost')
        ? 'local-loopback'
        : 'configured-local-host',
      sparseProvider: 'qdrant-core-bm25',
    },
    checks: {
      collectionDenseSparseSchemaAccepted: 'PASS',
      providerNativeBm25UpsertAccepted: 'PASS',
      denseQueryAccepted: 'PASS',
      sparseQueryAccepted: 'PASS',
      hybridRrfQueryAccepted: 'PASS',
      denseBranchTop1Expected: 'PASS',
      sparseBranchTop1Expected: 'PASS',
      hybridContainsBothBranchWinners: 'PASS',
    },
    ranks: {
      dense: dense.value.map((item) => item.candidate.candidateId),
      sparse: sparse.value.map((item) => item.candidate.candidateId),
      hybridRrf: hybrid.value.map((item) => item.candidate.candidateId),
    },
    claims: {
      selfHostedQdrantWireMeasured: true,
      retrievalQualityHoldoutMeasured: false,
      retrievalWinnerSelected: false,
      productionApproved: false,
    },
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputArg !== undefined) {
    const output = resolve(outputArg);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
} finally {
  await cleanup();
}
