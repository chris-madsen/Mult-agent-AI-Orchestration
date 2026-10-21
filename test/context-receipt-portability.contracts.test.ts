import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { Effect } from 'effect';
import { createAceServer } from '../src/transport/mcp-sdk-stdio.js';
import { projectContextForDelivery } from '../src/domain/context-delivery.js';
import type { ContextBundle, RetrievalEvidence } from '../src/domain/retrieval.js';

const body = 'export function stableEvidence() { return 42; }';
const evidence: RetrievalEvidence = {
  evidenceId: 'portable-evidence-1' as RetrievalEvidence['evidenceId'],
  source: 'code',
  citation: 'src/stable.ts:1-1',
  content: body,
  proofClass: 'direct',
  freshness: 'current',
  expansionHandle: 'portable-handle-1',
};
const base: ContextBundle = {
  requestId: 'portable-request' as ContextBundle['requestId'],
  query: 'find stable evidence',
  evidence: [evidence],
  warnings: [],
  partialSources: [],
  complete: true,
};

const changedBase: ContextBundle = {
  ...base,
  evidence: [{
    ...evidence,
    citation: 'src/stable.ts:1-2',
    content: 'export function stableEvidence() { return 43; }',
    sourceDigest: 'b'.repeat(64) as RetrievalEvidence['sourceDigest'],
  }],
};

const makeStatelessServer = (bundle: ContextBundle = base) => createAceServer({
  handle: (call) => {
    const args = call.arguments as {
      intent?: string;
      known_bundle_id?: string;
      known_evidence_ids?: readonly string[];
    };
    const projected = projectContextForDelivery(
      bundle,
      args.intent === 'inspect' ? 'inspect' : 'locate',
      {
        ...(args.known_bundle_id === undefined ? {} : { knownBundleId: args.known_bundle_id }),
        ...(args.known_evidence_ids === undefined ? {} : { knownEvidenceIds: args.known_evidence_ids }),
      },
    );
    return Effect.succeed({ status: 'ok' as const, result: { ...projected } });
  },
});

const callContext = async (
  options: {
    readonly bundle?: ContextBundle;
    readonly knownBundleId?: string;
    readonly knownEvidenceIds?: readonly string[];
  } = {},
): Promise<ContextBundle> => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = makeStatelessServer(options.bundle);
  const client = new Client({ name: 'portable-receipt-client', version: '1.0.0' });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: 'ace_context',
      arguments: {
        workspace_id: 'portable-workspace',
        query: 'find stable evidence',
        intent: 'inspect',
        ...(options.knownBundleId === undefined ? {} : { known_bundle_id: options.knownBundleId }),
        ...(options.knownEvidenceIds === undefined ? {} : { known_evidence_ids: options.knownEvidenceIds }),
        working_context: {
          focused_path: 'src/stable.ts',
          open_paths: ['src/stable.ts'],
          focused_range: { start_line: 1, end_line: 1 },
        },
      },
    });
    assert.equal(response.isError, undefined);
    return response.structuredContent as unknown as ContextBundle;
  } finally {
    await client.close();
    await server.close();
  }
};

test('stable evidence receipts survive independent MCP client/server instances', async () => {
  const first = await callContext();
  const firstBundleId = first.bundleId;
  assert.match(firstBundleId ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(first.evidence[0]?.content, body);
  if (firstBundleId === undefined) throw new Error('first response did not include a bundle id');

  const second = await callContext({
    knownBundleId: firstBundleId,
    knownEvidenceIds: first.evidence.map((item) => String(item.evidenceId)),
  });

  assert.equal(second.bundleId, first.bundleId);
  assert.equal(second.supersedesBundleId, first.bundleId);
  assert.equal(second.evidence[0]?.content, '');
  assert.equal(second.evidence[0]?.contentDelivery, 'known_reference');
  assert.equal(second.deliveryMetrics?.reusedContextBytes, Buffer.byteLength(body));
  assert.equal(second.deliveryMetrics?.duplicateContextBytesAvoided, Buffer.byteLength(body));
  assert.equal(second.deliveryMetrics?.newContextBytes, 0);
});

test('changed digest, range, and content are delivered as new evidence', async () => {
  const first = await callContext();
  const firstBundleId = first.bundleId;
  if (firstBundleId === undefined) throw new Error('first response did not include a bundle id');
  const changed = await callContext({
    bundle: changedBase,
    knownBundleId: firstBundleId,
    knownEvidenceIds: first.evidence.map((item) => String(item.evidenceId)),
  });

  assert.notEqual(changed.bundleId, first.bundleId);
  assert.equal(changed.evidence[0]?.content, changedBase.evidence[0]?.content);
  assert.notEqual(changed.evidence[0]?.contentDelivery, 'known_reference');
  assert.equal(changed.deliveryMetrics?.reusedContextBytes, 0);
});

test('unknown or stale receipts never suppress current evidence', async () => {
  const delivered = await callContext({
    knownBundleId: 'not-a-current-bundle',
    knownEvidenceIds: [String(evidence[0]?.evidenceId)],
  });

  assert.equal(delivered.evidence[0]?.content, body);
  assert.notEqual(delivered.evidence[0]?.contentDelivery, 'known_reference');
});
