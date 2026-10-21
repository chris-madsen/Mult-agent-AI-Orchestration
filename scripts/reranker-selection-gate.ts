import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateRerankerRun,
  frozenRerankerModelCandidates,
  selectRerankerCandidate,
  type RerankerEvaluationRun,
  type RerankerFixture,
  type RerankerSelectionCandidate,
} from '../src/domain/reranker-evaluation.js';

interface RerankerReport {
  readonly fixtureSha256: string;
  readonly sourceCommit?: string;
  readonly providerIdentity?: unknown;
  readonly licenseReference?: string;
  readonly modelId?: string;
  readonly observations: RerankerEvaluationRun['observations'];
  readonly runIdentity?: {
    readonly role?: 'baseline' | 'candidate' | null;
    readonly runnerVersion?: string | null;
    readonly modelRevision?: string | null;
    readonly artifactIdentity?: string | null;
    readonly licenseEvidence?: string | null;
    readonly startupMs?: number | null;
    readonly rssBytes?: number | null;
    readonly modelId?: string | null;
  };
}

const [fixtureArg, baselineArg, outputArg, ...candidateArgs] = process.argv.slice(2);
if (fixtureArg === undefined || baselineArg === undefined || outputArg === undefined || candidateArgs.length === 0) {
  throw new Error('Usage: tsx scripts/reranker-selection-gate.ts <frozen-fixture.json> <hybrid-baseline-report.json> <output.json> <candidate-report.json> [...]');
}
const fixtureBytes = await readFile(resolve(fixtureArg));
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as RerankerFixture;
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const readReport = async (path: string): Promise<RerankerReport> => JSON.parse(await readFile(resolve(path), 'utf8')) as RerankerReport;
const reports = await Promise.all([baselineArg, ...candidateArgs].map(readReport));
const toRun = (report: RerankerReport): RerankerEvaluationRun => ({
  fixtureSha256: report.fixtureSha256,
  observations: report.observations,
  role: report.runIdentity?.role ?? undefined,
  sourceCommit: report.sourceCommit,
  runnerVersion: report.runIdentity?.runnerVersion ?? undefined,
  providerIdentity: typeof report.providerIdentity === 'string'
    ? report.providerIdentity
    : report.providerIdentity === undefined ? 'disabled' : JSON.stringify(report.providerIdentity),
  modelRevision: report.runIdentity?.modelRevision ?? 'not-applicable',
  artifactIdentity: report.runIdentity?.artifactIdentity ?? 'not-applicable',
  licenseEvidence: report.runIdentity?.licenseEvidence ?? report.licenseReference ?? 'not-applicable',
  modelId: report.runIdentity?.modelId ?? report.modelId,
  startupMs: report.runIdentity?.startupMs ?? 0,
  rssBytes: report.runIdentity?.rssBytes ?? 0,
});
if (reports.some((report) => report.fixtureSha256 !== fixtureSha256)) throw new Error('every reranker report must bind the frozen fixture SHA-256');
const baseline = evaluateRerankerRun(fixture, toRun(reports[0] as RerankerReport));
if (baseline._tag === 'Err') throw new Error(`${baseline.error.code}: ${baseline.error.path}: ${baseline.error.message}`);
const candidates: RerankerSelectionCandidate[] = [];
for (const [index, report] of reports.slice(1).entries()) {
  const modelId = report.modelId ?? report.runIdentity?.modelId ?? undefined;
  if (fixture.status === 'frozen_reranker_holdout'
    && (modelId === undefined
      || !frozenRerankerModelCandidates.includes(modelId as typeof frozenRerankerModelCandidates[number]))) {
    throw new Error(`candidate ${index} is not one of the fixed frozen reranker models: ${modelId ?? 'missing'}`);
  }
  const run = toRun(report as RerankerReport);
  const metrics = evaluateRerankerRun(fixture, run);
  if (metrics._tag === 'Err') throw new Error(`candidate ${index}: ${metrics.error.code}: ${metrics.error.path}: ${metrics.error.message}`);
  candidates.push({
    identity: run.providerIdentity as string,
    modelId,
    metrics: metrics.value,
    licenseEvidence: run.licenseEvidence as string,
  });
}
const verdict = selectRerankerCandidate(baseline.value, candidates);
await writeFile(resolve(outputArg), JSON.stringify({
  schemaVersion: 1,
  fixture: fixtureArg,
  fixtureSha256,
  baseline: baseline.value,
  candidates: candidates.map((candidate) => ({ identity: candidate.identity, metrics: candidate.metrics })),
  verdict,
  note: 'No candidate is production-approved by this file alone; owner approval must bind the selected model, revision, artifact and license to the release commit.',
}, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output: outputArg, accepted: verdict.accepted, selectedIdentity: verdict.selectedIdentity }) + '\n');
if (!verdict.accepted) process.exitCode = 2;
