import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const root = process.cwd();
const requestedOutput = process.argv[2] ?? 'artifacts/baseline';
const outputRoot = resolve(root, requestedOutput);
const relOutput = relative(root, outputRoot);
if (isAbsolute(relOutput) || relOutput === '..' || relOutput.startsWith('../') || relOutput.length === 0) {
  throw new Error('baseline output directory must be repository-contained');
}

const safeSlug = (value) => value.replace(/[^a-zA-Z0-9_.-]+/gu, '-');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const commandLabel = (command, args) => [command, ...args].join(' ');

const run = async (id, command, args, cwd = root) => {
  const startedAtMs = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const finishedAtMs = Date.now();
  const unavailable = result.error && result.error.code === 'ENOENT';
  const status = unavailable ? 'NOT_RUN' : result.status === 0 ? 'PASS' : 'FAIL';
  const body = [
    `command: ${commandLabel(command, args)}`,
    `status: ${status}`,
    `exit_code: ${result.status ?? 'none'}`,
    '',
    '--- stdout ---',
    result.stdout ?? '',
    '',
    '--- stderr ---',
    result.stderr ?? '',
    '',
    ...(result.error ? [`spawn_error: ${result.error.code ?? result.error.name}`] : []),
  ].join('\n');
  const logName = `${safeSlug(id)}.log`;
  const logPath = resolve(outputRoot, logName);
  await writeFile(logPath, body, 'utf8');
  return {
    id,
    command: commandLabel(command, args),
    status,
    exitCode: result.status,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    log: {
      path: relative(root, logPath).split('\\').join('/'),
      sha256: sha256(Buffer.from(body, 'utf8')),
    },
    ...(unavailable ? { limitation: `${command} executable not available` } : {}),
  };
};

const gitCommitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (gitCommitResult.status !== 0) throw new Error('baseline must run inside a Git checkout');
const sourceCommit = gitCommitResult.stdout.trim().toLowerCase();
if (!/^[a-f0-9]{40,64}$/u.test(sourceCommit)) throw new Error('could not resolve exact source commit');

const dirtyResult = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
if (dirtyResult.status !== 0) throw new Error('could not inspect Git worktree state');
const dirtyEntries = dirtyResult.stdout.split('\n').filter((line) => line.trim().length > 0);
const workspaceClean = dirtyEntries.length === 0;

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packageLock = await readFile(resolve(root, 'package-lock.json'));

await mkdir(outputRoot, { recursive: true });

const steps = [];
steps.push(await run('node-version', 'node', ['--version']));
steps.push(await run('npm-version', 'npm', ['--version']));
steps.push(await run('python-version', 'python3', ['--version']));
steps.push(await run('npm-ci', 'npm', ['ci', '--ignore-scripts']));
steps.push(await run('typecheck', 'npm', ['run', 'check']));
steps.push(await run('contracts', 'npm', ['test']));
steps.push(await run('lint', 'npm', ['run', 'lint']));
steps.push(await run('build', 'npm', ['run', 'build']));

const openspecHelp = await run('openspec-help', 'openspec', ['--help']);
steps.push(openspecHelp);
let openspecStatus = 'NOT_RUN';
if (openspecHelp.status === 'PASS') {
  steps.push(await run('openspec-version', 'openspec', ['--version']));
  const validateHelp = await run('openspec-validate-help', 'openspec', ['validate', '--help']);
  steps.push(validateHelp);
  if (validateHelp.status === 'PASS') {
    const changes = [
      '001-foundation',
      '002-harbor-evaluation',
      '003-unified-retrieval',
      '004-temporal-memory',
      '005-adaptive-routing-spike',
      '006-production-retrieval-vertical-slice',
    ];
    const validations = [];
    for (const change of changes) {
      const validation = await run(
        `openspec-${change}`,
        'openspec',
        ['validate', change, '--strict'],
        resolve(root, 'docs'),
      );
      steps.push(validation);
      validations.push(validation);
    }
    openspecStatus = validations.every((step) => step.status === 'PASS') ? 'PASS' : 'FAIL';
  } else {
    openspecStatus = 'FAIL';
  }
}

const mandatoryIds = new Set(['npm-ci', 'typecheck', 'contracts', 'lint', 'build']);
const mandatory = steps.filter((step) => mandatoryIds.has(step.id));
const mandatoryPass = mandatory.length === mandatoryIds.size && mandatory.every((step) => step.status === 'PASS');
const status = !workspaceClean
  ? 'PARTIAL'
  : !mandatoryPass
    ? 'FAIL'
    : openspecStatus === 'PASS'
      ? 'PASS'
      : openspecStatus === 'NOT_RUN'
        ? 'PARTIAL'
        : 'FAIL';

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status,
  sourceCommit,
  workspace: {
    clean: workspaceClean,
    dirtyEntryCount: dirtyEntries.length,
    note: workspaceClean
      ? 'No Git worktree changes were observed before the baseline run.'
      : 'Baseline ran from a dirty worktree; filenames are intentionally not retained in the public-safe manifest.',
  },
  runtime: {
    acePackage: `${packageJson.name}@${packageJson.version}`,
    node: process.version,
    typescript: packageJson.dependencies?.typescript ?? 'unknown',
    mcpServerSdk: packageJson.dependencies?.['@modelcontextprotocol/server'] ?? 'unknown',
    mcpClientSdk: packageJson.dependencies?.['@modelcontextprotocol/client'] ?? 'unknown',
    packageLockSha256: sha256(packageLock),
  },
  mandatoryChecks: {
    status: mandatoryPass ? 'PASS' : 'FAIL',
    ids: [...mandatoryIds],
  },
  openspec: {
    status: openspecStatus,
    note: openspecStatus === 'NOT_RUN'
      ? 'OpenSpec CLI was unavailable; strict validation was not inferred.'
      : 'OpenSpec flags were probed before strict validation.',
  },
  steps,
  claimBoundary: 'PASS is a repository baseline receipt only. It does not prove real-provider, agent-E2E, benchmark or owner-approved production readiness.',
};

const manifestPath = resolve(outputRoot, 'baseline.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  output: relative(root, manifestPath).split('\\').join('/'),
  sourceCommit,
  status,
  mandatory: manifest.mandatoryChecks.status,
  openspec: openspecStatus,
  workspaceClean,
}) + '\n');

if (process.env.ACE_REQUIRE_BASELINE_GREEN === 'true' && status !== 'PASS') {
  process.exitCode = 2;
}
