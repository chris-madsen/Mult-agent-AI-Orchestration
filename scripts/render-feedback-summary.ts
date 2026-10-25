import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  validateFeedbackArtifactHashes,
  validateFeedbackReport,
} from '../src/domain/feedback-loop-experiment.js';

type JsonObject = Readonly<Record<string, unknown>>;
const object = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const markdownCell = (value: unknown): string => {
  const text = value === null || value === undefined ? 'UNKNOWN' : String(value);
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
};

const usage = (): never => {
  throw new Error('Usage: tsx scripts/render-feedback-summary.ts <feedback-run-directory> <benchmarks/reports/output.md>');
};

const main = async (): Promise<void> => {
  const [runDirectoryArg, outputArg, outputMode] = process.argv.slice(2);
  if (runDirectoryArg === undefined || outputArg === undefined) return usage();
  const runDirectory = resolve(runDirectoryArg);
  const outputPath = resolve(outputArg);
  const reportsRoot = resolve('benchmarks/reports');
  const outputRelative = relative(reportsRoot, outputPath);
  if (outputMode === '--external-output') {
    if (outputPath !== resolve(dirname(runDirectory), 'report.md')) {
      throw new Error('BLOCKED: external feedback report must be the sibling report.md of reconciled results');
    }
    const sourceRelation = relative(resolve('.'), outputPath);
    if (!isAbsolute(sourceRelation) && sourceRelation !== '..' && !sourceRelation.startsWith('../')) {
      throw new Error('BLOCKED: external feedback report must be outside the source checkout');
    }
  } else if (outputMode !== undefined || isAbsolute(outputRelative) || outputRelative === '..' || outputRelative.startsWith('../')) {
    throw new Error('BLOCKED: feedback summary must be written under benchmarks/reports');
  }
  const manifestBytes = await readFile(resolve(runDirectory, 'manifest.json'));
  const metricsBytes = await readFile(resolve(runDirectory, 'metrics.json'));
  const taskManifestBytes = await readFile(resolve(runDirectory, 'task-manifest.json'));
  const manifest = object(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  const report = validateFeedbackReport(JSON.parse(metricsBytes.toString('utf8')) as unknown);
  if (manifest === undefined || report._tag === 'Err') throw new Error(`BLOCKED: feedback run manifest or metrics schema is invalid${report._tag === 'Err' ? `: ${report.error.message}` : ''}`);
  if (manifest.status === 'BLOCKED') throw new Error('BLOCKED: summaries cannot promote a blocked run');
  if (manifest.metricsSha256 !== sha256(metricsBytes) || manifest.taskManifestSha256 !== sha256(taskManifestBytes)) {
    throw new Error('BLOCKED: feedback run hash links do not match raw metrics/task manifest bytes');
  }
  const artifacts = validateFeedbackArtifactHashes(manifest.rawArtifactHashes, 'manifest.rawArtifactHashes');
  if (artifacts._tag === 'Err') throw new Error(`BLOCKED: ${artifacts.error.path}: ${artifacts.error.message}`);
  for (const artifact of artifacts.value) {
    const artifactPath = resolve(runDirectory, artifact.path);
    const containment = relative(runDirectory, artifactPath);
    if (isAbsolute(containment) || containment === '..' || containment.startsWith('../')) throw new Error(`BLOCKED: raw artifact path escapes run directory: ${artifact.path}`);
    let bytes: Buffer;
    try {
      bytes = await readFile(artifactPath);
    } catch {
      throw new Error(`BLOCKED: raw artifact is missing: ${artifact.path}`);
    }
    if (sha256(bytes) !== artifact.sha256) throw new Error(`BLOCKED: raw artifact digest mismatch: ${artifact.path}`);
  }
  const lines = [
    '# ACE real feedback summary',
    '',
    `- Run status: ${report.value.status}`,
    `- Raw manifest SHA-256: ${sha256(manifestBytes)}`,
    `- Metrics SHA-256: ${sha256(metricsBytes)}`,
    `- Task manifest SHA-256: ${sha256(taskManifestBytes)}`,
    `- Raw artifact count: ${artifacts.value.length}`,
    '',
    '| Task ID | Gold found@k | LSP proof | ACE called | Native tokens | ACE tokens | Quality Δ | Token ratio | Status |',
    '|---|---|---|---:|---:|---:|---|---:|---|',
    ...report.value.rows.map((row) => [
      row.taskId,
      'UNKNOWN',
      'UNKNOWN',
      row.aceCalled === null ? 'UNKNOWN' : row.aceCalled ? '1' : '0',
      row.nativeTotalTokens,
      row.aceTotalTokens,
      row.qualityDelta,
      row.tokenRatio,
      row.status,
    ].map(markdownCell).join(' | ')),
    '',
    'The retrieval columns remain UNKNOWN because this is an agent-level Harbor summary; RepoBench retrieval evidence is reported separately.',
  ];
  await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: outputPath, status: report.value.status, rawArtifacts: artifacts.value.length })}\n`);
};

await main();
