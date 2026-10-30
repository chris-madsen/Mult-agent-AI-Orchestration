import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildRepoMapDelta } from '../src/adapters/repo-map-structural.js';
import type { SemanticAnalysisPort } from '../src/application/ports.js';
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

const semantics: SemanticAnalysisPort = {
  definition: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
  typeInfo: () => Effect.succeed({ _tag: 'Ok', value: undefined } as never),
  diagnostics: () => Effect.succeed({ _tag: 'Ok', value: [] } as never),
  references: ({ repoPath, line }) => Effect.succeed({
    _tag: 'Ok',
    value: [{
      location: {
        repoPath,
        startLine: line === 1 ? 2 : 1,
        startColumn: 1,
        endLine: line === 1 ? 2 : 1,
        endColumn: line === 1 ? 4 : 4,
      },
      isDefinition: line !== 1,
    }],
  } as never),
};

test('RepoMap structural adapter binds LSP references to provenance-bound symbols', async () => {
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [candidate('one', 1), candidate('two', 2)],
    semantics,
    sourceBytesByPath: new Map([['src/example.ts' as never, new TextEncoder().encode('one\ntwo\n')]]),
    snapshotIdentity: 'snapshot',
    requestId: 'request',
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const one = result.value.upserted.find((symbol) => symbol.name === 'one');
    const two = result.value.upserted.find((symbol) => symbol.name === 'two');
    // references(one) yields call sites *using one*, so the edge is two -> one.
    // A definition location is not a call-site edge.
    assert.deepEqual(one?.references, []);
    assert.deepEqual(two?.references, [{ targetId: one?.id, kind: 'reference' }]);
  }
});

test('RepoMap attributes interior call sites to the enclosing declaration, not exact symbol boundaries', async () => {
  const top = candidate('top', 1);
  const caller = {
    ...candidate('caller', 2),
    range: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 15 },
  };
  const useSites: SemanticAnalysisPort = {
    ...semantics,
    references: ({ line }) => Effect.succeed({
      _tag: 'Ok',
      value: line === 1 ? [{
        location: {
          repoPath: 'src/example.ts',
          startLine: 3, startColumn: 3, endLine: 3, endColumn: 6,
        },
        isDefinition: false,
      }] : [],
    } as never),
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [top, caller],
    semantics: useSites,
    sourceBytesByPath: new Map([[
      'src/example.ts' as never,
      new TextEncoder().encode('top()\ncaller() {\n  top()\n}\n'),
    ]]),
    snapshotIdentity: 'snapshot',
    requestId: 'request',
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') {
    const first = result.value.upserted.find((symbol) => symbol.name === 'top');
    const second = result.value.upserted.find((symbol) => symbol.name === 'caller');
    assert.deepEqual(second?.references, [{ targetId: first?.id, kind: 'reference' }]);
    assert.deepEqual(first?.references, []);
  }
});

test('RepoMap ignores definition locations and references outside verified source ranges', async () => {
  const one = candidate('one', 1);
  const unreachable: SemanticAnalysisPort = {
    ...semantics,
    references: () => Effect.succeed({
      _tag: 'Ok',
      value: [{
        location: { repoPath: 'other.ts', startLine: 3, startColumn: 1, endLine: 3, endColumn: 4 },
        isDefinition: false,
      }, {
        location: { repoPath: 'src/example.ts', startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 },
        isDefinition: true,
      }],
    } as never),
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [one],
    semantics: unreachable,
    sourceBytesByPath: new Map([['src/example.ts' as never, new TextEncoder().encode('one()\n')]]),
    snapshotIdentity: 'snapshot',
    requestId: 'request',
  }));
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Ok') assert.deepEqual(result.value.upserted[0]?.references, []);
});

test('RepoMap structural adapter does not invent reference edges when only outline symbols are available', async () => {
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [candidate('one', 1), candidate('two', 2)],
    sourceBytesByPath: new Map([['src/example.ts' as never, new TextEncoder().encode('one\\ntwo\\n')]]),
    snapshotIdentity: 'snapshot',
    requestId: 'request',
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


test('RepoMap preserves repeated reference frequency for Aider-style sqrt weighting', async () => {
  const target = candidate('target', 1);
  const caller = {
    ...candidate('caller', 2),
    range: { startLine: 2, startColumn: 1, endLine: 6, endColumn: 2 },
  };
  const repeated: SemanticAnalysisPort = {
    ...semantics,
    references: ({ line }) => Effect.succeed({
      _tag: 'Ok',
      value: line === 1 ? [3, 4, 5].map((referenceLine) => ({
        location: {
          repoPath: 'src/example.ts',
          startLine: referenceLine,
          startColumn: 3,
          endLine: referenceLine,
          endColumn: 9,
        },
        isDefinition: false,
      })) : [],
    } as never),
  };
  const result = await Effect.runPromise(buildRepoMapDelta({
    candidates: [target, caller],
    semantics: repeated,
    sourceBytesByPath: new Map([[
      'src/example.ts' as never,
      new TextEncoder().encode('target()\ncaller() {\n  target()\n  target()\n  target()\n}\n'),
    ]]),
    snapshotIdentity: 'snapshot',
    requestId: 'request',
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
