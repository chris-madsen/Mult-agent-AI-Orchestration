import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { projectContextForDelivery, contextTransportText, resolveDeliveryIntent } from '../src/domain/context-delivery.js';
import type { ContextBundle, RetrievalEvidence } from '../src/domain/retrieval.js';

const bodies = [
  'export function correctHandler() {\n  return true;\n}',
  'export function relatedHandler() {\n  return false;\n}',
  ...Array.from({ length: 4 }, (_, i) => `export function other${i}() {\n${'  const data = new Uint8Array(100);\n'.repeat(100)}  return data;\n}`),
];
const evidence: RetrievalEvidence[] = bodies.map((content, i) => ({
  evidenceId: `evidence-${i}` as RetrievalEvidence['evidenceId'],
  source: 'code',
  citation: `src/module-${i}.ts:1-104`,
  content,
  sourceDigest: createHash('sha256').update(content).digest('hex') as never,
  freshness: 'current',
  proofClass: 'direct',
  expansionHandle: `exact-original-handle-${i}`,
}));
const bundle: ContextBundle = {
  requestId: 'progressive-request' as ContextBundle['requestId'],
  query: 'find the correct handler',
  evidence,
  warnings: [],
  partialSources: [],
  complete: true,
};

test('locate mode progressively delivers source map instead of six complete bodies', () => {
  const projected = projectContextForDelivery(bundle, resolveDeliveryIntent(undefined));
  assert.equal(projected.complete, true);
  assert.equal(projected.evidence.length, 6);
  assert.equal(projected.evidence[0]?.content, bodies[0]);
  assert.equal(projected.evidence[1]?.content, bodies[1]);
  for (const [i, item] of projected.evidence.entries()) {
    assert.equal(item.expansionHandle, `exact-original-handle-${i}`);
    assert.equal(item.freshness, 'current');
    assert.equal(item.proofClass, 'direct');
    if (i >= 2) {
      assert.equal(item.contentDelivery, 'expand');
      assert.ok(item.content.startsWith('export function'));
      assert.ok(item.originalSpanLines && item.originalSpanLines > 40);
    }
  }
  const originalBytes = Buffer.byteLength(JSON.stringify(bundle));
  const projectedBytes = Buffer.byteLength(JSON.stringify(projected));
  assert.ok(projectedBytes < originalBytes / 3, `expected substantial reduction; got ${projectedBytes} / ${originalBytes}`);
});

test('inspect mode preserves the exact verified snippet bodies and original file handles', () => {
  const inspected = projectContextForDelivery(bundle, resolveDeliveryIntent('inspect'));
  assert.deepEqual(inspected, bundle);
  assert.equal(inspected.evidence[3]?.content, bodies[3]);
});

test('MCP navigation text is not another full JSON copy and gives actionable exact-expansion references', () => {
  const projected = projectContextForDelivery(bundle, 'locate');
  const text = contextTransportText(projected as unknown as Readonly<Record<string, unknown>>);
  assert.match(text, /src\/module-3\.ts:1-104/);
  assert.match(text, /ace_expand/);
  assert.doesNotMatch(text, /Uint8Array\(100\)/);
  assert.ok(Buffer.byteLength(text) < Buffer.byteLength(JSON.stringify(projected)));
});

test('long first-ranked functions use explicit on-demand delivery, never silent truncation', () => {
  const longFirst: ContextBundle = { ...bundle, evidence: [evidence[2] as RetrievalEvidence] };
  const projected = projectContextForDelivery(longFirst, 'locate');
  assert.equal(projected.evidence[0]?.contentDelivery, 'expand');
  assert.equal(projected.evidence[0]?.expansionHandle, 'exact-original-handle-2');
  assert.equal(projected.evidence[0]?.originalSpanLines, bodies[2]?.split('\n').length);
});
