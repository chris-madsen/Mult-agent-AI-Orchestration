import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { buildRepoMapDelta } from '../src/adapters/repo-map-structural.js';
import type { CodeCandidate } from '../src/domain/retrieval.js';
import { applyRepoMapDelta, emptyRepoMapGraph, rankRepoMap } from '../src/domain/repo-map.js';

const candidate = (name: string, line: number): CodeCandidate => ({
  candidateId: `${name}-candidate` as never,
  workspaceId: 'workspace' as never,
  repoPath: 'src/example.ts' as never,
  range: { startLine: line, startColumn: 1, endLine: line, endColumn: name.length + 1 },
  symbolName: name,
  structuralKind: 'function',
  structuralLanguage: 'typescript',
  structuralExported: true,
  semanticAnchor: { line, byteColumn: 1, endLine: line, endByteColumn: name.length + 1 },
  text: `function ${name}() {}`,
  sourceDigest: 'a'.repeat(64) as never,
  generation: 1 as never,
  indexedAtMs: 1,
  invalidated: false,
});

test('RepoMap structural adapter does not invent reference edges when only outline symbols are available', async () => {
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [candidate('one', 1), candidate('two', 2)],
    sourceBytesByPath: new Map([['src/example.ts' as never, new TextEncoder().encode('one\\ntwo\\n')]]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    assert.equal(result.value.upserted.length, 2);
    assert.deepEqual(result.value.upserted.map((symbol) => symbol.references), [[], []]);
  }
});

test('RepoMap structural adapter builds same-file reference edges from shared provider records without LSP', async () => {
  const target = candidate('target', 1);
  const caller = {
    ...candidate('caller', 2),
    range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 35 },
    semanticAnchor: { line: 2, byteColumn: 10, endLine: 2, endByteColumn: 16 },
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [target, caller],
    structuralAnalyses: [{
      repoPath: 'src/example.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [
        { name: 'target', startLine: 1, startColumn: 10, endLine: 1, endColumn: 16, startByteOffset: 9, endByteOffset: 15 },
        { name: 'caller', startLine: 2, startColumn: 10, endLine: 2, endColumn: 16, startByteOffset: 30, endByteOffset: 36 },
        { name: 'target', startLine: 2, startColumn: 21, endLine: 2, endColumn: 27, startByteOffset: 41, endByteOffset: 47 },
      ],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([[
      'src/example.ts' as never,
      new TextEncoder().encode('function target() {}\nfunction caller() { target(); }\n'),
    ]]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const targetSymbol = result.value.upserted.find((symbol) => symbol.name === 'target');
    const callerSymbol = result.value.upserted.find((symbol) => symbol.name === 'caller');
    assert.deepEqual(callerSymbol?.references, [{ targetId: targetSymbol?.id, kind: 'reference' }]);
  }
});

test('RepoMap structural adapter builds cross-file reference edges from shared provider records without LSP', async () => {
  const target = {
    ...candidate('target', 1),
    repoPath: 'src/target.ts' as never,
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [target],
    structuralAnalyses: [{
      repoPath: 'src/caller.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [
        { name: 'target', startLine: 1, startColumn: 1, endLine: 1, endColumn: 7, startByteOffset: 0, endByteOffset: 6 },
      ],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([
      ['src/target.ts' as never, new TextEncoder().encode('function target() {}\n')],
      ['src/caller.ts' as never, new TextEncoder().encode('target();\n')],
    ]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const targetSymbol = result.value.upserted.find((symbol) => symbol.name === 'target');
    const fileAnchor = result.value.upserted.find((symbol) => symbol.repoPath === 'src/caller.ts');
    assert.equal(fileAnchor?.kind, 'repo-map-file-anchor');
    assert.deepEqual(fileAnchor?.references, [{ targetId: targetSymbol?.id, kind: 'reference' }]);
    const ranked = rankRepoMap(
      applyRepoMapDelta(emptyRepoMapGraph(), result.value),
      { query: '', openFiles: [], mentionedFiles: [], tokenBudget: 32 },
    );
    assert.equal(ranked[0]?.symbol.id, targetSymbol?.id);
    assert.ok((ranked[0]?.score ?? 0) > 0);
  }
});

test('RepoMap structural adapter does not create file anchors for unresolved top-level identifiers', async () => {
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [],
    structuralAnalyses: [{
      repoPath: 'src/caller.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [
        { name: 'externalCall', startLine: 1, startColumn: 1, endLine: 1, endColumn: 13, startByteOffset: 0, endByteOffset: 12 },
      ],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([[
      'src/caller.ts' as never,
      new TextEncoder().encode('externalCall();\n'),
    ]]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.deepEqual(result.value.upserted, []);
});

test('RepoMap incremental delta upserts an unchanged caller when a definition first appears', async () => {
  const callerAnalysis = {
    repoPath: 'src/caller.ts',
    sourceDigest: 'a'.repeat(64) as never,
    symbols: [],
    identifiers: [
      { name: 'target', startLine: 1, startColumn: 1, endLine: 1, endColumn: 7, startByteOffset: 0, endByteOffset: 6 },
    ],
    hasSyntaxErrors: false,
  } as const;
  const sources = new Map([
    ['src/caller.ts' as never, new TextEncoder().encode('target();\n')],
    ['src/target.ts' as never, new TextEncoder().encode('function target() {}\n')],
  ]);
  const before = await Effect.runPromise(buildRepoMapDelta({
    candidates: [],
    structuralAnalyses: [callerAnalysis],
    sourceBytesByPath: sources,
  }));
  assert.equal(before._tag, 'Ok');
  if (before._tag === 'Err') return;
  assert.deepEqual(before.value.upserted, []);

  const target = { ...candidate('target', 1), repoPath: 'src/target.ts' as never };
  const incremental = await Effect.runPromise(buildRepoMapDelta({
    candidates: [target],
    structuralAnalyses: [callerAnalysis],
    sourceBytesByPath: sources,
    upsertPaths: new Set(['src/target.ts' as never]),
  }));
  assert.equal(incremental._tag, 'Ok');
  if (incremental._tag === 'Ok') {
    assert.deepEqual(
      incremental.value.upserted.map((symbol) => symbol.repoPath).sort(),
      ['src/caller.ts', 'src/target.ts'],
    );
    const targetSymbol = incremental.value.upserted.find((symbol) => symbol.name === 'target');
    const callerAnchor = incremental.value.upserted.find((symbol) => symbol.kind === 'repo-map-file-anchor');
    assert.deepEqual(callerAnchor?.references, [{ targetId: targetSymbol?.id, kind: 'reference' }]);
  }
});

test('RepoMap structural adapter preserves recursive references', async () => {
  const recursive = {
    ...candidate('recursive', 1),
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 45 },
    semanticAnchor: { line: 1, byteColumn: 10, endLine: 1, endByteColumn: 19 },
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [recursive],
    structuralAnalyses: [{
      repoPath: 'src/example.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [
        { name: 'recursive', startLine: 1, startColumn: 10, endLine: 1, endColumn: 19, startByteOffset: 9, endByteOffset: 18 },
        { name: 'recursive', startLine: 1, startColumn: 24, endLine: 1, endColumn: 33, startByteOffset: 23, endByteOffset: 32 },
      ],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([[
      'src/example.ts' as never,
      new TextEncoder().encode('function recursive() { recursive(); }\n'),
    ]]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const symbol = result.value.upserted[0];
    assert.deepEqual(symbol?.references, [{ targetId: symbol?.id, kind: 'reference' }]);
  }
});


test('RepoMap preserves repeated reference frequency using shared ast-grep occurrences, not LSP', async () => {
  const target = candidate('target', 1);
  const caller = {
    ...candidate('caller', 2),
    range: { startLine: 2, startColumn: 1, endLine: 6, endColumn: 2 },
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [target, caller],
    structuralAnalyses: [{
      repoPath: 'src/example.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [
        { name: 'target', startLine: 1, startColumn: 1, endLine: 1, endColumn: 7, startByteOffset: 0, endByteOffset: 6 },
        ...[3, 4, 5].map((line, i) => ({
          name: 'target',
          startLine: line,
          startColumn: 3,
          endLine: line,
          endColumn: 9,
          startByteOffset: 22 + i * 11,
          endByteOffset: 28 + i * 11,
        })),
      ],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([[
      'src/example.ts' as never,
      new TextEncoder().encode('target()\ncaller() {\n  target()\n  target()\n  target()\n}\n'),
    ]]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const targetSymbol = result.value.upserted.find((symbol) => symbol.name === 'target');
    const callerSymbol = result.value.upserted.find((symbol) => symbol.name === 'caller');
    assert.deepEqual(callerSymbol?.references, [{
      targetId: targetSymbol?.id,
      kind: 'reference',
      weight: 3,
    }]);
  }
});

test('RepoMap name reference connects all definitions instead of selecting a fabricated winner', async () => {
  const a = { ...candidate('target', 1), repoPath: 'src/a.ts' as never };
  const b = { ...candidate('target', 1), repoPath: 'src/b.ts' as never };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [a, b],
    structuralAnalyses: [{
      repoPath: 'src/caller.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [{
        name: 'target', startLine: 1, startColumn: 1,
        endLine: 1, endColumn: 7, startByteOffset: 0, endByteOffset: 6,
      }],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([
      ['src/a.ts' as never, new TextEncoder().encode('target()\n')],
      ['src/b.ts' as never, new TextEncoder().encode('target()\n')],
      ['src/caller.ts' as never, new TextEncoder().encode('target()\n')],
    ]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  const targets = result.value.upserted.filter((symbol) => symbol.name === 'target');
  const caller = result.value.upserted.find((symbol) => symbol.repoPath === 'src/caller.ts');
  assert.equal(targets.length, 2);
  assert.deepEqual(
    caller?.references.map((reference) => reference.targetId),
    targets.map((symbol) => symbol.id).sort(),
  );
});

test('RepoMap counts one reference per defining file even when that file defines the same name twice', async () => {
  const first = candidate('target', 1);
  const second = candidate('target', 2);
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [first, second],
    structuralAnalyses: [{
      repoPath: 'src/caller.ts',
      sourceDigest: 'a'.repeat(64) as never,
      symbols: [],
      identifiers: [{
        name: 'target', startLine: 1, startColumn: 1,
        endLine: 1, endColumn: 7, startByteOffset: 0, endByteOffset: 6,
      }],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([
      ['src/example.ts' as never, new TextEncoder().encode('target()\ntarget()\n')],
      ['src/caller.ts' as never, new TextEncoder().encode('target()\n')],
    ]),
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') return;
  const caller = result.value.upserted.find((symbol) => symbol.repoPath === 'src/caller.ts');
  assert.equal(caller?.references.length, 1);
  assert.equal(caller?.references[0]?.weight ?? 1, 1);
});

test('RepoMap only retains exact digest-bound source bytes for rendering, never stale index text', async () => {
  const source = new TextEncoder().encode('export function verified() {\n  return 42;\n}\n');
  const digest = createHash('sha256').update(source).digest('hex');
  const verified = { ...candidate('verified', 1), sourceDigest: digest as never };
  const input = {
    candidates: [verified],
    structuralAnalyses: [{
      repoPath: verified.repoPath,
      sourceDigest: digest as never,
      symbols: [],
      identifiers: [],
      hasSyntaxErrors: false,
    }],
    sourceBytesByPath: new Map([[verified.repoPath, source]]),
  };
  const result = await Effect.runPromise(buildRepoMapDelta(input));
  assert.equal(result._tag, 'Ok');
  if (result._tag !== 'Ok') return;
  assert.equal(result.value.sourceByPath?.[0]?.text, new TextDecoder().decode(source));
  assert.equal(result.value.sourceByPath?.[0]?.sourceDigest, digest);
  const stale = await Effect.runPromise(buildRepoMapDelta({
    ...input,
    structuralAnalyses: [{ ...input.structuralAnalyses[0]!, sourceDigest: 'a'.repeat(64) as never }],
  }));
  assert.equal(stale._tag, 'Ok');
  if (stale._tag === 'Ok') assert.deepEqual(stale.value.sourceByPath, [],
    'source digest disagreement must never authorize a stale source excerpt');
});
