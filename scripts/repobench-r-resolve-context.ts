import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  repoBenchSourceManifestExclusions,
  repoBenchSourceManifestSha256,
  type RepoBenchManifest,
  type RepoBenchRecord,
} from '../src/domain/repobench-r.js';
import { retrievalSourceManifestExcludedPath } from '../src/domain/retrieval-source-manifest.js';

type JsonObject = Record<string, unknown>;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`BLOCKED: ${path} must be a non-empty string`);
  return value;
};
const objectAt = (value: unknown, path: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`BLOCKED: ${path} must be an object`);
  return value as JsonObject;
};

const usage = (): never => {
  throw new Error('Usage: tsx scripts/repobench-r-resolve-context.ts --records <records.jsonl> --manifest <raw-manifest.json> --output <directory> <repository-id>=<checkout-root> [...mappings]');
};

const parseArgs = (): { readonly recordsPath: string; readonly manifestPath: string; readonly outputDirectory: string; readonly mappings: readonly string[] } => {
  const args = process.argv.slice(2);
  let recordsPath: string | undefined;
  let manifestPath: string | undefined;
  let outputDirectory = process.env.REPOBENCH_OUTPUT?.trim() || 'artifacts/feedback/repobench-r';
  const mappings: string[] = [];
  while (args.length > 0) {
    const name = args.shift();
    if (name === '--records') recordsPath = args.shift();
    else if (name === '--manifest') manifestPath = args.shift();
    else if (name === '--output') outputDirectory = args.shift() ?? usage();
    else if (name !== undefined) mappings.push(name);
  }
  if (recordsPath === undefined || manifestPath === undefined || mappings.length === 0) return usage();
  return { recordsPath: resolve(recordsPath), manifestPath: resolve(manifestPath), outputDirectory: resolve(outputDirectory), mappings };
};

const gitBytes = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => gitBytes(root, args).toString('utf8').trim();
const gitRevision = (root: string): string => gitText(root, ['rev-parse', 'HEAD']);

const sourceEntries = (root: string, revision: string): readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string; readonly source: string }[] => {
  const paths = gitText(root, ['ls-tree', '-r', '-z', '--name-only', revision]).split('\0')
    .filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  const entries: Array<{ readonly path: string; readonly sizeBytes: number; readonly sha256: string; readonly source: string }> = [];
  for (const path of paths) {
    if (retrievalSourceManifestExcludedPath(path)) continue;
    const bytes = gitBytes(root, ['show', `${revision}:${path}`]);
    if (bytes.includes(0)) continue;
    try {
      entries.push({ path, sizeBytes: bytes.byteLength, sha256: sha256(bytes), source: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    } catch {
      // Non-UTF-8 source cannot be a TypeScript/Python/Java gold snippet.
    }
  }
  return entries;
};

const occurrenceCount = (source: string, snippet: string): number => {
  let count = 0;
  let offset = source.indexOf(snippet);
  while (offset >= 0) {
    count += 1;
    offset = source.indexOf(snippet, offset + Math.max(snippet.length, 1));
  }
  return count;
};

const parseRecord = (value: unknown, index: number): RepoBenchRecord => {
  const record = objectAt(value, `records[${index}]`);
  const context = Array.isArray(record.context) ? record.context.map((item, contextIndex) => {
    const snippet = objectAt(item, `records[${index}].context[${contextIndex}]`);
    if (typeof snippet.snippet !== 'string') throw new Error(`BLOCKED: records[${index}].context[${contextIndex}].snippet must be a string`);
    const text = snippet.snippet;
    return {
      ...(typeof snippet.path === 'string' && snippet.path.trim().length > 0 ? { path: snippet.path } : {}),
      snippet: text,
    };
  }) : [];
  const goldIndex = record.gold_snippet_index;
  if (!Number.isSafeInteger(goldIndex) || (goldIndex as number) < 0 || (goldIndex as number) >= context.length) {
    throw new Error(`BLOCKED: records[${index}] has an invalid gold_snippet_index`);
  }
  return {
    id: `${stringAt(record.repo_name, `records[${index}].repo_name`)}:${stringAt(record.file_path, `records[${index}].file_path`)}:${index}`,
    repoName: stringAt(record.repo_name, `records[${index}].repo_name`),
    filePath: stringAt(record.file_path, `records[${index}].file_path`),
    context,
    goldSnippetIndex: goldIndex as number,
    ...(typeof record.import_statement === 'string' ? { importStatement: record.import_statement } : {}),
    code: stringAt(record.code, `records[${index}].code`),
    ...(typeof record.next_line === 'string' ? { nextLine: record.next_line } : {}),
  };
};

const parseMapping = (value: string): { readonly id: string; readonly root: string } => {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) throw new Error(`BLOCKED: invalid repository mapping ${value}`);
  return { id: value.slice(0, separator), root: resolve(value.slice(separator + 1)) };
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  try {
    const recordsBytes = await readFile(args.recordsPath);
    const rawManifest = objectAt(JSON.parse(await readFile(args.manifestPath, 'utf8')) as unknown, 'manifest');
    const dataset = objectAt(rawManifest.dataset, 'manifest.dataset');
    const manifest = rawManifest as unknown as RepoBenchManifest;
    const records = recordsBytes.toString('utf8').split(/\r?\n/u).filter((line) => line.trim().length > 0)
      .map((line, index) => parseRecord(JSON.parse(line) as unknown, index));
    const mappings = args.mappings.map(parseMapping);
    const sourcesByRepository = new Map<string, readonly ReturnType<typeof sourceEntries>[number][]>();
    const sourceRoots: Record<string, string> = {};
    for (const mapping of mappings) {
      if (!existsSync(mapping.root)) throw new Error(`BLOCKED: missing source checkout ${mapping.root}`);
      const repository = manifest.repositories.find((item) => item.id === mapping.id);
      if (repository === undefined) throw new Error(`BLOCKED: source mapping ${mapping.id} is not in manifest`);
      const actualRevision = gitRevision(mapping.root);
      if (actualRevision !== repository.revision) throw new Error(`BLOCKED: ${mapping.id} revision mismatch`);
      const entries = sourceEntries(mapping.root, actualRevision);
      const actualManifest = repoBenchSourceManifestSha256(mapping.id, actualRevision, entries.map(({ path, sizeBytes, sha256: digest }) => ({ path, sizeBytes, sha256: digest })));
      if (actualManifest !== repository.sourceManifestSha256) throw new Error(`BLOCKED: ${mapping.id} source manifest mismatch`);
      sourcesByRepository.set(mapping.id, entries);
      sourceRoots[mapping.id] = mapping.root;
    }
    const missingSourceRepository = records.find((record) => !sourcesByRepository.has(record.repoName))?.repoName;
    if (missingSourceRepository !== undefined) {
      throw new Error(`BLOCKED: source snapshot mapping is missing for repository ${missingSourceRepository}`);
    }
    const resolvedRecords = records.map((record) => {
      const sources = sourcesByRepository.get(record.repoName);
      const gold = record.context[record.goldSnippetIndex];
      if (sources === undefined || gold === undefined || gold.path !== undefined) return record;
      const matches = sources.filter((entry) => occurrenceCount(entry.source, gold.snippet) > 0);
      const exact = matches.filter((entry) => occurrenceCount(entry.source, gold.snippet) === 1);
      const path = matches.length === 1 && exact.length === 1 ? matches[0]?.path : undefined;
      return path === undefined ? record : {
        ...record,
        context: record.context.map((snippet, index) => index === record.goldSnippetIndex ? { ...snippet, path } : snippet),
      };
    });
    const outputRecords = resolvedRecords.map((record) => JSON.stringify({
      repo_name: record.repoName,
      file_path: record.filePath,
      context: record.context,
      ...(record.importStatement === undefined ? {} : { import_statement: record.importStatement }),
      code: record.code,
      ...(record.nextLine === undefined ? {} : { next_line: record.nextLine }),
      gold_snippet_index: record.goldSnippetIndex,
    })).join('\n') + '\n';
    const finalManifest = {
      ...rawManifest,
      dataset: {
        ...dataset,
        recordsSha256: sha256(new TextEncoder().encode(outputRecords)),
        rawRecordsSha256: typeof dataset.rawRecordsSha256 === 'string' ? dataset.rawRecordsSha256 : undefined,
      },
      sourceRoots,
      sourceManifestExclusions: repoBenchSourceManifestExclusions,
    };
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'records.jsonl'), outputRecords, 'utf8');
    await writeFile(resolve(args.outputDirectory, 'manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
    const unresolved = resolvedRecords.filter((record) => record.context[record.goldSnippetIndex]?.path === undefined).length;
    await writeFile(resolve(args.outputDirectory, 'resolution-report.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: unresolved === 0 ? 'READY' : 'READY_WITH_INVALID_ROWS',
      records: records.length,
      resolvedGoldPaths: records.length - unresolved,
      unresolvedGoldPaths: unresolved,
      sourceRoots,
      rawRecordsSha256: typeof dataset.rawRecordsSha256 === 'string' ? dataset.rawRecordsSha256 : null,
    }, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: unresolved === 0 ? 'READY' : 'READY_WITH_INVALID_ROWS', records: records.length, unresolvedGoldPaths: unresolved, output: args.outputDirectory })}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'RepoBench context resolution failed';
    await mkdir(args.outputDirectory, { recursive: true });
    await writeFile(resolve(args.outputDirectory, 'resolution-report.json'), `${JSON.stringify({ schemaVersion: 1, status: 'BLOCKED', reason }, null, 2)}\n`, 'utf8');
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
};

await main();
