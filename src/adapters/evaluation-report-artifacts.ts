import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ComparisonReport, Measurement } from '../domain/evaluation.js';

export interface ReportArtifact {
  readonly format: 'jsonl' | 'csv' | 'markdown';
  readonly content: string;
  readonly sha256: string;
}

export interface WrittenReportArtifacts {
  readonly jsonlPath: string;
  readonly csvPath: string;
  readonly markdownPath: string;
  readonly artifacts: readonly ReportArtifact[];
}

const measurementValue = <Value>(measurement: Measurement<Value>): Value | undefined =>
  measurement.status === 'known' ? measurement.value : undefined;

const measurementText = <Value>(measurement: Measurement<Value>): string => {
  const value = measurementValue(measurement);
  return value === undefined ? '' : String(value);
};

const digest = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

export const renderComparisonReportJsonl = (report: ComparisonReport): string => {
  const header = JSON.stringify({
    type: 'comparison_report',
    report_id: report.reportId,
    suite_id: report.suiteId,
    suite_version: report.suiteVersion,
    frozen_suite_fingerprint: report.frozenSuiteFingerprint,
    total_runs: report.totalRuns,
    successful_runs: report.successfulRuns,
    quality_pass_rate: report.qualityPassRate,
    limitations: report.limitations,
    evidence_hash: report.evidenceHash,
    released_at_ms: report.releasedAtMs,
  });
  const runs = report.runMetrics.map((run) => JSON.stringify({
    type: 'run_metric',
    report_id: report.reportId,
    run_id: run.runId,
    state: run.state,
    quality: run.quality,
    total_tokens: run.totalTokens,
    cost_usd: run.costUsd,
  }));
  return `${[header, ...runs].join('\n')}\n`;
};

export const renderComparisonReportCsv = (report: ComparisonReport): string => {
  const lines = [
    'report_id,suite_id,suite_version,run_id,state,quality,total_tokens,total_tokens_status,cost_usd,cost_status',
    ...report.runMetrics.map((run) => [
      report.reportId,
      report.suiteId,
      String(report.suiteVersion),
      run.runId,
      run.state,
      run.quality,
      measurementText(run.totalTokens),
      run.totalTokens.status,
      measurementText(run.costUsd),
      run.costUsd.status,
    ].map((value) => `"${value.replaceAll('"', '""')}"`).join(',')),
  ];
  return `${lines.join('\n')}\n`;
};

export const renderComparisonReportMarkdown = (report: ComparisonReport): string => {
  const rows = report.runMetrics.map((run) =>
    `| ${run.runId} | ${run.state} | ${run.quality} | ${measurementText(run.totalTokens) || 'unknown'} | ${measurementText(run.costUsd) || 'unknown'} |`,
  );
  return [
    `# Comparison report ${report.reportId}`,
    '',
    `- Suite: ${report.suiteId} v${report.suiteVersion}`,
    `- Frozen suite: \`${report.frozenSuiteFingerprint}\``,
    `- Runs: ${report.totalRuns}; successful: ${report.successfulRuns}`,
    `- Quality pass rate: ${measurementText(report.qualityPassRate) || 'unknown'}`,
    `- Evidence hash: \`${report.evidenceHash}\``,
    '',
    '| Run | State | Quality | Total tokens | Cost USD |',
    '|---|---|---|---:|---:|',
    ...rows,
    '',
    '## Limitations',
    ...report.limitations.map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
};

const artifact = (format: ReportArtifact['format'], content: string): ReportArtifact => ({
  format,
  content,
  sha256: digest(content),
});

export const renderComparisonReportArtifacts = (report: ComparisonReport): readonly ReportArtifact[] => [
  artifact('jsonl', renderComparisonReportJsonl(report)),
  artifact('csv', renderComparisonReportCsv(report)),
  artifact('markdown', renderComparisonReportMarkdown(report)),
];

export const writeComparisonReportArtifacts = async (
  directory: string,
  report: ComparisonReport,
): Promise<Result<WrittenReportArtifacts, ReturnType<typeof domainError>>> => {
  try {
    await mkdir(directory, { recursive: true });
    const artifacts = renderComparisonReportArtifacts(report);
    const paths = {
      jsonlPath: join(directory, `${report.reportId}.jsonl`),
      csvPath: join(directory, `${report.reportId}.csv`),
      markdownPath: join(directory, `${report.reportId}.md`),
    };
    const destinations = [paths.jsonlPath, paths.csvPath, paths.markdownPath];
    for (const [index, destination] of destinations.entries()) {
      const item = artifacts[index];
      if (item === undefined) return err(domainError('PERSISTENCE_FAILED', 'report', 'report artifact mapping failed'));
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, item.content, 'utf8');
      await rename(temporary, destination);
    }
    return ok({ ...paths, artifacts });
  } catch {
    return err(domainError('PERSISTENCE_FAILED', 'report', 'comparison report artifacts could not be written'));
  }
};
