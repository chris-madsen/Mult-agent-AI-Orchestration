import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeRequestId,
  makeEvidenceId,
  mergeEvidence,
  type RetrievalEvidence,
} from '../src/domain/retrieval.js';
import {
  dedupeEvidenceForDelivery as deduplicateEvidenceForDelivery,
  projectContextForDelivery,
} from '../src/domain/context-delivery.js';

const id = (value: string) => {
  const result = makeEvidenceId(value);
  if (result._tag === 'Err') throw new Error(result.error.message);
  return result.value;
};

const code = (
  evidenceId: string,
  citation: string,
  content: string,
  structuralName?: string,
  conflictValue?: string,
  sourceDigest = 'a'.repeat(64),
): RetrievalEvidence => ({
  evidenceId: id(evidenceId),
  source: 'code',
  citation,
  content,
  sourceDigest: sourceDigest as RetrievalEvidence['sourceDigest'],
  proofClass: 'direct',
  freshness: 'current',
  ...(structuralName === undefined ? {} : { structuralName }),
  ...(conflictValue === undefined ? {} : { conflictKey: 'decision', conflictValue }),
});

test('source-aware dedupe removes the same verified code span even when evidence ids differ', () => {
  const result = deduplicateEvidenceForDelivery([
    code('first', 'src/a.ts:10-20', 'same body', 'run'),
    code('second', 'src/a.ts:10-20', 'same body', 'run'),
  ]);
  assert.deepEqual(result.map((item) => item.evidenceId), [id('first')]);
  assert.deepEqual(result[0]?.equivalentEvidenceIds, [id('second')]);
});

test('nested code ranges remain independent evidence while distinct symbols survive', () => {
  const result = deduplicateEvidenceForDelivery([
    code('outer', 'src/a.ts:10-30', 'function run() { /* verified */ }', 'run'),
    code('inner-same', 'src/a.ts:12-18', 'return verified();', 'run'),
    code('inner-other', 'src/a.ts:20-25', 'function helper() {}', 'helper'),
  ]);
  assert.deepEqual(result.map((item) => item.evidenceId), [id('outer'), id('inner-same'), id('inner-other')]);
});

test('different source digests remain distinct even when citation and body match', () => {
  const result = deduplicateEvidenceForDelivery([
    code('old', 'src/a.ts:10-20', 'same body', 'run', undefined, 'a'.repeat(64)),
    code('new', 'src/a.ts:10-20', 'same body', 'run', undefined, 'b'.repeat(64)),
  ]);
  assert.deepEqual(result.map((item) => item.evidenceId), [id('old'), id('new')]);
});

test('dedupe never collapses different source classes or conflicting claims', () => {
  const documentation: RetrievalEvidence = {
    evidenceId: id('docs'),
    source: 'documentation',
    citation: 'docs/spec.md#decision',
    content: 'same body',
    proofClass: 'derived',
    freshness: 'current',
  };
  const memory: RetrievalEvidence = {
    ...documentation,
    evidenceId: id('memory'),
    source: 'memory',
    citation: 'archive://episode/1',
  };
  const result = deduplicateEvidenceForDelivery([
    documentation,
    memory,
    code('claim-a', 'src/a.ts:10-20', 'same span', 'run', 'A'),
    code('claim-b', 'src/a.ts:10-20', 'same span', 'run', 'B'),
  ]);
  assert.equal(result.length, 4);
});

test('delivery dedupe keeps conflict ids resolvable through canonical aliases', () => {
  const codeFirst = code('claim-code-first', 'src/a.ts:10-20', 'same span', 'run', 'A');
  const codeSecond = code('claim-code-second', 'src/a.ts:10-20', 'same span', 'run', 'A');
  const documentation: RetrievalEvidence = {
    evidenceId: id('claim-docs'),
    source: 'documentation',
    citation: 'docs/spec.md#decision',
    content: 'different claim',
    proofClass: 'derived',
    freshness: 'current',
    conflictKey: 'decision',
    conflictValue: 'B',
  };
  const requestId = makeRequestId('dedupe-conflict-request');
  assert.equal(requestId._tag, 'Ok');
  if (requestId._tag === 'Err') return;
  const merged = mergeEvidence(requestId.value, 'decision', [codeFirst, codeSecond, documentation]);
  const projected = projectContextForDelivery(merged, 'inspect');

  assert.equal(projected.evidence.length, 2);
  assert.deepEqual(projected.evidence[0]?.equivalentEvidenceIds, [codeSecond.evidenceId]);
  assert.deepEqual(
    new Set(projected.conflicts?.[0]?.evidenceIds),
    new Set([codeFirst.evidenceId, codeSecond.evidenceId, documentation.evidenceId]),
  );
});
