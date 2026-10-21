import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createAceServer } from '../src/transport/mcp-sdk-stdio.js';
import { makeFileArtifactStore } from '../src/adapters/file-artifact-store.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeFileWorkspaceStore } from '../src/application/file-workspace-store.js';
import { makeMcpGateway } from '../src/gateway/mcp-gateway.js';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  structuralKind: 'function',
  structuralName: i < 2 ? ['correctHandler', 'relatedHandler'][i] : `other${i - 2}`,
  structuralLanguage: 'typescript',
  structuralExported: true,
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
      assert.equal(item.content, `exported function other${i - 2} [typescript]`);
      assert.ok(item.originalSpanLines && item.originalSpanLines > 40);
    }
  }
  const originalBytes = Buffer.byteLength(JSON.stringify(bundle));
  const projectedBytes = Buffer.byteLength(JSON.stringify(projected));
  assert.ok(projectedBytes < originalBytes / 3, `expected substantial reduction; got ${projectedBytes} / ${originalBytes}`);
  assert.ok((projected.deliveryMetrics?.structuredContentBytes ?? Number.MAX_SAFE_INTEGER) < originalBytes / 3);
  assert.ok((projected.deliveryMetrics?.duplicateContentBytes ?? -1) >= 0);
  assert.equal(projected.deliveryMetrics?.expansionHandleCount, 6);
  assert.ok(
    Buffer.byteLength(projected.evidence[2]?.content ?? '') < Buffer.byteLength(bodies[2] ?? ''),
    'ast-grep outline metadata must be cheaper than resending the verified body',
  );
});

test('inspect mode preserves the exact verified snippet bodies and original file handles', () => {
  const inspected = projectContextForDelivery(bundle, resolveDeliveryIntent('inspect'));
  assert.deepEqual(inspected.evidence, bundle.evidence);
  assert.equal(inspected.deliveryMetrics?.initialEvidenceBytes, bodies.reduce((total, body) => total + Buffer.byteLength(body), 0));
  assert.equal(inspected.evidence[3]?.content, bodies[3]);
});

test('MCP navigation text is not another full JSON copy and gives actionable exact-expansion references', () => {
  const projected = projectContextForDelivery(bundle, 'locate');
  const text = contextTransportText(projected as unknown as Readonly<Record<string, unknown>>);
  assert.match(text, /src\/module-3\.ts:1-104/);
  assert.match(text, /ace_expand/);
  assert.doesNotMatch(text, /Uint8Array\(100\)/);
  assert.doesNotMatch(text, /correctHandler/);
  assert.ok(Buffer.byteLength(text) < Buffer.byteLength(JSON.stringify(projected)));
});

test('long first-ranked functions use explicit on-demand delivery, never silent truncation', () => {
  const longFirst: ContextBundle = {
    ...bundle,
    evidence: [{ ...evidence[2] as RetrievalEvidence, expansionCursor: '123', expansionMaxBytes: 2048 }],
  };
  const projected = projectContextForDelivery(longFirst, 'locate');
  assert.equal(projected.evidence[0]?.contentDelivery, 'expand');
  assert.equal(projected.evidence[0]?.expansionHandle, 'exact-original-handle-2');
  assert.equal(projected.evidence[0]?.originalSpanLines, bodies[2]?.split('\n').length);
  assert.equal(projected.evidence[0]?.expansionCursor, '123');
  assert.equal(projected.evidence[0]?.expansionMaxBytes, 2048);
  assert.match(contextTransportText(projected as unknown as Readonly<Record<string, unknown>>), /cursor=123, max_bytes=2048/);
});

test('actual official MCP transport does not mirror the entire structured ContextBundle as text', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const projected = projectContextForDelivery(bundle, 'locate');
  const server = createAceServer({
    handle: () => Effect.succeed({ status: 'ok' as const, result: { ...projected } }),
  });
  const client = new Client({ name: 'progressive-context-client', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: 'ace_context', arguments: { workspace_id: 'fixture', query: 'find handler' },
    });
    assert.equal(response.isError, undefined);
    const structured = response.structuredContent as unknown as ContextBundle;
    assert.equal(structured.evidence.length, 6);
    assert.equal(structured.evidence[0]?.content, bodies[0]);
    assert.equal(structured.evidence[4]?.contentDelivery, 'expand');
    assert.equal(structured.evidence[4]?.expansionHandle, 'exact-original-handle-4');
    const textual = response.content[0];
    assert.equal(textual?.type, 'text');
    if (textual?.type !== 'text') return;
    assert.match(textual.text, /ACE source map/);
    assert.doesNotMatch(textual.text, /Uint8Array\(100\)/);
    assert.ok(Buffer.byteLength(textual.text) < Buffer.byteLength(JSON.stringify(structured)));
  } finally {
    await client.close();
    await server.close();
  }
});

test('ace_expand format=utf8 returns exact readable source instead of expensive duplicate base64', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-readable-expand-'));
  const artifacts = makeFileArtifactStore(directory);
  const source = Buffer.from('export const greeting = "Привет, 世界 🙂";\n', 'utf8');
  const stored = await Effect.runPromise(artifacts.storeExact(source));
  assert.equal(stored._tag, 'Ok');
  if (stored._tag === 'Err') return;
  const gateway = makeMcpGateway({
    clock: { nowMs: () => Date.now() },
    ids: { newRequestId: () => 'expand-test', newWorkspaceId: () => 'expand-workspace' },
    files: makeNodeWorkspacePort({ allowedRoots: [directory] }),
    store: makeFileWorkspaceStore(join(directory, 'workspaces.json')),
    artifacts,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAceServer(gateway);
  const client = new Client({ name: 'ace-readable-source-client', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: 'ace_expand',
      arguments: { handle: stored.value.handle, format: 'utf8' },
    });
    assert.equal(result.isError, undefined);
    const output = result.structuredContent as unknown as Record<string, unknown>;
    assert.equal(output.encoding, 'utf8');
    assert.equal(output.content_utf8, source.toString('utf8'));
    assert.equal(output.digest, stored.value.digest);
    assert.equal(output.total_bytes, source.length);
    assert.equal('content_base64' in output, false);
    assert.equal(result.content[0]?.type, 'text');
    if (result.content[0]?.type === 'text') {
      assert.match(result.content[0].text, /structuredContent\.content_utf8/u);
      assert.doesNotMatch(result.content[0].text, /Привет|世界/u);
      assert.ok(Buffer.byteLength(result.content[0].text) < source.length * 2);
    }

    const pages: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await client.callTool({
        name: 'ace_expand',
        arguments: {
          handle: stored.value.handle,
          format: 'utf8',
          max_bytes: 11,
          ...(cursor === undefined ? {} : { cursor }),
        },
      });
      assert.equal(page.isError, undefined);
      const resultPage = page.structuredContent as unknown as Record<string, unknown>;
      assert.equal(resultPage.encoding, 'utf8');
      pages.push(String(resultPage.content_utf8));
      cursor = typeof resultPage.next_cursor === 'string' ? resultPage.next_cursor : undefined;
      pageCount += 1;
      assert.ok(pageCount < 100);
    } while (cursor !== undefined);
    assert.ok(pageCount > 2);
    assert.equal(pages.join(''), source.toString('utf8'), 'UTF-8 pagination must preserve every original character');

    const raw = await client.callTool({
      name: 'ace_expand',
      arguments: { handle: stored.value.handle, format: 'base64' },
    });
    const bytes = raw.structuredContent as unknown as Record<string, unknown>;
    assert.deepEqual(Buffer.from(String(bytes.content_base64), 'base64'), source);
  } finally {
    await client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stable evidence receipts suppress unchanged bodies without hidden server state', () => {
  const first = projectContextForDelivery(bundle, 'inspect');
  assert.match(first.bundleId ?? '', /^[a-f0-9]{64}$/u);
  const repeated = projectContextForDelivery(
    { ...bundle, requestId: 'another-request' as ContextBundle['requestId'] },
    'inspect',
    {
      knownBundleId: first.bundleId,
      knownEvidenceIds: [String(first.evidence[0]?.evidenceId), String(first.evidence[3]?.evidenceId)],
    },
  );
  assert.equal(repeated.bundleId, first.bundleId, 'bundle identity must not depend on request id');
  assert.equal(repeated.supersedesBundleId, first.bundleId);
  assert.equal(repeated.evidence[0]?.content, '');
  assert.equal(repeated.evidence[0]?.contentDelivery, 'known_reference');
  assert.equal(repeated.evidence[3]?.content, '');
  assert.equal(repeated.evidence[3]?.contentDelivery, 'known_reference');
  assert.equal(repeated.evidence[1]?.content, bodies[1]);
  const expectedReused = Buffer.byteLength(bodies[0] ?? '') + Buffer.byteLength(bodies[3] ?? '');
  assert.equal(repeated.deliveryMetrics?.reusedContextBytes, expectedReused);
  assert.equal(repeated.deliveryMetrics?.duplicateContextBytesAvoided, expectedReused);
  assert.equal(repeated.deliveryMetrics?.newContextBytes,
    bodies.reduce((total, body, index) => total + ([0, 3].includes(index) ? 0 : Buffer.byteLength(body)), 0));
  assert.equal(repeated.deliveryMetrics?.uniqueEvidenceCount, evidence.length);
  assert.equal(repeated.deliveryMetrics?.initialEvidenceBytes,
    bodies.reduce((total, body) => total + Buffer.byteLength(body), 0));
  assert.match(
    contextTransportText(repeated as unknown as Readonly<Record<string, unknown>>),
    /caller supplied stable evidence receipt/u,
  );
});

test('unknown evidence receipts do not suppress any verified body', () => {
  const delivered = projectContextForDelivery(bundle, 'inspect', {
    knownEvidenceIds: ['not-present'],
  });
  assert.deepEqual(delivered.evidence.map((item) => item.content), bodies);
  assert.equal(delivered.deliveryMetrics?.reusedContextBytes, 0);
});


test('source-aware delivery collapses duplicate code spans but preserves independent cross-source provenance', () => {
  const canonical = evidence[0] as RetrievalEvidence;
  const uncertainDuplicate: RetrievalEvidence = {
    ...canonical,
    evidenceId: 'duplicate-code-hit' as RetrievalEvidence['evidenceId'],
    proofClass: 'uncertain',
    expansionHandle: undefined,
  };
  const documentation: RetrievalEvidence = {
    evidenceId: 'matching-doc' as RetrievalEvidence['evidenceId'],
    source: 'documentation',
    citation: 'docs/handler.md',
    content: canonical.content,
    sourceDigest: canonical.sourceDigest,
    freshness: 'current',
    proofClass: 'derived',
  };
  const delivered = projectContextForDelivery({
    ...bundle,
    evidence: [uncertainDuplicate, canonical, documentation],
  }, 'inspect');

  assert.equal(delivered.evidence.length, 2);
  assert.equal(delivered.evidence[0]?.evidenceId, canonical.evidenceId);
  assert.equal(delivered.evidence[0]?.proofClass, 'direct');
  assert.equal(delivered.evidence[0]?.expansionHandle, canonical.expansionHandle);
  assert.equal(delivered.evidence[1]?.source, 'documentation');
  assert.equal(delivered.evidence[1]?.content, canonical.content);
  assert.equal(delivered.deliveryMetrics?.uniqueEvidenceCount, 2);
});
