import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const availablePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      server.close();
      reject(new Error('no local port available'));
      return;
    }
    server.close((error) => error === undefined ? resolve(address.port) : reject(error));
  });
});
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

test('DBC-01 real Gateway remains reachable but blocks projection when required retrieval is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-gateway-readiness-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'code.ts'), 'export const context = true;\n');
  const port = await availablePort();
  const session = 'session-readiness';
  const body = { model: 'mock', store: false, input: 'find context' };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/bin/ace-context-rpc.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACE_ALLOW_SOURCE_RUNTIME: 'true',
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: root,
      ACE_WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
      ACE_STATE_DIR: join(root, 'state'),
      ACE_ARTIFACT_DIR: join(root, 'artifacts'),
      ACE_ENABLE_EXPERIMENTAL_QDRANT: 'false',
      ACE_ENABLE_GRAPHITI: 'false',
      ACE_CONTEXT_RPC_HOST: '127.0.0.1',
      ACE_CONTEXT_RPC_PORT: String(port),
      ACE_CONTEXT_RPC_SHARED_SECRET: 'readiness-fixture-secret',
      ACE_CONTEXT_EXTERNAL_LLM_OPT_IN: 'true',
      ACE_CONTEXT_ALLOWED_LLM_PROVIDERS_JSON: '["mock"]',
      ACE_CONTEXT_ALLOWED_LLM_MODELS_BY_PROVIDER_JSON: '{"mock":["mock"]}',
      ACE_CONTEXT_ALLOWED_LLM_DATA_CLASSES_JSON: '["private_source"]',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      let completed = false;
      const finish = (failure?: Error): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (failure === undefined) resolve();
        else reject(failure);
      };
      const timer = setTimeout(() => finish(new Error('Gateway did not start: ' + stderr.slice(-1000))), 20_000);
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.includes('ace-context-rpc listening')) finish();
      });
      child.once('error', (error) => finish(error));
      child.once('exit', (code) => finish(new Error('Gateway exited before ready: ' + code + ' ' + stderr.slice(-1000))));
    });
    const base = `http://127.0.0.1:${port}/internal/ace-context/v3`;
    const health = await fetch(base + '/health', {
      headers: { authorization: 'Bearer readiness-fixture-secret' },
    });
    assert.equal(health.status, 200);
    const readiness = await health.json() as { providerWire: string };
    assert.equal(readiness.providerWire, 'not_certified');
    const request = {
      schemaVersion: 'ace.context.v3',
      requestId: 'request-readiness',
      attemptGroupId: 'turn-readiness',
      agentSessionId: session,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      dataClass: 'private',
      protocol: 'openai.responses',
      provider: 'mock',
      model: 'mock',
      bodyBase64: encoded,
      bodySha256: digest(Buffer.from(encoded, 'base64').toString('utf8')),
      query: 'find context',
      projectionMode: 'bifrost_hook',
      deadlineEpochMs: Date.now() + 30_000,
      attestation: {
        hostBuildDigest: digest('host'),
        sessionId: session,
        activeEngineId: 'gateway',
        effectiveCompressionControlsDigest: digest('controls'),
        durableActiveTranscriptRevision: 'r1',
        durableActiveTranscriptDigest: digest('transcript'),
        hostCompactionEpoch: 0,
        attestorId: 'local-test',
        providerManagedHistoryCapability: 'visible',
        hostTranscriptAttested: true,
        compactionEnabled: false,
      },
    };
    const response = await fetch(base + '/project', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer readiness-fixture-secret' },
      body: JSON.stringify(request),
    });
    assert.equal(response.status, 200);
    const result = await response.json() as { kind: string; reasonCode: string };
    assert.equal(result.kind, 'BLOCK');
    assert.equal(result.reasonCode, 'NOT_READY');
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await rm(root, { recursive: true, force: true });
  }
});

test('C07 operator guidance pins Bifröst routing and keeps real agent evidence unaccepted', async () => {
  const readiness = await readFile('docs/operations/ace-configuration-and-readiness-matrix.md', 'utf8');
  assert.match(readiness, /HERMES_CODEX_BASE_URL/u);
  assert.match(readiness, /bifrost_endpoint_sha256/u);
  assert.match(readiness, /A missing provider-native token counter or context-window value is \*\*UNKNOWN telemetry\*\*/u);
  assert.match(readiness, /agent-loop-evidence\.json/u);
  assert.match(readiness, /full real C07 Hermes\/Harbor trials and C08 release acceptance remain NOT_RUN/u);
});
