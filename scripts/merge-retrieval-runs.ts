import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluateRetrievalStrategy, type RetrievalHoldout, type RetrievalStrategyRun } from '../src/domain/retrieval-quality-evaluation.js';

interface RankProbeOutput {
  readonly holdoutSha256: string;
  readonly runs: Partial<Record<string, RetrievalStrategyRun>>;
}

const [holdoutArg, outputDirectoryArg, ...runArgs] = process.argv.slice(2);
if (holdoutArg === undefined || outputDirectoryArg === undefined || runArgs.length < 2) {
  throw new Error('Usage: tsx scripts/merge-retrieval-runs.ts <holdout.json> <output-dir> <rank-probe-output.json> [...]');
}
const holdoutBytes = await readFile(resolve(holdoutArg));
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
const holdoutSha256 = createHash('sha256').update(holdoutBytes).digest('hex');
const outputs = await Promise.all(runArgs.map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8')) as RankProbeOutput));
if (outputs.some((output) => output.holdoutSha256 !== holdoutSha256)) throw new Error('all rank probe outputs must bind the exact holdout SHA-256');
const strategies = [...new Set(outputs.flatMap((output) => Object.keys(output.runs)))];
await mkdir(resolve(outputDirectoryArg), { recursive: true });
for (const strategy of strategies) {
  const runs = outputs.map((output) => output.runs[strategy]).filter((run): run is RetrievalStrategyRun => run !== undefined);
  if (runs.length !== outputs.length) throw new Error(`strategy ${strategy} is missing from one repository run`);
  const first = runs[0] as RetrievalStrategyRun;
  const observations = runs.flatMap((run) => run.observations);
  const merged: RetrievalStrategyRun = {
    ...first,
    observations,
    providerIdentities: Object.assign({}, ...runs.map((run) => run.providerIdentities ?? {})),
  };
  const evaluated = evaluateRetrievalStrategy(holdout, merged);
  if (evaluated._tag === 'Err') {
    throw new Error(`${strategy}: ${evaluated.error.code}: ${evaluated.error.path}: ${evaluated.error.message}`);
  }
  const outputPath = resolve(outputDirectoryArg, `${strategy}.json`);
  await writeFile(outputPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ strategy, output: outputPath, cases: merged.observations.length }) + '\n');
}
