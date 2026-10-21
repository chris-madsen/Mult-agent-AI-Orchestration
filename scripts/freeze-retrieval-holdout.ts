import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalBenchmarkCandidateId, type BenchmarkCandidateRange } from '../src/domain/retrieval-benchmark.js';
import type {
  RetrievalHoldout,
  RetrievalHoldoutCase,
  RetrievalHoldoutRepository,
} from '../src/domain/retrieval-quality-evaluation.js';

interface RepositorySpec {
  readonly id: string;
  readonly revision: string;
}

interface SpanSpec extends BenchmarkCandidateRange {
  readonly repoPath: string;
}

interface CaseSpec {
  readonly id: string;
  readonly repositoryId: string;
  readonly query: string;
  readonly relevantSpans: readonly SpanSpec[];
  readonly critical?: boolean;
  readonly kind?: RetrievalHoldoutCase['kind'];
  readonly focusedPath?: string;
}

interface SourceSpec {
  readonly schemaVersion: 1;
  readonly status: 'frozen_multi_repository_holdout';
  readonly repositories: readonly RepositorySpec[];
  readonly cases: readonly CaseSpec[];
}

interface ManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

const [sourceArg, holdoutArg, manifestDirectoryArg, ...repositoryArgs] = process.argv.slice(2);
if (sourceArg === undefined || holdoutArg === undefined || manifestDirectoryArg === undefined || repositoryArgs.length === 0) {
  throw new Error('Usage: tsx scripts/freeze-retrieval-holdout.ts <source-spec.json> <holdout.json> <manifest-dir> <repository-id>=<checkout-root> [...]');
}

const repositoryRoots = new Map<string, string>();
for (const argument of repositoryArgs) {
  const separator = argument.indexOf('=');
  if (separator < 1 || separator === argument.length - 1) throw new Error(`invalid repository mapping: ${argument}`);
  repositoryRoots.set(argument.slice(0, separator), resolve(argument.slice(separator + 1)));
}

const sourceSpec = JSON.parse(await readFile(resolve(sourceArg), 'utf8')) as SourceSpec;
if (sourceSpec.schemaVersion !== 1 || sourceSpec.status !== 'frozen_multi_repository_holdout') {
  throw new Error('source spec must declare frozen_multi_repository_holdout schema version 1');
}
if (sourceSpec.repositories.length < 2) throw new Error('a frozen holdout requires at least two repositories');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const git = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => git(root, args).toString('utf8');
const sourceBytes = (root: string, revision: string, repoPath: string): Buffer =>
  git(root, ['show', `${revision}:${repoPath}`]);

const excluded = (repoPath: string): boolean => {
  const lower = repoPath.toLocaleLowerCase();
  return repoPath.split('/').some((part) => ['node_modules', 'dist', 'build', 'artifacts', '.cache', 'coverage', 'vendor'].includes(part))
    || ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip', '.tar', '.gz', '.exe', '.dll'].some((suffix) => lower.endsWith(suffix));
};

const manifestFor = (repository: RepositorySpec, root: string): { readonly bytes: Buffer; readonly digest: string } => {
  const paths = gitText(root, ['ls-tree', '-r', '-z', '--name-only', repository.revision])
    .split('\0')
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
  const entries: ManifestEntry[] = [];
  for (const repoPath of paths) {
    if (excluded(repoPath)) continue;
    const bytes = sourceBytes(root, repository.revision, repoPath);
    if (bytes.includes(0)) continue;
    entries.push({ path: repoPath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const value = {
    schemaVersion: 1,
    repositoryId: repository.id,
    revision: repository.revision,
    exclusions: ['.git', 'node_modules', 'dist', 'build', 'artifacts', '.cache', 'coverage', 'vendor', 'binary files'],
    entries,
  };
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  return { bytes, digest: sha256(bytes) };
};

const repositories: RetrievalHoldoutRepository[] = [];
const manifestByRepository = new Map<string, { readonly digest: string; readonly root: string; readonly revision: string }>();
for (const repository of sourceSpec.repositories) {
  const root = repositoryRoots.get(repository.id);
  if (root === undefined || !existsSync(root)) throw new Error(`missing checkout for repository ${repository.id}`);
  const actualRevision = gitText(root, ['rev-parse', repository.revision]).trim();
  if (actualRevision !== repository.revision) {
    throw new Error(`repository ${repository.id} revision mismatch: expected ${repository.revision}, got ${actualRevision}`);
  }
  const manifest = manifestFor(repository, root);
  await mkdir(resolve(manifestDirectoryArg), { recursive: true });
  const manifestPath = resolve(manifestDirectoryArg, `manifest-${repository.id}.json`);
  await writeFile(manifestPath, manifest.bytes);
  await writeFile(`${manifestPath}.sha256`, `${manifest.digest}  ${manifestPath.split('/').pop()}\n`);
  repositories.push({ id: repository.id, revision: repository.revision, sourceManifestSha256: manifest.digest });
  manifestByRepository.set(repository.id, { digest: manifest.digest, root, revision: repository.revision });
}

const seenCaseIds = new Set<string>();
const cases: RetrievalHoldoutCase[] = sourceSpec.cases.map((item) => {
  if (seenCaseIds.has(item.id)) throw new Error(`duplicate holdout case ${item.id}`);
  seenCaseIds.add(item.id);
  const repository = manifestByRepository.get(item.repositoryId);
  if (repository === undefined) throw new Error(`case ${item.id} references an unknown repository`);
  if (item.relevantSpans.length === 0) throw new Error(`case ${item.id} requires at least one relevant span`);
  const relevantCandidateIds = item.relevantSpans.map((span) => {
    if (excluded(span.repoPath)
      || !Number.isSafeInteger(span.startLine)
      || !Number.isSafeInteger(span.endLine)
      || span.startLine < 1
      || span.endLine < span.startLine
      || (span.startColumn !== undefined && (!Number.isSafeInteger(span.startColumn) || span.startColumn < 1))
      || (span.endColumn !== undefined && (!Number.isSafeInteger(span.endColumn) || span.endColumn < 1))) {
      throw new Error(`case ${item.id} has an invalid or excluded range in ${span.repoPath}`);
    }
    const bytes = sourceBytes(repository.root, repository.revision, span.repoPath);
    const lineCount = bytes.toString('utf8').split('\n').length;
    if (span.endLine > lineCount) {
      throw new Error(`case ${item.id} has an invalid range in ${span.repoPath}`);
    }
    const digest = sha256(bytes);
    return canonicalBenchmarkCandidateId(item.repositoryId, span.repoPath, digest, span);
  });
  return {
    id: item.id,
    repositoryId: item.repositoryId,
    query: item.query,
    relevantCandidateIds,
    ...(item.critical === undefined ? {} : { critical: item.critical }),
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    ...(item.focusedPath === undefined ? {} : { focusedPath: item.focusedPath }),
  };
});

for (const item of cases) {
  if (new Set(item.relevantCandidateIds).size !== item.relevantCandidateIds.length) {
    throw new Error(`case ${item.id} contains duplicate canonical candidate labels`);
  }
}

if (!cases.some((item) => item.critical === true)) throw new Error('holdout needs at least one critical case');
for (const repository of repositories) {
  if (!cases.some((item) => item.repositoryId === repository.id)) throw new Error(`repository ${repository.id} has no cases`);
}

const holdout: RetrievalHoldout = {
  schemaVersion: 1,
  status: 'frozen_multi_repository_holdout',
  repositories,
  cases,
};
const holdoutPath = resolve(holdoutArg);
if (existsSync(holdoutPath)) throw new Error(`refusing to overwrite frozen holdout ${holdoutPath}`);
await mkdir(dirname(holdoutPath), { recursive: true });
const holdoutBytes = Buffer.from(JSON.stringify(holdout, null, 2) + '\n', 'utf8');
await writeFile(holdoutPath, holdoutBytes);
await writeFile(`${holdoutPath}.sha256`, `${sha256(holdoutBytes)}  ${holdoutPath.split('/').pop()}\n`);
process.stdout.write(JSON.stringify({ holdout: holdoutPath, holdoutSha256: sha256(holdoutBytes), cases: cases.length, repositories: repositories.length }) + '\n');
