#!/usr/bin/env node
// Read-only evidence collection for a local coding agent. Not an SDLC runner or a G02 approver.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const REQUIRED = [
  'AGENTS.md',
  'docs/operations/ai-assisted-sdlc.md',
  'docs/research/sdlc/PROMPTS-ACE.md',
];
const STAGES = new Set(['research', 'design', 'plan', 'implement', 'review']);
const TIERS = new Set(['T0', 'T1', 'T2']);

const usage = () => `ACE local SDLC preflight (read-only)
Usage: node scripts/sdlc-preflight.mjs --tier T0|T1|T2 --stage research|design|plan|implement|review [options]

Options:
  --task-id <id>       Existing task identity; required before implementation
  --plan <path>        Existing canonical OpenSpec tasks or docs/plans plan
  --g02 <path>         Existing owner-reviewed G02 crosswalk for T2 implementation
  --root <directory>   Repo root (default: current working directory)
  --json               Print machine-readable evidence
  --help               Show help

This command never creates branches, writes evidence, runs CI, fetches remotes,
passes G02, or certifies provider/agent E2E. Use worktree:preflight for task
branch/worktree safety and the full SDLC prompts for decisions.
`;

const parseArgs = (args) => {
  const options = { tier: null, stage: null, taskId: null, plan: null, g02: null, root: process.cwd(), json: false, help: false };
  const lookup = new Map([['--tier', 'tier'], ['--stage', 'stage'], ['--task-id', 'taskId'], ['--plan', 'plan'], ['--g02', 'g02'], ['--root', 'root']]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      const split = arg.indexOf('=');
      const key = split < 0 ? arg : arg.slice(0, split);
      const property = lookup.get(key);
      if (!property) throw new Error(`unknown argument: ${arg}`);
      const value = split < 0 ? args[++i] : arg.slice(split + 1);
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
      options[property] = value;
    }
  }
  if (!options.help && (!TIERS.has(options.tier) || !STAGES.has(options.stage))) {
    throw new Error('explicit --tier T0|T1|T2 and --stage research|design|plan|implement|review are required');
  }
  return options;
};

const git = (root, args) => {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return result.status === 0 ? { ok: true, value: result.stdout.trim() } : { ok: false, value: null };
};

const canonicalFile = (root, userPath, allowedPrefixes) => {
  if (!userPath) return { status: 'NOT_PROVIDED', path: null };
  const path = resolve(root, userPath);
  const rel = relative(root, path).replaceAll('\\', '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel) || !allowedPrefixes.some((p) => rel.startsWith(p))) {
    return { status: 'INVALID_PATH', path: userPath };
  }
  try {
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) return { status: 'INVALID_PATH', path: rel };
  } catch {
    return { status: 'MISSING', path: rel };
  }
  return { status: 'PRESENT_NOT_APPROVED', path: rel };
};

const hasOperation = (root) => {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD']) {
    const pointer = git(root, ['rev-parse', '--git-path', name]);
    if (pointer.ok && existsSync(resolve(root, pointer.value))) return true;
  }
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  return gitDir.ok && (existsSync(resolve(gitDir.value, 'rebase-apply')) || existsSync(resolve(gitDir.value, 'rebase-merge')));
};

export const inspect = (options) => {
  const root = resolve(options.root);
  const evidence = {
    schema: 'ace.sdlc.local-preflight.v1',
    purpose: 'Read-only G00 evidence; not acceptance or G02 approval',
    selection: { tier: options.tier, stage: options.stage, taskId: options.taskId },
    source: { root, branch: null, head: null, cachedOriginMain: null, dirty: null, operationInProgress: null },
    canonical: { plan: null, g02: null },
    checks: [],
    tools: {},
    readBeforeAction: [...REQUIRED],
    next: [],
    verdict: 'BLOCKED',
  };
  const add = (id, status, reason) => evidence.checks.push({ id, status, reason });
  const workingTree = git(root, ['rev-parse', '--show-toplevel']);
  if (!workingTree.ok || resolve(workingTree.value) !== root) {
    add('G00-ROOT', 'BLOCKED', 'Root is not the root of a Git worktree');
    return evidence;
  }
  add('G00-ROOT', 'OBSERVED', 'Git worktree root identified');
  evidence.source.branch = git(root, ['branch', '--show-current']).value || null;
  evidence.source.head = git(root, ['rev-parse', 'HEAD']).value;
  evidence.source.cachedOriginMain = git(root, ['rev-parse', '--verify', 'origin/main']).value;
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  evidence.source.dirty = status.ok ? status.value.length > 0 : null;
  evidence.source.operationInProgress = hasOperation(root);
  add('G00-HEAD', evidence.source.head ? 'OBSERVED' : 'BLOCKED', evidence.source.head ? 'Exact local HEAD recorded' : 'Cannot resolve HEAD');
  for (const path of REQUIRED) {
    add(`SOURCE:${path}`, existsSync(resolve(root, path)) ? 'PRESENT' : 'BLOCKED', path);
  }
  if (evidence.source.cachedOriginMain === null) add('G00-REMOTE', 'UNKNOWN', 'No cached origin/main; no fetch was attempted');
  else add('G00-REMOTE', 'OBSERVED', 'Cached origin/main identity only; may be stale');
  if (evidence.source.dirty === null) add('G00-WORKTREE', 'BLOCKED', 'Git status unavailable');
  else if (evidence.source.dirty) add('G00-WORKTREE', 'REVIEW_REQUIRED', 'Working tree has changes; preserve unrelated work');
  else add('G00-WORKTREE', 'OBSERVED', 'Working tree is clean at inspection');
  if (evidence.source.operationInProgress) add('G00-OPERATION', 'BLOCKED', 'Git merge, cherry-pick, or rebase in progress');

  evidence.canonical.plan = canonicalFile(root, options.plan, ['openspec/changes/', 'docs/plans/']);
  evidence.canonical.g02 = canonicalFile(root, options.g02, ['openspec/changes/', 'docs/plans/']);
  if (options.plan) evidence.readBeforeAction.push(options.plan);
  if (options.g02 && options.g02 !== options.plan) evidence.readBeforeAction.push(options.g02);

  if (options.stage === 'implement') {
    if (!options.taskId) add('G00-TASK', 'BLOCKED', 'Implementation requires explicit --task-id and worktree preflight');
    else add('G00-TASK', 'REVIEW_REQUIRED', `Run npm run worktree:preflight -- --task-id ${JSON.stringify(options.taskId)} --json; do not infer safe branch from this check`);
    if (evidence.source.branch === null || evidence.source.branch === 'main' || evidence.source.branch === 'master') {
      add('G00-BRANCH', 'BLOCKED', 'Implementation on default/detached branch is not permitted');
    }
    if (evidence.canonical.plan.status !== 'PRESENT_NOT_APPROVED') {
      add('G00-PLAN', 'BLOCKED', 'Implementation requires an existing canonical --plan file');
    } else add('G00-PLAN', 'REVIEW_REQUIRED', 'Plan exists; agent must confirm requirements/owner acceptance');
    if (options.tier === 'T2') {
      add('G02', evidence.canonical.g02.status === 'PRESENT_NOT_APPROVED' ? 'REVIEW_REQUIRED' : 'BLOCKED',
        evidence.canonical.g02.status === 'PRESENT_NOT_APPROVED'
          ? 'G02 evidence path exists; owner decision and semantics NOT verified'
          : 'T2 code requires an existing --g02 crosswalk with explicit owner approval');
    }
  } else if (options.tier === 'T2') add('G02', 'REVIEW_REQUIRED', 'Complete the G02 owner/acceptance/decision/test crosswalk before code');
  else add('G02', options.tier === 'T0' ? 'N/A' : 'REVIEW_REQUIRED', options.tier === 'T0' ? 'No mandatory T2 design gate' : 'Use concise T1 invariant/RED/GREEN crosswalk');

  const packagePath = resolve(root, 'package.json');
  try {
    const scripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts ?? {};
    for (const command of ['test:affected', 'test:arch-rules', 'check:arch', 'verify:pr', 'worktree:preflight']) {
      evidence.tools[command] = scripts[command] ? 'DECLARED_NOT_EXECUTED' : 'NOT_AVAILABLE';
    }
  } catch {
    add('G00-TOOLS', 'UNKNOWN', 'Cannot inspect package scripts');
  }
  evidence.next.push('Read AGENTS.md, docs/operations/ai-assisted-sdlc.md and the entire stage command selected through PROMPTS-ACE.md');
  evidence.next.push('Check accepted ADR/OpenSpec, current runtime composition and active overlapping PRs; this script does not check remote PRs');
  if (options.taskId) evidence.next.push(`Run npm run worktree:preflight -- --task-id ${JSON.stringify(options.taskId)} --json before worktree mutation`);
  evidence.next.push('Keep BUILD/ARCH/SEC/PLAN and actual provider evidence separate; a declaration is never a test PASS');
  evidence.verdict = evidence.checks.some((x) => x.status === 'BLOCKED') ? 'BLOCKED'
    : evidence.checks.some((x) => x.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED'
      : 'READY_FOR_AGENT';
  return evidence;
};

const render = (result) => {
  const lines = [
    `ACE SDLC G00 preflight: ${result.verdict}`,
    `Tier/stage: ${result.selection.tier}/${result.selection.stage} | branch: ${result.source.branch ?? 'UNKNOWN'} | HEAD: ${result.source.head ?? 'UNKNOWN'}`,
    ...result.checks.map((c) => `[${c.status}] ${c.id}: ${c.reason}`),
    'Next (not performed):',
    ...result.next.map((n) => `  - ${n}`),
    'This is not permission to skip G02, four review gates, PR CI, real-provider E2E or human approval.',
  ];
  return lines.join('\n');
};

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) console.log(usage());
  else {
    const result = inspect(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : render(result));
    if (result.verdict === 'BLOCKED') process.exitCode = 2;
  }
} catch (error) {
  console.error(`ACE SDLC preflight: ${error.message}\n${usage()}`);
  process.exitCode = 2;
}
