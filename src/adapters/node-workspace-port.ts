import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { ingestRepoPath, makeContentDigest, type FileObservation, type RepoPath, type WorkspaceSnapshot } from '../domain/workspace.js';
import type { ExactRead, WorkspaceChangeBaseline, WorkspaceChangeObservation, WorkspaceFilePort } from '../application/ports.js';
import type { DomainError } from '../domain/errors.js';
import { recoverResult } from '../application/effect-result.js';

const execFileAsync = promisify(execFile);
const gitMetadataMaxBuffer = 64 * 1024 * 1024;

const isWithin = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
};

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  const code = cause.code;
  return typeof code === 'string' ? code : undefined;
};

const isNotGitRepository = (cause: unknown): boolean => {
  if (typeof cause !== 'object' || cause === null || !('stderr' in cause)) return false;
  return typeof cause.stderr === 'string' && /not a git repository/iu.test(cause.stderr);
};

const errorResult = <Value>(code: Parameters<typeof domainError>[0], path: string, message: string): Result<Value, ReturnType<typeof domainError>> =>
  err(domainError(code, path, message));

const makePortError = (code: Parameters<typeof domainError>[0], path: string, message: string) =>
  domainError(code, path, message);

export interface NodeWorkspacePortOptions {
  readonly allowedRoots: readonly string[];
  readonly excludedDirectories?: readonly string[];
}

const walkFiles = async (
  rootPath: string,
  currentPath: string,
  observedAtMs: number,
  excluded: ReadonlySet<string>,
  trackedPaths: ReadonlySet<string> | undefined,
): Promise<FileObservation[]> => {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: FileObservation[] = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const absolutePath = join(currentPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(rootPath, absolutePath, observedAtMs, excluded, trackedPaths)));
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(absolutePath);
    const bytes = new Uint8Array(await readFile(absolutePath));
    const digestValue = createHash('sha256').update(bytes).digest('hex');
    const digest = makeContentDigest(digestValue);
    if (digest._tag === 'Err') throw new Error(digest.error.message);
    const filePath = relative(rootPath, absolutePath).split(sep).join('/');
    const repoPath = ingestRepoPath(filePath);
    if (repoPath._tag === 'Err') throw new Error(repoPath.error.message);
    files.push({
      repoPath: repoPath.value,
      digest: digest.value,
      sizeBytes: bytes.byteLength,
      mtimeMs: metadata.mtimeMs,
      state: trackedPaths === undefined ? 'unknown' : trackedPaths.has(repoPath.value) ? 'tracked' : 'untracked',
      observedAtMs,
    });
  }
  return files.sort((left, right) => left.repoPath.localeCompare(right.repoPath));
};

const walkMetadata = async (
  rootPath: string,
  currentPath: string,
  excluded: ReadonlySet<string>,
): Promise<ReadonlyMap<RepoPath, { readonly sizeBytes: number; readonly mtimeMs: number }>> => {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = new Map<RepoPath, { readonly sizeBytes: number; readonly mtimeMs: number }>();
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const absolutePath = join(currentPath, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      for (const [repoPath, metadata] of await walkMetadata(rootPath, absolutePath, excluded)) files.set(repoPath, metadata);
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(absolutePath);
    const repoPath = ingestRepoPath(relative(rootPath, absolutePath).split(sep).join('/'));
    if (repoPath._tag === 'Err') throw new Error(repoPath.error.message);
    files.set(repoPath.value, { sizeBytes: metadata.size, mtimeMs: metadata.mtimeMs });
  }
  return files;
};

const gitList = async (rootPath: string, args: readonly string[]): Promise<Set<string>> => {
  // Git errors inside a repository are not equivalent to a non-Git directory.
  // Failing closed prevents corrupt/permission-denied metadata from masquerading
  // as an empty tracked/deleted set.
  const result = await execFileAsync('git', [...args], {
    cwd: rootPath,
    encoding: 'utf8',
    // Large real repositories can exceed Node's 1 MiB execFile default for
    // NUL-delimited path lists. Keep the bound finite, but large enough to
    // observe a pinned worktree without treating metadata truncation as empty.
    maxBuffer: gitMetadataMaxBuffer,
  });
  return new Set(result.stdout.split('\0').filter((value) => value.length > 0));
};

const gitPaths = (values: ReadonlySet<string> | undefined): Result<RepoPath[], ReturnType<typeof domainError>> => {
  if (values === undefined) return ok([]);
  const paths: RepoPath[] = [];
  for (const value of values) {
    const repoPath = ingestRepoPath(value);
    if (repoPath._tag === 'Err') return repoPath;
    paths.push(repoPath.value);
  }
  return ok(paths.sort((left, right) => left.localeCompare(right)));
};

interface GitNameStatus {
  readonly status: string;
  readonly path?: string;
  readonly from?: string;
  readonly to?: string;
}

const parseGitNameStatus = (raw: string): Result<readonly GitNameStatus[], ReturnType<typeof domainError>> => {
  const tokens = raw.split('\0').filter((value) => value.length > 0);
  const entries: GitNameStatus[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    if (status === undefined) return errorResult('SNAPSHOT_FAILED', 'git', 'Git name-status output is truncated');
    index += 1;
    if (status.startsWith('R')) {
      const from = tokens[index];
      const to = tokens[index + 1];
      if (from === undefined || to === undefined) return errorResult('SNAPSHOT_FAILED', 'git', 'Git rename output is truncated');
      entries.push({ status: 'R', from, to });
      index += 2;
    } else {
      const path = tokens[index];
      if (path === undefined) return errorResult('SNAPSHOT_FAILED', 'git', 'Git name-status path is missing');
      entries.push({ status: status.slice(0, 1), path });
      index += 1;
    }
  }
  return ok(entries);
};

const observeGitChanges = async (
  rootPath: string,
  previous: string | WorkspaceChangeBaseline | undefined,
  excluded: ReadonlySet<string>,
): Promise<Result<WorkspaceChangeObservation, ReturnType<typeof domainError>>> => {
  const previousHeadRevision = typeof previous === 'string' ? previous : previous?.headRevision;
  let headRevision: string;
  try {
    const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootPath, encoding: 'utf8' });
    headRevision = head.stdout.trim();
  } catch (cause) {
    if (!isNotGitRepository(cause)) return errorResult('SNAPSHOT_FAILED', 'git', 'Git HEAD could not be observed');
    try {
      const current = await walkMetadata(rootPath, rootPath, excluded);
      const prior = new Map((typeof previous === 'object' && previous !== null ? previous.files : []).map((file) => [file.repoPath, file] as const));
      const changed = new Set<RepoPath>();
      const added = new Set<RepoPath>();
      const deleted = new Set<RepoPath>();
      for (const [repoPath, metadata] of current) {
        const previousFile = prior.get(repoPath);
        if (previousFile === undefined) added.add(repoPath);
        else if (previousFile.sizeBytes !== metadata.sizeBytes || previousFile.mtimeMs !== metadata.mtimeMs) changed.add(repoPath);
      }
      for (const repoPath of prior.keys()) if (!current.has(repoPath)) deleted.add(repoPath);
      return ok({
        headRevision: 'unavailable',
        changedPaths: [...changed].sort(),
        addedPaths: [...added].sort(),
        deletedPaths: [...deleted].sort(),
        renamed: [],
        untrackedPaths: [...current.keys()].sort(),
      });
    } catch {
      return errorResult('SNAPSHOT_FAILED', 'workspace', 'non-Git metadata observation failed');
    }
  }
  if (!/^[a-f0-9]{40,64}$/iu.test(headRevision)) return errorResult('SNAPSHOT_FAILED', 'git', 'Git HEAD revision is invalid');
  try {
    // A workspace can be registered before Git exists and later become a clean
    // repository. There is no commit range from the synthetic "unavailable"
    // baseline to the first real HEAD, so reconcile every prior/current path
    // exactly once on that transition instead of silently accepting stale
    // pre-Git digests.
    const transitionedFromNonGit = typeof previous === 'object'
      && previous !== null
      && previous.headRevision === 'unavailable';
    const transitionMetadata = transitionedFromNonGit
      ? await walkMetadata(rootPath, rootPath, excluded)
      : undefined;
    const ranges = previousHeadRevision !== undefined
      && /^[a-f0-9]{40,64}$/iu.test(previousHeadRevision)
      && previousHeadRevision !== headRevision
      ? [
        ['diff', '--name-status', '-z', '-M', `${previousHeadRevision}..${headRevision}`],
        ['diff', '--name-status', '-z', '-M', 'HEAD'],
      ] as const
      : [['diff', '--name-status', '-z', '-M', 'HEAD']] as const;
    const outputs = await Promise.all(ranges.map((args) => execFileAsync('git', [...args], { cwd: rootPath, encoding: 'utf8' })));
    const [untracked, staged, unstaged, branchResult] = await Promise.all([
      gitList(rootPath, ['ls-files', '--others', '--exclude-standard', '-z']),
      gitList(rootPath, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']),
      gitList(rootPath, ['diff', '--name-only', '-z', '--diff-filter=ACMRT']),
      execFileAsync('git', ['branch', '--show-current'], { cwd: rootPath, encoding: 'utf8' }),
    ]);
    const parsed: GitNameStatus[] = [];
    for (const output of outputs) {
      const result = parseGitNameStatus(output.stdout);
      if (result._tag === 'Err') return result;
      parsed.push(...result.value);
    }
    const changed = new Set<RepoPath>();
    const added = new Set<RepoPath>();
    const deleted = new Set<RepoPath>();
    const renamed: { readonly from: RepoPath; readonly to: RepoPath }[] = [];
    if (transitionMetadata !== undefined && typeof previous === 'object' && previous !== null) {
      const priorPaths = new Set(previous.files.map((file) => file.repoPath));
      for (const repoPath of transitionMetadata.keys()) {
        if (priorPaths.has(repoPath)) changed.add(repoPath);
        else added.add(repoPath);
      }
      for (const repoPath of priorPaths) {
        if (!transitionMetadata.has(repoPath)) deleted.add(repoPath);
      }
    }
    for (const entry of parsed) {
      if (entry.status === 'R') {
        const from = ingestRepoPath(entry.from);
        const to = ingestRepoPath(entry.to);
        if (from._tag === 'Err') return from;
        if (to._tag === 'Err') return to;
        renamed.push({ from: from.value, to: to.value });
        continue;
      }
      const repoPath = ingestRepoPath(entry.path);
      if (repoPath._tag === 'Err') return repoPath;
      if (entry.status === 'D') deleted.add(repoPath.value);
      else if (entry.status === 'A') added.add(repoPath.value);
      else changed.add(repoPath.value);
    }
    for (const value of untracked) {
      const repoPath = ingestRepoPath(value);
      if (repoPath._tag === 'Err') return repoPath;
      added.add(repoPath.value);
    }
    const untrackedPaths = gitPaths(untracked);
    const stagedPaths = gitPaths(staged);
    const unstagedPaths = gitPaths(unstaged);
    if (untrackedPaths._tag === 'Err') return untrackedPaths;
    if (stagedPaths._tag === 'Err') return stagedPaths;
    if (unstagedPaths._tag === 'Err') return unstagedPaths;
    const branch = branchResult.stdout.trim();
    return ok({
      headRevision,
      changedPaths: [...changed].sort(),
      addedPaths: [...added].filter((path) => !changed.has(path)).sort(),
      deletedPaths: [...deleted].sort(),
      renamed: renamed.sort((left, right) => left.from.localeCompare(right.from)),
      untrackedPaths: untrackedPaths.value,
      stagedPaths: stagedPaths.value,
      unstagedPaths: unstagedPaths.value,
      ...(branch.length === 0 ? {} : { branch }),
    });
  } catch {
    return errorResult('SNAPSHOT_FAILED', 'git', 'Git change observation failed');
  }
};

const resolveSafePath = async (rootPath: string, repoPath: RepoPath): Promise<Result<string, ReturnType<typeof domainError>>> => {
  const candidate = resolve(rootPath, repoPath);
  if (!isWithin(rootPath, candidate)) return errorResult('PATH_ESCAPE', 'repo_path', 'path escapes workspace root');
  try {
    const resolved = await realpath(candidate);
    return isWithin(rootPath, resolved)
      ? ok(resolved)
      : errorResult('PATH_ESCAPE', 'repo_path', 'symlink resolves outside workspace root');
  } catch (cause) {
    return nodeErrorCode(cause) === 'ENOENT'
      ? errorResult('FILE_NOT_FOUND', 'repo_path', 'file does not exist')
      : errorResult('PATH_ESCAPE', 'repo_path', 'path could not be safely resolved');
  }
};

export const makeNodeWorkspacePort = (options: NodeWorkspacePortOptions): WorkspaceFilePort => {
  const excluded = new Set(options.excludedDirectories ?? [
    '.git',
    '.ace',
    '.venv',
    '.venv-system',
    'node_modules',
    'dist',
    'target',
    'coverage',
  ]);
  return {
    canonicalizeRoot: (candidate) =>
      recoverResult(Effect.tryPromise<Result<string, DomainError>, DomainError>({
        try: async () => {
          let canonical: string;
          try {
            canonical = await realpath(candidate);
            const rootStat = await stat(canonical);
            if (!rootStat.isDirectory()) return errorResult('WORKSPACE_ROOT_NOT_ALLOWED', 'root_path', 'workspace root is not a directory');
          } catch {
            return errorResult('WORKSPACE_ROOT_NOT_ALLOWED', 'root_path', 'workspace root is unavailable');
          }
          const allowed = await Promise.all(
            options.allowedRoots.map(async (root) => {
              try {
                return await realpath(root);
              } catch {
                return undefined;
              }
            }),
          );
          return allowed.some((root) => root !== undefined && isWithin(root, canonical))
            ? ok(canonical)
            : errorResult('WORKSPACE_ROOT_NOT_ALLOWED', 'root_path', 'workspace root is outside the allowlist');
        },
        catch: () => makePortError('WORKSPACE_ROOT_NOT_ALLOWED', 'root_path', 'workspace root check failed'),
      })),
    observeChanges: (rootPath, previousHeadRevision) =>
      recoverResult(Effect.tryPromise<Result<WorkspaceChangeObservation, DomainError>, DomainError>({
        try: () => observeGitChanges(rootPath, previousHeadRevision, excluded),
        catch: () => makePortError('SNAPSHOT_FAILED', 'git', 'Git change observation failed'),
      })),
    snapshot: (rootPath, observedAtMs) =>
      recoverResult(Effect.tryPromise<Result<WorkspaceSnapshot, DomainError>, DomainError>({
        try: async () => {
          let headRevision: string;
          try {
            const headResult = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootPath, encoding: 'utf8' });
            headRevision = headResult.stdout.trim();
            if (!/^[a-f0-9]{40,64}$/iu.test(headRevision)) {
              return errorResult('SNAPSHOT_FAILED', 'git', 'Git HEAD revision is invalid or unavailable');
            }
          } catch (cause) {
            if (!isNotGitRepository(cause)) {
              return errorResult('SNAPSHOT_FAILED', 'git', 'Git HEAD could not be observed (permission, executable or state failure)');
            }
            const files = await walkFiles(rootPath, rootPath, observedAtMs, excluded, undefined);
            return ok({ headRevision: 'unavailable', files, removedPaths: [], gitStatus: 'not_repository' });
          }
          try {
            const [
              trackedPaths,
              deletedWorktreePaths,
              deletedIndexPaths,
              stagedValues,
              unstagedValues,
              untrackedValues,
              branchResult,
            ] = await Promise.all([
              gitList(rootPath, ['ls-files', '-z']),
              gitList(rootPath, ['diff', '--name-only', '-z', '--diff-filter=D']),
              gitList(rootPath, ['diff', '--cached', '--name-only', '-z', '--diff-filter=D']),
              gitList(rootPath, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']),
              gitList(rootPath, ['diff', '--name-only', '-z', '--diff-filter=ACMRT']),
              gitList(rootPath, ['ls-files', '--others', '--exclude-standard', '-z']),
              execFileAsync('git', ['branch', '--show-current'], { cwd: rootPath, encoding: 'utf8' }),
            ]);
            const files = await walkFiles(rootPath, rootPath, observedAtMs, excluded, trackedPaths);
            const deletedValues = new Set([...deletedWorktreePaths, ...deletedIndexPaths]);
            const removedPaths = gitPaths(deletedValues);
            const stagedPaths = gitPaths(stagedValues);
            const unstagedPaths = gitPaths(unstagedValues);
            const untrackedPaths = gitPaths(untrackedValues);
            if (removedPaths._tag === 'Err') return removedPaths;
            if (stagedPaths._tag === 'Err') return stagedPaths;
            if (unstagedPaths._tag === 'Err') return unstagedPaths;
            if (untrackedPaths._tag === 'Err') return untrackedPaths;
            const branch = branchResult.stdout.trim();
            return ok({
              headRevision,
              files,
              removedPaths: removedPaths.value,
              gitStatus: 'available',
              ...(branch.length === 0 ? {} : { branch }),
              stagedPaths: stagedPaths.value,
              unstagedPaths: unstagedPaths.value,
              untrackedPaths: untrackedPaths.value,
              deletedPaths: removedPaths.value,
            });
          } catch {
            return errorResult('SNAPSHOT_FAILED', 'git', 'Git file state could not be observed completely');
          }
        },
        catch: () => makePortError('SNAPSHOT_FAILED', 'workspace', 'workspace snapshot failed'),
      })),
    readExact: (rootPath, repoPath) =>
      recoverResult(Effect.tryPromise<Result<ExactRead, DomainError>, DomainError>({
        try: async () => {
          const safePath = await resolveSafePath(rootPath, repoPath);
          if (safePath._tag === 'Err') return safePath;
          try {
            const before = await stat(safePath.value);
            const bytes = new Uint8Array(await readFile(safePath.value));
            const after = await stat(safePath.value);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
              return errorResult('WORKTREE_RACED', 'repo_path', 'file changed while it was being read');
            }
            const digestValue = createHash('sha256').update(bytes).digest('hex');
            const digest = makeContentDigest(digestValue);
            return digest._tag === 'Ok'
              ? ok<ExactRead>({
                bytes,
                digest: digest.value,
                sizeBytes: after.size,
                mtimeMs: after.mtimeMs,
              })
              : digest;
          } catch {
            return errorResult('FILE_NOT_FOUND', 'repo_path', 'file could not be read');
          }
        },
        catch: () => makePortError('FILE_NOT_FOUND', 'repo_path', 'file read failed'),
      })),
  };
};
