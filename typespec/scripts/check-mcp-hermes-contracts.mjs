import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(import.meta.dirname, '../..');
const load = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const baseline = load('.github/fixtures/contracts/ace-public-v1-baseline.json');
const mcp = [
  ['ace_context', 'AceContextInput'],
  ['ace_expand', 'AceExpandInput'],
  ['ace_workspace_status', 'AceWorkspaceStatusInput'],
  ['ace_memory_search', 'AceMemorySearchInput'],
];

const deref = (schema, node) => {
  let current = node;
  while (current?.$ref?.startsWith('#/$defs/')) {
    const key = current.$ref.slice('#/$defs/'.length);
    current = schema.$defs?.[key];
    assert.ok(current, `generated unresolved ref ${key}`);
  }
  return current;
};
const at = (schema, fullPath) => {
  let value = schema;
  for (const segment of fullPath.split('.')) {
    const array = segment.endsWith('[]');
    const key = array ? segment.slice(0, -2) : segment;
    value = deref(schema, value).properties?.[key];
    assert.ok(value, `missing ${fullPath} at ${key}`);
    value = deref(schema, value);
    if (array) {
      value = deref(schema, value.items);
      assert.ok(value, `missing items for ${fullPath}`);
    }
  }
  return value;
};
const variants = (node) => node.enum ?? (
  node.const === undefined ? (node.anyOf ?? node.oneOf ?? []).flatMap(variants) : [node.const]
);

for (const [name, schemaName] of mcp) {
  const owner = baseline.mcp.tools[name];
  const generated = load(`typespec/generated/schema/${schemaName}.json`);
  const properties = Object.keys(generated.properties ?? {});
  assert.deepEqual(properties.sort(), owner.properties.filter(x => !x.includes('.')).sort(),
    `${name}: generated top-level field mismatch`);
  assert.deepEqual([...(generated.required ?? [])].sort(), [...owner.required].sort(),
    `${name}: required/optional drift`);
  for (const [scope, expected] of Object.entries(owner.requiredByPath ?? {})) {
    assert.deepEqual([...(at(generated, scope).required ?? [])].sort(), [...expected].sort(),
      `${name}.${scope}: nested required/optional drift`);
  }
  for (const path of owner.properties) {
    const field = at(generated, path);
    assert.ok(field, `${name}.${path}: generated field disappeared`);
  }
  for (const [path, expected] of Object.entries(owner.types)) {
    const field = at(generated, path);
    // Literal unions emit JSON Schema anyOf/const instead of type=string.
    // That is the same accepted finite string type, not a missing type.
    const cases = variants(field);
    const normalizedType = field.type ?? (
      cases.length > 0 && cases.every((value) => typeof value === 'string') ? 'string' : undefined
    );
    assert.equal(normalizedType, expected, `${name}.${path}: type drift`);
  }
  for (const [path, expected] of Object.entries(owner.enums ?? {})) {
    assert.deepEqual([...variants(at(generated, path))].sort(), [...expected].sort(),
      `${name}.${path}: enumerated variant drift`);
  }
}

const handshake = load('typespec/generated/schema/BridgeReady.json');
const transform = load('typespec/generated/schema/TransformRequest.json');
assert.deepEqual([...(handshake.required ?? [])].sort(),
  [...baseline.hermes.bridgeReadyRequired].sort());
assert.deepEqual([...(transform.required ?? [])].sort(),
  [...baseline.hermes.transformRequestRequired].sort());
assert.deepEqual(Object.keys(transform.properties ?? {}).sort(),
  [...baseline.hermes.transformRequestProperties].sort());
for (const [key, expected] of Object.entries(baseline.hermes.bridgeHandshake)) {
  assert.deepEqual(variants(handshake.properties[key]), [expected]);
}
assert.deepEqual(
  transform.properties.sourceObligations.properties.required.prefixItems.map(x => x.const),
  baseline.hermes.sourceObligationsRequired,
);
assert.equal(transform.properties.sourceObligations.properties.required.minItems, 1);
assert.equal(transform.properties.sourceObligations.properties.required.maxItems, 1);

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validators = Object.fromEntries([
  ...mcp.map(([name, type]) => [name, ajv.compile(load(`typespec/generated/schema/${type}.json`))]),
  ['bridgeReady', ajv.compile(handshake)],
  ['transform', ajv.compile(transform)],
]);
const tests = [
  ['ace_context', { workspace_id: 'w1', query: 'find x' }, true],
  ['ace_context', { workspace_id: 'w1', query: '', source_obligations: { required: ['code','lsp'] } }, true],
  ['ace_context', { workspace_id: 'w1' }, false],
  ['ace_context', { workspace_id: 'w1', query: 'q', known_bundle_id: '' }, false],
  ['ace_context', { workspace_id: 'w1', query: 'q', working_context: { focused_range: { start_line: 0, end_line: 1 } } }, false],
  ['ace_context', { workspace_id: 'w1', query: 'q', source_obligations: { required: ['not-source'] } }, false],
  ['ace_expand', { handle: 'a', format: 'utf8' }, true],
  ['ace_expand', { handle: '' }, false],
  ['ace_expand', { handle: 'a', max_bytes: 0 }, false],
  ['ace_expand', { handle: 'a', format: 'not-encoding' }, false],
  ['ace_workspace_status', { workspace_id: 'w1' }, true],
  ['ace_workspace_status', { workspace_id: 3 }, false],
  ['ace_memory_search', { workspace_id: 'w1', query: '' }, true],
  ['ace_memory_search', { workspace_id: 'w1', query: 'q', include_original: null }, false],
  ['bridgeReady', { type: 'bridge_ready', schemaVersion: 1, runtimeId: 'ace-harbor-runtime-v1',
    node: 'v22', providerIdentities: { qdrant: 'qdrant/test' } }, true],
  ['bridgeReady', { type: 'bridge_ready', schemaVersion: 2, runtimeId: 'ace-harbor-runtime-v1',
    node: 'v22', providerIdentities: { qdrant: 'qdrant/test' } }, false],
  ['transform', {
    type: 'transform', schemaVersion: 1, requestId: 'r1', sessionId: 's1', turnId: 't1',
    workspaceId: 'w1', query: 'find code', budgetTokens: 100, sourceObligations: { required: ['code'] },
  }, true],
  ['transform', {
    type: 'transform', schemaVersion: 1, requestId: 'r1', sessionId: 's1', turnId: 't1',
    workspaceId: 'w1', query: 'find code', budgetTokens: 100, sourceObligations: { required: ['memory'] },
  }, false],
  ['transform', {
    type: 'transform', schemaVersion: 1, requestId: 'r1', sessionId: 's1', turnId: 't1',
    workspaceId: 'w1', query: 'find code', budgetTokens: 0, sourceObligations: { required: ['code'] },
  }, false],
];
for (const [name, value, expected] of tests) {
  assert.equal(validators[name](value), expected,
    `TypeSpec ${name}: fixture unexpected ${JSON.stringify(value)}; ${JSON.stringify(validators[name].errors)}`);
}
console.log(JSON.stringify({
  status: 'pass', mcpContracts: mcp.length, hermesContracts: 2,
  cases: tests.length,
  limitations: [
    'candidate_schemas_only',
    'mcp_sdk_remains_protocol_owner',
    'unknown_extra_field_policy_differs_from_some_existing_runtime_decoders',
    'hermes_bridge_ready_runtime_additionally_requires_nonempty_provider_identities',
    'no_generated_final_provider_egress',
  ],
}));
