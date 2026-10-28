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
    assert.equal(result.value.selected.length, 1);
    assert.equal(result.value.truncated, true);
    assert.ok(result.value.limitations.length > 0);
  }
});

test('ContextAssembler rejects invalid budgets before packing', async () => {
  const result = await Effect.runPromise(makeContextAssembler().assemble({ budgetTokens: 0, evidence: [] }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
});


test('ContextAssembler deduplicates identical exact spans across providers despite different receipts', async () => {
  const code = {
    ...evidence('code', 'code', 'export function run() {}'),
    receiptId: 'code-receipt' as never,
    sourceDigest: 'a'.repeat(64) as never,
    citation: 'src/run.ts:1',
  };
  const structural = {
    ...evidence('outline', 'structural', 'export function run() {}'),
    receiptId: 'structural-receipt' as never,
    sourceDigest: code.sourceDigest,
    citation: code.citation,
  };
  const result = await Effect.runPromise(makeContextAssembler().assemble({
    budgetTokens: 200,
    evidence: [structural, code],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.deepEqual(result.value.selected.map((item) => item.evidenceId), [code.evidenceId]);
    assert.equal(result.value.omitted.length, 1);
    assert.equal(result.value.truncated, false, 'deduplication is not budget truncation');
    assert.deepEqual(result.value.limitations, []);
  }
});

test('ContextAssembler does not collapse distinct LSP relationships sharing a citation and digest', async () => {
  const base = {
    ...evidence('def', 'lsp', 'definition: function run'),
    sourceDigest: 'b'.repeat(64) as never,
    citation: 'src/run.ts:1',
  };
  const result = await Effect.runPromise(makeContextAssembler().assemble({
    budgetTokens: 200,
    evidence: [base, { ...base, evidenceId: 'ref' as never, content: 'references: src/caller.ts:8' }],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.equal(result.value.selected.length, 2);
});

test('ContextAssembler distinguishes a budget omission from duplicate suppression', async () => {
  const first = evidence('first', 'code', 'some code');
  const second = evidence('second', 'documentation', 'this documentation is too large to include');
  const result = await Effect.runPromise(makeContextAssembler().assemble({
    budgetTokens: 8,
    evidence: [first, second],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.selected.length, 1);
    assert.equal(result.value.truncated, true);
    assert.match(result.value.limitations[0] ?? '', /context budget/u);
  }
});

test('ContextAssembler enforces explicit section token caps independently of the global budget', async () => {
  const result = await Effect.runPromise(makeContextAssembler().assemble({
    budgetTokens: 30,
    sectionBudgets: { code: 4, repo_map: 4, lsp: 4, other: 4 },
    evidence: [
      evidence('code', 'code', 'code'),
      evidence('map', 'structural', 'map'),
      evidence('lsp', 'lsp', 'lsp'),
      evidence('docs', 'documentation', 'docs'),
    ],
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.deepEqual(result.value.sectionBudgets, { code: 4, repo_map: 4, lsp: 4, other: 4 });
    assert.ok(result.value.sectionUsage.code <= 4);
    assert.ok(result.value.sectionUsage.repo_map <= 4);
    assert.ok(result.value.sectionUsage.lsp <= 4);
    assert.ok(result.value.sectionUsage.other <= 4);
  }
});


test('ContextAssembler rejects malformed section budgets instead of silently changing policy', async () => {
  const assembler = makeContextAssembler();
  for (const sectionBudgets of [
    { code: -1 },
    { repo_map: 1.5 },
    { lsp: Number.NaN },
    { other: Number.POSITIVE_INFINITY },
  ]) {
    const result = await Effect.runPromise(assembler.assemble({
      budgetTokens: 30,
      sectionBudgets,
      evidence: [],
    }));
    assert.equal(result._tag, 'Err');
    if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
  }
});
