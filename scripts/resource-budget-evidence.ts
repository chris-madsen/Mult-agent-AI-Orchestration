import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  evaluateResourceBudgetEvidence,
  type ResourceBudgetEvidenceInput,
} from '../src/domain/resource-budget-evidence.js';

const containedPath = (input: string): string => {
  const absolute = resolve(input);
  const rel = relative(process.cwd(), absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.length === 0) {
    throw new Error(`resource-budget evidence path must be repository-contained: ${input}`);
  }
  return rel.split('\\').join('/');
};

const [inputArg, outputArg] = process.argv.slice(2);
if (inputArg === undefined || outputArg === undefined) {
  throw new Error('Usage: tsx scripts/resource-budget-evidence.ts <measurement.json> <evidence.json>');
}

const inputPath = containedPath(inputArg);
const input = JSON.parse(await readFile(inputPath, 'utf8')) as ResourceBudgetEvidenceInput;
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();

const verdict = evaluateResourceBudgetEvidence(input, currentCommit);
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidence: verdict.value.evidence,
  scope: input.scope,
  sourceCommit: input.sourceCommit,
  currentCommit,
  budgetPolicy: input.budgetPolicy,
  measurementEnvironment: input.measurementEnvironment,
  observed: input.observed,
  verdict: verdict.value,
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');

process.stdout.write(JSON.stringify({
  output: outputArg,
  evidence: verdict.value.evidence,
  scope: verdict.value.scope,
  allWithinBudget: verdict.value.allWithinBudget,
  failures: verdict.value.failures,
}) + '\n');

if (process.env.ACE_REQUIRE_RESOURCE_BUDGET_ACCEPTED === 'true' && !verdict.value.allWithinBudget) {
  process.exitCode = 2;
}
