import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Vertex DBC-14 fixtures encode one explicit synthetic code-doc contradiction', async () => {
  const [documentation, code] = await Promise.all([
    readFile('benchmarks/fixtures/vertex-docs/adr-vertex-conflict-v1.md', 'utf8'),
    readFile('benchmarks/fixtures/vertex-code/current-policy.ts', 'utf8'),
  ]);
  assert.match(documentation, /fixture_version: vertex-conflict-v1/u);
  assert.match(documentation, /symbol: aceVertexConflictPolicy/u);
  assert.match(documentation, /wait for explicit operator confirmation/u);
  assert.match(code, /aceVertexConflictPolicy/u);
  assert.match(code, /retry-immediately/u);
  assert.equal(code.includes('wait for explicit operator confirmation'), false);
});

test('Vertex synthetic import script cannot accept an arbitrary local upload path', async () => {
  const script = await readFile('scripts/vertex-synthetic-fixture-import.sh', 'utf8');
  assert.match(script, /ACE_VERTEX_SYNTHETIC_IMPORT_ACK/u);
  assert.match(script, /fixture_dir="benchmarks\/fixtures\/vertex-docs"/u);
  assert.match(script, /gcloud storage cp "\$fixture_dir"\/\*\.md/u);
  assert.equal(script.includes('ACE_VERTEX_LOCAL_SOURCE'), false);
  assert.equal(script.includes('ragCorpora"'), false, 'script must not create a new corpus');
});
