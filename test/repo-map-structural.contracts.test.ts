import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildRepoMapDelta } from '../src/adapters/repo-map-structural.js';
import type { SemanticAnalysisPort } from '../src/application/ports.js';
import type { CodeCandidate } from '../src/domain/retrieval.js';

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
    assert.deepEqual(one?.references, [{ targetId: two?.id, kind: 'reference' }]);
    assert.deepEqual(two?.references, [{ targetId: one?.id, kind: 'definition' }]);
  }
});
