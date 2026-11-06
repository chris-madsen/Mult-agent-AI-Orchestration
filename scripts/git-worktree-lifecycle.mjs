#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_BASE = 'origin/main';
const STATE_DIRECTORY = 'ace-worktree-state';
const OPERATION_HEADS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD'];
class LifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    this.details = details;
  }
}

const commandResult = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error && !options.allowFailure) throw new LifecycleError('COMMAND_FAILED', `${command} could not start: ${result.error.message}`, { command, args });
  if (result.status !== 0 && !options.allowFailure) {
    throw new LifecycleError('COMMAND_FAILED', `${command} ${args.join(' ')} failed: ${(result.stderr ?? '').trim() || `exit ${result.status}`}`, {
      command,
      args,
      exitCode: result.status,
    });
  }
  return result;
};

const git = (args, cwd, options = {}) => commandResult('git', args, { ...options, cwd });

const requireGit = (args, cwd) => git(args, cwd).stdout.trim();

const canonicalPath = (value) => {
  const absolute = isAbsolute(value) ? value : resolve(value);
  try {
    return execFileSync('realpath', ['-m', absolute], { encoding: 'utf8' }).trim();
  } catch {
    return absolute;
  }
};

const now = () => new Date().toISOString();

const taskIdentity = (taskId) => {
  const canonical = taskId.trim().toLowerCase();
  const normalized = canonical
    .replace(/[^a-z0-9._/-]+/gu, '-')
    .replace(/\/+/gu, '/')
    .replace(/(^[./-]+|[./-]+$)/gu, '');
  if (!normalized) throw new LifecycleError('INVALID_TASK_ID', 'taskId must contain at least one alphanumeric character');
  if (normalized.includes('..')) throw new LifecycleError('INVALID_TASK_ID', 'taskId must not contain parent traversal');
  return { canonical, normalized };
};

const taskSlug = (taskId) => {
  const { canonical, normalized } = taskIdentity(taskId);
  const readable = normalized.replaceAll('/', '-');
  if (canonical === readable) return readable;
  const suffix = createHash('sha256').update(canonical).digest('hex').slice(0, 10);
  return `${readable}-${suffix}`;
};

const branchForTask = (taskId) => `codex/${taskSlug(taskId)}`;

const parseArgs = (argv) => {
  if (argv[0] === '--help' || argv[0] === '-h') return { command: 'audit', json: false, taskId: null, path: null, owner: null, sessionId: null, base: DEFAULT_BASE, help: true };
  const [command = 'audit', ...rest] = argv;
  if (!['audit', 'preflight', 'start', 'status', 'cleanup'].includes(command)) {
    throw new LifecycleError('INVALID_COMMAND', `unsupported command: ${command}`);
  }
  const options = { command, json: false, taskId: null, path: null, owner: null, sessionId: null, base: DEFAULT_BASE };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--task-id') options.taskId = rest[++index] ?? null;
    else if (arg.startsWith('--task-id=')) options.taskId = arg.slice('--task-id='.length);
    else if (arg === '--path') options.path = rest[++index] ?? null;
    else if (arg.startsWith('--path=')) options.path = arg.slice('--path='.length);
    else if (arg === '--owner') options.owner = rest[++index] ?? null;
    else if (arg.startsWith('--owner=')) options.owner = arg.slice('--owner='.length);
    else if (arg === '--session-id') options.sessionId = rest[++index] ?? null;
    else if (arg.startsWith('--session-id=')) options.sessionId = arg.slice('--session-id='.length);
    else if (arg === '--base') options.base = rest[++index] ?? DEFAULT_BASE;
    else if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new LifecycleError('INVALID_ARGUMENT', `unsupported argument: ${arg}`);
  }
  return options;
};

const help = () => `Usage:
  node scripts/git-worktree-lifecycle.mjs audit [--json]
  node scripts/git-worktree-lifecycle.mjs preflight --task-id <id> [--base origin/main] [--json]
  node scripts/git-worktree-lifecycle.mjs start --task-id <id> --path <directory> [--owner <name>] [--json]
  node scripts/git-worktree-lifecycle.mjs status --task-id <id> [--owner <name>] [--json]
  node scripts/git-worktree-lifecycle.mjs cleanup --task-id <id> [--json]

The lifecycle state is stored under the repository's common Git directory at
${STATE_DIRECTORY}/. Pull-request data comes from gh or ACE_WORKTREE_LIFECYCLE_PR_JSON.
`;

const repositoryContext = (cwd = process.cwd()) => {
  const root = canonicalPath(requireGit(['rev-parse', '--show-toplevel'], cwd));
  const commonGitDirectoryRaw = requireGit(['rev-parse', '--git-common-dir'], cwd);
  const commonGitDirectory = canonicalPath(isAbsolute(commonGitDirectoryRaw) ? commonGitDirectoryRaw : resolve(root, commonGitDirectoryRaw));
  return {
    cwd: canonicalPath(cwd),
    root,
    commonGitDirectory,
    stateDirectory: join(commonGitDirectory, STATE_DIRECTORY),
  };
};

const operationHeads = (worktreePath) => Object.fromEntries(OPERATION_HEADS.map((name) => {
  const path = requireGit(['rev-parse', '--git-path', name], worktreePath);
  const resolved = canonicalPath(isAbsolute(path) ? path : resolve(worktreePath, path));
  return [name, existsSync(resolved)];
}));

const parsePorcelainBranch = (lines) => {
  const branchLine = lines.find((line) => line.startsWith('# branch.head '));
  const oidLine = lines.find((line) => line.startsWith('# branch.oid '));
  const branch = branchLine?.slice('# branch.head '.length).trim() ?? null;
  return {
    branch: branch === '(detached)' ? null : branch,
    headSha: oidLine?.slice('# branch.oid '.length).trim() ?? null,
    dirty: lines.some((line) => line.length > 0 && !line.startsWith('#')),
    conflict: lines.some((line) => line.startsWith('u ')),
  };
};

const inspectWorktree = (worktree) => {
  const path = canonicalPath(worktree.path);
  if (!existsSync(path)) return { path, missing: true, branch: worktree.branch ?? null, headSha: worktree.headSha ?? null };
  const status = git(['status', '--porcelain=v2', '--branch'], path).stdout.trim().split(/\r?\n/u).filter(Boolean);
  const porcelain = parsePorcelainBranch(status);
  const heads = operationHeads(path);
  const conflict = porcelain.conflict;
  const dirty = porcelain.dirty;
  const activeOperation = Object.values(heads).some(Boolean);
  return {
    path,
    missing: false,
    branch: porcelain.branch ?? worktree.branch ?? null,
    headSha: porcelain.headSha ?? worktree.headSha ?? null,
    dirty,
    conflict,
    operationHeads: heads,
    activeOperation,
    clean: !dirty && !conflict && !activeOperation,
  };
};

const listWorktrees = (context) => {
  const output = requireGit(['worktree', 'list', '--porcelain'], context.root);
  const entries = [];
  let current = null;
  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    if (key === 'worktree') {
      flush();
      current = { path: value };
    } else if (current) {
      if (key === 'HEAD') current.headSha = value;
      else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//u, '');
      else if (key === 'detached') current.detached = true;
      else if (key === 'locked') current.locked = value || true;
      else if (key === 'prunable') current.prunable = value || true;
    }
  }
  flush();
  return entries.map((entry) => ({ ...entry, ...inspectWorktree(entry) }));
};

const readRecords = async (context) => {
  if (!existsSync(context.stateDirectory)) return { records: [], issues: [] };
  const names = (await readdir(context.stateDirectory)).filter((name) => name.endsWith('.json')).sort();
  const records = [];
  const issues = [];
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(join(context.stateDirectory, name), 'utf8'));
      let validTaskId = false;
      if (typeof record?.taskId === 'string') {
        try {
          taskSlug(record.taskId);
          validTaskId = true;
        } catch {
          validTaskId = false;
        }
      }
      if (record?.schemaVersion !== SCHEMA_VERSION
        || !validTaskId
        || typeof record.branch !== 'string'
        || record.branch.trim().length === 0
        || typeof record.worktreePath !== 'string'
        || record.worktreePath.trim().length === 0) {
        issues.push({ file: name, code: 'INVALID_RECORD', message: 'record schema or required fields are invalid' });
      } else records.push(record);
    } catch (error) {
      issues.push({ file: name, code: 'INVALID_RECORD', message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { records, issues };
};

const writeRecord = async (context, record) => {
  await mkdir(context.stateDirectory, { recursive: true });
  const name = `${taskSlug(record.taskId)}.json`;
  const target = join(context.stateDirectory, name);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
};

const normalizedPullRequest = (value) => ({
  number: Number(value.number),
  title: typeof value.title === 'string' ? value.title : '',
  headRefName: typeof value.headRefName === 'string' ? value.headRefName : '',
  baseRefName: typeof value.baseRefName === 'string' ? value.baseRefName : '',
  state: typeof value.state === 'string' ? value.state.toUpperCase() : 'UNKNOWN',
  mergedAt: value.mergedAt ?? null,
  headRefOid: value.headRefOid ?? null,
});

const pullRequests = () => {
  const fixture = process.env.ACE_WORKTREE_LIFECYCLE_PR_JSON;
  if (fixture) {
    try {
      const parsed = JSON.parse(fixture);
      const values = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(values)) throw new Error('expected an array or {items: []}');
      return { available: true, source: 'fixture', items: values.map(normalizedPullRequest) };
    } catch (error) {
      throw new LifecycleError('PR_LOOKUP_INVALID', `ACE_WORKTREE_LIFECYCLE_PR_JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const result = commandResult('gh', [
    'pr', 'list', '--state', 'all', '--limit', '1000',
    '--json', 'number,title,headRefName,baseRefName,state,mergedAt,headRefOid',
  ], { allowFailure: true });
  if (result.status !== 0) {
    return { available: false, source: 'gh', error: (result.stderr ?? '').trim() || `exit ${result.status}`, items: [] };
  }
  try {
    const values = JSON.parse(result.stdout);
    if (!Array.isArray(values)) throw new Error('gh returned a non-array response');
    return { available: true, source: 'gh', items: values.map(normalizedPullRequest) };
  } catch (error) {
    return { available: false, source: 'gh', error: error instanceof Error ? error.message : String(error), items: [] };
  }
};

const pullRequestsForBranch = (prs, branch) => prs.items.filter((item) => item.headRefName === branch);

const pullRequestForBranch = (prs, branch) => {
  const matches = pullRequestsForBranch(prs, branch);
  return matches.find((item) => item.state === 'OPEN')
    ?? matches.find((item) => item.state === 'MERGED' || item.mergedAt)
    ?? matches[0]
    ?? null;
};

const recordForWorktree = (records, worktree) => records.find((record) => canonicalPath(record.worktreePath) === canonicalPath(worktree.path))
  ?? records.find((record) => record.branch === worktree.branch)
  ?? null;

const observedStatus = ({ worktree, record, pr }) => {
  if (worktree.missing) return 'orphaned';
  if (worktree.conflict || worktree.activeOperation) return 'conflict';
  if (pr?.state === 'MERGED' || pr?.mergedAt) return worktree.clean ? 'merged-clean' : 'merged-dirty';
  if (pr?.state === 'OPEN') return 'pr-open';
  if (worktree.dirty) return 'active';
  if (!pr && record?.status === 'pr-open') return 'pr-open';
  return record?.status === 'pr-open' ? 'active' : 'active';
};

const recommendationFor = ({ status, registered, pr }) => {
  if (!registered) return 'owner-review; do-not-delete legacy worktree';
  if (status === 'merged-clean') return 'cleanup candidate';
  if (status === 'merged-dirty') return 'preserve dirty worktree and review local changes';
  if (status === 'conflict') return 'preserve conflict state; perform file-level recovery';
  if (status === 'pr-open' || pr?.state === 'OPEN') return 'retain for PR iteration';
  if (status === 'orphaned') return 'repair registry/path before any cleanup';
  return 'continue task or open focused PR';
};

const audit = async (context) => {
  const [{ records, issues }, worktrees, prs] = await Promise.all([
    readRecords(context),
    Promise.resolve(listWorktrees(context)),
    Promise.resolve(pullRequests()),
  ]);
  const items = worktrees.map((worktree) => {
    const record = recordForWorktree(records, worktree);
    const pr = pullRequestForBranch(prs, worktree.branch);
    const registered = record !== null;
    const observed = observedStatus({ worktree, record, pr });
    const status = registered ? observed : 'legacy-unclassified';
    return {
      path: worktree.path,
      branch: worktree.branch,
      headSha: worktree.headSha,
      dirty: worktree.dirty ?? false,
      conflict: worktree.conflict ?? false,
      activeOperation: worktree.activeOperation ?? false,
      missing: worktree.missing ?? false,
      status,
      observedStatus: observed,
      taskId: record?.taskId ?? null,
      owner: record?.owner ?? null,
      sessionId: record?.sessionId ?? null,
      lastSeenAt: record?.lastSeenAt ?? null,
      pr: pr ? {
        number: pr.number,
        state: pr.state,
        title: pr.title,
        baseRefName: pr.baseRefName,
        mergedAt: pr.mergedAt,
        headRefOid: pr.headRefOid,
      } : null,
      prLookup: prs.available ? 'available' : `unavailable: ${prs.error}`,
      recommendation: recommendationFor({ status, registered, pr }),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    repositoryRoot: context.root,
    generatedAt: now(),
    prLookup: { available: prs.available, source: prs.source, error: prs.error ?? null },
    registryIssues: issues,
    worktrees: items,
  };
};

const requireTaskId = (options) => {
  if (!options.taskId?.trim()) throw new LifecycleError('TASK_ID_REQUIRED', '--task-id is required for this command');
  return options.taskId.trim();
};

const currentWorktreeFor = (worktrees, context) => worktrees.find((worktree) => canonicalPath(worktree.path) === context.root) ?? null;

const preflight = async (context, options) => {
  const taskId = requireTaskId(options);
  const branch = branchForTask(taskId);
  const worktrees = listWorktrees(context);
  const current = currentWorktreeFor(worktrees, context);
  const { records } = await readRecords(context);
  const prs = pullRequests();
  const existing = worktrees.find((item) => item.branch === branch) ?? null;
  const record = records.find((item) => item.taskId === taskId || item.branch === branch) ?? null;
  const pr = pullRequestForBranch(prs, branch);

  if (existing) {
    if (record !== null && taskSlug(record.taskId) !== taskSlug(taskId)) {
      throw new LifecycleError(
        'TASK_ID_COLLISION',
        `branch ${branch} is registered to a different task; refusing cross-task worktree reuse`,
        { requestedTaskId: taskId, registeredTaskId: record.taskId, branch },
      );
    }
    return {
      ok: true,
      action: 'reuse',
      taskId,
      branch,
      worktreePath: existing.path,
      record,
      worktree: existing,
      pr,
      warnings: existing.clean ? [] : ['existing worktree is not clean; continue there instead of creating another'],
    };
  }
  if (record && !existing) {
    throw new LifecycleError('REGISTRY_ORPHAN', `task ${taskId} has a registry record but no matching worktree`, { record });
  }
  if (pr && pr.state === 'OPEN') {
    throw new LifecycleError('OPEN_PR_EXISTS', `branch ${branch} already has open PR #${pr.number}; reuse its worktree`, { pr });
  }
  const branchExists = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], context.root, { allowFailure: true }).status === 0;
  if (branchExists) throw new LifecycleError('BRANCH_EXISTS', `branch ${branch} already exists without a registered worktree`, { branch });
  if (!prs.available) throw new LifecycleError('PR_LOOKUP_UNAVAILABLE', `cannot create a new worktree until PR lookup succeeds: ${prs.error}`, { source: prs.source });
  if (options.base !== DEFAULT_BASE) throw new LifecycleError('INVALID_BASE', `new worktrees must be based on ${DEFAULT_BASE}`);
  if (!current) throw new LifecycleError('CURRENT_WORKTREE_UNAVAILABLE', 'current Git worktree is not in git worktree list');
  if (!current.clean) {
    throw new LifecycleError('CURRENT_WORKTREE_NOT_CLEAN', 'current checkout is dirty, conflicted, or in an operation; do not create a sibling worktree from it', {
      dirty: current.dirty,
      conflict: current.conflict,
      activeOperation: current.activeOperation,
    });
  }
  return { ok: true, action: 'create', taskId, branch, base: options.base, current, pr: null, record: null };
};

const recordFrom = ({ context, taskId, branch, worktreePath, baseRef, owner, sessionId, status = 'active', prNumber = null, headSha = null, dirtySummary = null }) => ({
  schemaVersion: SCHEMA_VERSION,
  repositoryRoot: context.root,
  taskId,
  branch,
  worktreePath: canonicalPath(worktreePath),
  baseRef,
  owner: owner ?? process.env.USER ?? null,
  sessionId: sessionId ?? process.env.ACE_SESSION_ID ?? null,
  createdAt: now(),
  lastSeenAt: now(),
  status,
  prNumber,
  headSha,
  dirtySummary,
});

const updateRecordFromInspection = (record, worktree, pr) => ({
  ...record,
  lastSeenAt: now(),
  status: observedStatus({ worktree, record, pr }),
  prNumber: pr?.number ?? record.prNumber ?? null,
  headSha: worktree.headSha ?? record.headSha ?? null,
  dirtySummary: worktree.clean ? null : {
    dirty: worktree.dirty,
    conflict: worktree.conflict,
    activeOperation: worktree.activeOperation,
  },
});

const start = async (context, options) => {
  const result = await preflight(context, options);
  if (result.action === 'reuse') {
    const record = result.record ?? recordFrom({
      context,
      taskId: result.taskId,
      branch: result.branch,
      worktreePath: result.worktreePath,
      baseRef: DEFAULT_BASE,
      owner: options.owner,
      sessionId: options.sessionId,
      status: result.pr?.state === 'OPEN' ? 'pr-open' : 'active',
      prNumber: result.pr?.number ?? null,
      headSha: result.worktree.headSha,
    });
    await writeRecord(context, updateRecordFromInspection(record, result.worktree, result.pr));
    return { ...result, record: updateRecordFromInspection(record, result.worktree, result.pr) };
  }
  if (!options.path) throw new LifecycleError('PATH_REQUIRED', '--path is required when creating a new worktree');
  const worktreePath = canonicalPath(options.path.startsWith('~') ? join(homedir(), options.path.slice(2)) : options.path);
  if (existsSync(worktreePath)) throw new LifecycleError('PATH_EXISTS', `target worktree path already exists: ${worktreePath}`);
  await mkdir(dirname(worktreePath), { recursive: true });
  git(['worktree', 'add', '-b', result.branch, worktreePath, result.base], context.root);
  const worktree = listWorktrees(context).find((item) => canonicalPath(item.path) === worktreePath);
  if (!worktree) throw new LifecycleError('WORKTREE_VERIFY_FAILED', `git worktree add succeeded but ${worktreePath} is not registered`);
  const record = recordFrom({
    context,
    taskId: result.taskId,
    branch: result.branch,
    worktreePath,
    baseRef: result.base,
    owner: options.owner,
    sessionId: options.sessionId,
    headSha: worktree.headSha,
  });
  await writeRecord(context, record);
  return { ...result, worktree, record };
};

const status = async (context, options) => {
  const taskId = requireTaskId(options);
  const { records } = await readRecords(context);
  const record = records.find((item) => item.taskId === taskId);
  if (!record) throw new LifecycleError('RECORD_NOT_FOUND', `no lifecycle record exists for task ${taskId}; run audit before registering legacy worktrees`);
  const worktree = listWorktrees(context).find((item) => canonicalPath(item.path) === canonicalPath(record.worktreePath));
  if (!worktree) throw new LifecycleError('WORKTREE_NOT_FOUND', `registered worktree does not exist: ${record.worktreePath}`);
  const prs = pullRequests();
  const pr = pullRequestForBranch(prs, record.branch);
  const updated = updateRecordFromInspection({ ...record, owner: options.owner ?? record.owner, sessionId: options.sessionId ?? record.sessionId }, worktree, pr);
  await writeRecord(context, updated);
  return { record: updated, worktree, pr, prLookup: prs.available ? 'available' : `unavailable: ${prs.error}` };
};

const cleanup = async (context, options) => {
  const taskId = requireTaskId(options);
  const { records } = await readRecords(context);
  const record = records.find((item) => item.taskId === taskId);
  if (!record) throw new LifecycleError('RECORD_NOT_FOUND', `no lifecycle record exists for task ${taskId}`);
  const prs = pullRequests();
  if (!prs.available) throw new LifecycleError('PR_LOOKUP_UNAVAILABLE', `cleanup requires PR lookup: ${prs.error}`);

  const worktrees = listWorktrees(context);
  const worktree = worktrees.find((item) => canonicalPath(item.path) === canonicalPath(record.worktreePath));
  const branchPrs = pullRequestsForBranch(prs, record.branch);
  if (!worktree) {
    const knownPr = pullRequestForBranch(prs, record.branch);
    const updated = { ...record, status: 'orphaned', lastSeenAt: now(), prNumber: knownPr?.number ?? record.prNumber ?? null };
    await writeRecord(context, updated);
    throw new LifecycleError('WORKTREE_NOT_FOUND', `registered worktree does not exist: ${record.worktreePath}`);
  }

  const openPr = branchPrs.find((item) => item.state === 'OPEN');
  if (openPr) {
    throw new LifecycleError('PR_NOT_MERGED', `cleanup refuses branch ${record.branch} while PR #${openPr.number} is open`, { pr: openPr });
  }
  if (typeof worktree.headSha !== 'string' || worktree.headSha.length === 0) {
    throw new LifecycleError('WORKTREE_HEAD_UNKNOWN', `cannot prove HEAD identity for ${worktree.path}`);
  }
  const pr = branchPrs.find((item) =>
    (item.state === 'MERGED' || item.mergedAt)
    && typeof item.headRefOid === 'string'
    && item.headRefOid === worktree.headSha);
  if (!pr) {
    const merged = branchPrs.filter((item) => item.state === 'MERGED' || item.mergedAt);
    if (merged.length > 0) {
      throw new LifecycleError(
        'PR_HEAD_MISMATCH',
        `clean worktree HEAD ${worktree.headSha} is not the exact head of a merged PR for ${record.branch}`,
        { worktreeHead: worktree.headSha, mergedPrHeads: merged.map((item) => ({ number: item.number, headRefOid: item.headRefOid })) },
      );
    }
    throw new LifecycleError('PR_NOT_MERGED', `cleanup requires a merged PR for ${record.branch}`, { prs: branchPrs });
  }
  if (pr.baseRefName !== 'main') {
    throw new LifecycleError('PR_BASE_MISMATCH', `cleanup requires the merged PR to target main, got ${pr.baseRefName || 'unknown'}`, { pr });
  }
  if (!worktree.clean) {
    const updated = updateRecordFromInspection({ ...record, prNumber: pr.number }, worktree, pr);
    await writeRecord(context, updated);
    throw new LifecycleError('WORKTREE_NOT_CLEAN', `refusing to delete merged worktree with local changes: ${worktree.path}`, { status: updated.status });
  }
  if (canonicalPath(worktree.path) === context.root) throw new LifecycleError('CURRENT_WORKTREE', 'refusing to remove the current worktree');
  if (worktree.branch !== record.branch) {
    throw new LifecycleError(
      'WORKTREE_BRANCH_MISMATCH',
      `registered worktree is on ${worktree.branch ?? 'detached HEAD'}, not ${record.branch}`,
      { expectedBranch: record.branch, actualBranch: worktree.branch },
    );
  }
  if (worktrees.filter((item) => item.branch === record.branch).length !== 1) {
    throw new LifecycleError('BRANCH_IN_USE', `branch ${record.branch} is referenced by more than one worktree`);
  }

  const expectedHead = worktree.headSha;
  const branchRef = `refs/heads/${record.branch}`;
  const branchHead = requireGit(['rev-parse', branchRef], context.root);
  if (branchHead !== expectedHead) {
    throw new LifecycleError(
      'BRANCH_HEAD_MISMATCH',
      `branch ${record.branch} moved after worktree inspection; refusing cleanup`,
      { expectedHead, branchHead },
    );
  }

  git(['worktree', 'remove', worktree.path], context.root);
  // A merged PR may have been squash-merged, so ancestry-based `git branch -d`
  // is not a valid deletion proof. Delete the local ref with an expected-old
  // value instead: Git refuses if another process moved the branch meanwhile.
  const branchDeletion = git(['update-ref', '-d', branchRef, expectedHead], context.root, { allowFailure: true });
  if (branchDeletion.status !== 0) {
    const updated = {
      ...record,
      status: 'merged-clean',
      prNumber: pr.number,
      lastSeenAt: now(),
      headSha: expectedHead,
      cleanupAt: now(),
      cleanupWarning: (branchDeletion.stderr ?? '').trim() || `git update-ref exited ${branchDeletion.status}`,
    };
    await writeRecord(context, updated);
    throw new LifecycleError(
      'BRANCH_DELETE_FAILED',
      `worktree was removed but local branch ${record.branch} was preserved because its ref could not be deleted with the expected HEAD`,
      { expectedHead, warning: updated.cleanupWarning },
    );
  }
  const branchStillExists = git(['show-ref', '--verify', '--quiet', branchRef], context.root, { allowFailure: true }).status === 0;
  if (branchStillExists) {
    throw new LifecycleError('BRANCH_DELETE_FAILED', `local branch ${record.branch} still exists after guarded ref deletion`, { expectedHead });
  }
  const updated = {
    ...record,
    status: 'merged-clean',
    prNumber: pr.number,
    lastSeenAt: now(),
    headSha: expectedHead,
    cleanupAt: now(),
    cleanupWarning: null,
  };
  await writeRecord(context, updated);
  return { record: updated, removedWorktree: worktree.path, deletedLocalBranch: true, remoteBranchTouched: false };
};

const textReport = (value) => {
  if (value?.worktrees && Array.isArray(value.worktrees)) {
    const lines = [
      `Repository: ${value.repositoryRoot}`,
      `Generated: ${value.generatedAt}`,
      `PR lookup: ${value.prLookup.available ? `available (${value.prLookup.source})` : `unavailable (${value.prLookup.error})`}`,
      `Worktrees: ${value.worktrees.length}`,
    ];
    for (const item of value.worktrees) {
      const pr = item.pr ? `#${item.pr.number} ${item.pr.state}` : 'none';
      lines.push(`- ${item.branch ?? '(detached)'} @ ${item.path}`);
      lines.push(`  head=${item.headSha ?? 'unknown'} status=${item.status} observed=${item.observedStatus} dirty=${item.dirty} conflict=${item.conflict} pr=${pr}`);
      lines.push(`  task=${item.taskId ?? 'unregistered'} owner=${item.owner ?? 'unknown'} lastSeen=${item.lastSeenAt ?? 'unknown'}`);
      lines.push(`  action=${item.recommendation}`);
    }
    if (value.registryIssues?.length) lines.push(`Registry issues: ${value.registryIssues.length}`);
    return lines.join('\n');
  }
  if (value?.action) return [`Action: ${value.action}`, `Task: ${value.taskId}`, `Branch: ${value.branch}`, `Worktree: ${value.worktreePath ?? value.worktree?.path ?? 'not-created'}`, ...(value.warnings ?? [])].join('\n');
  if (value?.record) return [`Task: ${value.record.taskId}`, `Status: ${value.record.status}`, `Branch: ${value.record.branch}`, `Worktree: ${value.record.worktreePath}`, `PR: ${value.pr?.number ?? value.record.prNumber ?? 'none'}`].join('\n');
  if (value?.removedWorktree) return [`Removed worktree: ${value.removedWorktree}`, `Deleted local branch: ${value.deletedLocalBranch}`, `Remote branch touched: ${value.remoteBranchTouched}`].join('\n');
  return JSON.stringify(value, null, 2);
};

const run = async (argv = process.argv.slice(2), cwd = process.cwd()) => {
  const options = parseArgs(argv);
  if (options.help) return { help: help() };
  const context = repositoryContext(cwd);
  if (options.command === 'audit') return audit(context);
  if (options.command === 'preflight') return preflight(context, options);
  if (options.command === 'start') return start(context, options);
  if (options.command === 'status') return status(context, options);
  return cleanup(context, options);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help());
    return;
  }
  const result = await run(process.argv.slice(2));
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${textReport(result)}\n`);
};

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const lifecycleError = error instanceof LifecycleError
      ? error
      : new LifecycleError('UNEXPECTED_ERROR', error instanceof Error ? error.message : String(error));
    const json = process.argv.includes('--json');
    if (json) process.stderr.write(`${JSON.stringify({ ok: false, error: { code: lifecycleError.code, message: lifecycleError.message, details: lifecycleError.details } })}\n`);
    else process.stderr.write(`worktree lifecycle: ${lifecycleError.code}: ${lifecycleError.message}\n`);
    process.exitCode = 1;
  });
}

export {
  SCHEMA_VERSION,
  branchForTask,
  parseArgs,
  run,
  taskSlug,
};
