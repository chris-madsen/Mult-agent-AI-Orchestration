import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const loadJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const openapi = loadJson('generated/openapi.json');
assert.equal(openapi.info?.version, '3.0.0', 'generated API version must be 3.0.0');

const routes = Object.keys(openapi.paths ?? {})
  .filter((path) => path.startsWith('/internal/ace-context/'))
  .sort();
assert.deepEqual(routes, [
  '/internal/ace-context/v3/authorize-attempt',
  '/internal/ace-context/v3/capabilities',
  '/internal/ace-context/v3/health',
  '/internal/ace-context/v3/project',
]);

const schemas = openapi.components?.schemas ?? {};
const request = schemas.ProjectionRequest;
assert.equal(request?.properties?.schemaVersion?.enum?.[0], 'ace.context.v3');
assert.equal(request?.properties?.protocol?.enum?.[0], 'openai.responses');
assert.deepEqual(request?.additionalProperties, { not: {} }, 'generated OpenAPI must reject unknown fields');
assert.equal(schemas.ProjectionDecision?.oneOf?.length, 2, 'decision must be a discriminated union');
assert.deepEqual(schemas.ProjectionDecision?.discriminator?.mapping, {
  PREPARED: '#/components/schemas/PreparedProjection',
  BLOCK: '#/components/schemas/BlockedProjection',
});

const jsonSchema = loadJson('generated/schema/ProjectionRequest.json');
assert.deepEqual(jsonSchema.unevaluatedProperties, { not: {} }, 'generated JSON Schema must reject unknown fields');
assert.equal(jsonSchema.properties?.schemaVersion?.const, 'ace.context.v3');
assert.equal(jsonSchema.properties?.protocol?.const, 'openai.responses');

const sdkTypes = readFileSync(resolve(root, 'generated/sdk/types.gen.ts'), 'utf8');
const serverTypes = readFileSync(resolve(root, '../src/generated/ace-context/v3/types.gen.ts'), 'utf8');
assert.equal(serverTypes, sdkTypes, 'ACE server types must be a byte-exact generated SDK copy');

process.stdout.write(JSON.stringify({ status: 'pass', apiVersion: openapi.info.version, routes }) + '\n');
