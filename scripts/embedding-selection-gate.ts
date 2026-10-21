import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateEmbeddingSelection,
  type EmbeddingComparisonReport,
  type EmbeddingSelectionPolicy,
} from '../src/domain/embedding-selection.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const main = async (): Promise<void> => {
  const [reportArg, policyArg, outputArg] = process.argv.slice(2);
  if (reportArg === undefined || policyArg === undefined || outputArg === undefined) {
    throw new Error('Usage: tsx scripts/embedding-selection-gate.ts <comparison.json> <policy.json> <output.json>');
  }
  const reportPath = resolve(reportArg);
  const policyPath = resolve(policyArg);
  const outputPath = resolve(outputArg);
  const [reportBytes, policyBytes] = await Promise.all([
    readFile(reportPath),
    readFile(policyPath),
  ]);
  const report = JSON.parse(reportBytes.toString('utf8')) as EmbeddingComparisonReport;
  const policy = JSON.parse(policyBytes.toString('utf8')) as EmbeddingSelectionPolicy;
  const verdict = evaluateEmbeddingSelection(report, policy);
  if (verdict._tag === 'Err') {
    throw new Error(`${verdict.error.code}: ${verdict.error.path}: ${verdict.error.message}`);
  }

  const output = {
    schemaVersion: 1,
    sourceCommit: process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
      || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    reportPath: reportArg,
    policyPath: policyArg,
    reportSha256: sha256(reportBytes),
    policySha256: sha256(policyBytes),
    evidenceStage: report.evidence_stage,
    dataset: report.dataset,
    datasetSha256: report.dataset_sha256,
    verdict: verdict.value,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    output: outputArg,
    selectedProvider: verdict.value.selectedProvider,
    status: verdict.value.status,
    measurementAccepted: verdict.value.measurementAccepted,
    productionApproved: verdict.value.productionApproved,
  }) + '\n');

  if (!verdict.value.measurementAccepted) process.exitCode = 2;
  if (process.env.ACE_REQUIRE_EMBEDDING_PRODUCTION_APPROVAL === 'true'
    && !verdict.value.productionApproved) process.exitCode = 3;
};

await main();
