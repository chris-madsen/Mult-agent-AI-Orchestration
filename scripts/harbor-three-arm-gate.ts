import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  assessThreeArmReports,
  validateHarborPairReport,
  validateHarborReportExecutionIdentity,
  validateThreeArmDesign,
  type HarborPairReportSummary,
} from '../src/domain/harbor-three-arm.js';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;
const sha256File = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');

const [
  naturalReportPath,
  forcedReportPath,
  outputPath,
  nativeJobPath = 'benchmarks/harbor/ace-suite/retrieval-native-paired-job.json',
  naturalJobPath = 'benchmarks/harbor/ace-suite/retrieval-ace-natural-job.json',
  forcedJobPath = 'benchmarks/harbor/ace-suite/retrieval-ace-paired-job.json',
] = process.argv.slice(2);

if (naturalReportPath === undefined || forcedReportPath === undefined || outputPath === undefined) {
  throw new Error('Usage: tsx scripts/harbor-three-arm-gate.ts <natural-pair-report.json> <forced-pair-report.json> <output.json> [native-job.json] [natural-job.json] [forced-job.json]');
}

const [nativeJob, naturalJob, forcedJob, naturalReport, forcedReport] = await Promise.all([
  readJson(nativeJobPath),
  readJson(naturalJobPath),
  readJson(forcedJobPath),
  readJson(naturalReportPath),
  readJson(forcedReportPath),
]);

const [nativeJobSha256, naturalJobSha256, forcedJobSha256, naturalReportSha256, forcedReportSha256] = await Promise.all([
  sha256File(nativeJobPath),
  sha256File(naturalJobPath),
  sha256File(forcedJobPath),
  sha256File(naturalReportPath),
  sha256File(forcedReportPath),
]);

const design = validateThreeArmDesign(nativeJob, naturalJob, forcedJob);
if (design._tag === 'Err') throw new Error(`${design.error.code}: ${design.error.message}`);
const naturalSummary = validateHarborPairReport(naturalReport);
if (naturalSummary._tag === 'Err') throw new Error(`${naturalSummary.error.code}: ${naturalSummary.error.message}`);
const forcedSummary = validateHarborPairReport(forcedReport);
if (forcedSummary._tag === 'Err') throw new Error(`${forcedSummary.error.code}: ${forcedSummary.error.message}`);
const identityChecks: readonly [string, HarborPairReportSummary, string, readonly string[]][] = [
  ['natural', naturalSummary.value, naturalJobSha256, design.value.natural.tasks],
  ['forced', forcedSummary.value, forcedJobSha256, design.value.forced.tasks],
];
for (const [label, summary, expectedDigest, expectedTasks] of identityChecks) {
  const identity = validateHarborReportExecutionIdentity(summary, expectedDigest, expectedTasks);
  if (identity._tag === 'Err') throw new Error(`${identity.error.code}: ${label} ${identity.error.message}`);
}
const outcome = assessThreeArmReports(naturalSummary.value, forcedSummary.value);
if (outcome._tag === 'Err') throw new Error(`${outcome.error.code}: ${outcome.error.message}`);

const designFingerprint = createHash('sha256')
  .update(JSON.stringify(design.value), 'utf8')
  .digest('hex');

const report = {
  evidence: 'three-arm-harbor-comparison',
  design_fingerprint: designFingerprint,
  arms: {
    A: 'native-codex-natural',
    B: 'codex-plus-ace-optional-natural',
    C: 'codex-plus-ace-forced-diagnostic',
  },
  design: {
    distinct_task_count: design.value.distinctTaskCount,
    total_task_trials_per_arm: design.value.native.tasks.length,
    model: design.value.native.modelName,
    reasoning_effort: design.value.native.reasoningEffort,
    natural_extra_instructions: design.value.natural.extraInstructions,
    forced_extra_instruction_count: design.value.forced.extraInstructions.length,
  },
  outcome: outcome.value,
  source_reports: {
    natural: naturalReportPath,
    forced: forcedReportPath,
    natural_sha256: naturalReportSha256,
    forced_sha256: forcedReportSha256,
  },
  execution_identity: {
    native_job_sha256: nativeJobSha256,
    natural_job_sha256: naturalJobSha256,
    forced_job_sha256: forcedJobSha256,
    design_fingerprint: designFingerprint,
    task_paths: design.value.native.tasks,
  },
  limitations: [
    outcome.value.naturalUse === 'not_observed'
      ? 'ACE was available in the optional-natural arm but Codex did not call it; no ACE-caused retrieval benefit is attributable.'
      : outcome.value.naturalUse === 'observed_partial_only'
        ? 'Codex called ACE naturally, but no complete successful ACE context call was observed.'
        : 'Natural ACE usage was observed; quality, correlation and complete cost telemetry still govern acceptance.',
    'The forced arm is diagnostic only and can never establish natural tool-choice savings.',
    outcome.value.costTelemetryComplete
      ? 'End-to-end cost telemetry is marked complete by the input report.'
      : 'Local CPU/RAM/indexing/electricity/provider costs remain unknown; they are not treated as zero.',
    'A 5x target is not inferred from this report; measured ratios describe only the supplied frozen trials.',
  ],
};

await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: outputPath,
  naturalUse: outcome.value.naturalUse,
  productionAcceptance: outcome.value.productionAcceptance,
  designFingerprint,
}) + '\n');

if (process.env.ACE_HARBOR_REQUIRE_PRODUCTION_ACCEPTANCE === 'true'
  && outcome.value.productionAcceptance !== 'measured-not-necessarily-5x') {
  process.exitCode = 2;
}
