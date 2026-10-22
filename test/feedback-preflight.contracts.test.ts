import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  codexAuthenticationRoute,
  inspectCodexAuthJson,
} from '../src/domain/feedback-preflight.js';
import * as feedbackPreflight from '../src/domain/feedback-preflight.js';

const validAuth = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    access_token: 'oauth-access-token',
    refresh_token: 'oauth-refresh-token',
    id_token: 'e30.e30.signature',
    account_id: 'account-id',
  },
  last_refresh: '2026-10-22T16:00:00Z',
});

test('Codex ChatGPT auth is ready without a manually supplied API key', () => {
  const observed = inspectCodexAuthJson('/home/test/.codex/auth.json', validAuth);
  assert.equal(observed.status, 'ready');
  assert.equal(observed.authenticationRoute, codexAuthenticationRoute);
  assert.equal(observed.identity, '/home/test/.codex/auth.json');
  assert.doesNotMatch(JSON.stringify(observed), /oauth-access-token|oauth-refresh-token|oauth-id-token/u);
});

test('Codex auth preflight rejects missing or malformed OAuth state', () => {
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', '').status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', '{"auth_mode":"chatgpt"}').status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', '{"tokens":{"access_token":"x"}}').status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', '{not-json').status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', '{"auth_mode":"api_key","tokens":{"access_token":"x"}}').status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { id_token: 'identity-only' },
    last_refresh: '2026-10-22T16:00:00Z',
  })).status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access-only' },
    last_refresh: '2026-10-22T16:00:00Z',
  })).status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access', refresh_token: 'refresh' },
  })).status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access', refresh_token: 'refresh' },
    last_refresh: 'not-a-date',
  })).status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access', refresh_token: 'refresh' },
    last_refresh: '2026-10-22T16:00:00Z',
  })).status, 'not_ready');
  assert.equal(inspectCodexAuthJson('/tmp/auth.json', JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: 'access', refresh_token: 'refresh', id_token: 'not-a-jwt' },
    last_refresh: '2026-10-22T16:00:00Z',
  })).status, 'not_ready');
});

test('real Stage0 requires source-root to be the actual Git checkout root', async () => {
  const stage0 = await readFile('scripts/feedback-loop-stage0.ts', 'utf8');
  assert.match(stage0, /rev-parse', '--show-toplevel/u);
  assert.match(stage0, /--source-root must be the Git checkout root/u);
});

test('real Stage0 keeps evidence outside frozen source and revalidates source identity after providers run', async () => {
  const stage0 = await readFile('scripts/feedback-loop-stage0.ts', 'utf8');
  assert.match(stage0, /--output must remain outside --source-root/u);
  assert.match(stage0, /const finalSource = realSourceIdentity\(sourceRoot\)/u);
  assert.match(stage0, /finalSource\.manifestSha256 !== source\.manifestSha256/u);
});

test('feedback jobs use the Codex OAuth route and do not require the legacy API-key route', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  const jobs = await readFile('scripts/prepare-harbor-feedback-jobs.ts', 'utf8');
  const sweAtlasConfig = await readFile('benchmarks/harbor/ace-swe-atlas-codex-config.toml', 'utf8');
  const sweAtlasWrapper = await readFile('scripts/harbor-ace-mcp.sh', 'utf8');
  assert.doesNotMatch(preflight, /OPENAI_API_KEY|OPENAI_API_BASE/u);
  assert.match(preflight, /authenticationRoute: codexAuthenticationRoute/u);
  assert.match(preflight, /fastembed-sparse-worker\.sh'\], sparseEmbeddingEnvironment/u);
  assert.match(jobs, /CODEX_FORCE_AUTH_JSON:\s*'1'/u);
  assert.match(jobs, /CODEX_AUTH_JSON_PATH:\s*''/u);
  assert.doesNotMatch(jobs, /OPENAI_API_KEY|OPENAI_API_BASE/u);
  assert.match(sweAtlasConfig, /cwd = "\/app"/u);
  assert.match(sweAtlasConfig, /ACE_WORKSPACE_ROOT = "\/app"/u);
  assert.match(sweAtlasConfig, /ACE_ALLOWED_ROOTS = "\/app"/u);
  assert.match(sweAtlasConfig, /GIT_CONFIG_VALUE_0 = "\/ace"/u);
  assert.match(sweAtlasConfig, /GIT_CONFIG_VALUE_1 = "\/app"/u);
  assert.match(sweAtlasConfig, /command = "\/ace\/scripts\/harbor-ace-mcp\.sh"/u);
  assert.match(sweAtlasWrapper, /fastembed==0\.7\.4/u);
  assert.match(sweAtlasWrapper, /PYTHONPATH=/u);
});


test('exact-current preflight binds experiment identity to checkout, jobs, Harbor and auth route', () => {
  const module = feedbackPreflight as unknown as {
    readonly validateFeedbackPreflightBinding?: (input: {
      readonly currentSourceCommit: string;
      readonly actualHarborVersion: string;
      readonly expectedAuthenticationRoute: string;
      readonly jobModel: string;
      readonly jobReasoningEffort: 'low' | 'medium' | 'high';
      readonly experiment: {
        readonly sourceCommit: string;
        readonly model: string;
        readonly reasoningEffort: 'low' | 'medium' | 'high';
        readonly harborVersion: string;
        readonly authenticationRoute: string;
      };
    }) => readonly string[];
  };
  assert.equal(typeof module.validateFeedbackPreflightBinding, 'function');
  if (module.validateFeedbackPreflightBinding === undefined) return;
  const base = {
    currentSourceCommit: 'a'.repeat(40),
    actualHarborVersion: 'harbor 0.24.0',
    expectedAuthenticationRoute: codexAuthenticationRoute,
    jobModel: 'gpt-5.6-luna',
    jobReasoningEffort: 'high' as const,
    experiment: {
      sourceCommit: 'a'.repeat(40),
      model: 'gpt-5.6-luna',
      reasoningEffort: 'high' as const,
      harborVersion: 'harbor 0.24.0',
      authenticationRoute: codexAuthenticationRoute,
    },
  };
  assert.deepEqual(module.validateFeedbackPreflightBinding(base), []);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, sourceCommit: 'b'.repeat(40) },
  }), ['sourceCommit']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, model: 'different-model' },
  }), ['model']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, reasoningEffort: 'medium' },
  }), ['reasoningEffort']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, harborVersion: 'harbor 0.23.0' },
  }), ['harborVersion']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, authenticationRoute: 'different-route' },
  }), ['authenticationRoute']);
});

test('explicit image digest cannot contradict experiment task-image provenance', () => {
  const module = feedbackPreflight as unknown as {
    readonly validateFeedbackImageOverride?: (
      requested: string | undefined,
      experimentImageDigest: string | undefined,
      taskImages: readonly { readonly reference: string; readonly digest: string }[],
    ) => readonly string[];
  };
  assert.equal(typeof module.validateFeedbackImageOverride, 'function');
  if (module.validateFeedbackImageOverride === undefined) return;
  const digestA = `sha256:${'a'.repeat(64)}`;
  const digestB = `sha256:${'b'.repeat(64)}`;
  assert.deepEqual(module.validateFeedbackImageOverride(undefined, digestA, [{ reference: 'task:1', digest: digestA }]), []);
  assert.deepEqual(module.validateFeedbackImageOverride(digestA, digestA, [{ reference: 'task:1', digest: digestA }]), []);
  assert.deepEqual(module.validateFeedbackImageOverride(digestB, digestA, [{ reference: 'task:1', digest: digestA }]), ['imageDigest']);
  assert.deepEqual(module.validateFeedbackImageOverride(digestA, undefined, [
    { reference: 'task:1', digest: digestA },
    { reference: 'task:2', digest: digestB },
  ]), ['imageDigest']);
});


test('OAuth preflight inspects the same default auth.json path Harbor uses for CODEX_FORCE_AUTH_JSON', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  assert.doesNotMatch(preflight, /process\.env\.CODEX_HOME/u);
  assert.match(preflight, /process\.env\.HOME/u);
});


test('exact-current preflight requires a clean checkout, compiled runtime provenance and ACE config digest', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  assert.match(preflight, /status', '--porcelain=v1'/u);
  assert.match(preflight, /verifyCompiledRuntimeProvenance/u);
  assert.match(preflight, /aceConfigDigest/u);
});
