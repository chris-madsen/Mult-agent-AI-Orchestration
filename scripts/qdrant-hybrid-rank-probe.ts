import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../src/adapters/http-provider-boundaries.js';
import { makeProcessEmbeddingPort } from '../src/adapters/process-embedding.js';
import type { CodeRetrievalStrategy } from '../src/domain/retrieval.js';
import type { RetrievalHoldout } from '../src/domain/retrieval-quality-evaluation.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const [holdoutArg, outputArg] = process.argv.slice(2);
if (holdoutArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/qdrant-hybrid-rank-probe.ts <holdout.json> <output.json>');
}

const workspaceRaw = process.env.ACE_WORKSPACE_ID?.trim();
const collection = process.env.ACE_QDRANT_COLLECTION?.trim();
if (workspaceRaw === undefined || workspaceRaw.length === 0) throw new Error('ACE_WORKSPACE_ID is required');
if (collection === undefined || collection.length === 0) throw new Error('ACE_QDRANT_COLLECTION is required');
const workspaceId = makeWorkspaceId(workspaceRaw);
if (workspaceId._tag === 'Err') throw new Error(workspaceId.error.message);

const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const allowedHosts = (process.env.ACE_QDRANT_LOCAL_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const embeddingDimension = Number(process.env.ACE_EMBEDDING_DIMENSION ?? '384');
const queryLimit = Number(process.env.ACE_RETRIEVAL_ABLATION_LIMIT ?? '10');
if (!Number.isSafeInteger(embeddingDimension) || embeddingDimension < 1) {
  throw new Error('ACE_EMBEDDING_DIMENSION must be a positive integer');
}
if (!Number.isSafeInteger(queryLimit) || queryLimit < 1 || queryLimit > 1000) {
  throw new Error('ACE_RETRIEVAL_ABLATION_LIMIT must be between 1 and 1000');
}

const holdoutBytes = await readFile(resolve(holdoutArg));
const holdoutSha256 = createHash('sha256').update(holdoutBytes).digest('hex');
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
if (holdout.schemaVersion !== 1 || holdout.cases.length === 0) throw new Error('retrieval holdout is invalid');

const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
  || resolve('scripts/fastembed-worker.sh');
const embeddingEnvironment: Record<string, string> = {};
for (const name of [
  'ACE_EMBEDDING_PROVIDER',
  'ACE_EMBEDDING_MODEL',
  'ACE_EMBEDDING_MODEL_REVISION',
  'ACE_EMBEDDING_ARTIFACT_MODEL',
  'ACE_EMBEDDING_ARTIFACT_REVISION',
  'ACE_EMBEDDING_ARTIFACT_DIGEST',
  'ACE_EMBEDDING_DIMENSION',
  'ACE_EMBEDDING_PREPROCESSING',
  'ACE_EMBEDDING_EXECUTION_MODE',
  'ACE_EMBEDDING_PINNED',
  'ACE_EMBEDDING_PYTHON',
  'ACE_EMBEDDING_LD_LIBRARY_PATH',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]) {
  const value = process.env[name]?.trim();
  if (value !== undefined && value.length > 0) embeddingEnvironment[name] = value;
}

const embeddings = makeProcessEmbeddingPort({
  command: embeddingWorker,
  dimension: embeddingDimension,
  timeoutMs: Number(process.env.ACE_EMBEDDING_TIMEOUT_MS ?? '120000'),
  env: embeddingEnvironment,
});
const qdrant = makeQdrantCodeCandidatePort({
  baseUrl: qdrantUrl,
  collection,
  http: makeFetchHttpPort(),
  allowedHosts,
  providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/unknown',
});
const strategies: readonly CodeRetrievalStrategy[] = ['dense', 'sparse', 'hybrid_rrf'];

try {
  const probe = await Effect.runPromise(embeddings.probe());
  if (probe._tag === 'Err') {
    throw new Error(`${probe.error.code}: ${probe.error.path}: ${probe.error.message}`);
  }

  const observations = [];
  for (const item of holdout.cases) {
    const embeddingStarted = performance.now();
    const vectorResult = await Effect.runPromise(embeddings.embedMany(
      [item.query],
      `rank-probe-${item.id}`,
    ));
    const embeddingLatencyMs = Math.max(0, performance.now() - embeddingStarted);
    if (vectorResult._tag === 'Err') {
      throw new Error(`${item.id}: ${vectorResult.error.code}: ${vectorResult.error.message}`);
    }
    const vector = vectorResult.value[0];
    if (vector === undefined) throw new Error(`${item.id}: embedding worker returned no vector`);

    const branches: Record<string, unknown> = {};
    for (const strategy of strategies) {
      const queryStarted = performance.now();
      const result = await Effect.runPromise(qdrant.search({
        workspaceId: workspaceId.value,
        ...(strategy === 'sparse' ? {} : { vector }),
        queryText: item.query,
        strategy,
        limit: queryLimit,
        requestId: `rank-probe-${item.id}-${strategy}`,
      }));
      const queryLatencyMs = Math.max(0, performance.now() - queryStarted);
      if (result._tag === 'Err') {
        throw new Error(`${item.id}/${strategy}: ${result.error.code}: ${result.error.message}`);
      }
      const appliedEmbeddingLatencyMs = strategy === 'sparse' ? 0 : embeddingLatencyMs;
      branches[strategy] = {
        candidateIds: result.value.map((ranked) => ranked.candidate.candidateId),
        scores: result.value.map((ranked) => ranked.score),
        embeddingLatencyMs: appliedEmbeddingLatencyMs,
        queryLatencyMs,
        totalMeasuredLatencyMs: appliedEmbeddingLatencyMs + queryLatencyMs,
      };
    }
    observations.push({ caseId: item.id, branches });
  }

  const sourceCommit = process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(resolve(outputArg), JSON.stringify({
    schemaVersion: 1,
    sourceCommit,
    holdout: holdoutArg,
    holdoutSha256,
    holdoutStatus: holdout.status,
    workspaceId: workspaceId.value,
    collection,
    queryLimit,
    embeddingIdentity: embeddings.identity() ?? null,
    strategies,
    observations,
    note: 'Evaluation-only rank telemetry. Sparse records zero dense-embedding work; production ace_context issues one configured strategy.',
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    output: outputArg,
    holdoutSha256,
    cases: observations.length,
    strategies,
  }) + '\n');
} finally {
  embeddings.close();
}
