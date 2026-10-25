import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Bifrost plugin build is pinned and fail-closed before plugin compilation', async () => {
  const script = await readFile('scripts/build-bifrost-ace-plugin.sh', 'utf8');
  const plugin = await readFile('integrations/bifrost/ace-connector/plugin/main.go', 'utf8');
  assert.match(script, /BIFROST_COMMIT:=fe7634a6c828927d05ffdd57c62be0aaab04193f/u);
  assert.match(script, /rev-parse HEAD/u);
  assert.match(script, /-buildmode=plugin/u);
  assert.match(plugin, /HTTPTransportPreHook/u);
  assert.match(plugin, /ACE host identity attestation is unavailable/u);
  assert.match(plugin, /ACE projection blocked/u);
  assert.match(plugin, /PreLLMHook/u);
  assert.match(plugin, /LLMPluginShortCircuit/u);
  assert.match(plugin, /AllowFallbacks:\s*&allowFallbacks/u);
  assert.match(plugin, /ace\.pre_llm_attempt_seen/u);
  assert.match(plugin, /len\(fallbacks\) != 0/u);
});
