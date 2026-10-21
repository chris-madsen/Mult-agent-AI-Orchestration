import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
        receiptScope: 'portable-workspace',
      },
    );
    return Effect.succeed({ status: 'ok' as const, result: { ...projected } });
  },
});

const callContext = async (
  options: {
    readonly bundle?: ContextBundle;
    readonly intent?: 'locate' | 'inspect';
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
        intent: options.intent ?? 'inspect',
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
  assert.match(first.evidence[0]?.receiptId ?? '', /^receipt-v1-[a-f0-9]{64}$/u);
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

test('evidence-only receipts suppress unchanged items in a changed bundle', async () => {
  const secondEvidence: RetrievalEvidence = {
    ...evidence,
    evidenceId: 'portable-evidence-2' as RetrievalEvidence['evidenceId'],
    citation: 'src/other.ts:1-1',
    content: 'export const otherEvidence = true;',
  };
  const mixed = { ...base, evidence: [evidence, secondEvidence] };
  const changedMixed = {
    ...mixed,
    evidence: [
      { ...evidence, content: 'export function stableEvidence() { return 43; }' },
      secondEvidence,
    ],
  };
  const first = await callContext({ bundle: mixed });
  const changed = await callContext({
    bundle: changedMixed,
    knownEvidenceIds: first.evidence.map((item) => String(item.receiptId)),
  });

  assert.equal(changed.evidence[0]?.content, changedMixed.evidence[0]?.content);
  assert.notEqual(changed.evidence[0]?.contentDelivery, 'known_reference');
  assert.equal(changed.evidence[1]?.content, '');
  assert.equal(changed.evidence[1]?.contentDelivery, 'known_reference');
  assert.equal(changed.deliveryMetrics?.reusedContextBytes, Buffer.byteLength(secondEvidence.content));
});

test('exact bundle receipt can suppress the complete bundle without item ids', async () => {
  const first = await callContext();
  const repeated = await callContext({ knownBundleId: first.bundleId });
  assert.equal(repeated.evidence[0]?.content, '');
  assert.equal(repeated.evidence[0]?.contentDelivery, 'known_reference');
});

test('delivery projection changes create a new receipt even when source bytes are unchanged', async () => {
  const first = await callContext({ intent: 'locate' });
  const inspected = await callContext({
    intent: 'inspect',
    knownEvidenceIds: [String(first.evidence[0]?.receiptId)],
  });
  assert.equal(inspected.evidence[0]?.content, body);
  assert.notEqual(inspected.evidence[0]?.contentDelivery, 'known_reference');
  assert.notEqual(inspected.evidence[0]?.receiptId, first.evidence[0]?.receiptId);
});

test('unknown or stale receipts never suppress current evidence', async () => {
  const delivered = await callContext({
    knownBundleId: 'not-a-current-bundle',
    knownEvidenceIds: [String(evidence[0]?.evidenceId)],
  });

  assert.equal(delivered.evidence[0]?.content, body);
  assert.notEqual(delivered.evidence[0]?.contentDelivery, 'known_reference');
});

test('a current evidence receipt remains usable when the bundle receipt is stale', async () => {
  const first = await callContext();
  const delivered = await callContext({
    knownBundleId: 'stale-bundle-id',
    knownEvidenceIds: [String(first.evidence[0]?.receiptId)],
  });

  assert.equal(delivered.evidence[0]?.content, '');
  assert.equal(delivered.evidence[0]?.contentDelivery, 'known_reference');
});

test('receipt identity includes source class even when citation and body match', async () => {
  const documentation = await callContext({
    bundle: {
      ...base,
      evidence: [{ ...evidence, source: 'documentation' }],
    },
  });
  const code = await callContext({
    bundle: base,
    knownEvidenceIds: [String(documentation.evidence[0]?.receiptId)],
  });

  assert.equal(code.evidence[0]?.content, body);
  assert.notEqual(code.evidence[0]?.contentDelivery, 'known_reference');
  assert.notEqual(code.evidence[0]?.receiptId, documentation.evidence[0]?.receiptId);
});

test('portable receipts remain stable across an actual process restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ace-receipt-process-'));
  const scriptPath = join(directory, 'receipt-child.mjs');
  const contextModule = pathToFileURL(resolve('src/domain/context-delivery.ts')).href;
  await writeFile(scriptPath, `
    import { projectContextForDelivery } from ${JSON.stringify(contextModule)};
    const [body, knownReceipt] = process.argv.slice(2);
    const evidence = {
      evidenceId: 'process-evidence-1',
      source: 'code',
      citation: 'src/stable.ts:1-1',
      content: body,
      proofClass: 'direct',
      freshness: 'current',
    };
    const result = projectContextForDelivery({
      requestId: 'process-request',
      query: 'find stable evidence',
      evidence: [evidence],
      warnings: [],
      partialSources: [],
      complete: true,
    }, 'inspect', {
      receiptScope: 'portable-workspace',
      ...(knownReceipt === undefined ? {} : { knownEvidenceIds: [knownReceipt] }),
    });
    process.stdout.write(JSON.stringify({
      bundleId: result.bundleId,
      receiptId: result.evidence[0]?.receiptId,
      content: result.evidence[0]?.content,
    }));
  `, 'utf8');
  const runChild = (knownReceipt?: string): { readonly bundleId?: string; readonly receiptId?: string; readonly content?: string } => {
    const output = execFileSync(process.execPath, [
      '--import',
      'tsx',
      scriptPath,
      body,
      ...(knownReceipt === undefined ? [] : [knownReceipt]),
    ], { cwd: resolve('.'), encoding: 'utf8' });
    return JSON.parse(output) as { readonly bundleId?: string; readonly receiptId?: string; readonly content?: string };
  };
  try {
    const first = runChild();
    const second = runChild(first.receiptId);
    assert.equal(second.bundleId, first.bundleId);
    assert.equal(second.receiptId, first.receiptId);
    assert.equal(second.content, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
