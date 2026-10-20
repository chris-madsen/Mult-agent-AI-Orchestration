import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { Effect } from 'effect';
import { makeTypeScriptLanguageServicePort } from '../src/adapters/typescript-language-service.js';
import {
  evaluateSemanticProviderOracle,
  type SemanticProviderOracle,
} from '../src/adapters/semantic-provider-evaluator.js';
import type { SemanticProviderReport } from '../src/domain/semantic-provider-selection.js';

const root = resolve(process.argv[2] ?? 'benchmarks/semantic/provider-comparison-v1');
const output = resolve(process.argv[3] ?? 'benchmarks/reports/typescript-ls-provider-comparison-v1.json');

const listFiles = async (directory: string): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result.sort();
};

const digestFiles = (files: Readonly<Record<string, string>>): string => {
  const digest = createHash('sha256');
  for (const [path, source] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const bytes = Buffer.from(source, 'utf8');
    digest.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return digest.digest('hex');
};

const p95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const sourceRoot = join(root, 'src');
const fixtureFiles: Record<string, string> = {};
for (const absolute of await listFiles(sourceRoot)) {
  const repoPath = relative(root, absolute).split('\\').join('/');
  fixtureFiles[repoPath] = await readFile(absolute, 'utf8');
}
if (Object.keys(fixtureFiles).length === 0) throw new Error('semantic fixture contains no source files');

const oracleBytes = await readFile(join(root, 'oracle.json'));
const oracle = JSON.parse(oracleBytes.toString('utf8')) as SemanticProviderOracle;
const fixtureSha256 = digestFiles(fixtureFiles);
const oracleSha256 = createHash('sha256').update(oracleBytes).digest('hex');

const coldStarted = performance.now();
const provider = makeTypeScriptLanguageServicePort({
  rootPath: root,
  files: fixtureFiles,
  providerVersion: `typescript/${ts.version}`,
});
const preflight = await Effect.runPromise(provider.diagnostics({ repoPath: 'src/repositories.ts' }));
if (preflight._tag === 'Err') throw new Error(`${preflight.error.code}: ${preflight.error.message}`);
const coldStartMs = Math.max(0, performance.now() - coldStarted);

const first = await evaluateSemanticProviderOracle(provider, fixtureFiles, oracle);
if (first._tag === 'Err') throw new Error(`${first.error.code}: ${first.error.message}`);
const warm = await evaluateSemanticProviderOracle(provider, fixtureFiles, oracle);
if (warm._tag === 'Err') throw new Error(`${warm.error.code}: ${warm.error.message}`);

const report: SemanticProviderReport = {
  provider: 'typescript-language-service',
  providerVersion: `typescript-language-server/6.0.2|typescript/${ts.version}`,
  fixtureSha256,
  oracleSha256,
  caseResults: warm.value.caseResults,
  coldStartMs,
  warmQueryP95Ms: p95(warm.value.queryDurationsMs),
  maxRssBytes: process.memoryUsage().rss,
  runtime: {
    node: process.version,
    typescript: ts.version,
    adapter: 'ace-generic-lsp-jsonrpc/v1',
  },
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  command: 'npm run compare:semantic-tsls',
};

await writeFile(output, JSON.stringify({
  schemaVersion: 1,
  fixture: relative(process.cwd(), root).split('\\').join('/'),
  firstPassQueryP95Ms: p95(first.value.queryDurationsMs),
  ...report,
}, null, 2) + '\n', 'utf8');

const failed = report.caseResults.filter((item) => item.status !== 'pass');
process.stdout.write(JSON.stringify({
  output: relative(process.cwd(), output).split('\\').join('/'),
  fixtureSha256,
  oracleSha256,
  cases: report.caseResults.length,
  failures: failed.map((item) => item.caseId),
  coldStartMs,
  warmQueryP95Ms: report.warmQueryP95Ms,
}) + '\n');
if (failed.length > 0) process.exitCode = 2;
