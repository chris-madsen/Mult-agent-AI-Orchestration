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
