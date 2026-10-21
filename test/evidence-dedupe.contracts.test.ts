import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deduplicateEvidenceForDelivery,
  makeEvidenceId,
  type RetrievalEvidence,
} from '../src/domain/retrieval.js';

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
): RetrievalEvidence => ({
  evidenceId: id(evidenceId),
  source: 'code',
  citation,
  content,
  sourceDigest: 'a'.repeat(64) as RetrievalEvidence['sourceDigest'],
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
  assert.equal(result.suppressed, 1);
  assert.deepEqual(result.evidence.map((item) => item.evidenceId), [id('first')]);
});

test('later nested code for the same structural symbol is suppressed but distinct symbols survive', () => {
  const result = deduplicateEvidenceForDelivery([
    code('outer', 'src/a.ts:10-30', 'function run() { /* verified */ }', 'run'),
    code('inner-same', 'src/a.ts:12-18', 'return verified();', 'run'),
    code('inner-other', 'src/a.ts:20-25', 'function helper() {}', 'helper'),
  ]);
  assert.equal(result.suppressed, 1);
  assert.deepEqual(result.evidence.map((item) => item.evidenceId), [id('outer'), id('inner-other')]);
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
  assert.equal(result.suppressed, 0);
  assert.equal(result.evidence.length, 4);
});
