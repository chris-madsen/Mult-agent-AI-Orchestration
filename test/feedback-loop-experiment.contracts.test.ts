import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  reconcileFeedbackTrials,
  validateFeedbackExperimentManifest,
  validateFeedbackTaskManifest,
  validateFeedbackReport,
  type FeedbackTaskManifest,
  type FeedbackTrialObservation,
} from '../src/domain/feedback-loop-experiment.js';
import {
  dockerImageMatchesDigest,
  validateFeedbackHarborJob,
  validateMatchingFeedbackHarborJobs,
} from '../src/domain/feedback-harbor-config.js';

const revision = 'a'.repeat(40);
const digest = (character: string): string => character.repeat(64);

const manifest: FeedbackTaskManifest = {
  schemaVersion: 1,
  selection: 'smoke',
  dataset: { id: 'scale-ai/swe-atlas-qna', revision, rawSha256: digest('b') },
  tasks: [{ id: 'task-1', sourceRevision: revision, sourceDigest: digest('c'), taskDigest: digest('d') }],
  holdout: [],
};

const observation = (
  arm: FeedbackTrialObservation['arm'],
  overrides: Partial<FeedbackTrialObservation> = {},
): FeedbackTrialObservation => ({
  arm,
  taskId: 'task-1',
  trialId: `${arm}-trial-1`,
  sourceRevision: revision,
  sourceDigest: digest('c'),
  taskDigest: digest('d'),
  quality: 'pass',
  usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, costUsd: 0.01 },
  durationMs: 100,
  ...(arm === 'native' ? { nativeFileReads: 2 } : {}),
  observedAceCalls: arm === 'native' ? 0 : 1,
  observedAceRequestIds: arm === 'native' ? [] : ['request-1'],
  providerTraceRequestIds: arm === 'native' ? [] : ['request-1'],
  rawArtifactHashes: [{ path: `${arm}/result.json`, sha256: digest('e') }],
  ...overrides,
});

const reconcile = (native = observation('native'), ace = observation('ace_optional')) =>
  reconcileFeedbackTrials({ taskManifest: manifest, native: [native], ace: [ace] });

test('feedback loop reports correlated paired usage without counting cached input twice', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    usage: { inputTokens: 40, cachedInputTokens: 10, outputTokens: 10, costUsd: 0.005 },
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.qualityGate, 'pass');
  assert.equal(result.value.nativeTotalTokens, 120);
  assert.equal(result.value.aceTotalTokens, 50);
  assert.equal(result.value.aceCachedInputTokens, 10);
  assert.equal(result.value.tokenRatio, 2.4);
});

test('optional ACE with no calls is ACE_NOT_USED and cannot claim token savings', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 0,
    observedAceRequestIds: [],
    providerTraceRequestIds: [],
  }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'ACE_NOT_USED');
  assert.equal(result.value.aceNotUsed, true);
  assert.equal(result.value.tokenRatio, null);
  assert.equal(result.value.rows[0]?.aceCorrelation, 'ACE_NOT_USED');
});

test('native arm with an ACE call is invalid instead of being treated as a clean baseline', () => {
  const result = reconcile(observation('native', {
    observedAceCalls: 1,
    observedAceRequestIds: ['native-request'],
    providerTraceRequestIds: ['native-request'],
  }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /native arm/u);
});

test('observed ACE calls without provider correlation remain UNKNOWN', () => {
  const result = reconcile(undefined, observation('ace_optional', { providerTraceRequestIds: [] }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.tokenRatio, null);
  assert.equal(result.value.rows[0]?.aceCorrelation, 'UNKNOWN');
});

test('native pass and ACE fail is a per-task quality regression', () => {
  const result = reconcile(undefined, observation('ace_optional', { quality: 'fail' }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'QUALITY_REGRESSION');
  assert.deepEqual(result.value.qualityRegressionTaskIds, ['task-1']);
  assert.equal(result.value.tokenRatio, null);
});

test('failed trial evidence is retained and missing usage remains UNKNOWN', () => {
  const result = reconcile(observation('native', { quality: 'fail', usage: {} }));
  assert.equal(result._tag, 'Ok');
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.rows[0]?.nativeQuality, 'fail');
  assert.equal(result.value.rows[0]?.nativeTotalTokens, null);
});

test('invalid zero token counters are rejected instead of becoming a measured zero', () => {
  const result = reconcile(observation('native', { usage: { inputTokens: 0, outputTokens: 20 } }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /token counters/u);
});

test('missing raw artifact hash is rejected', () => {
  const result = reconcile(observation('native', { rawArtifactHashes: [] }));
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /raw artifact hash/u);
});

test('source/task digest mismatch blocks the paired result', () => {
  const result = reconcile(undefined, observation('ace_optional', { sourceDigest: digest('f') }));
  assert.equal(result._tag, 'Err');
  assert.equal(result.error.code, 'DIGEST_MISMATCH');
});

test('duplicate trial and request IDs are invalid', () => {
  const duplicateTrial = reconcile(observation('native', { trialId: 'same' }), observation('ace_optional', { trialId: 'same' }));
  assert.equal(duplicateTrial._tag, 'Err');
  const duplicateRequest = reconcile(undefined, observation('ace_optional', {
    observedAceRequestIds: ['request-1', 'request-1'],
    observedAceCalls: 2,
  }));
  assert.equal(duplicateRequest._tag, 'Err');
});


test('multiple ACE calls are counted as calls, not as one correlated task', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 3,
    observedAceRequestIds: ['request-1', 'request-2', 'request-3'],
    providerTraceRequestIds: ['request-1', 'request-2', 'request-3'],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.aceObservedCalls, 3);
  assert.equal(result.value.aceCorrelatedCalls, 3);
});

test('partially correlated requests are counted individually but not marked complete', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 3,
    observedAceRequestIds: ['request-1', 'request-2', 'request-3'],
    providerTraceRequestIds: ['request-1', 'request-3'],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'UNKNOWN');
  assert.equal(result.value.aceObservedCalls, 3);
  assert.equal(result.value.aceCorrelatedCalls, 2);
  assert.equal(result.value.tokenRatio, null);
});

test('ace_expand counts as ACE usage without breaking provider correlation for ace_context', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    observedAceCalls: 2,
    observedAceRequestIds: ['request-1'],
    providerTraceRequestIds: ['request-1'],
    observedAceContextCalls: 1,
  } as Partial<FeedbackTrialObservation> & { readonly observedAceContextCalls: number }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'PASS');
  assert.equal(result.value.aceObservedCalls, 2);
  assert.equal(result.value.aceCorrelatedCalls, 1);
  assert.equal(result.value.rows[0]?.aceCorrelation, 'correlated');
});

test('quality regression never presents token savings even in the per-task row', () => {
  const result = reconcile(undefined, observation('ace_optional', {
    quality: 'fail',
    usage: { inputTokens: 20, cachedInputTokens: 0, outputTokens: 10 },
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  assert.equal(result.value.status, 'QUALITY_REGRESSION');
  assert.equal(result.value.rows[0]?.tokenRatio, null);
  assert.equal(result.value.tokenRatio, null);
});


test('failed paired tasks cannot be counted as savings per accepted task', () => {
  const bothFailed = reconcile(observation('native', { quality: 'fail' }), observation('ace_optional', { quality: 'fail' }));
  assert.equal(bothFailed._tag, 'Ok');
  if (bothFailed._tag === 'Ok') {
    assert.equal(bothFailed.value.status, 'UNKNOWN');
    assert.equal(bothFailed.value.tokenRatio, null);
    assert.equal(bothFailed.value.rows[0]?.tokenRatio, null);
  }
  const improved = reconcile(observation('native', { quality: 'fail' }));
  assert.equal(improved._tag, 'Ok');
  if (improved._tag === 'Ok') {
    assert.equal(improved.value.status, 'UNKNOWN');
    assert.equal(improved.value.tokenRatio, null);
    assert.equal(improved.value.rows[0]?.qualityDelta, 'no_regression');
  }
});

test('main task manifest requires ten frozen tasks and ten untouched holdout tasks', () => {
  const result = validateFeedbackTaskManifest({
    ...manifest,
    selection: 'main',
  });
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /exactly 10/u);
});

test('freeze CLI creates a provenance-bound one-task smoke manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-feedback-smoke-freeze-'));
  const tasksPath = join(root, 'task-identities.jsonl');
  const output = join(root, 'frozen');
  await writeFile(tasksPath, `${JSON.stringify({
    ...manifest.tasks[0],
    taskPath: 'tasks/task-1',
  })}\n`);
  const run = spawnSync(resolve('node_modules/.bin/tsx'), [
    'scripts/freeze-feedback-task-manifest.ts',
    '--tasks', tasksPath,
    '--dataset-revision', revision,
    '--dataset-sha256', digest('b'),
    '--output', output,
    '--smoke-id', 'task-1',
  ], { cwd: resolve('.'), encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
  const frozen = JSON.parse(await readFile(join(output, 'task-manifest.json'), 'utf8')) as FeedbackTaskManifest;
  assert.equal(frozen.selection, 'smoke');
  assert.equal(frozen.tasks.length, 1);
  assert.equal(frozen.tasks[0]?.id, 'task-1');
  assert.deepEqual(frozen.holdout, []);
  const selection = JSON.parse(await readFile(join(output, 'selection.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(selection.smokeId, 'task-1');
  assert.equal(validateFeedbackTaskManifest(frozen)._tag, 'Ok');
});

test('holdout mutation and duplicate IDs are rejected before trials are reconciled', () => {
  const result = validateFeedbackTaskManifest({
    ...manifest,
    holdout: [manifest.tasks[0]!],
  });
  assert.equal(result._tag, 'Err');
  assert.match(result.error.message, /unique/u);
});

test('feedback report validator rejects malformed rows and zero economic counters', () => {
  const reconciled = reconcile();
  assert.equal(reconciled._tag, 'Ok');
  assert.equal(validateFeedbackReport(reconciled.value)._tag, 'Ok');
  assert.equal(validateFeedbackReport({ ...reconciled.value, rows: [] })._tag, 'Err');
  assert.equal(validateFeedbackReport({ ...reconciled.value, nativeTotalTokens: 0 })._tag, 'Err');
  assert.equal(validateFeedbackReport({ ...reconciled.value, qualityRegressionTaskIds: [7] })._tag, 'Err');
});


test('Harbor preparation binds actual clean Git blobs and blocks dirty source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-feedback-frozen-'));
  const source = join(root, 'source');
  const ace = join(root, 'ace');
  await mkdir(source);
  await mkdir(join(ace, 'dist', 'bin'), { recursive: true });
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  for (const dir of [source, ace]) {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'ACE test');
    git(dir, 'config', 'user.email', 'ace-test@example.invalid');
  }
  for (let i = 0; i < 20; i += 1) {
    const taskDir = join(source, 'tasks', 'task-' + String(i));
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, 'test.txt'), 'content ' + String(i) + '\n');
    await writeFile(join(taskDir, 'task.toml'), 'version = "1.0"\n[environment]\ndocker_image = "registry.example/feedback:1"\n');
  }
  git(source, 'add', '.');
  git(source, 'commit', '-q', '-m', 'pin tasks');
  const revisionValue = git(source, 'rev-parse', 'HEAD');
  const entries = (prefix?: string) => {
    const paths = execFileSync('git', [
      '-C', source, 'ls-tree', '-r', '-z', '--name-only', revisionValue,
      ...(prefix === undefined ? [] : [prefix + '/']),
    ]).toString('utf8').split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
    return paths.map((path) => {
      const bytes = execFileSync('git', ['-C', source, 'show', revisionValue + ':' + path]);
      return { path, sizeBytes: bytes.byteLength, sha256: sha(bytes) };
    });
  };
  const treeDigest = (id: string, items: ReturnType<typeof entries>) =>
    sha(Buffer.from(JSON.stringify({ schemaVersion: 1, identity: id, revision: revisionValue, entries: items }, null, 2) + '\n'));
  const sourceDigest = treeDigest('scale-ai/swe-atlas-qna', entries());
  const tasks = Array.from({ length: 20 }, (_, i) => {
    const taskPath = 'tasks/task-' + String(i);
    const id = 'task-' + String(i);
    return { id, taskPath, sourceRevision: revisionValue, sourceDigest, taskDigest: treeDigest(id, entries(taskPath)) };
  });
  const manifestPath = join(root, 'task-manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1, selection: 'main',
    dataset: { id: 'scale-ai/swe-atlas-qna', revision: revisionValue, rawSha256: 'b'.repeat(64) },
    tasks: tasks.slice(0, 10), holdout: tasks.slice(10),
  }));
  const aceConfig = join(ace, 'codex.toml');
  await writeFile(aceConfig, 'model = "test-model"\n');
  await writeFile(join(ace, 'dist', 'bin', 'ace-mcp.js'), 'console.log("mock executable");\n');
  git(ace, 'add', '.');
  git(ace, 'commit', '-q', '-m', 'pin ACE');
  const dockerBin = join(root, 'bin');
  await mkdir(dockerBin);
  const fakeDocker = join(dockerBin, 'docker');
  await writeFile(fakeDocker, `#!/usr/bin/env bash\nprintf '%s\\n' '{"Id":"sha256:${'a'.repeat(64)}","RepoDigests":[]}'\n`);
  await chmod(fakeDocker, 0o755);
  const fakeHarbor = join(dockerBin, 'harbor');
  await writeFile(fakeHarbor, '#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo "harbor 0.24.0"; exit 0; fi\nexit 2\n');
  await chmod(fakeHarbor, 0o755);
  const run = (output: string) => spawnSync(resolve('node_modules/.bin/tsx'), [
    'scripts/prepare-harbor-feedback-jobs.ts',
    '--task-manifest', manifestPath, '--source-root', source, '--ace-root', ace,
    '--output', output, '--run-id', 'frozen-test', '--model', 'test-model',
    '--reasoning', 'medium', '--image-digest', 'sha256:' + 'a'.repeat(64),
    '--ace-config', aceConfig,
  ], { cwd: resolve('.'), encoding: 'utf8', timeout: 120_000, env: { ...process.env, PATH: `${dockerBin}:${process.env.PATH ?? ''}` } });
  const firstOutput = join(root, 'first');
  const first = run(firstOutput);
  assert.equal(first.status, 0, first.stderr);
  const prepared = JSON.parse(await readFile(join(firstOutput, 'job-manifest.json'), 'utf8'));
  assert.equal(prepared.status, 'READY');
  assert.equal(prepared.taskImages[0].reference, 'registry.example/feedback:1');
  const job = JSON.parse(await readFile(join(firstOutput, 'ace-optional-job.json'), 'utf8'));
  assert.equal('mounts' in job.environment, false);
  const runner = await readFile(join(firstOutput, 'run-ace-optional.sh'), 'utf8');
  assert.match(runner, /--mounts/u);
  assert.match(runner, /read_only/u);
  assert.equal(prepared.verifiedSourceDigest, sourceDigest);
  await writeFile(join(source, 'tasks', 'task-1', 'test.txt'), 'tampered task\n');
  const secondOutput = join(root, 'second');
  const second = run(secondOutput);
  assert.equal(second.status, 2);
  const blocked = JSON.parse(await readFile(join(secondOutput, 'job-manifest.json'), 'utf8'));
  assert.equal(blocked.status, 'BLOCKED');
  assert.match(blocked.reason, /dirty/u);
});


test('untrusted RepoBench pickle is rejected before Python can deserialize it', async (t) => {
  const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  if (python.status !== 0) return t.skip('Python3 is unavailable in this test runtime');
  const root = await mkdtemp(join(tmpdir(), 'ace-untrusted-pickle-'));
  const input = join(root, 'records.raw');
  const output = join(root, 'records.jsonl');
  const bytes = Buffer.from('not a trusted pickle');
  await writeFile(input, bytes);
  const argumentsPrefix = [
    'scripts/repobench-r-pickle-to-json.py',
    '--input', input, '--config', 'python_cff', '--split', 'test_easy', '--output', output,
  ];
  const mismatched = spawnSync('python3', [
    ...argumentsPrefix, '--expected-sha256', 'a'.repeat(64), '--trust-pickle-source',
  ], { cwd: resolve('.'), encoding: 'utf8' });
  assert.equal(mismatched.status, 2);
  assert.match(mismatched.stderr, /digest does not match/u);
  const validDigest = createHash('sha256').update(bytes).digest('hex');
  const noOptIn = spawnSync('python3', [
    ...argumentsPrefix, '--expected-sha256', validDigest,
  ], { cwd: resolve('.'), encoding: 'utf8' });
  assert.equal(noOptIn.status, 2);
  assert.match(noOptIn.stderr, /trust-pickle-source/u);
});

const harborJob = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tasks: [{ path: '/frozen/task-a' }],
  agents: [{ name: 'codex', model_name: 'gpt-5.6-luna', kwargs: { reasoning_effort: 'high' } }],
  n_concurrent_trials: 1,
  n_attempts: 1,
  ...overrides,
});

test('feedback Harbor identity comes from frozen jobs, not CODEX environment variables', () => {
  const checked = validateMatchingFeedbackHarborJobs(harborJob(), harborJob({
    environment: { type: 'docker' },
    agents: [{
      name: 'codex',
      model_name: 'gpt-5.6-luna',
      kwargs: { reasoning_effort: 'high', config: '/ace/benchmarks/harbor/ace-retrieval-codex-config.toml' },
    }],
  }));
  assert.equal(checked._tag, 'Ok');
  if (checked._tag === 'Ok') {
    assert.equal(checked.value.model, 'gpt-5.6-luna');
    assert.equal(checked.value.reasoningEffort, 'high');
    assert.equal(checked.value.nConcurrentTrials, 1);
    assert.equal(checked.value.nAttempts, 1);
  }
});

test('feedback Harbor identity requires ACE config only on the ACE optional arm', () => {
  const aceJob = harborJob({
    agents: [{
      name: 'codex',
      model_name: 'gpt-5.6-luna',
      kwargs: { reasoning_effort: 'high', config: '/ace/benchmarks/harbor/ace-retrieval-codex-config.toml' },
    }],
  });
  assert.equal(validateMatchingFeedbackHarborJobs(harborJob(), aceJob)._tag, 'Ok');
  assert.equal(validateMatchingFeedbackHarborJobs(harborJob(), harborJob())._tag, 'Err');
  assert.equal(validateMatchingFeedbackHarborJobs(aceJob, aceJob)._tag, 'Err');
});

test('feedback Harbor identity rejects different frozen task sets between arms', () => {
  const aceJob = harborJob({
    tasks: [{ path: '/frozen/task-b' }],
    agents: [{
      name: 'codex',
      model_name: 'gpt-5.6-luna',
      kwargs: { reasoning_effort: 'high', config: '/ace/benchmarks/harbor/ace-retrieval-codex-config.toml' },
    }],
  });
  assert.equal(validateMatchingFeedbackHarborJobs(harborJob(), aceJob)._tag, 'Err');
});

test('feedback Harbor identity rejects model/reasoning drift and non-serial jobs', () => {
  assert.equal(validateMatchingFeedbackHarborJobs(harborJob(), harborJob({ agents: [{ name: 'codex', model_name: 'other', kwargs: { reasoning_effort: 'high' } }] }))._tag, 'Err');
  assert.equal(validateFeedbackHarborJob(harborJob({ n_concurrent_trials: 2 }))._tag, 'Err');
  assert.equal(validateFeedbackHarborJob(harborJob({ n_attempts: 2 }))._tag, 'Err');
});

test('Docker feedback image identity accepts a local image ID or matching repository digest only', () => {
  const imageDigest = `sha256:${'a'.repeat(64)}`;
  assert.equal(dockerImageMatchesDigest(imageDigest, { Id: imageDigest, RepoDigests: [] }), true);
  assert.equal(dockerImageMatchesDigest(imageDigest, { Id: 'sha256:other', RepoDigests: [`registry.example/ace@${imageDigest}`] }), true);
  assert.equal(dockerImageMatchesDigest(imageDigest, { Id: 'sha256:other', RepoDigests: [] }), false);
  assert.equal(dockerImageMatchesDigest('not-a-digest', { Id: imageDigest }), false);
});

test('feedback experiment manifest rejects contradictory single-image and task-image digests', () => {
  const checked = validateFeedbackExperimentManifest({
    schemaVersion: 1,
    runId: 'smoke-1',
    sourceCommit: revision,
    taskManifestSha256: digest('a'),
    model: 'gpt-5.6-luna',
    reasoningEffort: 'high',
    harborVersion: '0.24.0',
    imageDigest: `sha256:${digest('b')}`,
    taskImages: [{ reference: 'registry.example/task:1', digest: `sha256:${digest('c')}` }],
    aceConfigDigest: digest('d'),
    seed: 'unknown',
    mode: 'cold',
    nConcurrentTrials: 1,
    nAttempts: 1,
    authenticationRoute: 'CODEX_FORCE_AUTH_JSON=1',
  });
  assert.equal(checked._tag, 'Err');
});

test('feedback experiment manifest accepts pinned per-task Docker images for multi-image datasets', () => {
  const checked = validateFeedbackExperimentManifest({
    schemaVersion: 1,
    runId: 'main-serial-1',
    sourceCommit: revision,
    taskManifestSha256: digest('a'),
    model: 'gpt-5.6-luna',
    reasoningEffort: 'high',
    harborVersion: '0.24.0',
    taskImages: [
      { reference: 'registry.example/calypso:1', digest: `sha256:${digest('b')}` },
      { reference: 'registry.example/simple-login:1', digest: `sha256:${digest('c')}` },
    ],
    aceConfigDigest: digest('d'),
    seed: 'unknown',
    mode: 'cold',
    nConcurrentTrials: 1,
    nAttempts: 1,
    authenticationRoute: 'CODEX_FORCE_AUTH_JSON=1',
  });
  assert.equal(checked._tag, 'Ok');
  if (checked._tag === 'Ok') assert.equal(checked.value.taskImages.length, 2);
  assert.equal(validateFeedbackExperimentManifest({
    schemaVersion: 1,
    runId: 'main-serial-1',
    sourceCommit: revision,
    taskManifestSha256: digest('a'),
    model: 'gpt-5.6-luna',
    reasoningEffort: 'high',
    harborVersion: '0.24.0',
    taskImages: [{ reference: 'registry.example/calypso:1', digest: 'not-a-digest' }],
    aceConfigDigest: digest('d'),
    seed: 'unknown',
    mode: 'cold',
    nConcurrentTrials: 1,
    nAttempts: 1,
    authenticationRoute: 'CODEX_FORCE_AUTH_JSON=1',
  })._tag, 'Err');
});
