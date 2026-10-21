import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RetrievalHoldout, RetrievalHoldoutCase } from '../src/domain/retrieval-quality-evaluation.js';

const [holdoutArg, manifestDirectoryArg] = process.argv.slice(2);
if (holdoutArg === undefined || manifestDirectoryArg === undefined) {
  throw new Error('Usage: tsx scripts/validate-retrieval-holdout.ts <holdout.json> <manifest-dir>');
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const holdoutPath = resolve(holdoutArg);
const holdoutBytes = await readFile(holdoutPath);
const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
if (holdout.status !== 'frozen_multi_repository_holdout' || holdout.repositories === undefined) {
  throw new Error('holdout must be frozen_multi_repository_holdout with bound repositories');
}
if (holdout.repositories.length < 2 || holdout.cases.length < 24) {
  throw new Error('frozen retrieval holdout requires at least two repositories and 24 cases');
}
const kinds = new Set(holdout.cases.map((item) => item.kind));
const requiredKinds: readonly NonNullable<RetrievalHoldoutCase['kind']>[] = [
  'behavior_without_name',
  'exact_symbol_or_config',
  'rare_literal',
  'same_name_distractor',
  'multilingual',
  'working_context',
  'compactness',
  'partial_coverage',
];
for (const requiredKind of requiredKinds) {
  if (!kinds.has(requiredKind)) throw new Error(`holdout is missing required case kind ${requiredKind}`);
}
for (const repository of holdout.repositories) {
  const cases = holdout.cases.filter((item) => item.repositoryId === repository.id);
  if (cases.length < 12) throw new Error(`repository ${repository.id} has fewer than 12 cases`);
  if (cases.filter((item) => item.critical === true).length < 2) {
    throw new Error(`repository ${repository.id} has fewer than two critical cases`);
  }
  const manifestPath = resolve(manifestDirectoryArg, `manifest-${repository.id}.json`);
  const manifestBytes = await readFile(manifestPath);
  if (sha256(manifestBytes) !== repository.sourceManifestSha256) {
    throw new Error(`manifest digest mismatch for ${repository.id}`);
  }
}
const holdoutSha256 = sha256(holdoutBytes);
process.stdout.write(JSON.stringify({
  status: holdout.status,
  holdoutSha256,
  repositories: holdout.repositories.map((item) => item.id),
  cases: holdout.cases.length,
}) + '\n');
