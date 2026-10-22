import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  codexAuthenticationRoute,
  inspectCodexAuthJson,
} from '../src/domain/feedback-preflight.js';

const validAuth = JSON.stringify({
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    access_token: 'oauth-access-token',
    refresh_token: 'oauth-refresh-token',
    id_token: 'oauth-id-token',
    account_id: 'account-id',
  },
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
});

test('feedback jobs use the Codex OAuth route and do not require the legacy API-key route', async () => {
  const preflight = await readFile('scripts/feedback-loop-preflight.ts', 'utf8');
  const jobs = await readFile('scripts/prepare-harbor-feedback-jobs.ts', 'utf8');
  assert.doesNotMatch(preflight, /OPENAI_API_KEY|OPENAI_API_BASE/u);
  assert.match(preflight, /authenticationRoute: codexAuthenticationRoute/u);
  assert.match(jobs, /CODEX_FORCE_AUTH_JSON:\s*'1'/u);
  assert.doesNotMatch(jobs, /OPENAI_API_KEY|OPENAI_API_BASE/u);
});
