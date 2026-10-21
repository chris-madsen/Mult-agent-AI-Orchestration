import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateSemanticProviderSelection,
  type SemanticProviderReport,
  type SemanticSelectionPolicy,
} from '../src/domain/semantic-provider-selection.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const [policyArg, outputArg, ...reportArgs] = process.argv.slice(2);
if (policyArg === undefined || outputArg === undefined || reportArgs.length < 2) {
  throw new Error('Usage: tsx scripts/semantic-provider-selection-gate.ts <policy.json> <output.json> <report1.json> <report2.json> [...]');
}

const policyBytes = await readFile(resolve(policyArg));
const policy = JSON.parse(policyBytes.toString('utf8')) as SemanticSelectionPolicy;
const reports: SemanticProviderReport[] = [];
const reportEvidence: Array<{ readonly path: string; readonly sha256: string }> = [];
for (const reportArg of reportArgs) {
  const bytes = await readFile(resolve(reportArg));
  reports.push(JSON.parse(bytes.toString('utf8')) as SemanticProviderReport);
  reportEvidence.push({ path: reportArg, sha256: sha256(bytes) });
}

const verdict = evaluateSemanticProviderSelection(reports, policy);
if (verdict._tag === 'Err') {
  throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
}
const output = {
  schemaVersion: 1,
  sourceCommit: process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  policyPath: policyArg,
  policySha256: sha256(policyBytes),
  reports: reportEvidence,
  providerIds: reports.map((report) => report.provider).sort(),
  fixtureSha256: policy.requiredFixtureSha256,
  oracleSha256: policy.requiredOracleSha256,
  verdict: verdict.value,
};
await writeFile(resolve(outputArg), JSON.stringify(output, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputArg,
  selectedProvider: verdict.value.selectedProvider,
  status: verdict.value.status,
  matchedComparison: verdict.value.matchedComparison,
  measurementAccepted: verdict.value.measurementAccepted,
  productionApproved: verdict.value.productionApproved,
}) + '\n');

if (!verdict.value.measurementAccepted) process.exitCode = 2;
if (process.env.ACE_REQUIRE_SEMANTIC_PRODUCTION_APPROVAL === 'true'
  && !verdict.value.productionApproved) process.exitCode = 3;
