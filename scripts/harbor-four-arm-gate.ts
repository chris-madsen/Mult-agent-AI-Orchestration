import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { validateHarborFourArmDesign, validateHarborFourArmReport } from '../src/domain/harbor-four-arm.js';

const [nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath, reportPath, outputPath] = process.argv.slice(2);
if ([nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath, reportPath, outputPath].some((value) => value === undefined)) {
  throw new Error('Usage: ACE_HARBOR_REPOSITORY_IDS=repo-a,repo-b tsx scripts/harbor-four-arm-gate.ts <native-job.json> <dense-job.json> <hybrid-job.json> <hybrid-delta-job.json> <report.json> <output.json>');
}
const repositoryIds = (process.env.ACE_HARBOR_REPOSITORY_IDS ?? 'ace')
  .split(',')
  .map((repositoryId) => repositoryId.trim())
  .filter((repositoryId) => repositoryId.length > 0);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;
const sha256File = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');
const [nativeJob, denseJob, hybridJob, deltaJob, report] = await Promise.all([
  readJson(nativeJobPath as string),
  readJson(denseJobPath as string),
  readJson(hybridJobPath as string),
  readJson(deltaJobPath as string),
  readJson(reportPath as string),
]);
const design = validateHarborFourArmDesign(nativeJob, denseJob, hybridJob, deltaJob, {
  repositoryIds,
  requireExternalEvidence: process.env.ACE_HARBOR_REQUIRE_EXTERNAL_EVIDENCE === 'true',
});
if (design._tag === 'Err') throw new Error(`${design.error.code}: ${design.error.path}: ${design.error.message}`);
const checkedReport = validateHarborFourArmReport(report);
if (checkedReport._tag === 'Err') throw new Error(`${checkedReport.error.code}: ${checkedReport.error.path}: ${checkedReport.error.message}`);
const [nativeJobSha256, denseJobSha256, hybridJobSha256, deltaJobSha256, reportSha256] = await Promise.all([
  sha256File(nativeJobPath as string),
  sha256File(denseJobPath as string),
  sha256File(hybridJobPath as string),
  sha256File(deltaJobPath as string),
  sha256File(reportPath as string),
]);
const designFingerprint = createHash('sha256').update(JSON.stringify(design.value), 'utf8').digest('hex');
const native = checkedReport.value.arms.native;
const delta = checkedReport.value.arms['hybrid-delta'];
const tokenRatio = native.rawInputTokens === null || delta.rawInputTokens === null || native.rawInputTokens === 0
  ? null
  : delta.rawInputTokens / native.rawInputTokens;
const reportOutput = {
  schemaVersion: 1,
  sourceCommit: process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim()
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  evidence: 'four-arm-harbor-comparison',
  designFingerprint,
  arms: {
    A: 'native-codex',
    B: 'codex-plus-ace-dense',
    C: 'codex-plus-ace-hybrid',
    D: 'codex-plus-ace-hybrid-receipts-delta',
  },
  design: {
    distinctTaskCount: design.value.distinctTaskCount,
    tasksPerRepository: design.value.tasksPerRepository,
    totalTrialsPerArm: design.value.native.tasks.length,
    model: design.value.native.modelName,
    reasoningEffort: design.value.native.reasoningEffort,
  },
  verdict: {
    qualityNonInferior: checkedReport.value.qualityNonInferior,
    costTelemetryComplete: checkedReport.value.costTelemetryComplete,
    tokenRatioDeltaOverNative: tokenRatio,
    fiveXAllowed: checkedReport.value.qualityNonInferior
      && checkedReport.value.costTelemetryComplete
      && tokenRatio !== null
      && tokenRatio <= 0.2,
  },
  source: {
    report: reportPath,
    reportSha256,
    nativeJobSha256,
    denseJobSha256,
    hybridJobSha256,
    hybridDeltaJobSha256: deltaJobSha256,
    rawTracePaths: checkedReport.value.rawTracePaths,
    usageEventPaths: checkedReport.value.usageEventPaths,
    failedRunPaths: checkedReport.value.failedRunPaths,
  },
};
await writeFile(outputPath as string, JSON.stringify(reportOutput, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputPath,
  designFingerprint,
  qualityNonInferior: checkedReport.value.qualityNonInferior,
  tokenRatio,
  fiveXAllowed: reportOutput.verdict.fiveXAllowed,
}) + '\n');
