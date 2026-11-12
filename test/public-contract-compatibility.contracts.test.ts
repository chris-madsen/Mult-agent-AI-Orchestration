import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { Effect } from 'effect';
import { createAceServer } from '../src/transport/mcp-sdk-stdio.js';
import type { ContextBundle, CandidateFreshness } from '../src/domain/retrieval.js';
import type { ContextSource, SourceCoverageStatus } from '../src/domain/source-coverage.js';
import type { DomainErrorCode } from '../src/domain/errors.js';
import type {
  GatewayDecisionKind,
  GatewayProjectionRequest,
  ProjectionMode,
  ProviderManagedHistoryCapability,
} from '../src/domain/gateway-projection.js';
import type { HermesContextEvidence, HermesContextTransformStatus } from '../src/domain/hermes-context-evidence.js';
import type { AceTransformRequest, AceTransformResult } from '../src/application/context-transform-service.js';
import type { ContextBridgeResponse } from '../src/transport/context-bridge-stdio.js';
import { domainError } from '../src/domain/errors.js';
import type { GatewayResponse } from '../src/gateway/mcp-gateway.js';

interface ToolBaseline {
  readonly required: readonly string[];
  readonly properties: readonly string[];
  readonly requiredByPath?: Readonly<Record<string, readonly string[]>>;
  readonly types?: Readonly<Record<string, string>>;
  readonly enums?: Readonly<Record<string, readonly string[]>>;
}

interface GatewayObjectBaseline {
  readonly required: readonly string[];
  readonly properties: readonly string[];
  readonly enums?: Readonly<Record<string, readonly string[]>>;
  readonly constants?: Readonly<Record<string, string>>;
  readonly additionalProperties: false;
}

interface PublicContractBaseline {
  readonly mcp: {
    readonly tools: Readonly<Record<string, ToolBaseline>>;
    readonly successEnvelopeRequired: readonly string[];
    readonly failureEnvelopeRequired: readonly string[];
    readonly contentItemRequired: readonly string[];
    readonly successStructuredContentRequired: readonly string[];
    readonly failureStructuredContentRequired: readonly string[];
  };
  readonly context: {
    readonly completeType: 'boolean';
    readonly candidateFreshness: readonly CandidateFreshness[];
    readonly sourceCoverageStatuses: readonly SourceCoverageStatus[];
    readonly sourceKinds: readonly ContextSource[];
  };
  readonly domainErrorCodes: readonly DomainErrorCode[];
  readonly gateway: {
    readonly schemaVersion: 'ace.gateway.v1';
    readonly requestSchemaBlobSha: string;
    readonly decisionSchemaBlobSha: string;
    readonly request: GatewayObjectBaseline & {
      readonly attestation: GatewayObjectBaseline & {
        readonly hostCompactionEpochVariants: readonly Readonly<Record<string, unknown>>[];
      };
    };
    readonly decision: GatewayObjectBaseline & {
      readonly receipt: GatewayObjectBaseline & {
        readonly hostCompactionEpochVariants: readonly Readonly<Record<string, unknown>>[];
      };
    };
  };
  readonly bifrost: { readonly schemaVersion: 'ace.gateway.v1' };
  readonly hermes: {
    readonly bridgeHandshake: { readonly type: 'bridge_ready'; readonly schemaVersion: 1; readonly runtimeId: 'ace-harbor-runtime-v1' };
    readonly bridgeReadyRequired: readonly string[];
    readonly transformRequestRequired: readonly string[];
    readonly transformRequestProperties: readonly string[];
    readonly sourceObligationsRequired: readonly ['code'];
    readonly responseTypes: readonly ContextBridgeResponse['type'][];
    readonly transformResultStatuses: readonly AceTransformResult['status'][];
    readonly evidenceStatuses: readonly HermesContextTransformStatus[];
    readonly deliveryModes: readonly NonNullable<HermesContextEvidence['deliveryMode']>[];
  };
}

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type CompletenessRemainsBoolean = Expect<Equal<ContextBundle['complete'], boolean>>;
type TransformSchemaVersionRemainsV1 = Expect<Equal<AceTransformRequest['schemaVersion'], 1>>;
type GatewayVersionRemainsV1 = Expect<Equal<GatewayProjectionRequest['schemaVersion'], 'ace.gateway.v1'>>;
type ProviderCapabilityRemainsEnumerated = Expect<Equal<ProviderManagedHistoryCapability, 'visible' | 'hidden' | 'unknown'>>;
type DecisionKindRemainsEnumerated = Expect<Equal<GatewayDecisionKind, 'APPLY' | 'UNCHANGED_AUTHORIZED' | 'DEGRADED_AUTHORIZED' | 'BLOCK'>>;
type ProjectionModeRemainsEnumerated = Expect<Equal<ProjectionMode, 'native' | 'gateway' | 'assist-only' | 'observe-only' | 'off'>>;
type ContractTypeAssertions = readonly [
  CompletenessRemainsBoolean,
  TransformSchemaVersionRemainsV1,
  GatewayVersionRemainsV1,
  ProviderCapabilityRemainsEnumerated,
  DecisionKindRemainsEnumerated,
  ProjectionModeRemainsEnumerated,
];
const contractTypeAssertions: ContractTypeAssertions = [true, true, true, true, true, true];

const baselinePath = new URL('../.github/fixtures/contracts/ace-public-v1-baseline.json', import.meta.url);
const gatewayRequestPath = new URL('../contracts/ace-gateway/v1/projection-request.schema.json', import.meta.url);
const gatewayDecisionPath = new URL('../contracts/ace-gateway/v1/projection-decision.schema.json', import.meta.url);

const parseJson = (text: string, label: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
};

const readJson = async (path: URL, label: string): Promise<unknown> =>
  parseJson(await readFile(path, 'utf8'), label);

const gitBlobSha = (text: string): string => {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const sorted = (values: readonly string[]): string[] => [...values].sort();

const schemaAtPath = (root: unknown, path: string): Record<string, unknown> => {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    const item = segment.endsWith('[]');
    const property = item ? segment.slice(0, -2) : segment;
    const properties = asRecord(asRecord(current, path).properties, `${path}.properties`);
    current = properties[property];
    if (item) current = asRecord(current, `${path}.${segment}`).items;
  }
  return asRecord(current, path);
};

const assertRequired = (schema: unknown, expected: readonly string[], label: string): void => {
  const actual = asRecord(schema, label).required;
  if (actual !== undefined && !Array.isArray(actual)) throw new Error(`${label}.required must be an array`);
  assert.deepEqual(sorted(Array.isArray(actual) ? actual as string[] : []), sorted(expected), `${label} required fields changed`);
};

const assertKeysPresent = (value: unknown, expected: readonly string[], label: string): void => {
  const object = asRecord(value, label);
  for (const key of expected) assert.ok(key in object, `${label} is missing ${key}`);
};

const assertPropertiesPresent = (schema: unknown, expected: readonly string[], label: string): void => {
  for (const path of expected) {
    assert.doesNotThrow(() => schemaAtPath(schema, path), `${label} is missing ${path}`);
  }
};

const assertTypes = (
  schema: unknown,
  expected: Readonly<Record<string, string>> | undefined,
  label: string,
): void => {
  for (const [path, type] of Object.entries(expected ?? {})) {
    assert.equal(schemaAtPath(schema, path).type, type, `${label}.${path} type changed`);
  }
};

const assertEnums = (
  schema: unknown,
  expected: Readonly<Record<string, readonly string[]>> | undefined,
  label: string,
): void => {
  for (const [path, values] of Object.entries(expected ?? {})) {
    const actual = schemaAtPath(schema, path).enum;
    assert.ok(Array.isArray(actual), `${label}.${path} must remain an enum`);
    assert.deepEqual(sorted(actual as string[]), sorted(values), `${label}.${path} enum changed`);
  }
};

const assertGatewayObject = (schema: unknown, expected: GatewayObjectBaseline, label: string): void => {
  const object = asRecord(schema, label);
  assertRequired(object, expected.required, label);
  const properties = asRecord(object.properties, `${label}.properties`);
  assert.deepEqual(sorted(Object.keys(properties)), sorted(expected.properties), `${label} properties changed`);
  assertEnums(object, expected.enums, label);
  for (const [property, value] of Object.entries(expected.constants ?? {})) {
    assert.equal(asRecord(asRecord(object.properties, `${label}.properties`)[property], `${label}.${property}`).const, value);
  }
  assert.equal(object.additionalProperties, expected.additionalProperties, `${label} additionalProperties changed`);
};

const sortedTypeValues = <Value extends string>(values: readonly Value[]): string[] => sorted(values);

const baseline = async (): Promise<PublicContractBaseline> =>
  await readJson(baselinePath, 'public contract baseline') as PublicContractBaseline;

test('compatibility checks allow optional additions and detect removals, new requirements, and enum changes', () => {
  const expected: ToolBaseline = {
    required: ['id'],
    properties: ['id'],
    types: { id: 'string' },
    enums: { state: ['ready'] },
  };
  const additive = { type: 'object', required: ['id'], properties: { id: { type: 'string' }, label: { type: 'string' }, state: { enum: ['ready'] } } };
  assertRequired(additive, expected.required, 'additive fixture');
  assertPropertiesPresent(additive, expected.properties, 'additive fixture');
  assertTypes(additive, expected.types, 'additive fixture');
  assertEnums(additive, expected.enums, 'additive fixture');

  assert.throws(() => assertRequired({ required: [] }, expected.required, 'removed field'));
  assert.throws(() => assertPropertiesPresent({ properties: { renamed: {} } }, expected.properties, 'renamed field'));
  assert.throws(() => assertRequired({ required: ['id', 'new_required'], properties: { id: {} } }, expected.required, 'new required field'));
  assert.throws(() => assertTypes({ properties: { id: { type: 'number' } } }, expected.types, 'changed field type'));
  assert.throws(() => assertEnums({ properties: { state: { enum: ['ready', 'future'] } } }, expected.enums, 'unknown enum variant'));

  const strictGateway: GatewayObjectBaseline = {
    required: ['id'],
    properties: ['id'],
    additionalProperties: false,
  };
  assert.throws(() => assertGatewayObject({
    required: ['id'],
    properties: { id: { type: 'string' }, optional: { type: 'string' } },
    additionalProperties: false,
  }, strictGateway, 'strict Gateway v1'));
});

test('official MCP SDK schemas and result envelopes remain compatible with the shared baseline', async () => {
  assert.deepEqual(contractTypeAssertions, [true, true, true, true, true, true]);
  const contract = await baseline();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAceServer({
    handle: (call) => {
      const workspaceId = (call.arguments as { workspace_id?: string }).workspace_id;
      const response: GatewayResponse = workspaceId === 'not-ready'
        ? { status: 'error', error: domainError('NOT_READY', 'workspace_id', 'workspace is not ready') }
        : { status: 'ok', result: { status: 'ready' } };
      return Effect.succeed(response);
    },
  });
  const client = new Client({ name: 'ace-public-contract-test', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
    for (const [name, expected] of Object.entries(contract.mcp.tools)) {
      const tool = tools.get(name);
      assert.ok(tool, `MCP tool ${name} was removed`);
      const input = asRecord(tool.inputSchema, `${name}.inputSchema`);
      assertRequired(input, expected.required, `${name}.inputSchema`);
      assertPropertiesPresent(input, expected.properties, `${name}.inputSchema`);
      assertTypes(input, expected.types, `${name}.inputSchema`);
      for (const [path, fields] of Object.entries(expected.requiredByPath ?? {})) {
        assertRequired(schemaAtPath(input, path), fields, `${name}.inputSchema.${path}`);
      }
      assertEnums(input, expected.enums, `${name}.inputSchema`);
    }

    const success = await client.callTool({ name: 'ace_workspace_status', arguments: { workspace_id: 'ready' } });
    const failure = await client.callTool({ name: 'ace_workspace_status', arguments: { workspace_id: 'not-ready' } });
    for (const key of contract.mcp.successEnvelopeRequired) assert.ok(key in success, `MCP success is missing ${key}`);
    for (const key of contract.mcp.failureEnvelopeRequired) assert.ok(key in failure, `MCP failure is missing ${key}`);
    assert.equal(failure.isError, true);
    assertKeysPresent(success.content[0], contract.mcp.contentItemRequired, 'MCP success content');
    assertKeysPresent(failure.content[0], contract.mcp.contentItemRequired, 'MCP failure content');
    assertKeysPresent(success.structuredContent, contract.mcp.successStructuredContentRequired, 'MCP success structuredContent');
    assertKeysPresent(failure.structuredContent, contract.mcp.failureStructuredContentRequired, 'MCP failure structuredContent');
    assert.equal(asRecord(failure.structuredContent, 'MCP failure structuredContent').status, 'error');
    assert.equal(asRecord(asRecord(failure.structuredContent, 'MCP failure structuredContent').error, 'MCP failure error').code, 'NOT_READY');
  } finally {
    await client.close();
    await server.close();
  }
});

test('versioned Gateway JSON Schemas remain compatible for TypeScript and Bifrost owners', async () => {
  const contract = await baseline();
  const requestText = await readFile(gatewayRequestPath, 'utf8');
  const decisionText = await readFile(gatewayDecisionPath, 'utf8');
  assert.equal(gitBlobSha(requestText), contract.gateway.requestSchemaBlobSha, 'Gateway v1 request schema changed in place');
  assert.equal(gitBlobSha(decisionText), contract.gateway.decisionSchemaBlobSha, 'Gateway v1 decision schema changed in place');
  const request = asRecord(parseJson(requestText, 'Gateway request schema'), 'Gateway request schema');
  const decision = asRecord(parseJson(decisionText, 'Gateway decision schema'), 'Gateway decision schema');
  assertGatewayObject(request, contract.gateway.request, 'Gateway request');
  assertGatewayObject(decision, contract.gateway.decision, 'Gateway decision');

  const requestProperties = asRecord(request.properties, 'Gateway request properties');
  assert.equal(asRecord(requestProperties.schemaVersion, 'Gateway schemaVersion').const, contract.gateway.schemaVersion);
  assert.equal(asRecord(requestProperties.protocol, 'Gateway protocol').const, contract.gateway.request.constants?.protocol);
  const definitions = asRecord(request.$defs, 'Gateway request definitions');
  const attestation = asRecord(definitions.attestation, 'Gateway attestation definition');
  assertGatewayObject(attestation, contract.gateway.request.attestation, 'Gateway attestation');
  const attestationProperties = asRecord(attestation.properties, 'Gateway attestation properties');
  assert.deepEqual(asRecord(attestationProperties.hostCompactionEpoch, 'Gateway epoch').oneOf,
    contract.gateway.request.attestation.hostCompactionEpochVariants);

  const decisionDefinitions = asRecord(decision.$defs, 'Gateway decision definitions');
  const receipt = asRecord(decisionDefinitions.receipt, 'Gateway receipt definition');
  assertGatewayObject(receipt, contract.gateway.decision.receipt, 'Gateway receipt');
  const receiptProperties = asRecord(receipt.properties, 'Gateway receipt properties');
  assert.equal(asRecord(receiptProperties.schemaVersion, 'Gateway receipt schemaVersion').const, contract.gateway.schemaVersion);
  assert.deepEqual(asRecord(receiptProperties.hostCompactionEpoch, 'Gateway receipt epoch').oneOf,
    contract.gateway.decision.receipt.hostCompactionEpochVariants);
});

test('typed context, errors, gateway, and Hermes status variants match the approved snapshot', async () => {
  const contract = await baseline();
  const candidateFreshness = ['current', 'stale', 'changed_during_request', 'unknown'] as const satisfies readonly CandidateFreshness[];
  const sourceCoverageStatuses = ['satisfied', 'partial', 'empty', 'unavailable', 'denied', 'not_requested'] as const satisfies readonly SourceCoverageStatus[];
  const sourceKinds = ['code', 'structural', 'lsp', 'documentation', 'memory', 'history'] as const satisfies readonly ContextSource[];
  const domainErrorCodes = [
    'INVALID_INPUT', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_ROOT_NOT_ALLOWED', 'PATH_ESCAPE', 'FILE_NOT_FOUND',
    'DIGEST_MISMATCH', 'WORKTREE_RACED', 'SNAPSHOT_FAILED', 'PERSISTENCE_FAILED', 'POLICY_DENIED', 'AUTH_REQUIRED',
    'SECRET_DETECTED', 'AUDIT_FAILED', 'ARTIFACT_NOT_FOUND', 'INVALID_HANDLE', 'NOT_READY', 'INVALID_BENCHMARK',
    'INVALID_USAGE', 'USAGE_UNAVAILABLE', 'UNSUPPORTED_PROVIDER', 'QUALITY_GATE_FAILED', 'INVALID_RETRIEVAL',
    'INVALID_MEMORY', 'INVALID_ROUTING', 'ARCHIVE_TOMBSTONED', 'EXTERNAL_UNAVAILABLE', 'INVALID_EXTERNAL_RESPONSE',
    'INVALID_ATTESTATION', 'UNSUPPORTED_PROTOCOL', 'PROTECTED_GROUP_INVALID', 'HOST_CONTEXT_UNATTESTED',
    'HOST_COMPACTION_ACTIVE', 'PROVIDER_MANAGED_STATE_UNKNOWN', 'DUAL_PROJECTION_OWNER', 'DEADLINE_EXCEEDED',
  ] as const satisfies readonly DomainErrorCode[];
  const decisionKinds = ['APPLY', 'UNCHANGED_AUTHORIZED', 'DEGRADED_AUTHORIZED', 'BLOCK'] as const satisfies readonly GatewayDecisionKind[];
  const projectionModes = ['native', 'gateway', 'assist-only', 'observe-only', 'off'] as const satisfies readonly ProjectionMode[];
  const providerHistory = ['visible', 'hidden', 'unknown'] as const satisfies readonly ProviderManagedHistoryCapability[];
  const transformStatuses = ['ready', 'partial', 'not_ready', 'blocked'] as const satisfies readonly AceTransformResult['status'][];
  const evidenceStatuses = ['ready', 'partial', 'not_ready', 'blocked', 'not_beneficial'] as const satisfies readonly HermesContextTransformStatus[];
  const deliveryModes = ['augmentation', 'replacement', 'no_op'] as const satisfies readonly NonNullable<HermesContextEvidence['deliveryMode']>[];
  const responseTypes = ['bridge_ready', 'transform_result', 'transform_error'] as const satisfies readonly ContextBridgeResponse['type'][];

  // A `satisfies readonly Union[]` list can omit new Union members without
  // failing compilation. These reciprocal checks make it exhaustive and stop
  // a new error/status from silently disappearing from QG5 coverage.
  type ExhaustivePublicVariants = readonly [
    Expect<Equal<CandidateFreshness, typeof candidateFreshness[number]>>,
    Expect<Equal<SourceCoverageStatus, typeof sourceCoverageStatuses[number]>>,
    Expect<Equal<ContextSource, typeof sourceKinds[number]>>,
    Expect<Equal<DomainErrorCode, typeof domainErrorCodes[number]>>,
    Expect<Equal<GatewayDecisionKind, typeof decisionKinds[number]>>,
    Expect<Equal<ProjectionMode, typeof projectionModes[number]>>,
    Expect<Equal<ProviderManagedHistoryCapability, typeof providerHistory[number]>>,
    Expect<Equal<AceTransformResult['status'], typeof transformStatuses[number]>>,
    Expect<Equal<HermesContextTransformStatus, typeof evidenceStatuses[number]>>,
    Expect<Equal<NonNullable<HermesContextEvidence['deliveryMode']>, typeof deliveryModes[number]>>,
    Expect<Equal<ContextBridgeResponse['type'], typeof responseTypes[number]>>,
  ];
  const exhaustivePublicVariants: ExhaustivePublicVariants = [true, true, true, true, true, true, true, true, true, true, true];
  assert.equal(exhaustivePublicVariants.every(Boolean), true);

  assert.deepEqual(sortedTypeValues(candidateFreshness), sorted(contract.context.candidateFreshness));
  assert.deepEqual(sortedTypeValues(sourceCoverageStatuses), sorted(contract.context.sourceCoverageStatuses));
  assert.deepEqual(sortedTypeValues(sourceKinds), sorted(contract.context.sourceKinds));
  assert.deepEqual(sortedTypeValues(domainErrorCodes), sorted(contract.domainErrorCodes));
  assert.deepEqual(sortedTypeValues(decisionKinds), sorted(contract.gateway.decision.enums?.kind ?? []));
  assert.deepEqual(sortedTypeValues(projectionModes), sorted(contract.gateway.request.enums?.projectionMode ?? []));
  assert.deepEqual(sortedTypeValues(providerHistory), sorted(contract.gateway.request.attestation.enums?.providerManagedHistoryCapability ?? []));
  assert.deepEqual(sortedTypeValues(transformStatuses), sorted(contract.hermes.transformResultStatuses));
  assert.deepEqual(sortedTypeValues(evidenceStatuses), sorted(contract.hermes.evidenceStatuses));
  assert.deepEqual(sortedTypeValues(deliveryModes), sorted(contract.hermes.deliveryModes));
  assert.deepEqual(sortedTypeValues(responseTypes), sorted(contract.hermes.responseTypes));
  assert.equal(contract.context.completeType, 'boolean');
  assert.deepEqual(contract.hermes.sourceObligationsRequired, ['code']);
  assert.equal(contract.bifrost.schemaVersion, contract.gateway.schemaVersion);
});

test('malformed baseline JSON is rejected with a safe, specific message', () => {
  assert.throws(() => parseJson('{', 'fixture'), /fixture must be valid JSON/u);
});
