import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditedHarborLabel } from '../src/domain/harbor-report-label.js';

interface TaskSummary {
  readonly taskName: string;
  readonly trials: number;
  readonly successes: number;
  readonly failures: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly rawTotalTokens: number | null;
  readonly costUsd: number | null;
  readonly latencyMsMedian: number | null;
}

interface ConfigurationSummary {
  readonly taskStats: readonly TaskSummary[];
  readonly trials: number;
  readonly successes: number;
  readonly rawTotalTokens: number | null;
  readonly costUsd: number | null;
  readonly aceCalls: number;
  readonly currentSourceCalls: number;
}

interface GateReport {
  readonly native: ConfigurationSummary;
  readonly ace: ConfigurationSummary;
  readonly acceptance: string;
  readonly paired: boolean;
  readonly qualityNonInferior: boolean;
  readonly providerReceiptsVerified: boolean;
  readonly savingsFactor: number | null;
  readonly tokenReduction: number | null;
  readonly costSavingsFactor: number | null;
  readonly costReduction: number | null;
  readonly evaluationDesign?: string;
  readonly providerOperationsObserved?: boolean;
  readonly providerCorrelationVerified?: boolean;
  readonly productionAcceptance?: string;
  readonly limitations?: readonly string[];
}

const csv = (value: string | number | null | boolean): string => `"${String(value).replaceAll('"', '""')}"`;
const format = (value: number | null): string => value === null ? 'unavailable' : value.toFixed(3);

const main = async (): Promise<void> => {
  const [inputPath = 'benchmarks/reports/ace-retrieval-paired-3x3.json', outputDirectory = 'benchmarks/reports'] = process.argv.slice(2);
  const report = JSON.parse(await readFile(inputPath, 'utf8')) as GateReport;
  const label = auditedHarborLabel(report.acceptance, report.evaluationDesign);
  const configurations: ReadonlyArray<readonly [string, ConfigurationSummary]> = [
    ['native-codex', report.native],
    ['codex-plus-ace', report.ace],
  ];
  const rows = [
    ['native-codex', 'aggregate', report.native],
    ['codex-plus-ace', 'aggregate', report.ace],
    ...report.native.taskStats.map((task) => ['native-codex', task.taskName, task] as const),
    ...report.ace.taskStats.map((task) => ['codex-plus-ace', task.taskName, task] as const),
  ] as const;
  const csvLines = [
    'configuration,scope,trials,successes,failures,input_tokens,cached_input_tokens,output_tokens,raw_total_tokens,cost_usd,latency_ms_median,ace_calls,current_source_calls',
    ...rows.map(([configuration, scope, summary]) => [
      configuration, scope, summary.trials, summary.successes, 'failures' in summary ? summary.failures : summary.trials - summary.successes,
      'inputTokens' in summary ? summary.inputTokens : null,
      'cachedInputTokens' in summary ? summary.cachedInputTokens : null,
      'outputTokens' in summary ? summary.outputTokens : null,
      summary.rawTotalTokens, summary.costUsd,
      'latencyMsMedian' in summary ? summary.latencyMsMedian : null,
      'aceCalls' in summary ? summary.aceCalls : null,
      'currentSourceCalls' in summary ? summary.currentSourceCalls : null,
    ].map((value) => csv(value as string | number | null | boolean)).join(',')),
  ].join('\n') + '\n';
  const markdown = [
    '# Production retrieval paired Harbor report',
    '',
    `- Historical gate result: **${report.acceptance}**`,
    `- Audited interpretation: **${label}**`,
    `- Evaluation design: ${report.evaluationDesign ?? 'unrecorded; cannot infer natural tool use'}`,
    `- Per-request provider correlation: ${report.providerCorrelationVerified === true ? 'verified' : 'not demonstrated'}`,
    '- Provider CPU/RAM/indexing costs: not metered; displayed USD totals are Codex-reported usage only.',
    `- Paired: ${report.paired}`,
    `- Quality non-inferior: ${report.qualityNonInferior}`,
    `- Provider receipts verified: ${report.providerReceiptsVerified}`,
    `- Savings factor (native / ACE raw total tokens): ${format(report.savingsFactor)}`,
    `- Token reduction: ${format(report.tokenReduction)}`,
    `- Cost savings factor: ${format(report.costSavingsFactor)}`,
    `- Cost reduction: ${format(report.costReduction)}`,
    '',
    '| Configuration | Trials | Successes | Raw tokens | Cost USD | ACE calls | Current-source calls |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...configurations.map(([configuration, summary]) => `| ${configuration} | ${summary.trials} | ${summary.successes} | ${summary.rawTotalTokens ?? 'unavailable'} | ${summary.costUsd ?? 'unavailable'} | ${summary.aceCalls} | ${summary.currentSourceCalls} |`),
    '',
    '## Per-task results',
    '',
    '| Configuration | Task | Trials | Successes | Failures | Raw tokens | Cost USD | Median latency ms |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...configurations.flatMap(([configuration, summary]) => summary.taskStats.map((task) => `| ${configuration} | ${task.taskName} | ${task.trials} | ${task.successes} | ${task.failures} | ${task.rawTotalTokens ?? 'unavailable'} | ${task.costUsd ?? 'unavailable'} | ${task.latencyMsMedian ?? 'unavailable'} |`)),
    '',
    'These ratios describe the recorded trials only; forced tool use and tiny repeated fixtures cannot establish a production 5× retrieval result.',
    '',
    '## Known limitations',
    ...(report.limitations ?? [
      'Historical report pre-dates explicit evaluation-mode/correlation fields and cannot be promoted to normative DBC-12 acceptance.',
    ]).map((limitation) => `- ${limitation}`),
    '',
  ].join('\n');
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, 'ace-retrieval-paired-3x3.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(join(outputDirectory, 'ace-retrieval-paired-3x3.md'), markdown, 'utf8'),
    writeFile(join(outputDirectory, 'ace-retrieval-paired-3x3.csv'), csvLines, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify({ acceptance: report.acceptance, savingsFactor: report.savingsFactor, outputDirectory })}\n`);
};

await main();
