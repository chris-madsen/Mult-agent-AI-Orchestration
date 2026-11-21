import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  validateResponsesProjectionRequest, decodeNativeResponsesBody,
  bodyQueryMatches, addVerifiedContextToResponses, nativeResponsesVisibleText, type ResponsesProjectionRequest,
} from '../src/domain/responses-projection.js';
const digest = (s: string): string=>createHash('sha256').update(s).digest('hex');
const input = {
  model:'openai/gpt-test',
  stream:true,
  store:false,
  reasoning:{ effort:'high', summary:'auto' },
  tools:[{ type:'function', name:'read_file', parameters:{ type:'object', properties:{ path:{ type:'string' } } } }],
  input:[
    { role:'user', content:[{ type:'input_text', text:'find the entrypoint' }, { type:'input_image', image_url:'data:image/png;base64,AA==' }] },
    { type:'reasoning', id:'rs1', encrypted_content:'opaque-reasoning', summary:[{ type:'summary_text', text:'plan' }] },
    { type:'function_call', id:'fc1', call_id:'call_1', name:'read_file', arguments:'{"path":"src/a.ts"}' },
    { type:'function_call_output', call_id:'call_1', output:'entrypoint found' },
  ],
  metadata:{ host:'hermes' },
  unknown_extension:{ retain:true },
};
const body = (value: unknown): string=>Buffer.from(JSON.stringify(value)).toString('base64');
const attestation = {
  hostBuildDigest:digest('build'), sessionId:'hermes-session', activeEngineId:'bifrost-visible-request-only',
  effectiveCompressionControlsDigest:digest('controls'), durableActiveTranscriptRevision:'unattested',
  durableActiveTranscriptDigest:digest('body'), hostCompactionEpoch:'unknown' as const,
  attestorId:'ace-bifrost-test', providerManagedHistoryCapability:'unknown' as const,
  hostTranscriptAttested:false, compactionEnabled:false,
};
const req = (override:Partial<ResponsesProjectionRequest> = {}, requestBody:unknown = input):ResponsesProjectionRequest=>{
  const bodyBase64 = body(requestBody);
  return {
    schemaVersion:'ace.context.v3', protocol:'openai.responses', requestId:'r1', attemptGroupId:'a1',
    agentSessionId:'hermes-session', workspaceId:'workspace-1', dataClass:'private',
    provider:'openai', model:'openai/gpt-test', bodyBase64,
    bodySha256:createHash('sha256').update(Buffer.from(bodyBase64, 'base64')).digest('hex'),
    query:'entrypoint found', projectionMode:'bifrost_hook', deadlineEpochMs:Date.now() + 60000,
    attestation, ...override,
  };
};
test('v3 ACE context RPC validates exact original provider bytes and rejects unknown versions', ()=>{
  assert.equal(validateResponsesProjectionRequest(req())._tag, 'Ok');
  assert.equal(validateResponsesProjectionRequest(req({ projectionMode:'gateway' as never }))._tag, 'Err', 'obsolete automatic projection mode must not be accepted');
  assert.equal(validateResponsesProjectionRequest(req({ protocol:'unsupported.protocol' as never }))._tag, 'Err');
  assert.equal(validateResponsesProjectionRequest(req({ schemaVersion:'unsupported-version' as never }))._tag, 'Err');
  assert.equal(validateResponsesProjectionRequest(req({ bodySha256:digest('wrong') }))._tag, 'Err');
  assert.equal(validateResponsesProjectionRequest({ ...req(), unexpected:true })._tag, 'Err');
  assert.equal(validateResponsesProjectionRequest(req({ attestation:{ ...attestation, sessionId:'other' } }))._tag, 'Err');
});
test('native tool/reasoning input is preserved, original items stay in order', ()=>{
  const request = req();const d = decodeNativeResponsesBody(request);
  assert.equal(d._tag, 'Ok');if (d._tag === 'Err') return;
  assert.equal(bodyQueryMatches(d.value, request.query), true);
  const out = addVerifiedContextToResponses(d.value, 'context src/a.ts:3');
  assert.equal(out._tag, 'Ok');if (out._tag === 'Err') return;
  const parsed = JSON.parse(Buffer.from(out.value, 'base64').toString('utf8')) as Record<string, any>;
  assert.equal(parsed.input.length, 5);
  assert.equal(parsed.input[0].role, 'developer');
  assert.match(parsed.input[0].content, /ACE verified context/u);
  assert.deepEqual(parsed.input.slice(1), input.input);
  assert.deepEqual(parsed.reasoning, input.reasoning);
  assert.deepEqual(parsed.tools, input.tools);
  assert.deepEqual(parsed.unknown_extension, input.unknown_extension);
  assert.equal(parsed.store, false);
  assert.equal(parsed.stream, true);
});
test('stateless function-call output-only continuation remains valid', ()=>{
  const next = { ...input, input:[{ type:'function_call_output', call_id:'call_1', output:'entrypoint found' }] };
  const request = req({}, next);const d = decodeNativeResponsesBody(request);
  assert.equal(d._tag, 'Ok');if (d._tag === 'Err') return;
  assert.equal(bodyQueryMatches(d.value, 'entrypoint found'), true);
  const appended = addVerifiedContextToResponses(d.value, 'evidence');
  assert.equal(appended._tag, 'Ok');if (appended._tag === 'Err') return;
  const current = JSON.parse(Buffer.from(appended.value, 'base64').toString('utf8')) as Record<string, any>;
  assert.deepEqual(current.input.slice(1), next.input);
});
test('text input is represented as a native user input item', ()=>{
  const value = { ...input, input:'entrypoint found' };const d = decodeNativeResponsesBody(req({}, value));
  assert.equal(d._tag, 'Ok');if (d._tag === 'Err') return;
  const out = addVerifiedContextToResponses(d.value, 'evidence');
  assert.equal(out._tag, 'Ok');if (out._tag === 'Err') return;
  const current = JSON.parse(Buffer.from(out.value, 'base64').toString('utf8')) as Record<string, any>;
  assert.deepEqual(current.input.slice(1), [{ role:'user', content:'entrypoint found' }]);
});
test('deny provider-stored hidden history and malformed native input', ()=>{
  const cases = [
    { ...input, previous_response_id: 'resp_old' }, { ...input, conversation: 'conv_old' },
    { ...input, conversation_id: 'old_conversation' }, { ...input, thread_id: 'old_thread' },
    { ...input, store: true }, { ...input, input: {} },
    Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'store')),
    { ...input, input:[] }, { ...input, model:'different' },
  ];
  for (const value of cases)assert.equal(decodeNativeResponsesBody(req({}, value))._tag, 'Err');
});
test('empty or whitespace tool output falls back to last nonempty user text', () => {
  for (const output of ['', '   ']) {
    const value = { ...input, input: [
      { role: 'user', content: 'earlier question' },
      { type: 'function_call_output', call_id: 'call_1', output },
    ] };
    const decoded = decodeNativeResponsesBody(req({}, value));
    assert.equal(decoded._tag, 'Ok');
    if (decoded._tag === 'Ok') {
      assert.equal(bodyQueryMatches(decoded.value, 'earlier question'), true);
      assert.equal(bodyQueryMatches(decoded.value, ''), false);
    }
  }
});
test('query must be verified against actual visible Responses content', ()=>{
  const d = decodeNativeResponsesBody(req());
  assert.equal(d._tag, 'Ok');if (d._tag === 'Err') return;
  assert.equal(bodyQueryMatches(d.value, 'injected query'), false);
  assert.equal(bodyQueryMatches(d.value, 'entrypoint found'), true);
});
test('projected context never truncates or mutates opaque tool items or extends beyond limit', ()=>{
  const request = req();const d = decodeNativeResponsesBody(request);if (d._tag === 'Err') throw Error('fixture error');
  assert.equal(addVerifiedContextToResponses(d.value, 'x'.repeat(4 * 1024 * 1024))._tag, 'Err');
});

test('opaque native number lexemes survive context injection without floating-point corruption', () => {
  const text = '{"model":"openai/gpt-test","store":false,"input":[{"role":"user","content":"entrypoint found","opaque":9007199254740993}],"metadata":{"decimal":1.00,"exponent":1e100,"nested":[99999999999999999999]}}';
  const bytes = Buffer.from(text);
  const original = req({
    bodyBase64: bytes.toString('base64'),
    bodySha256: createHash('sha256').update(bytes).digest('hex'),
    query: 'entrypoint found',
  });
  const decoded = decodeNativeResponsesBody(original);
  assert.equal(decoded._tag, 'Ok');
  if (decoded._tag === 'Err') return;
  const updated = addVerifiedContextToResponses(decoded.value, 'src/a.ts:1 verified evidence');
  assert.equal(updated._tag, 'Ok');
  if (updated._tag === 'Err') return;
  const result = Buffer.from(updated.value, 'base64').toString('utf8');
  for (const literal of ['9007199254740993', '"decimal":1.00', '"exponent":1e100', '99999999999999999999']) {
    assert.ok(result.includes(literal), 'opaque JSON lexeme changed: ' + literal);
  }
});

test('visible native source extracts only model-readable text, never opaque reasoning or image payloads', () => {
  const original = {
    ...input,
    input: [
      { role: 'system', content: 'trusted code sample' },
      { role: 'user', content: [{ type: 'input_text', text: 'visible pasted code' },
        { type: 'input_image', image_url: 'data:image/png;base64,U0VDUkVU' }] },
      { type: 'reasoning', encrypted_content: 'do not use this opaque string' },
      { type: 'function_call', call_id: 'call1', name: 'read_file', arguments: '{"secret":"opaque args"}' },
      { type: 'function_call_output', call_id: 'call1', output: 'export function verified() {}' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'model output code' }] },
    ],
  };
  assert.deepEqual(nativeResponsesVisibleText(original), [
    'trusted code sample', 'visible pasted code', 'export function verified() {}', 'model output code',
  ]);
  assert.deepEqual(nativeResponsesVisibleText({ ...input, input: 'user typed code' }), ['user typed code']);
});
