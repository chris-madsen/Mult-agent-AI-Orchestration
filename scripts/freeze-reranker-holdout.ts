import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalBenchmarkCandidateId, type BenchmarkCandidateRange } from '../src/domain/retrieval-benchmark.js';
import { exactUtf8SourceSpan } from '../src/domain/utf8-range.js';
import type { RetrievalHoldout } from '../src/domain/retrieval-quality-evaluation.js';
import {
  type RerankerFixture,
  type RerankerFixtureCase,
} from '../src/domain/reranker-evaluation.js';

interface RepositorySpec {
  readonly id: string;
  readonly revision: string;
}

interface SourceDocumentSpec extends BenchmarkCandidateRange {
  readonly repoPath: string;
}

interface SourceCaseSpec {
  readonly id: string;
  readonly repositoryId: string;
  readonly query: string;
  readonly documents: readonly SourceDocumentSpec[];
  readonly relevantDocumentIndexes: readonly number[];
  readonly critical?: boolean;
}

interface SourceSpec {
  readonly schemaVersion: 1;
  readonly status: 'frozen_reranker_holdout';
  readonly repositories: readonly RepositorySpec[];
  readonly cases: readonly SourceCaseSpec[];
}

interface ManifestEntry {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

const [sourceArg, holdoutArg, manifestDirectoryArg, primaryHoldoutArg, ...repositoryArgs] = process.argv.slice(2);
if ([sourceArg, holdoutArg, manifestDirectoryArg, primaryHoldoutArg].some((value) => value === undefined)
  || repositoryArgs.length === 0) {
  throw new Error('Usage: tsx scripts/freeze-reranker-holdout.ts <source-spec.json> <holdout.json> <manifest-dir> <retrieval-holdout.json> <repository-id>=<checkout-root> [...]');
}

const aceRepositoryRoot = resolve(process.cwd());
const isInsideAceRepository = (path: string): boolean => {
  const relativePath = relative(aceRepositoryRoot, resolve(path));
  return relativePath === '' || (!isAbsolute(relativePath) && !relativePath.startsWith(`..${sep}`) && relativePath !== '..');
};
if (isInsideAceRepository(holdoutArg as string) || isInsideAceRepository(manifestDirectoryArg as string)) {
  throw new Error('reranker holdout and manifests must be outside the ACE checkout');
}

const repositoryRoots = new Map<string, string>();
for (const argument of repositoryArgs) {
  const separator = argument.indexOf('=');
  if (separator < 1 || separator === argument.length - 1) throw new Error(`invalid repository mapping: ${argument}`);
  repositoryRoots.set(argument.slice(0, separator), resolve(argument.slice(separator + 1)));
}

const sourceSpec = JSON.parse(await readFile(resolve(sourceArg as string), 'utf8')) as SourceSpec;
if (sourceSpec.schemaVersion !== 1 || sourceSpec.status !== 'frozen_reranker_holdout') {
  throw new Error('source spec must declare frozen_reranker_holdout schema version 1');
}
if (sourceSpec.repositories.length < 2 || sourceSpec.cases.length < 2) {
  throw new Error('a frozen reranker holdout requires at least two repositories and cases');
}

const primaryHoldout = JSON.parse(await readFile(resolve(primaryHoldoutArg as string), 'utf8')) as RetrievalHoldout;
const excludedRetrievalCandidateIds = new Set(primaryHoldout.cases.flatMap((item) => item.relevantCandidateIds));

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const git = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);
const gitText = (root: string, args: readonly string[]): string => git(root, args).toString('utf8');
const sourceBytes = (root: string, revision: string, repoPath: string): Buffer => git(root, ['show', `${revision}:${repoPath}`]);
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
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    repositoryId: repository.id,
    revision: repository.revision,
    exclusions: ['.git', 'node_modules', 'dist', 'build', 'artifacts', '.cache', 'coverage', 'vendor', 'binary files'],
    entries,
  }, null, 2) + '\n', 'utf8');
  return { bytes, digest: sha256(bytes) };
};

const textForRange = (bytes: Buffer, range: BenchmarkCandidateRange): string => {
  const text = exactUtf8SourceSpan(bytes, range);
  if (text === undefined) {
    throw new Error('frozen reranker source range is invalid or splits a UTF-8 character');
  }
  return text;
};

const repositories: NonNullable<RerankerFixture['repositories']> = [];
const repositoryInfo = new Map<string, { readonly root: string; readonly revision: string; readonly manifestDigest: string }>();
for (const repository of sourceSpec.repositories) {
  const root = repositoryRoots.get(repository.id);
  if (root === undefined || !existsSync(root)) throw new Error(`missing checkout for repository ${repository.id}`);
  const actualRevision = gitText(root, ['rev-parse', repository.revision]).trim();
  if (actualRevision !== repository.revision) throw new Error(`repository ${repository.id} revision mismatch: expected ${repository.revision}, got ${actualRevision}`);
  const manifest = manifestFor(repository, root);
  await mkdir(resolve(manifestDirectoryArg as string), { recursive: true });
  const manifestPath = resolve(manifestDirectoryArg as string, `manifest-${repository.id}.json`);
  await writeFile(manifestPath, manifest.bytes);
  await writeFile(`${manifestPath}.sha256`, `${manifest.digest}  ${basename(manifestPath)}\n`);
  repositories.push({ id: repository.id, revision: repository.revision, sourceManifestSha256: manifest.digest });
  repositoryInfo.set(repository.id, { root, revision: repository.revision, manifestDigest: manifest.digest });
}

const seenCaseIds = new Set<string>();
const cases: RerankerFixtureCase[] = sourceSpec.cases.map((item) => {
  if (seenCaseIds.has(item.id)) throw new Error(`duplicate reranker case ${item.id}`);
  seenCaseIds.add(item.id);
  const repository = repositoryInfo.get(item.repositoryId);
  if (repository === undefined) throw new Error(`case ${item.id} references an unknown repository`);
  if (item.documents.length < 2 || item.relevantDocumentIndexes.length === 0
    || item.relevantDocumentIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= item.documents.length)) {
    throw new Error(`case ${item.id} has invalid document/relevance labels`);
  }
  const candidateIds: string[] = [];
  const refs: NonNullable<RerankerFixtureCase['documentRefs']> = [];
  const documents = item.documents.map((document) => {
    if (excluded(document.repoPath)) throw new Error(`case ${item.id} references an excluded path`);
    if (!Number.isSafeInteger(document.startLine) || !Number.isSafeInteger(document.endLine)
      || document.startLine < 1 || document.endLine < document.startLine
      || (document.startColumn !== undefined && (!Number.isSafeInteger(document.startColumn) || document.startColumn < 1))
      || (document.endColumn !== undefined && (!Number.isSafeInteger(document.endColumn) || document.endColumn < 1))) {
      throw new Error(`case ${item.id} has an invalid source range`);
    }
    const bytes = sourceBytes(repository.root, repository.revision, document.repoPath);
    const sourceDigest = sha256(bytes);
    const candidateId = canonicalBenchmarkCandidateId(item.repositoryId, document.repoPath, sourceDigest, document);
    if (excludedRetrievalCandidateIds.has(candidateId)) throw new Error(`case ${item.id} overlaps retrieval candidate ${candidateId}`);
    candidateIds.push(candidateId);
    refs.push({ candidateId, repoPath: document.repoPath, sourceDigest, startLine: document.startLine, endLine: document.endLine, ...(document.startColumn === undefined ? {} : { startColumn: document.startColumn }), ...(document.endColumn === undefined ? {} : { endColumn: document.endColumn }) });
    return textForRange(bytes, document);
  });
  return {
    id: item.id,
    repositoryId: item.repositoryId,
    query: item.query,
    documents,
    documentCandidateIds: candidateIds,
    documentRefs: refs,
    relevantDocumentIndexes: item.relevantDocumentIndexes,
    ...(item.critical === undefined ? {} : { critical: item.critical }),
  };
});

for (const repository of repositories) {
  if (!cases.some((item) => item.repositoryId === repository.id)) throw new Error(`repository ${repository.id} has no cases`);
}
if (!cases.some((item) => item.critical === true)) throw new Error('reranker holdout needs at least one critical case');

const holdout: RerankerFixture = {
  schemaVersion: 1,
  status: 'frozen_reranker_holdout',
  repositories,
  excludedRetrievalCandidateIds: [...excludedRetrievalCandidateIds].sort(),
  cases,
};
const holdoutPath = resolve(holdoutArg as string);
if (existsSync(holdoutPath)) throw new Error(`refusing to overwrite frozen holdout ${holdoutPath}`);
await mkdir(dirname(holdoutPath), { recursive: true });
const holdoutBytes = Buffer.from(JSON.stringify(holdout, null, 2) + '\n', 'utf8');
const holdoutDigest = sha256(holdoutBytes);
await writeFile(holdoutPath, holdoutBytes);
await writeFile(`${holdoutPath}.sha256`, `${holdoutDigest}  ${basename(holdoutPath)}\n`);
process.stdout.write(JSON.stringify({ holdout: holdoutPath, holdoutSha256: holdoutDigest, cases: cases.length, repositories: repositories.length }) + '\n');
