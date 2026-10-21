import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateRetrievalQualityPolicy,
  evaluateRetrievalStrategy,
  type RetrievalHoldout,
  type RetrievalQualityPolicy,
  type RetrievalStrategyRun,
} from '../src/domain/retrieval-quality-evaluation.js';

const [holdoutArg, runArg, policyArg, outputArg, baselineRunArg] = process.argv.slice(2);
if ([holdoutArg, runArg, policyArg, outputArg].some((value) => value === undefined)) {
  throw new Error('Usage: tsx scripts/retrieval-quality-gate.ts <holdout.json> <run.json> <policy.json> <output.json> [baseline-run.json]');
}
const [holdoutBytes, runBytes, policyBytes, baselineBytes] = await Promise.all([
  readFile(resolve(holdoutArg as string)),
  readFile(resolve(runArg as string)),
  readFile(resolve(policyArg as string)),
  baselineRunArg === undefined ? Promise.resolve(undefined) : readFile(resolve(baselineRunArg)),
]);
const holdoutSha256 = createHash('sha256').update(holdoutBytes).digest('hex');
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
const run = JSON.parse(runBytes.toString('utf8')) as RetrievalStrategyRun;
const policy = JSON.parse(policyBytes.toString('utf8')) as RetrievalQualityPolicy;
if (run.holdoutSha256 !== holdoutSha256) throw new Error('run holdout SHA-256 does not match actual holdout');
const metrics = evaluateRetrievalStrategy(holdout, run);
if (metrics._tag === 'Err') throw new Error(`${metrics.error.code}: ${metrics.error.message}`);
const baselineRun = baselineBytes === undefined
  ? undefined
  : JSON.parse(baselineBytes.toString('utf8')) as RetrievalStrategyRun;
if (baselineRun !== undefined && baselineRun.holdoutSha256 !== holdoutSha256) {
  throw new Error('dense-only baseline holdout SHA-256 does not match actual holdout');
}
const baseline = baselineBytes === undefined
  ? undefined
  : evaluateRetrievalStrategy(holdout, baselineRun as RetrievalStrategyRun);
if (baseline?._tag === 'Err') throw new Error(`${baseline.error.code}: ${baseline.error.message}`);
const verdict = evaluateRetrievalQualityPolicy(
  metrics.value,
  holdoutSha256,
  policy,
  baseline?._tag === 'Ok' ? baseline.value : undefined,
);
if (verdict._tag === 'Err') throw new Error(`${verdict.error.code}: ${verdict.error.message}`);
await writeFile(resolve(outputArg as string), JSON.stringify({
  schemaVersion: 1,
  sourceCommit: process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  holdoutSha256,
  runSha256: createHash('sha256').update(runBytes).digest('hex'),
  policySha256: createHash('sha256').update(policyBytes).digest('hex'),
  ...(baselineBytes === undefined ? {} : { baselineRunSha256: createHash('sha256').update(baselineBytes).digest('hex') }),
  verdict: verdict.value,
}, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output: outputArg, strategy: verdict.value.selectedStrategy, accepted: verdict.value.measurementAccepted }) + '\n');
if (!verdict.value.measurementAccepted) process.exitCode = 2;
