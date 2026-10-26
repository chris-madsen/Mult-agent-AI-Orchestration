import assert from 'node:assert/strict';
import test from 'node:test';
import { compareStructuralAnalyses, symbolParityFingerprint } from '../src/application/ast-grep-parity.js';
import type { StructuralAnalysis } from '../src/domain/semantic.js';

const analysis = (overrides: Partial<StructuralAnalysis> = {}): StructuralAnalysis => ({
  repoPath: 'fixture.ts',
  sourceDigest: 'a'.repeat(64) as never,
  symbols: [{
    name: 'save',
    kind: 'function',
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 30,
    startByteOffset: 0,
    endByteOffset: 30,
    isExported: true,
  }],
  hasSyntaxErrors: false,
  ...overrides,
});

test('NAPI parity comparator accepts semantically equivalent symbol/range output', () => {
  const report = compareStructuralAnalyses(analysis(), analysis());
  assert.equal(report.equivalent, true);
  assert.deepEqual(report.differences, []);
  assert.equal(typeof symbolParityFingerprint(report), 'string');
});

test('NAPI parity comparator reports missing, range, export, and syntax differences', () => {
  const report = compareStructuralAnalyses(
    analysis(),
    analysis({
      symbols: [{
        name: 'save',
        kind: 'function',
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 30,
        startByteOffset: 31,
        endByteOffset: 61,
        isExported: false,
      }],
      hasSyntaxErrors: true,
    }),
  );
  assert.equal(report.equivalent, false);
  assert.deepEqual(report.differences.map((difference) => difference.kind), [
    'range_mismatch',
    'export_mismatch',
    'syntax_mismatch',
  ]);
});

test('NAPI parity comparator reports symbol loss and additions', () => {
  const report = compareStructuralAnalyses(
    analysis({ symbols: [] }),
    analysis({ symbols: [{
      name: 'load',
      kind: 'function',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 30,
      isExported: false,
    }] }),
  );
  assert.deepEqual(report.differences.map((difference) => difference.kind), [
    'missing_from_cli',
  ]);
});


test('parity does not lose same-named overloads or class methods', () => {
  const overloads = [
    { ...analysis().symbols[0]!, startLine: 1, endLine: 1, startByteOffset: 0, endByteOffset: 30 },
    { ...analysis().symbols[0]!, startLine: 4, endLine: 4, startByteOffset: 60, endByteOffset: 90 },
  ];
  const report = compareStructuralAnalyses(
    analysis({ symbols: overloads }),
    analysis({ symbols: [overloads[1]!] }),
  );
  assert.equal(report.equivalent, false);
  assert.ok(report.differences.some((item) => item.kind === 'missing_from_napi'),
    'a Map keyed only by name+kind would lose this missing overload');
});

test('parity checks declaration extents and UTF-8 byte offsets, not just identifier anchors', () => {
  const first = analysis();
  const symbol = first.symbols[0]!;
  const withSameIdentifier = {
    ...symbol,
    nameStartLine: 1, nameStartColumn: 17, nameEndLine: 1, nameEndColumn: 21,
  };
  const changed = {
    ...withSameIdentifier,
    endColumn: 32,
    endByteOffset: 32,
  };
  const report = compareStructuralAnalyses(
    analysis({ symbols: [withSameIdentifier] }),
    analysis({ symbols: [changed] }),
  );
  assert.equal(report.equivalent, false);
  assert.ok(report.differences.some((item) => item.kind === 'range_mismatch'));
});

test('parity checks paths and import status even if digests and names match', () => {
  const imported = { ...analysis().symbols[0]!, isImport: true };
  const report = compareStructuralAnalyses(
    analysis({ symbols: [imported] }),
    analysis({ repoPath: 'other.ts', symbols: [{ ...imported, isImport: false }] }),
  );
  assert.deepEqual(report.differences.map((item) => item.kind), [
    'path_mismatch', 'import_mismatch',
  ]);
});

test('parity fingerprint differentiates equal-shape reports from different source digests', () => {
  const left = compareStructuralAnalyses(analysis(), analysis());
  const right = compareStructuralAnalyses(
    analysis({ sourceDigest: 'b'.repeat(64) as never }),
    analysis({ sourceDigest: 'b'.repeat(64) as never }),
  );
  assert.equal(left.equivalent, true);
  assert.equal(right.equivalent, true);
  assert.notEqual(symbolParityFingerprint(left), symbolParityFingerprint(right),
    'the previous fingerprint omitted both source digests');
});

test('parity report is independent of the provider symbol order', () => {
  const original = analysis().symbols[0]!;
  const symbols = [
    { ...original, startLine: 1, endLine: 1, startByteOffset: 0, endByteOffset: 30 },
    { ...original, startLine: 4, endLine: 4, startByteOffset: 60, endByteOffset: 90 },
  ];
  const expected = compareStructuralAnalyses(analysis({ symbols }), analysis({ symbols }));
  const reordered = compareStructuralAnalyses(
    analysis({ symbols: [...symbols].reverse() }),
    analysis({ symbols: [...symbols].reverse() }),
  );
  assert.equal(expected.equivalent, true);
  assert.equal(reordered.equivalent, true);
  assert.equal(symbolParityFingerprint(expected), symbolParityFingerprint(reordered));
});
