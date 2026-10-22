import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  mapRepoBenchRecords,
  repoBenchSourceKey,
  type RepoBenchManifest,
  type RepoBenchRecord,
  type RepoBenchSourceFile,
} from '../src/domain/repobench-r.js';

type JsonObject = Record<string, unknown>;

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/repobench-r-adapter.ts --records <records.json|records.jsonl> --manifest <manifest.json> --output <directory> <repository-id>=<checkout-root> [...mappings]',
  );
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const asObject = (value: unknown, path: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as JsonObject;
};
const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
};
const optionalStringAt = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
};
const arrayAt = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
};
const integerAt = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative integer`);
  return value as number;
};

const parseManifest = (value: unknown): RepoBenchManifest => {
  const root = asObject(value, 'manifest');
  const dataset = asObject(root.dataset, 'manifest.dataset');
  const repositories = arrayAt(root.repositories, 'manifest.repositories').map((item, index) => {
    const repository = asObject(item, `manifest.repositories[${index}]`);
    return {
      id: stringAt(repository.id, `manifest.repositories[${index}].id`),
      revision: stringAt(repository.revision, `manifest.repositories[${index}].revision`),
      sourceManifestSha256: stringAt(repository.sourceManifestSha256, `manifest.repositories[${index}].sourceManifestSha256`),
    };
  });
  return {
    schemaVersion: root.schemaVersion as 1,
    dataset: {
      datasetId: dataset.datasetId as 'tianyang/repobench-r',
      config: dataset.config as RepoBenchManifest['dataset']['config'],
      split: dataset.split as RepoBenchManifest['dataset']['split'],
      revision: stringAt(dataset.revision, 'manifest.dataset.revision'),
      recordsSha256: stringAt(dataset.recordsSha256, 'manifest.dataset.recordsSha256'),
    },
    repositories,
  };
};

const parseRecord = (value: unknown, index: number): RepoBenchRecord => {
  const record = asObject(value, `records[${index}]`);
  const context = arrayAt(record.context, `records[${index}].context`).map((item, contextIndex) =>
    stringAt(item, `records[${index}].context[${contextIndex}]`));
  const rawIndex = record.gold_snippet_index ?? record.gold_snippet_idex;
  const importStatement = optionalStringAt(record.import_statement, `records[${index}].import_statement`);
  const nextLine = optionalStringAt(record.next_line, `records[${index}].next_line`);
  return {
    id: `${stringAt(record.repo_name, `records[${index}].repo_name`)}:${stringAt(record.file_path, `records[${index}].file_path`)}:${index}`,
    repoName: stringAt(record.repo_name, `records[${index}].repo_name`),
    filePath: stringAt(record.file_path, `records[${index}].file_path`),
    context,
    goldSnippetIndex: integerAt(rawIndex, `records[${index}].gold_snippet_index`),
    ...(importStatement === undefined ? {} : { importStatement }),
    code: stringAt(record.code, `records[${index}].code`),
    ...(nextLine === undefined ? {} : { nextLine }),
  };
};

const parseRecords = (bytes: Uint8Array): readonly RepoBenchRecord[] => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    return arrayAt(JSON.parse(trimmed) as unknown, 'records').map(parseRecord);
  }
  return text.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseRecord(JSON.parse(line) as unknown, index));
};

const parseArguments = (): {
  readonly recordsPath: string;
  readonly manifestPath: string;
  readonly outputDirectory: string;
  readonly mappings: readonly string[];
} => {
  const args = process.argv.slice(2);
  let recordsPath: string | undefined;
  let manifestPath: string | undefined;
  let outputDirectory = process.env.REPOBENCH_OUTPUT?.trim() || 'artifacts/feedback/repobench-r';
  const mappings: string[] = [];
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--records') recordsPath = args.shift();
    else if (current === '--manifest') manifestPath = args.shift();
    else if (current === '--output') outputDirectory = args.shift() ?? usage();
    else if (current !== undefined) mappings.push(current);
  }
  if (recordsPath === undefined || manifestPath === undefined || mappings.length === 0) return usage();
  return {
    recordsPath: resolve(recordsPath),
    manifestPath: resolve(manifestPath),
    outputDirectory: resolve(outputDirectory),
    mappings,
  };
};

const parseMappings = (mappings: readonly string[]): ReadonlyMap<string, string> => {
  const result = new Map<string, string>();
  for (const mapping of mappings) {
    const separator = mapping.indexOf('=');
    if (separator < 1 || separator === mapping.length - 1) throw new Error(`invalid repository mapping: ${mapping}`);
    const repositoryId = mapping.slice(0, separator);
    const root = resolve(mapping.slice(separator + 1));
    if (!existsSync(root)) throw new Error(`repository checkout is missing: ${root}`);
    if (result.has(repositoryId)) throw new Error(`duplicate repository mapping: ${repositoryId}`);
    result.set(repositoryId, root);
  }
  return result;
};

const gitRevision = (root: string): string => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const readSource = async (root: string, repositoryId: string, repoPath: string): Promise<RepoBenchSourceFile> => {
  if (isAbsolute(repoPath) || relative(root, resolve(root, repoPath)).startsWith('..')) {
    throw new Error(`source path escapes checkout: ${repositoryId}/${repoPath}`);
  }
  const bytes = await readFile(resolve(root, repoPath));
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { repositoryId, repoPath, source, sourceDigest: sha256(bytes) };
};

const main = async (): Promise<void> => {
  const args = parseArguments();
  const recordsBytes = await readFile(args.recordsPath);
  const manifest = parseManifest(JSON.parse(await readFile(args.manifestPath, 'utf8')) as unknown);
  const recordsDigest = sha256(recordsBytes);
  await mkdir(args.outputDirectory, { recursive: true });
  const records = parseRecords(recordsBytes);
  if (manifest.dataset.recordsSha256 !== recordsDigest) {
    const report = {
      schemaVersion: 1,
      status: 'BLOCKED',
      reason: 'records_sha256_mismatch',
      expected: manifest.dataset.recordsSha256,
      actual: recordsDigest,
      recordsPath: args.recordsPath,
    };
    await writeFile(`${args.outputDirectory}/mapping-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.exitCode = 2;
    return;
  }
  const mappings = parseMappings(args.mappings);
  for (const repository of manifest.repositories) {
    const root = mappings.get(repository.id);
    if (root === undefined) throw new Error(`missing checkout mapping for ${repository.id}`);
    const actualRevision = gitRevision(root);
    if (actualRevision !== repository.revision) {
      throw new Error(`BLOCKED: ${repository.id} revision mismatch; expected ${repository.revision}, got ${actualRevision}`);
    }
  }
  const sourceFiles = new Map<string, RepoBenchSourceFile>();
  for (const record of records) {
    const root = mappings.get(record.repoName);
    if (root === undefined) continue;
    const key = repoBenchSourceKey(record.repoName, record.filePath);
    if (sourceFiles.has(key)) continue;
    sourceFiles.set(key, await readSource(root, record.repoName, record.filePath));
  }
  const mapped = mapRepoBenchRecords(manifest, records, sourceFiles);
  if (mapped._tag === 'Err') {
    const report = {
      schemaVersion: 1,
      status: 'BLOCKED',
      reason: mapped.error.code,
      message: mapped.error.message,
      dataset: manifest.dataset,
      recordsSha256: recordsDigest,
    };
    await writeFile(`${args.outputDirectory}/mapping-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.exitCode = 2;
    return;
  }
  await Promise.all([
    writeFile(`${args.outputDirectory}/holdout.json`, `${JSON.stringify(mapped.value.holdout, null, 2)}\n`, 'utf8'),
    writeFile(`${args.outputDirectory}/mapping-report.json`, `${JSON.stringify({
      schemaVersion: 1,
      status: mapped.value.invalidRows.length === 0 ? 'READY' : 'READY_WITH_INVALID_ROWS',
      dataset: manifest.dataset,
      recordsSha256: recordsDigest,
      mappedRows: mapped.value.mappedRows,
      invalidRows: mapped.value.invalidRows,
    }, null, 2)}\n`, 'utf8'),
    writeFile(`${args.outputDirectory}/adapter-manifest.json`, `${JSON.stringify({
      schemaVersion: 1,
      command: process.argv.join(' '),
      dataset: manifest.dataset,
      repositories: manifest.repositories,
      recordsSha256: recordsDigest,
      holdoutSha256: sha256(new TextEncoder().encode(`${JSON.stringify(mapped.value.holdout, null, 2)}\n`)),
    }, null, 2)}\n`, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify({
    status: mapped.value.invalidRows.length === 0 ? 'READY' : 'READY_WITH_INVALID_ROWS',
    mappedRows: mapped.value.mappedRows.length,
    invalidRows: mapped.value.invalidRows.length,
    outputDirectory: args.outputDirectory,
  })}\n`);
};

await main();
