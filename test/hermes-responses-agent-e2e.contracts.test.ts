import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import * as feedbackPreflight from '../src/domain/feedback-preflight.js';

const routeContract = feedbackPreflight as unknown as {
  readonly inspectHermesBifrostEndpoint?: (input: {
    readonly endpoint?: string;
    readonly endpointSha256?: string;
    readonly expectedSha256?: string;
    readonly allowedHosts?: readonly string[];
  }) => { readonly status: string; readonly reason: string; readonly identity?: string };
};

// eslint-disable-next-line import/extensions -- NodeNext pairs the .mjs runtime with .d.mts types.
const evidenceModule = await import('../scripts/real-provider-evidence.mjs') as unknown as {
  readonly summarizeHermesSessionExport?: (bytes: Uint8Array) => Readonly<Record<string, unknown>>;
  readonly evaluateHermesAgentLoopEvidence?: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const sessionExport = (overrides: Record<string, unknown> = {}): string => `${JSON.stringify({
  id: 'private-session-id',
  source: 'cli',
  model: 'openai-codex/test-model',
  messages: [
    { role: 'user', content: 'private prompt text' },
    { role: 'assistant', content: 'reasoning summary', reasoning: 'private reasoning' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"private.ts"}' } }] },
    { role: 'tool', tool_name: 'read_file', tool_call_id: 'call-1', content: 'private source bytes' },
    { role: 'assistant', content: 'completed task' },
  ],
  ...overrides,
})}\n`;

const signedProviderEnvelope = (requestId: string, sourceCommit: string) => {
  const attemptId = 'bf-attempt-' + 'b'.repeat(32);
  const payload = {
    schemaVersion: 1,
    evidenceKind: 'real_provider',
    sourceCommit,
    bifrostCommit: 'c'.repeat(40),
    aceRuntimeSha256: '1'.repeat(64),
    bifrostPluginSha256: '2'.repeat(64),
    pluginOrderSha256: '3'.repeat(64),
    requestId,
    attemptId,
    protocol: 'openai.responses',
    provider: 'openai',
    model: 'test-model',
    dataClass: 'public',
    destinationSha256: '4'.repeat(64),
    ingressBodySha256: '5'.repeat(64),
    preparedBodySha256: '6'.repeat(64),
    preparedBodySemanticSha256: '6'.repeat(64),
    finalWireBodySha256: '6'.repeat(64),
    finalWireBodySemanticSha256: '6'.repeat(64),
    serializedRequestSha256: '7'.repeat(64),
    capturePoint: 'contextTransport-before-tls-write',
    physicalSendAuthorized: true,
    pluginOrderVerified: true,
    storeFalseVerified: true,
    nonStreamingVerified: true,
    protectedItemsVerified: true,
    providerAcknowledgement: {
      kind: 'real_provider',
      statusCode: 200,
      requestId,
      attemptId,
      providerRequestId: 'provider-response-id',
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    envelope: {
      schemaVersion: 1,
      payloadBase64: payloadBytes.toString('base64'),
      signatureBase64: sign(null, payloadBytes, privateKey).toString('base64'),
    },
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
};

test('Harbor Hermes adapter requires a pinned Bifrost endpoint instead of direct provider routing', async () => {
  const adapter = await readFile('scripts/harbor_hermes_codex_oauth.py', 'utf8');
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  const readiness = await readFile('docs/operations/ace-configuration-and-readiness-matrix.md', 'utf8');
  assert.match(adapter, /HERMES_CODEX_BASE_URL/u);
  assert.match(adapter, /bifrost_endpoint_sha256/u);
  assert.match(adapter, /_validate_bifrost_endpoint/u);
  assert.match(preflight, /bifrostEndpoint/u);
  assert.match(preflight, /providerTokenWindow/u);
  assert.match(readiness, /agent-loop-evidence\.json/u);
  assert.match(readiness, /full real C07 Hermes\/Harbor trials and C08 release acceptance remain NOT_RUN/u);
  assert.match(readiness, /Real C03–C05 public synthetic subscriber probes are owner-authorized/u);
});

test('Harbor adapter endpoint guard executes locally without contacting a provider', () => {
  const script = String.raw`
import hashlib
import importlib.util
import sys
import types
import typing

typing.override = lambda function: function

# This is an offline import/endpoint-guard test: stub only optional Harbor
# adapter dependencies so the PR-focused Node CI needs no Python packages.
yaml = types.ModuleType("yaml")
sys.modules["yaml"] = yaml
pydantic = types.ModuleType("pydantic")
pydantic.Field = lambda default=None, **kwargs: default
sys.modules["pydantic"] = pydantic

for name in (
    "harbor", "harbor.agents", "harbor.agents.installed", "harbor.environments",
    "harbor.models", "harbor.models.agent",
):
    package = types.ModuleType(name)
    package.__path__ = []
    sys.modules[name] = package

class HermesOptions:
    pass

install_state = {"installed": False, "version_probes": 0, "upstream_install": 0}
class Hermes:
    @classmethod
    def preflight(cls, kwargs=None, env=None):
        return None

    def __init__(self, *args, **kwargs):
        pass

    async def install(self, environment):
        install_state["upstream_install"] += 1
        install_state["installed"] = True
        # Harbor 0.24.0 has installed the CLI, but its final
        # invalid Hermes version subcommand fails despite a valid --version.
        raise base.NonZeroAgentExitCodeError("unsupported version subcommand")

    async def exec_as_agent(self, environment, command, timeout_sec=None):
        assert "hermes pm repair" not in command
        assert "hermes --version" in command
        install_state["version_probes"] += 1
        if not install_state["installed"]:
            raise base.NonZeroAgentExitCodeError("Hermes not installed yet")
        return None

base = types.ModuleType("harbor.agents.installed.base")
base.NonZeroAgentExitCodeError = type("NonZeroAgentExitCodeError", (Exception,), {})
base.with_prompt_template = lambda function: function
sys.modules[base.__name__] = base

hermes = types.ModuleType("harbor.agents.installed.hermes")
hermes.Hermes = Hermes
hermes.HermesOptions = HermesOptions
sys.modules[hermes.__name__] = hermes

environment = types.ModuleType("harbor.environments.base")
environment.BaseEnvironment = type("BaseEnvironment", (), {})
sys.modules[environment.__name__] = environment

context = types.ModuleType("harbor.models.agent.context")
context.AgentContext = type("AgentContext", (), {})
sys.modules[context.__name__] = context

spec = importlib.util.spec_from_file_location("c07_harbor_adapter", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
validate = module.HermesCodexOAuth._validate_bifrost_endpoint
endpoint = "http://127.0.0.1:8080/chatgpt_passthrough"
pin = hashlib.sha256(endpoint.encode()).hexdigest()
assert validate(endpoint, pin) == endpoint
for bad_endpoint, bad_pin in (
    ("https://chatgpt.com/backend-api/codex", hashlib.sha256(b"https://chatgpt.com/backend-api/codex").hexdigest()),
    ("https://api.anthropic.com/v1", hashlib.sha256(b"https://api.anthropic.com/v1").hexdigest()),
    (endpoint, "f" * 64),
    ("http://127.0.0.1:8080/v1", hashlib.sha256(b"http://127.0.0.1:8080/v1").hexdigest()),
    (None, pin),
):
    try:
        validate(bad_endpoint, bad_pin)
    except ValueError:
        continue
    raise AssertionError("invalid or direct provider endpoint was accepted")
trailing_dot_endpoint = "https://api.openai.com./v1"
try:
    validate(trailing_dot_endpoint, hashlib.sha256(trailing_dot_endpoint.encode()).hexdigest(), "api.openai.com.")
except ValueError:
    pass
else:
    raise AssertionError("a trailing-dot direct provider host bypassed the denylist")

# Probe the actual subclass's install implementation without invoking
# the network or relying on a globally installed Harbor package.
import asyncio
agent = module.HermesCodexOAuth()
asyncio.run(agent.install(None))
assert install_state["upstream_install"] == 1
assert install_state["version_probes"] == 2
`;
  const run = spawnSync('python3', ['-c', script, 'scripts/harbor_hermes_codex_oauth.py'], {
    cwd: resolve('.'),
    env: { PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('Hermes Bifrost endpoint contract rejects direct provider URLs and endpoint drift', () => {
  assert.equal(typeof routeContract.inspectHermesBifrostEndpoint, 'function');
  if (routeContract.inspectHermesBifrostEndpoint === undefined) return;
  const bifrostEndpoint = 'http://127.0.0.1:8080/chatgpt_passthrough';
  const endpointSha256 = sha256(bifrostEndpoint);
  const acceptedIdentity = routeContract.inspectHermesBifrostEndpoint({
    endpoint: `${bifrostEndpoint}/`,
    endpointSha256,
    expectedSha256: endpointSha256,
  });
  assert.equal(acceptedIdentity.status, 'ready');
  const wrongRoute = 'http://127.0.0.1:8080/v1';
  const wrong = routeContract.inspectHermesBifrostEndpoint({
    endpoint: wrongRoute,
    endpointSha256: sha256(wrongRoute),
    expectedSha256: sha256(wrongRoute),
  });
  assert.notEqual(wrong.status, 'ready', 'a pinned local /v1 is not the Codex subscriber route');
  const wrongDigest = routeContract.inspectHermesBifrostEndpoint({
    endpoint: bifrostEndpoint,
    endpointSha256: 'd'.repeat(64),
    expectedSha256: 'd'.repeat(64),
  });
  assert.notEqual(wrongDigest.status, 'ready', 'the endpoint digest must hash the URL itself');

  assert.equal(acceptedIdentity.identity, endpointSha256);
  assert.doesNotMatch(JSON.stringify(acceptedIdentity), /127\.0\.0\.1/u);

  const directProvider = 'https://chatgpt.com/backend-api/codex';
  const direct = routeContract.inspectHermesBifrostEndpoint({
    endpoint: directProvider,
    endpointSha256: sha256(directProvider),
    expectedSha256: sha256(directProvider),
  });
  assert.notEqual(direct.status, 'ready');
  const trailingDotProvider = 'https://api.openai.com./v1';
  const trailingDot = routeContract.inspectHermesBifrostEndpoint({
    endpoint: trailingDotProvider,
    endpointSha256: sha256(trailingDotProvider),
    expectedSha256: sha256(trailingDotProvider),
    allowedHosts: ['api.openai.com.'],
  });
  assert.notEqual(trailingDot.status, 'ready', 'direct provider hosts remain prohibited even if explicitly allowlisted');
  const arbitraryProvider = 'https://api.anthropic.com/v1';
  const fakeGateway = routeContract.inspectHermesBifrostEndpoint({
    endpoint: arbitraryProvider,
    endpointSha256: sha256(arbitraryProvider),
    expectedSha256: sha256(arbitraryProvider),
  });
  assert.notEqual(fakeGateway.status, 'ready',
    'a self-pinned arbitrary provider URL does not prove a Bifröst Gateway');
  const explicitlyApproved = routeContract.inspectHermesBifrostEndpoint({
    endpoint: 'https://gateway.private.example/chatgpt_passthrough',
    endpointSha256: sha256('https://gateway.private.example/chatgpt_passthrough'),
    expectedSha256: sha256('https://gateway.private.example/chatgpt_passthrough'),
    allowedHosts: ['gateway.private.example'],
  });
  assert.equal(explicitlyApproved.status, 'ready');

  const drifted = routeContract.inspectHermesBifrostEndpoint({
    endpoint: bifrostEndpoint,
    endpointSha256,
    expectedSha256: 'f'.repeat(64),
  });
  assert.notEqual(drifted.status, 'ready');
});

test('Hermes session export summary redacts transcript content and correlates tool IDs', () => {
  assert.equal(typeof evidenceModule.summarizeHermesSessionExport, 'function');
  if (evidenceModule.summarizeHermesSessionExport === undefined) return;
  const summary = evidenceModule.summarizeHermesSessionExport(Buffer.from(sessionExport(), 'utf8'));
  const serialized = JSON.stringify(summary);
  assert.equal(summary.toolLoopStatus, 'complete');
  assert.equal(summary.hostTranscriptAttested, false);
  assert.doesNotMatch(serialized, /private-session-id|private prompt text|private reasoning|private\.ts|private source bytes/u);
  assert.match(String(summary.sessionIdSha256), /^[a-f0-9]{64}$/u);
  assert.match(String(summary.rawTraceSha256), /^[a-f0-9]{64}$/u);
});

test('unmatched tool results and hidden provider continuations cannot satisfy the agent-loop contract', () => {
  assert.equal(typeof evidenceModule.summarizeHermesSessionExport, 'function');
  assert.equal(typeof evidenceModule.evaluateHermesAgentLoopEvidence, 'function');
  if (evidenceModule.summarizeHermesSessionExport === undefined
    || evidenceModule.evaluateHermesAgentLoopEvidence === undefined) return;

  const unmatchedSummary = evidenceModule.summarizeHermesSessionExport(Buffer.from(sessionExport({
    messages: [
      { role: 'user', content: 'prompt' },
      { role: 'assistant', content: 'turn one' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_name: 'read_file', tool_call_id: 'call-other', content: 'result' },
    ],
  }), 'utf8'));
  const unmatched = evidenceModule.evaluateHermesAgentLoopEvidence({
    sessionSummary: unmatchedSummary,
    gatewayRequests: [],
    signatureCheckedFinalWireReceipts: [],
    taskOutcome: 'unknown',
  });
  assert.equal(unmatched.status, 'BLOCKED');

  const hiddenSummary = evidenceModule.summarizeHermesSessionExport(Buffer.from(sessionExport({
    previous_response_id: 'hidden-provider-state',
  }), 'utf8'));
  const hidden = evidenceModule.evaluateHermesAgentLoopEvidence({
    sessionSummary: hiddenSummary,
    gatewayRequests: [],
    signatureCheckedFinalWireReceipts: [],
    taskOutcome: 'unknown',
  });
  assert.equal(hidden.status, 'BLOCKED');
});

test('deeply nested or array-nested hidden provider state fails closed', () => {
  let nested: Record<string, unknown> = { previous_response_id: 'hidden-provider-state' };
  for (let index = 0; index < 13; index += 1) nested = { nested };
  const summaries = [
    evidenceModule.summarizeHermesSessionExport?.(Buffer.from(sessionExport({ metadata: nested }), 'utf8')),
    evidenceModule.summarizeHermesSessionExport?.(Buffer.from(sessionExport({
      metadata: [{ previous_response_id: 'hidden-provider-state' }],
    }), 'utf8')),
  ];
  for (const summary of summaries) {
    assert.ok(summary);
    assert.equal(summary.hiddenProviderState, 'present');
    const result = evidenceModule.evaluateHermesAgentLoopEvidence?.({
      sessionSummary: summary,
      gatewayRequests: [],
      signatureCheckedFinalWireReceipts: [],
      taskOutcome: 'unknown',
    });
    assert.equal(result?.status, 'BLOCKED');
  }
});

test('missing or mock-only final-wire links remain NOT_RUN/BLOCKED, never accepted', () => {
  assert.equal(typeof evidenceModule.summarizeHermesSessionExport, 'function');
  assert.equal(typeof evidenceModule.evaluateHermesAgentLoopEvidence, 'function');
  if (evidenceModule.summarizeHermesSessionExport === undefined
    || evidenceModule.evaluateHermesAgentLoopEvidence === undefined) return;
  const summary = evidenceModule.summarizeHermesSessionExport(Buffer.from(sessionExport(), 'utf8'));
  const missing = evidenceModule.evaluateHermesAgentLoopEvidence({
    sessionSummary: summary,
    gatewayRequests: [{ kind: 'PREPARED', requestId: 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentSessionId: 'private-session-id' }],
    signatureCheckedFinalWireReceipts: [],
    taskOutcome: 'pass',
  });
  assert.equal(missing.status, 'NOT_RUN');

  const mockOnly = evidenceModule.evaluateHermesAgentLoopEvidence({
    sessionSummary: summary,
    gatewayRequests: [{ kind: 'PREPARED', requestId: 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentSessionId: 'private-session-id' }],
    signatureCheckedFinalWireReceipts: [{
      status: 'MOCK_WIRE_VERIFIED',
      requestId: 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      attemptId: 'bf-attempt-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerAcknowledgement: { kind: 'mock', statusCode: 200, providerRequestId: 'mock-response' },
    }],
    taskOutcome: 'pass',
  });
  assert.equal(mockOnly.status, 'BLOCKED');
});

test('even correlated provider receipt candidates cannot be promoted to real-agent acceptance', () => {
  assert.equal(typeof evidenceModule.summarizeHermesSessionExport, 'function');
  assert.equal(typeof evidenceModule.evaluateHermesAgentLoopEvidence, 'function');
  if (evidenceModule.summarizeHermesSessionExport === undefined
    || evidenceModule.evaluateHermesAgentLoopEvidence === undefined) return;
  const summary = evidenceModule.summarizeHermesSessionExport(Buffer.from(sessionExport(), 'utf8'));
  const requestId = 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = evidenceModule.evaluateHermesAgentLoopEvidence({
    sessionSummary: summary,
    gatewayRequests: [{ kind: 'PREPARED', requestId, agentSessionId: 'private-session-id' }],
    signatureCheckedFinalWireReceipts: [{
      status: 'REAL_PROVIDER_CANDIDATE',
      requestId,
      attemptId: 'bf-attempt-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      providerAcknowledgement: { kind: 'real_provider', statusCode: 200, providerRequestId: 'provider-response' },
    }],
    taskOutcome: 'pass',
  });
  assert.equal(result.status, 'CANDIDATE');
  assert.equal(result.hostTranscriptAttested, false);
  const reasonCodes = result.reasonCodes as readonly string[];
  assert.ok(Array.isArray(reasonCodes));
  assert.ok(reasonCodes.includes('SESSION_EXPORT_NOT_INDEPENDENTLY_ATTESTED'));
  assert.ok(reasonCodes.includes('REAL_PROVIDER_RECEIPTS_REMAIN_CANDIDATES'));
  assert.ok(reasonCodes.includes('TASK_OUTCOME_NOT_INDEPENDENTLY_CHECKED'));
});

test('feedback collector signature-checks final-wire bytes but leaves missing Hermes session correlation NOT_RUN', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-c07-collector-'));
  const nativeRoot = join(root, 'native');
  const aceRoot = join(root, 'ace');
  const outputRoot = join(root, 'collected');
  const taskManifestPath = join(root, 'task-manifest.json');
  const experimentManifestPath = join(root, 'experiment-manifest.json');
  let repositoryArtifactRoot: string | undefined;
  try {
    const sourceRevision = 'a'.repeat(40);
    const taskManifest = {
      schemaVersion: 1,
      selection: 'smoke',
      dataset: { id: 'local/ace-suite', revision: sourceRevision, rawSha256: 'b'.repeat(64) },
      tasks: [{ id: 'task-1', sourceRevision, sourceDigest: 'c'.repeat(64), taskDigest: 'd'.repeat(64) }],
      holdout: [],
    };
    const taskBytes = `${JSON.stringify(taskManifest, null, 2)}\n`;
    await writeFile(taskManifestPath, taskBytes);
    const experiment = {
      schemaVersion: 1,
      runId: 'c07-local-fixture',
      sourceCommit: sourceRevision,
      taskManifestSha256: sha256(taskBytes),
      agent: 'hermes',
      agentVersion: 'v0.22.3',
      model: 'openai-codex/test-model',
      reasoningEffort: 'high',
      bifrostEndpointSha256: 'e'.repeat(64),
      harborVersion: 'harbor-local-fixture',
      taskImages: [{ reference: 'task/local-fixture', digest: `sha256:${'f'.repeat(64)}` }],
      agentAdapterSha256: '1'.repeat(64),
      aceContextBridgeSha256: '2'.repeat(64),
      contextPluginSha256: '3'.repeat(64),
      seed: 'unknown',
      mode: 'cold',
      nConcurrentTrials: 1,
      nAttempts: 1,
      authenticationRoute: 'Hermes Codex OAuth; credentials not retained',
    };
    await writeFile(experimentManifestPath, `${JSON.stringify(experiment, null, 2)}\n`);
    const gatewayRequestId = 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const signedFinalWire = signedProviderEnvelope(gatewayRequestId, sourceRevision);
    const verificationPublicKeyPath = join(root, 'final-wire-public.pem');
    await writeFile(verificationPublicKeyPath, signedFinalWire.publicKeyPem);

    const writeTrial = async (trialRoot: string, trialName: string, trialId: string, arm: 'native' | 'ace') => {
      const trial = join(trialRoot, trialName);
      await mkdir(join(trial, 'agent'), { recursive: true });
      await writeFile(join(trial, 'result.json'), JSON.stringify({
        trial_id: trialId,
        task_name: 'task-1',
        started_at: '2026-11-20T00:00:00Z',
        finished_at: '2026-11-20T00:00:01Z',
        verifier_result: { rewards: { reward: 1 } },
        exception_info: null,
        agent_result: { n_input_tokens: 100, n_output_tokens: 20, n_cache_tokens: 0 },
      }));
      if (arm === 'ace') {
        await writeFile(join(trial, 'agent', 'ace-responses-projection.jsonl'), `${JSON.stringify({
          schemaVersion: 'ace.context.v3',
          requestId: gatewayRequestId,
          kind: 'PREPARED',
          baseBodySha256: 'a'.repeat(64),
          projectedBodySha256: 'b'.repeat(64),
          bodyBase64: 'e30=',
          reasonCode: 'VERIFIED_CONTEXT_ADDED',
        })}\n`);
        await writeFile(join(trial, 'agent', 'ace-final-wire-evidence.jsonl'), `${JSON.stringify(signedFinalWire.envelope)}\n`);
        await writeFile(join(trial, 'agent', 'hermes-session.jsonl'), sessionExport());
        await writeFile(join(trial, 'agent', 'hermes.txt'), 'private transcript log');
      }
    };

    await mkdir(nativeRoot);
    await mkdir(aceRoot);
    await writeTrial(nativeRoot, 'native-trial-1', 'native-1', 'native');
    await writeTrial(aceRoot, 'ace-trial-1', 'ace-1', 'ace');
    await writeFile(join(nativeRoot, 'aggregate.json'), JSON.stringify({ n_total_trials: 1 }));
    await writeFile(join(aceRoot, 'aggregate.json'), JSON.stringify({ n_total_trials: 1 }));

    const run = spawnSync(resolve('node_modules/.bin/tsx'), [
      '--no-cache',
      'scripts/collect-feedback-loop.ts',
      taskManifestPath,
      experimentManifestPath,
      join(nativeRoot, 'aggregate.json'),
      join(aceRoot, 'aggregate.json'),
      outputRoot,
      '--final-wire-public-key',
      verificationPublicKeyPath,
    ], { cwd: resolve('.'), encoding: 'utf8', timeout: 120_000 });
    assert.equal(run.status, 0, run.stderr + run.stdout);

    const evidenceBytes = await readFile(join(outputRoot, 'agent-loop-evidence.json'));
    const evidence = JSON.parse(evidenceBytes.toString('utf8')) as {
      readonly status: string;
      readonly trials: readonly { readonly evidence: {
        readonly status: string;
        readonly rawTraceSha256?: string;
        readonly reasonCodes?: readonly string[];
        readonly gatewayRequestCount?: number;
        readonly finalWireEnvelopeCount?: number;
        readonly finalWireVerificationKeyProvided?: boolean;
        readonly signatureCheckedFinalWireReceiptIndex?: readonly {
          readonly requestId: string;
          readonly attemptId: string;
          readonly status: string;
          readonly sourceCommit: string;
          readonly providerRequestIdSha256: string;
        }[];
      } }[];
    };
    assert.equal(evidence.status, 'NOT_RUN', evidenceBytes.toString('utf8'));
    assert.equal(evidence.trials[0]?.evidence.status, 'NOT_RUN');
    assert.match(evidence.trials[0]?.evidence.rawTraceSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.ok(evidence.trials[0]?.evidence.reasonCodes?.includes('SESSION_CORRELATION_NOT_OBSERVED'));
    assert.equal(evidence.trials[0]?.evidence.gatewayRequestCount, 1);
    assert.equal(evidence.trials[0]?.evidence.finalWireEnvelopeCount, 1);
    assert.equal(evidence.trials[0]?.evidence.finalWireVerificationKeyProvided, true);
    assert.equal(evidence.trials[0]?.evidence.signatureCheckedFinalWireReceiptIndex?.[0]?.requestId, gatewayRequestId);
    assert.equal(evidence.trials[0]?.evidence.signatureCheckedFinalWireReceiptIndex?.[0]?.status, 'REAL_PROVIDER_CANDIDATE');
    assert.equal(evidence.trials[0]?.evidence.signatureCheckedFinalWireReceiptIndex?.[0]?.sourceCommit, sourceRevision);
    assert.match(evidence.trials[0]?.evidence.signatureCheckedFinalWireReceiptIndex?.[0]?.providerRequestIdSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(evidenceBytes.toString('utf8'), /private-session-id|private prompt text|private transcript log/u);
    const metrics = JSON.parse(await readFile(join(outputRoot, 'metrics.json'), 'utf8')) as {
      readonly status: string;
      readonly tokenRatio: number | null;
      readonly rows: readonly { readonly aceCalled: boolean | null; readonly aceCorrelation: string }[];
    };
    assert.equal(metrics.status, 'UNKNOWN');
    assert.equal(metrics.tokenRatio, null);
    assert.equal(metrics.rows[0]?.aceCalled, true);
    assert.equal(metrics.rows[0]?.aceCorrelation, 'UNKNOWN');

    const copiedAgentDirectory = join(outputRoot, 'raw-agent-ace', Buffer.from('task-1').toString('base64url'), 'agent');
    await assert.rejects(readFile(join(copiedAgentDirectory, 'hermes-session.jsonl')));
    await assert.rejects(readFile(join(copiedAgentDirectory, 'hermes.txt')));
    await assert.rejects(readFile(join(copiedAgentDirectory, 'ace-responses-projection.jsonl')));
    await assert.rejects(readFile(join(copiedAgentDirectory, 'ace-final-wire-evidence.jsonl')));

    repositoryArtifactRoot = await mkdtemp(join(resolve('node_modules'), '.c07-repo-artifacts-'));
    await writeTrial(repositoryArtifactRoot, 'ace-trial-1', 'ace-symlink-1', 'ace');
    await writeFile(join(repositoryArtifactRoot, 'aggregate.json'), JSON.stringify({ n_total_trials: 1 }));
    const externalAlias = join(root, 'ace-repo-alias');
    await symlink(repositoryArtifactRoot, externalAlias, 'dir');
    const symlinkOutputRoot = join(root, 'collected-symlink');
    const symlinkRun = spawnSync(resolve('node_modules/.bin/tsx'), [
      '--no-cache',
      'scripts/collect-feedback-loop.ts',
      taskManifestPath,
      experimentManifestPath,
      join(nativeRoot, 'aggregate.json'),
      join(externalAlias, 'aggregate.json'),
      symlinkOutputRoot,
      '--final-wire-public-key',
      verificationPublicKeyPath,
    ], { cwd: resolve('.'), encoding: 'utf8', timeout: 120_000 });
    assert.equal(symlinkRun.status, 0, symlinkRun.stderr + symlinkRun.stdout);
    const symlinkEvidence = JSON.parse(await readFile(join(symlinkOutputRoot, 'agent-loop-evidence.json'), 'utf8')) as {
      readonly status: string;
      readonly trials: readonly { readonly evidence: { readonly status: string; readonly reasonCodes?: readonly string[] } }[];
    };
    assert.equal(symlinkEvidence.status, 'BLOCKED');
    assert.equal(symlinkEvidence.trials[0]?.evidence.status, 'BLOCKED');
    assert.ok(symlinkEvidence.trials[0]?.evidence.reasonCodes?.includes('RAW_HERMES_TRACE_MUST_REMAIN_OUTSIDE_REPOSITORY'));
  } finally {
    await rm(root, { recursive: true, force: true });
    if (repositoryArtifactRoot !== undefined) await rm(repositoryArtifactRoot, { recursive: true, force: true });
  }
});

test('C07 a partly bound set of Gateway requests cannot claim same-session correlation', () => {
  const summary = evidenceModule.summarizeHermesSessionExport?.(Buffer.from(sessionExport(), 'utf8'));
  assert.ok(summary);
  const result = evidenceModule.evaluateHermesAgentLoopEvidence?.({
    sessionSummary: summary,
    gatewayRequests: [
      { kind: 'PREPARED', requestId: 'ace-' + 'a'.repeat(32), agentSessionId: 'private-session-id' },
      { kind: 'PREPARED', requestId: 'ace-' + 'b'.repeat(32) },
    ],
    signatureCheckedFinalWireReceipts: [],
    taskOutcome: 'pass',
  });
  assert.equal(result?.status, 'NOT_RUN', 'every prepared request needs its own same-session binding');
  assert.ok((result?.reasonCodes as readonly string[]).includes('SESSION_CORRELATION_NOT_OBSERVED'));
});

test('C07 tool-call IDs only prove a completed loop when results follow calls and the final assistant follows results', () => {
  const summary = (messages: readonly Record<string, unknown>[]) =>
    evidenceModule.summarizeHermesSessionExport?.(Buffer.from(sessionExport({ messages }), 'utf8'));
  const resultFirst = summary([
    { role: 'user', content: 'prompt' },
    { role: 'tool', tool_call_id: 'call-1', content: 'early result' },
    { role: 'assistant', tool_calls: [{ id: 'call-1' }] },
    { role: 'assistant', content: 'answer' },
  ]);
  assert.equal(resultFirst?.toolLoopStatus, 'incomplete');
  const assistantBeforeResult = summary([
    { role: 'user', content: 'prompt' },
    { role: 'assistant', tool_calls: [{ id: 'call-1' }] },
    { role: 'assistant', content: 'premature final answer' },
    { role: 'tool', tool_call_id: 'call-1', content: 'delayed result' },
  ]);
  assert.equal(assistantBeforeResult?.toolLoopStatus, 'incomplete');
  const ordered = summary([
    { role: 'user', content: 'prompt' },
    { role: 'assistant', tool_calls: [{ id: 'call-1' }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'result' },
    { role: 'assistant', content: 'final answer' },
  ]);
  assert.equal(ordered?.toolLoopStatus, 'complete');
  const extraUnlinkedResult = summary([
    { role: 'user', content: 'prompt' },
    { role: 'assistant', tool_calls: [{ id: 'call-1' }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'result' },
    { role: 'assistant', content: 'final answer' },
    { role: 'tool', tool_call_id: 'orphan-call', content: 'unlinked result' },
  ]);
  assert.equal(extraUnlinkedResult?.toolLoopStatus, 'incomplete');
});
