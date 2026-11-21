import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pinned Bifröst ACE plugin requires per-attempt native Responses authorization', async () => {
  const script = await readFile('scripts/build-bifrost-ace-plugin.sh', 'utf8');
  const plugin = await readFile('integrations/bifrost/ace-connector/plugin/main.go', 'utf8');
  const workflow = await readFile('.github/workflows/ace-contracts.yml', 'utf8');
  assert.match(script, /BIFROST_COMMIT:=72f03b4b0d4a93b08e9fc0e5ebfe3447248af2a0/u);
  assert.match(script, /OUTPUT:=\$temp_root\/ace-bifrost-context\.so/u);
  assert.match(script, /mktemp -d "\$temp_root\/ace-bifrost-plugin\./u);
  assert.match(script, /status --porcelain --untracked-files=all/u);
  assert.match(script, /Bifrost source checkout must be clean/u);
  assert.match(script, /go 1\.27\.4/u);
  assert.match(script, /rev-parse HEAD/u);
  assert.match(script, /plugin\/\*\.go/u);
  assert.match(workflow, /BIFROST_SOURCE_ROOT:\s+\$\{\{\s*runner\.temp\s*\}\}\/bifrost-src/u);
  assert.match(workflow, /git -C "\$source_root" fetch --no-tags --depth=1 origin "\$BIFROST_COMMIT"/u);
  assert.match(workflow, /scripts\/build-bifrost-ace-plugin\.sh\|\.github\/workflows\/ace-contracts\.yml/u);
  assert.match(workflow, /node=true; go=true/u);
  assert.match(script, /test -tags=bifrost_plugin -count=1/u);
  assert.match(script, /-buildmode=plugin/u);
  assert.match(script, /-X main\.aceSourceCommit=\$ace_commit/u);
  assert.match(script, /-X main\.aceBifrostCommit=\$actual/u);
  assert.match(plugin, /ACE Bifröst source commit provenance is unavailable/u);
  assert.match(plugin, /aceSourceCommit \+ ":" \+ aceBifrostCommit/u);
  assert.doesNotMatch(plugin, /pinnedBifrostCommit/u);
  assert.match(plugin, /ACE plugin source commit provenance is unavailable/u);
  assert.match(plugin, /ace-bifrost-plugin:" \+ aceSourceCommit/u);
  assert.match(plugin, /func HTTPTransportPreHook\(/u);
  assert.match(plugin, /case "\/v1\/responses", chatGPTResponsesIngress:/u);
  assert.match(plugin, /chatGPTResponsesIngress = "\/chatgpt_passthrough\/backend-api\/codex\/responses"/u);
  assert.match(plugin, /chatGPTModelsIngress/u);
  assert.match(plugin, /func prepareNativeResponses\(/u);
  assert.match(plugin, /ProjectNativeResponses/u);
  assert.match(plugin, /AuthorizeNativeResponsesAttempt/u);
  assert.match(plugin, /ctx\.SetPhysicalSendGuard\(guard\)/u);
  assert.match(plugin, /AuthorizationDeadline:\s+time\.UnixMilli/u);
  assert.match(plugin, /PreparedBodySemanticSHA256/u);
  assert.match(plugin, /Provider: string\(attempt\.Provider\), Model: attempt\.Model/u);
  assert.match(plugin, /ExpectedProvider: binding\.provider, ExpectedModel: binding\.model/u);
  assert.match(plugin, /Do not decide a route-changing fallback from normalized request fields here/u);
  assert.match(plugin, /ctx\.TrustedValue\(projectionBindingKey\{\}\)/u);
  assert.match(plugin, /Bifröst native Responses route is unsupported by the ACE context extension/u);
  assert.match(plugin, /func PreLLMHook\(/u);
  assert.match(plugin, /req\.PassthroughRequest/u);
  assert.match(plugin, /p\.UpstreamURL != chatGPTProviderOrigin/u);
  assert.match(plugin, /requestBoundIdentityForProvider/u);
  assert.match(plugin, /req\.Path == "\/v1\/responses"/u);
  assert.doesNotMatch(plugin, /OAuthKeyConfig|NewOAuth|refreshToken/u);
  assert.match(plugin, /LLMPluginShortCircuit/u);
  assert.match(plugin, /AllowFallbacks:\s*&allowFallbacks/u);
  assert.match(plugin, /ACE physical-send authorization guard is unavailable/u);

  assert.doesNotMatch(plugin, /projectionClient\.Project\(/u);
  assert.doesNotMatch(plugin, /context\.Background\(\)/u);
  assert.doesNotMatch(plugin, /ACE_CONTEXT_STRICT/u);
});

test('native plugin retains truthful request-bound identity helpers', async () => {
  const plugin = await readFile('integrations/bifrost/ace-connector/plugin/main.go', 'utf8');
  assert.match(plugin, /crypto\/rand/u);
  assert.match(plugin, /newPhysicalRequestID/u);
  assert.match(plugin, /sessionCorrelationFromRequest/u);
  assert.match(plugin, /schemas\.HarnessSessionHeaders/u);
  assert.match(plugin, /schemas\.NormalizeSessionID/u);
  assert.match(plugin, /schemas\.ParseModelString\(rawModel, expectedProvider\)/u);
  assert.match(plugin, /durableActiveTranscriptDigest/u);
  assert.match(plugin, /"hostTranscriptAttested"\s*:\s*false/u);
  assert.match(plugin, /"hostCompactionEpoch"\s*:\s*"unknown"/u);
  assert.match(plugin, /bifrost-visible-request-only/u);
});

test('native Bifröst metadata never claims authenticated multi-tenant workspace or known provider history', async () => {
  const source = await readFile('integrations/bifrost/ace-connector/plugin/main.go', 'utf8');
  assert.match(source, /ACE_BIFROST_TENANCY_MODE/u);
  assert.match(source, /singleWorkspaceAllowed/u);
  assert.match(source, /"providerManagedHistoryCapability"\s*:\s*"unknown"/u);
});
