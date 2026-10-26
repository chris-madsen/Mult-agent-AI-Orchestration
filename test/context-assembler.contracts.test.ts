import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { makeContextAssembler } from '../src/application/context-assembler.js';
import type { RetrievalEvidence } from '../src/domain/retrieval.js';

const evidence = (id: string, source: RetrievalEvidence['source'], content: string): RetrievalEvidence => ({
  evidenceId: id as never,
  source,
  citation: `${source}:${id}`,
  content,
  proofClass: 'direct',
  freshness: 'current',
});

test('ContextAssembler prioritizes code, deduplicates receipts, and respects the budget', async () => {
  const assembler = makeContextAssembler();
  const result = await Effect.runPromise(assembler.assemble({
    budgetTokens: 20,
    evidence: [
      evidence('docs', 'documentation', 'documentation should be lower priority'),
      { ...evidence('code', 'code', 'authoritative code'), receiptId: 'code-receipt' as never, citation: 'code:shared' },
      { ...evidence('duplicate', 'code', 'authoritative code'), receiptId: 'code-receipt' as never, citation: 'code:shared' },
      evidence('lsp', 'lsp', 'definition relationship'),
    ],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.selected[0]?.source, 'code');
    assert.equal(result.value.selected.length, 2);
    assert.equal(result.value.truncated, true);
    assert.ok(result.value.limitations.length > 0);
  }
});

test('ContextAssembler rejects invalid budgets before packing', async () => {
  const result = await Effect.runPromise(makeContextAssembler().assemble({ budgetTokens: 0, evidence: [] }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
});
