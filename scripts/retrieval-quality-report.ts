import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateRetrievalStrategy,
  type RetrievalHoldout,
  type RetrievalStrategyRun,
} from '../src/domain/retrieval-quality-evaluation.js';

const [holdoutArg, outputArg, ...runArgs] = process.argv.slice(2);
if (holdoutArg === undefined || outputArg === undefined || runArgs.length === 0) {
  throw new Error('Usage: tsx scripts/retrieval-quality-report.ts <holdout.json> <output.json> <run1.json> [run2.json ...]');
}
const holdoutBytes = await readFile(resolve(holdoutArg));
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
const holdoutSha256 = createHash('sha256').update(holdoutBytes).digest('hex');
const metrics = [];
for (const runArg of runArgs) {
  const run = JSON.parse(await readFile(resolve(runArg), 'utf8')) as RetrievalStrategyRun;
  if (run.holdoutSha256 !== holdoutSha256) {
    throw new Error(`run ${runArg} does not match actual holdout SHA-256`);
  }
  const evaluated = evaluateRetrievalStrategy(holdout, run);
  if (evaluated._tag === 'Err') {
    throw new Error(`${evaluated.error.code}: ${evaluated.error.path}: ${evaluated.error.message}`);
  }
  metrics.push(evaluated.value);
}
await writeFile(resolve(outputArg), JSON.stringify({
  schemaVersion: 1,
  holdout: holdoutArg,
  holdoutSha256,
  holdoutStatus: holdout.status,
  metrics,
  note: 'No winner is selected by this report. Apply a predeclared policy separately.',
}, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output: outputArg, holdoutSha256, strategies: metrics.map((item) => item.strategy) }) + '\n');
