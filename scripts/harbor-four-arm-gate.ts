import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readHarborFourArmTrialObservations } from '../src/adapters/harbor-four-arm-trial-evidence.js';
import { verifyHarborJobByteBinding } from '../src/application/harbor-byte-binding.js';
import { assessHarborFourArmFiveX, validateHarborFourArmDesign, validateHarborFourArmReport } from '../src/domain/harbor-four-arm.js';
import { bindHarborTrialsToFrozenTasks, reconcileHarborFourArmTrials } from '../src/domain/harbor-four-arm-evidence.js';

const [nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath, reportPath, outputPath,
  nativeTrialsPath, denseTrialsPath, hybridTrialsPath, deltaTrialsPath] = process.argv.slice(2);
if ([nativeJobPath, denseJobPath, hybridJobPath, deltaJobPath, reportPath, outputPath].some((value) => value === undefined)) {
  throw new Error('Usage: ACE_HARBOR_REPOSITORY_IDS=repo-a,repo-b tsx scripts/harbor-four-arm-gate.ts <native-job.json> <dense-job.json> <hybrid-job.json> <hybrid-delta-job.json> <report.json> <output.json> [<native-result.json> <dense-result.json> <hybrid-result.json> <hybrid-delta-result.json>]');
}
const trialPaths = [nativeTrialsPath, denseTrialsPath, hybridTrialsPath, deltaTrialsPath];
if (trialPaths.some((path) => path !== undefined) && trialPaths.some((path) => path === undefined)) {
  throw new Error('BLOCKED: all four raw Harbor result paths are required for trial-level reconciliation');
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
  requireExternalEvidence: true,
});
if (design._tag === 'Err') throw new Error(`${design.error.code}: ${design.error.path}: ${design.error.message}`);
const workspaceRoot = resolve(process.env.ACE_HARBOR_WORKSPACE_ROOT?.trim() || process.cwd());
const requiredIdentity = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`BLOCKED: ${name} is required to verify Harbor execution identity`);
  return value;
};
const expectedModelIdentity = requiredIdentity('ACE_HARBOR_MODEL_IDENTITY');
const expectedProviderIdentity = requiredIdentity('ACE_HARBOR_PROVIDER_IDENTITY');
const expectedRuntimeImageIdentity = requiredIdentity('ACE_HARBOR_RUNTIME_IMAGE_IDENTITY');
const byteBindings = await Promise.all([
  verifyHarborJobByteBinding(nativeJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(denseJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(hybridJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
  verifyHarborJobByteBinding(deltaJob, { workspaceRoot, expectedModelIdentity, expectedProviderIdentity, expectedRuntimeImageIdentity }),
]);
for (const [index, binding] of byteBindings.entries()) {
  if (binding._tag === 'Err') throw new Error(`BLOCKED: harbor job ${index} byte binding: ${binding.error.code}: ${binding.error.path}: ${binding.error.message}`);
}
const checkedReport = validateHarborFourArmReport(report);
if (checkedReport._tag === 'Err') throw new Error(`${checkedReport.error.code}: ${checkedReport.error.path}: ${checkedReport.error.message}`);
const [nativeJobSha256, denseJobSha256, hybridJobSha256, deltaJobSha256, reportSha256] = await Promise.all([
  sha256File(nativeJobPath as string),
  sha256File(denseJobPath as string),
  sha256File(hybridJobPath as string),
  sha256File(deltaJobPath as string),
  sha256File(reportPath as string),
]);
const readEvidenceArtifact = async (path: string, category: string): Promise<{ readonly path: string; readonly sha256: string }> => {
  const resolved = resolve(workspaceRoot, path);
  const bytes = await readFile(resolved);
  if (bytes.length === 0) throw new Error(`BLOCKED: ${category} artifact is empty: ${path}`);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const rawTraceArtifacts = await Promise.all(checkedReport.value.rawTracePaths.map((path) => readEvidenceArtifact(path, 'raw trace')));
const usageEventArtifacts = await Promise.all(checkedReport.value.usageEventPaths.map((path) => readEvidenceArtifact(path, 'usage event')));
const failedRunArtifacts = await Promise.all(checkedReport.value.failedRunPaths.map((path) => readEvidenceArtifact(path, 'failure')));
const designFingerprint = createHash('sha256').update(JSON.stringify(design.value), 'utf8').digest('hex');
const native = checkedReport.value.arms.native;
const delta = checkedReport.value.arms['hybrid-delta'];
const rawTrialEvidence = trialPaths.every((path): path is string => path !== undefined)
  ? (() => {
    const observations = Promise.all([
      readHarborFourArmTrialObservations('native', trialPaths[0]),
      readHarborFourArmTrialObservations('dense', trialPaths[1]),
      readHarborFourArmTrialObservations('hybrid', trialPaths[2]),
      readHarborFourArmTrialObservations('hybrid-delta', trialPaths[3]),
    ]).then((groups) => {
      const bindings = design.value.native.externalEvidence?.taskBindings;
      if (bindings === undefined) {
        throw new Error('BLOCKED: frozen task bindings are required for raw trial attribution');
      }
      const arms = ['native', 'dense', 'hybrid', 'hybrid-delta'] as const;
      const checkedGroups = groups.map((group, index) => {
        const checked = bindHarborTrialsToFrozenTasks(design.value.native.tasks, bindings, group);
        if (checked._tag === 'Err') {
          throw new Error(`BLOCKED: ${arms[index] ?? 'unknown'} task identity: ${checked.error.message}`);
        }
        return checked.value;
      });
      const reconciled = reconcileHarborFourArmTrials(checkedReport.value.arms, checkedGroups.flat());
      if (reconciled._tag === 'Err') {
        throw new Error(`BLOCKED: raw Harbor trial evidence: ${reconciled.error.path}: ${reconciled.error.message}`);
      }
      return reconciled.value;
    });
    return observations;
  })()
  : undefined;
const reconciledEvidence = rawTrialEvidence === undefined ? undefined : await rawTrialEvidence;
const measuredNativeInputTokens = reconciledEvidence?.arms.native.rawInputTokens ?? native.rawInputTokens;
const measuredDeltaInputTokens = reconciledEvidence?.arms['hybrid-delta'].rawInputTokens ?? delta.rawInputTokens;
const tokenRatio = measuredNativeInputTokens === null || measuredDeltaInputTokens === null || measuredNativeInputTokens === 0
  ? null
  : measuredDeltaInputTokens / measuredNativeInputTokens;
// Without raw trial paths, or when their independently observed telemetry is
// unknown, a self-declared aggregate cannot authorize the five-X claim.
const rawTrialEvidenceVerified = reconciledEvidence?.releaseEligible === true;
const releaseGate = assessHarborFourArmFiveX({
  qualityNonInferior: checkedReport.value.qualityNonInferior,
  costTelemetryComplete: checkedReport.value.costTelemetryComplete,
  tokenRatio,
  rawTrialEvidenceVerified,
});
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
    fiveXAllowed: releaseGate.allowed,
    fiveXBlocker: releaseGate.allowed ? null : releaseGate.reason,
    rawTrialEvidenceVerified,
    rawTrialEvidence: reconciledEvidence === undefined
      ? { status: 'not_supplied', releaseEligible: false }
      : {
        status: reconciledEvidence.status,
        releaseEligible: reconciledEvidence.releaseEligible,
        arms: Object.fromEntries(Object.entries(reconciledEvidence.arms).map(([arm, evidence]) => [arm, {
          status: evidence.status,
          releaseEligible: evidence.releaseEligible,
          unknownFields: evidence.unknownFields,
        }])),
      },
  },
  source: {
    report: reportPath,
    reportSha256,
    nativeJobSha256,
    denseJobSha256,
    hybridJobSha256,
    hybridDeltaJobSha256: deltaJobSha256,
    workspaceRoot,
    taskManifestSha256: design.value.native.externalEvidence?.taskManifestSha256,
    taskBytesSha256: design.value.native.externalEvidence?.taskBytesSha256,
    modelIdentity: design.value.native.externalEvidence?.modelIdentity,
    providerIdentity: design.value.native.externalEvidence?.providerIdentity,
    runtimeImageIdentity: design.value.native.externalEvidence?.runtimeImageIdentity,
    configBindings: {
      native: design.value.native.externalEvidence?.codexConfig,
      dense: design.value.dense.externalEvidence?.codexConfig,
      hybrid: design.value.hybrid.externalEvidence?.codexConfig,
      hybridDelta: design.value.hybridDelta.externalEvidence?.codexConfig,
    },
    rawTraceArtifacts,
    usageEventArtifacts,
    failedRunArtifacts,
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
