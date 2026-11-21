#!/usr/bin/env node
// Real ACE projection -> Core -> Qdrant/embedding/LSP E2E.
// This deliberately does NOT traverse Bifröst or an LLM provider wire. It proves
// real retrieval/projection behavior only; G11 provider-wire acceptance is separate.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnRealProviderProcess, stopRealProviderProcess } from './real-provider-process.mjs';
import { resolveRealProviderRuntime } from './real-provider-runtime.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const port = async () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address !== 'object' || address === null) { server.close(); reject(new Error('no local port')); return; }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const runtime = await resolveRealProviderRuntime(import.meta.dirname);
const directory = await mkdtemp(join(tmpdir(), 'ace-gateway-real-projection-'));
const workspace = join(directory, 'workspace');
await mkdir(workspace);
const workspaceId = randomUUID();
const code = [
  'export function retryAfterTransientFailure(input: string) {',
  '  let attempt = 0;',
  '  while (attempt < 3) {',
  '    const value = input.trim();',
  '    if (value.length) return value;',
  '    attempt += 1;',
  '  }',
  "  throw new Error('retry failed');",
  '}',
].join('\n') + '\n';
const filler = Array.from({ length: 1991 }, (_, i) => 'export const filler_' + i + ' = ' + i + ';').join('\n');
const codePath = join(workspace, 'service.ts');
await writeFile(codePath, code + filler + '\n');
const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
const outage = process.env.ACE_REAL_PROJECTION_OUTAGE === 'true' || process.env.ACE_REAL_PROJECTION_HARD_OUTAGE === 'true';
const race = process.env.ACE_REAL_PROJECTION_RACE === 'true';
const maxWait = Number(process.env.ACE_REAL_PROJECTION_TIMEOUT_MS || '180000');
assert.ok(Number.isSafeInteger(maxWait) && maxWait >= 10000 && maxWait <= 600000);
const gatewayPort = await port();
const child = spawnRealProviderProcess(process.execPath, [runtime.executable], {
  cwd: runtime.runtimeRoot,
  env: {
    ...process.env,
    ACE_RUNTIME_ROOT: runtime.runtimeRoot,
    ACE_WORKSPACE_ROOT: workspace,
    ACE_ALLOWED_ROOTS: directory,
    ACE_STATE_DIR: join(directory, 'state'),
    ACE_ARTIFACT_DIR: join(directory, 'artifacts'),
    ACE_WORKSPACE_ID: workspaceId,
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_ENABLE_GRAPHITI: 'false',
    ACE_RETRIEVAL_STRATEGY: process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'dense',
    ACE_QDRANT_URL: outage ? 'http://127.0.0.1:6339' : qdrantUrl,
    ACE_EMBEDDING_WORKER: process.env.ACE_EMBEDDING_WORKER ?? runtime.embeddingWorker,
    ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? runtime.astGrepCommand,
    ACE_CONTEXT_RPC_HOST: '127.0.0.1',
    ACE_CONTEXT_RPC_PORT: String(gatewayPort),
    ACE_CONTEXT_RPC_SHARED_SECRET: 'real-provider-fixture-secret',
    ACE_CONTEXT_EXTERNAL_LLM_OPT_IN: 'true',
    ACE_CONTEXT_ALLOWED_LLM_PROVIDERS_JSON: '["mock"]',
    ...(race ? { ACE_ENABLE_TEST_FAILPOINTS: 'true', ACE_EMBEDDING_DELAY_MS: '1000' } : {}),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let startupLog = '';
const endpoint = `http://127.0.0.1:${gatewayPort}/internal/ace-context/v3`;
const timeout = (ms) => AbortSignal.timeout(ms);
try {
  await new Promise((resolve, reject) => {
    let done = false;
    const settle = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => settle(new Error('Gateway startup timed out: ' + startupLog.slice(-3000))), maxWait);
    child.stderr.on('data', (chunk) => {
      startupLog += chunk.toString('utf8');
      if (startupLog.includes('ace-context-rpc listening')) settle();
    });
    child.once('exit', (code) => settle(new Error('Gateway exited before listening: ' + code + ': ' + startupLog.slice(-3000))));
    child.once('error', settle);
  });
  const health = await fetch(endpoint + '/health', {
    headers: { authorization: 'Bearer real-provider-fixture-secret' }, signal: timeout(10000),
  });
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.providerWire, 'not_certified');

  const body = {
    model: 'test-model', store: false,
    input: 'Find retryAfterTransientFailure and its definition.',
    extra_field: { preserve: true },
  };
  const bodyBytes = Buffer.from(JSON.stringify(body), 'utf8');
  const bodyBase64 = bodyBytes.toString('base64');
  const sessionId = 'real-projection-session';
  const payload = {
    schemaVersion: 'ace.context.v3', protocol: 'openai.responses', requestId: 'responses-projection-' + randomUUID(),
    attemptGroupId: 'turn-1', agentSessionId: sessionId, workspaceId,
    dataClass: 'private', provider: 'mock', model: 'test-model',
    bodyBase64, bodySha256: digest(bodyBytes),
    query: 'Find retryAfterTransientFailure and its definition.',
    projectionMode: 'bifrost_hook', deadlineEpochMs: Date.now() + maxWait,
    attestation: {
      hostBuildDigest: digest('host'), sessionId, activeEngineId: 'bifrost-visible-request-only',
      effectiveCompressionControlsDigest: digest('controls'),
      durableActiveTranscriptRevision: 'rev1', durableActiveTranscriptDigest: digest('transcript'),
      hostCompactionEpoch: 'unknown', attestorId: 'responses-projection-e2e',
      providerManagedHistoryCapability: 'visible', hostTranscriptAttested: false, compactionEnabled: false,
    },
  };
  const responsePromise = fetch(endpoint + '/project', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer real-provider-fixture-secret' },
    body: JSON.stringify(payload), signal: timeout(maxWait),
  });
  if (race) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(codePath, code.replace('return value;', "return value + '-changed';") + filler + '\n');
  }
  const response = await responsePromise;
  const decision = await response.json();
  assert.equal(response.status, 200, JSON.stringify(decision));
  if (decision.kind === 'BLOCK') {
    assert.ok(outage || race, 'normal ready real-provider fixture must not report BLOCK');
    assert.equal(typeof decision.reasonCode, 'string');
    assert.ok(decision.reasonCode.length > 0, 'typed denial must specify a reason');
    assert.equal(decision.baseBodySha256, payload.bodySha256);
    console.log(JSON.stringify({ status: 'projection-honest-block', outage, race, reason: decision.reasonCode }));
  } else {
    assert.equal(decision.kind, 'PREPARED', JSON.stringify(decision));
    assert.equal(outage, false, 'outage must fail closed rather than returning PREPARED');
    assert.equal(decision.baseBodySha256, payload.bodySha256);
    const projected = JSON.parse(Buffer.from(decision.bodyBase64, 'base64').toString('utf8'));
    assert.deepEqual(projected.extra_field, body.extra_field);
    assert.equal(projected.input[1].content, body.input);
    const contextMessage = projected.input.find((item) => item.role === 'developer' && String(item.content).includes('[ACE verified context]'));
    assert.ok(contextMessage, 'real gateway projection must visibly add verified ACE context');
    assert.match(contextMessage.content, /retryAfterTransientFailure/u);
    if (race) assert.match(contextMessage.content, /-changed/u, 'stale source must not masquerade as current');
    else assert.match(contextMessage.content, /service\.ts/u, 'context must cite source file');
    console.log(JSON.stringify({
      status: 'projection-pass', transport: 'ace-internal-projection-http', qdrant: qdrantUrl,
      source: '2000-line TypeScript fixture', race,
      projectedBodySha256: decision.projectedBodySha256,
      providerWireCertified: false,
    }));
  }
} finally {
  await stopRealProviderProcess(child);
  await rm(directory, { recursive: true, force: true });
}
