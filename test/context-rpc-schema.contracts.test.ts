import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loadJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

test('generated ACE context RPC v3 is not a separate model gateway', async () => {
  const openapi = await loadJson('typespec/generated/openapi.json');
  assert.equal((openapi.info as { version?: string }).version, '3.0.0');
  const paths = Object.keys(openapi.paths as Record<string, unknown>)
    .filter((path) => path.startsWith('/internal/ace-context/'))
    .sort();
  assert.deepEqual(paths, [
    '/internal/ace-context/v3/authorize-attempt',
    '/internal/ace-context/v3/capabilities',
    '/internal/ace-context/v3/health',
    '/internal/ace-context/v3/project',
  ]);
  const request = await loadJson('typespec/generated/schema/ProjectionRequest.json');
  const properties = request.properties as Record<string, { const?: string }>;
  assert.equal(properties.schemaVersion?.const, 'ace.context.v3');
  assert.equal(properties.protocol?.const, 'openai.responses');
  assert.deepEqual(request.unevaluatedProperties, { not: {} });
  const components = openapi.components as { schemas: Record<string, Record<string, unknown>> };
  assert.deepEqual(components.schemas.ProjectionRequest.additionalProperties, { not: {} });
  const decision = components.schemas.ProjectionDecision as {
    oneOf?: readonly unknown[];
    discriminator?: { mapping?: Readonly<Record<string, string>> };
  };
  assert.equal(decision.oneOf?.length, 2);
  assert.deepEqual(decision.discriminator?.mapping, {
    PREPARED: '#/components/schemas/PreparedProjection',
    BLOCK: '#/components/schemas/BlockedProjection',
  });
});

test('generated Responses contract rejects unknown top-level fields', async () => {
  const request = await loadJson('typespec/generated/schema/ProjectionRequest.json');
  assert.deepEqual(request.unevaluatedProperties, { not: {} });
  const openapi = await loadJson('typespec/generated/openapi.json');
  const components = openapi.components as { schemas: Record<string, { properties: Record<string, { enum?: readonly string[] }> }> };
  assert.deepEqual(components.schemas.ProjectionRequest.properties.dataClass?.enum, ['private', 'project_document', 'public']);
});
