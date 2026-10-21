import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluateRerankerRun, type RerankerEvaluationRun, type RerankerFixture } from '../src/domain/reranker-evaluation.js';
import type { RetrievalStrategyRun } from '../src/domain/retrieval-quality-evaluation.js';

const [fixtureArg, retrievalHoldoutArg, retrievalRunArg, outputArg] = process.argv.slice(2);
if (fixtureArg === undefined || retrievalHoldoutArg === undefined || retrievalRunArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/reranker-baseline-from-retrieval.ts <frozen-reranker-holdout.json> <retrieval-holdout.json> <hybrid-retrieval-run.json> <baseline-report.json>');
}
const fixtureBytes = await readFile(resolve(fixtureArg));
const retrievalHoldoutBytes = await readFile(resolve(retrievalHoldoutArg));
const retrievalBytes = await readFile(resolve(retrievalRunArg));
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as RerankerFixture;
const retrievalRun = JSON.parse(retrievalBytes.toString('utf8')) as RetrievalStrategyRun;
if (fixture.status !== 'frozen_reranker_holdout' || fixture.repositories === undefined) {
  throw new Error('baseline requires a frozen reranker holdout');
}
if (retrievalRun.strategy !== 'hybrid_rrf') throw new Error('baseline retrieval run must be hybrid_rrf');
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const retrievalHoldoutSha256 = createHash('sha256').update(retrievalHoldoutBytes).digest('hex');
if (retrievalRun.holdoutSha256 !== retrievalHoldoutSha256) {
  throw new Error('hybrid retrieval run must be scored against the exact converted retrieval holdout SHA');
}
const observations: RerankerEvaluationRun['observations'] = fixture.cases.map((item) => {
  const retrievalObservation = retrievalRun.observations.find((entry) => entry.caseId === item.id);
  if (retrievalObservation === undefined) throw new Error(`missing hybrid observation for ${item.id}`);
  const candidateIndexes = new Map((item.documentCandidateIds ?? []).map((candidateId, index) => [candidateId, index]));
  const rankedIds = retrievalObservation.stageRanks?.fused ?? retrievalObservation.retrievedCandidateIds;
  const rankedIndexes: number[] = [];
  for (const candidateId of rankedIds) {
    const index = candidateIndexes.get(candidateId);
    if (index !== undefined && !rankedIndexes.includes(index)) rankedIndexes.push(index);
  }
  for (let index = 0; index < item.documents.length; index += 1) {
    if (!rankedIndexes.includes(index)) rankedIndexes.push(index);
  }
  return {
    caseId: item.id,
    rankedDocumentIndexes: rankedIndexes,
    latencyMs: retrievalObservation.latencyMs,
    deliveredPayloadCharacters: retrievalObservation.payloadCharacters,
  };
});
const run: RerankerEvaluationRun = {
  fixtureSha256,
  retrievalHoldoutSha256,
  observations,
  role: 'baseline',
  sourceCommit: retrievalRun.sourceCommit,
  runnerVersion: retrievalRun.runnerVersion ?? 'ace-reranker-baseline-from-retrieval/v1',
  providerIdentity: JSON.stringify(retrievalRun.providerIdentities ?? { strategy: retrievalRun.strategy }),
};
const metrics = evaluateRerankerRun(fixture, run);
if (metrics._tag === 'Err') throw new Error(`${metrics.error.code}: ${metrics.error.path}: ${metrics.error.message}`);
if (existsSync(resolve(outputArg))) throw new Error(`refusing to overwrite baseline report ${resolve(outputArg)}`);
await writeFile(resolve(outputArg), JSON.stringify({
  schemaVersion: 1,
  sourceCommit: run.sourceCommit,
  fixture: fixtureArg,
  fixtureSha256,
  fixtureStatus: fixture.status,
  providerIdentity: retrievalRun.providerIdentities ?? { strategy: retrievalRun.strategy },
  runIdentity: {
    role: run.role,
    runnerVersion: run.runnerVersion,
    modelRevision: null,
    artifactIdentity: null,
    licenseEvidence: null,
    startupMs: null,
    rssBytes: null,
  },
  metrics: metrics.value,
  observations,
  note: 'Hybrid-without-reranker baseline derived from a real ACE MCP retrieval run; no reranker model is selected by this report.',
}, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output: outputArg, fixtureSha256, strategy: retrievalRun.strategy, mrr: metrics.value.mrr }) + '\n');
