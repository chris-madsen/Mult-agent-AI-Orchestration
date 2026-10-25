import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyFeedbackVerifierHttpStatus,
  hermesCodexAuthenticationRoute,
  inspectFeedbackVerifierConfiguration,
  inspectHermesAuthJson,
} from '../src/domain/feedback-preflight.js';
import * as feedbackPreflight from '../src/domain/feedback-preflight.js';

const validAuth = JSON.stringify({
  providers: {
    'openai-codex': {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
      },
      last_refresh: '2026-10-22T16:00:00Z',
    },
  },
});

test('Hermes ChatGPT/Codex OAuth is ready without a manually supplied API key', () => {
  const observed = inspectHermesAuthJson('/home/test/.hermes/auth.json', validAuth);
  assert.equal(observed.status, 'ready');
  assert.equal(observed.authenticationRoute, hermesCodexAuthenticationRoute);
  assert.equal(observed.identity, '/home/test/.hermes/auth.json');
  assert.doesNotMatch(JSON.stringify(observed), /oauth-access-token|oauth-refresh-token|oauth-id-token/u);
});

test('current Hermes credential_pool OAuth schema is accepted without exposing tokens', () => {
  const observed = inspectHermesAuthJson('/home/test/.hermes/auth.json', JSON.stringify({
    active_provider: 'openai-codex',
    credential_pool: {
      'openai-codex': [{
        auth_type: 'oauth',
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        last_refresh: '2026-10-23T16:18:50.493094Z',
      }],
    },
  }));
  assert.equal(observed.status, 'ready');
  assert.doesNotMatch(JSON.stringify(observed), /oauth-access-token|oauth-refresh-token/u);
});

test('Hermes Codex-OAuth preflight rejects missing or malformed OAuth state', () => {
  assert.equal(inspectHermesAuthJson('/tmp/auth.json', '').status, 'not_ready');
  assert.equal(inspectHermesAuthJson('/tmp/auth.json', '{}').status, 'not_ready');
  assert.equal(inspectHermesAuthJson('/tmp/auth.json', JSON.stringify({
    providers: { 'openai-codex': { auth_mode: 'chatgpt', tokens: { access_token: 'access-only' }, last_refresh: '2026-10-22T16:00:00Z' } },
  })).status, 'not_ready');
  assert.equal(inspectHermesAuthJson('/tmp/auth.json', JSON.stringify({
    providers: { 'openai-codex': { auth_mode: 'api_key', tokens: { access_token: 'access', refresh_token: 'refresh' }, last_refresh: '2026-10-22T16:00:00Z' } },
  })).status, 'not_ready');
  assert.equal(inspectHermesAuthJson('/tmp/auth.json', JSON.stringify({
    providers: { 'openai-codex': { auth_mode: 'chatgpt', tokens: { access_token: 'access', refresh_token: 'refresh' }, last_refresh: 'not-a-date' } },
  })).status, 'not_ready');
});

test('task verifier preflight never exposes credentials and classifies invalid configuration', () => {
  const missing = inspectFeedbackVerifierConfiguration({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'model' });
  assert.equal(missing.status, 'missing_configuration');
  const invalid = inspectFeedbackVerifierConfiguration({ apiKey: '${OPENAI_API_KEY}', baseUrl: 'not-a-url', model: 'model' });
  assert.equal(invalid.status, 'invalid_configuration');
  assert.doesNotMatch(JSON.stringify(invalid), /OPENAI_API_KEY/u);
});

test('task verifier HTTP probe rejects authentication without treating it as a successful result', () => {
  const identity = 'https://api.openai.com/v1#model=eval-model';
  assert.equal(classifyFeedbackVerifierHttpStatus(401, identity).status, 'authentication_rejected');
  assert.equal(classifyFeedbackVerifierHttpStatus(503, identity).status, 'unavailable');
  assert.equal(classifyFeedbackVerifierHttpStatus(200, identity).status, 'ready');
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

test('feedback jobs use Hermes openai-codex OAuth and native ContextEngine registration', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  const jobs = await readFile('scripts/prepare-harbor-feedback-jobs.ts', 'utf8');
  const adapter = await readFile('scripts/harbor_hermes_codex_oauth.py', 'utf8');
  const wrapper = await readFile('scripts/harbor-ace-context-bridge.sh', 'utf8');
  const contextPlugin = await readFile('integrations/hermes/ace_context_engine/__init__.py', 'utf8');
  assert.doesNotMatch(jobs, /OPENAI_API_KEY|OPENROUTER_API_KEY/u);
  assert.match(jobs, /feedbackHermesAgentImportPath/u);
  assert.match(jobs, /feedbackHermesVersion/u);
  assert.match(jobs, /ace_context_enabled/u);
  assert.match(jobs, /feedbackAceContextBridgeCommand/u);
  assert.match(adapter, /--provider openai-codex/u);
  assert.match(adapter, /context.*ace_context_engine/u);
  assert.match(adapter, /get_version_command/u);
  assert.match(adapter, /hermes --version/u);
  assert.match(adapter, /hermes pm repair/u);
  assert.doesNotMatch(adapter, /hermes version/u);
  assert.doesNotMatch(adapter, /curl -fsSL.*install\.sh/u);
  assert.doesNotMatch(adapter, /ensure_system_dependencies/u);
  assert.match(adapter, /ACE_CONTEXT_BRIDGE_COMMAND/u);
  assert.match(adapter, /ACE_WORKSPACE_ROOT.*\/workspace/u);
  assert.match(adapter, /ACE_ALLOWED_ROOTS.*\/workspace/u);
  assert.match(adapter, /config\["plugins"\]/u);
  assert.match(adapter, /model_config.*default/u);
  assert.match(adapter, /context_length.*128000/u);
  assert.match(contextPlugin, /def register_context_engine\(context\)/u);
  assert.match(adapter, /status=\$\?/u);
  assert.match(adapter, /exit "\$status"/u);
  assert.doesNotMatch(adapter, /hermes.*\|.*tee/u);
  assert.match(adapter, /HERMES_HOME/u);
  assert.match(adapter, /download_file\("\/tmp\/hermes\/auth\.json"/u);
  assert.doesNotMatch(adapter, /Path\.home\(\)\s*\/\s*["']\.codex["']|HERMES_CODEX_AUTH_JSON_PATH|\$HOME\/\.codex/u);
  assert.doesNotMatch(adapter, /OPENAI_API_KEY|OPENROUTER_API_KEY/u);
  assert.match(wrapper, /ACE_CONTEXT_BRIDGE_MODE="true"/u);
  assert.match(wrapper, /ACE_WORKSPACE_ROOT="\$\{ACE_WORKSPACE_ROOT:-\/app\}"/u);
  assert.doesNotMatch(wrapper, /pip install/u);
  assert.match(wrapper, /runtime\/python\/\$\{python_version\}\/site-packages/u);
  assert.doesNotMatch(preflight, /command\('codex'/u);
  assert.match(preflight, /hermesCodexAuth/u);
  assert.match(preflight, /agentRuntimeDigest/u);
});

test('exact-current preflight binds experiment identity to checkout, jobs, Harbor and auth route', () => {
  const module = feedbackPreflight as unknown as {
    readonly validateFeedbackPreflightBinding?: (input: {
      readonly currentSourceCommit: string;
      readonly actualHarborVersion: string;
      readonly expectedAuthenticationRoute: string;
      readonly jobAgent: 'hermes';
      readonly jobAgentVersion: string;
      readonly jobModel: string;
      readonly jobReasoningEffort: 'low' | 'medium' | 'high';
      readonly experiment: {
        readonly sourceCommit: string;
        readonly agent: 'hermes';
        readonly agentVersion: string;
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
    expectedAuthenticationRoute: hermesCodexAuthenticationRoute,
    jobAgent: 'hermes' as const,
    jobAgentVersion: 'v0.22.3',
    jobModel: 'openai-codex/gpt-5.6-luna',
    jobReasoningEffort: 'high' as const,
    experiment: {
      sourceCommit: 'a'.repeat(40),
      agent: 'hermes' as const,
      agentVersion: 'v0.22.3',
      model: 'openai-codex/gpt-5.6-luna',
      reasoningEffort: 'high' as const,
      harborVersion: 'harbor 0.24.0',
      authenticationRoute: hermesCodexAuthenticationRoute,
    },
  };
  assert.deepEqual(module.validateFeedbackPreflightBinding(base), []);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, sourceCommit: 'b'.repeat(40) },
  }), ['sourceCommit']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, agentVersion: 'v0.0.0' },
  }), ['agentVersion']);
  assert.deepEqual(module.validateFeedbackPreflightBinding({
    ...base,
    experiment: { ...base.experiment, model: 'openai-codex/different-model' },
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


test('OAuth preflight inspects the dedicated Hermes auth store, not Codex CLI state', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  assert.doesNotMatch(preflight, /CODEX_HOME|\.codex.*auth\.json/u);
  assert.match(preflight, /HERMES_AUTH_JSON_PATH/u);
  assert.match(preflight, /HERMES_HOME/u);
  assert.match(preflight, /\.hermes/u);
});


test('exact-current preflight requires a clean checkout, compiled runtime provenance and Hermes/MCP digests', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  assert.match(preflight, /status', '--porcelain=v1'/u);
  assert.match(preflight, /verifyCompiledRuntimeProvenance/u);
  assert.match(preflight, /agentAdapterSha256/u);
  assert.match(preflight, /aceContextBridgeSha256/u);
  assert.match(preflight, /dist\/bin\/ace-context-bridge\.js/u);
  assert.match(preflight, /contextPluginSha256/u);
  assert.match(preflight, /taskVerifier/u);
  assert.match(preflight, /local-task-verifier/u);
  assert.match(preflight, /AbortSignal\.timeout\(5_000\)/u);
});
