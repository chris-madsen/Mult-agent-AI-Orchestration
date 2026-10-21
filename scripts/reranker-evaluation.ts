import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeProcessRerankerPort } from '../src/adapters/process-reranker.js';
import {
  evaluateRerankerRun,
  type RerankerEvaluationRun,
  type RerankerFixture,
} from '../src/domain/reranker-evaluation.js';

const [fixtureArg, outputArg] = process.argv.slice(2);
if (fixtureArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/reranker-evaluation.ts <fixture.json> <output.json>');
}
const model = process.env.ACE_RERANKER_MODEL?.trim();
const licenseReference = process.env.ACE_RERANKER_LICENSE_REFERENCE?.trim();
if (model === undefined || model.length === 0) throw new Error('ACE_RERANKER_MODEL is required');
if (licenseReference === undefined || licenseReference.length === 0) {
  throw new Error('ACE_RERANKER_LICENSE_REFERENCE is required for evidence');
}
const worker = process.env.ACE_RERANKER_WORKER?.trim()
  || resolve('scripts/fastembed-reranker-worker.sh');
const timeoutMs = Number(process.env.ACE_RERANKER_TIMEOUT_MS ?? '120000');
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) {
  throw new Error('ACE_RERANKER_TIMEOUT_MS must be an integer between 100 and 3600000');
}

const fixtureBytes = await readFile(resolve(fixtureArg));
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as RerankerFixture;
const env: Record<string, string> = { ACE_RERANKER_MODEL: model };
for (const name of [
  'ACE_RERANKER_PYTHON',
  'ACE_RERANKER_THREADS',
  'FASTEMBED_CACHE_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
]) {
  const value = process.env[name]?.trim();
  if (value !== undefined && value.length > 0) env[name] = value;
}

const reranker = makeProcessRerankerPort({
  command: worker,
  timeoutMs,
  expectedModel: model,
  env,
});
try {
  const probe = await Effect.runPromise(reranker.probe());
  if (probe._tag === 'Err') {
    throw new Error(`${probe.error.code}: ${probe.error.path}: ${probe.error.message}`);
  }
  const identity = reranker.identity();
  if (identity === undefined) throw new Error('reranker identity receipt is unavailable after successful probe');

  const observations: RerankerEvaluationRun['observations'][number][] = [];
  for (const item of fixture.cases) {
    const started = performance.now();
    const result = await Effect.runPromise(reranker.rerank({
      query: item.query,
      documents: item.documents,
      requestId: `reranker-eval-${item.id}`,
    }));
    const latencyMs = Math.max(0, performance.now() - started);
    if (result._tag === 'Err') {
      throw new Error(`${item.id}: ${result.error.code}: ${result.error.message}`);
    }
    observations.push({
      caseId: item.id,
      rankedDocumentIndexes: result.value.map((score) => score.index),
      latencyMs,
    });
  }
  const run: RerankerEvaluationRun = { fixtureSha256, observations };
  const metrics = evaluateRerankerRun(fixture, run);
  if (metrics._tag === 'Err') {
    throw new Error(`${metrics.error.code}: ${metrics.error.path}: ${metrics.error.message}`);
  }
  const sourceCommit = process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(resolve(outputArg), JSON.stringify({
    schemaVersion: 1,
    sourceCommit,
    fixture: fixtureArg,
    fixtureSha256,
    fixtureStatus: fixture.status,
    providerIdentity: identity,
    licenseReference,
    metrics: metrics.value,
    observations,
    note: 'Evaluation evidence only. This report does not select or approve a production reranker.',
  }, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    output: outputArg,
    model: identity.model,
    fixtureSha256,
    recallAt1: metrics.value.recallAt1,
    latencyP95Ms: metrics.value.latencyP95Ms,
  }) + '\n');
} finally {
  reranker.close();
}
