import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateRetrievalStrategy,
  selectRetrievalStrategy,
  type RetrievalHoldout,
  type RetrievalQualityMetrics,
  type RetrievalStrategyRun,
} from '../src/domain/retrieval-quality-evaluation.js';

const expectedStrategies = [
  'sparse',
  'dense',
  'hybrid_rrf',
  'hybrid_reranker',
  'hybrid_reranker_working_context',
] as const;

const [holdoutArg, outputArg, ...runArgs] = process.argv.slice(2);
if (holdoutArg === undefined || outputArg === undefined || runArgs.length !== expectedStrategies.length) {
  throw new Error(
    'Usage: tsx scripts/retrieval-ablation-gate.ts <holdout.json> <output.json> <sparse-run.json> <dense-run.json> <hybrid-rrf-run.json> <hybrid-reranker-run.json> <hybrid-reranker-working-context-run.json>',
  );
}

const holdoutBytes = await readFile(resolve(holdoutArg));
const holdoutSha256 = createHash('sha256').update(holdoutBytes).digest('hex');
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
if (holdout.status !== 'frozen_multi_repository_holdout') {
  throw new Error('retrieval ablation requires frozen_multi_repository_holdout');
}

const metrics: RetrievalQualityMetrics[] = [];
const runDigests: Record<string, string> = {};
for (const [index, expectedStrategy] of expectedStrategies.entries()) {
  const runPath = runArgs[index] as string;
  const runBytes = await readFile(resolve(runPath));
  const run = JSON.parse(runBytes.toString('utf8')) as RetrievalStrategyRun;
  if (run.strategy !== expectedStrategy) {
    throw new Error(`run ${runPath} must declare strategy ${expectedStrategy}`);
  }
  if (run.holdoutSha256 !== holdoutSha256) {
    throw new Error(`run ${runPath} does not match the frozen holdout SHA-256`);
  }
  const evaluated = evaluateRetrievalStrategy(holdout, run);
  if (evaluated._tag === 'Err') {
    throw new Error(`${expectedStrategy}: ${evaluated.error.code}: ${evaluated.error.path}: ${evaluated.error.message}`);
  }
  metrics.push(evaluated.value);
  runDigests[expectedStrategy] = createHash('sha256').update(runBytes).digest('hex');
}

const selection = selectRetrievalStrategy(metrics, 'dense');
if (selection._tag === 'Err') {
  throw new Error(`${selection.error.code}: ${selection.error.path}: ${selection.error.message}`);
}

await writeFile(resolve(outputArg), JSON.stringify({
  schemaVersion: 1,
  holdout: holdoutArg,
  holdoutSha256,
  requiredStrategies: expectedStrategies,
  runDigests,
  metrics,
  selection: selection.value,
  note: 'Dense-only is the frozen reference. Hybrid variants are accepted only after non-inferiority on critical Recall@5, MRR and nDCG@5; payload and latency are tie-breakers only.',
}, null, 2) + '\n', 'utf8');

process.stdout.write(JSON.stringify({
  output: outputArg,
  holdoutSha256,
  strategies: expectedStrategies,
  selectedStrategy: selection.value.selectedStrategy,
  fallbackToDense: selection.value.fallbackToDense,
}) + '\n');
