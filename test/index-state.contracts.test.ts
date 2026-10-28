import assert from 'node:assert/strict';
import { Effect } from 'effect';
import test from 'node:test';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { StructuralAnalysisPort, WorkspaceFilePort } from '../src/application/ports.js';

const workspaceId = (() => {
  const result = makeWorkspaceId('index-state-contract');
  assert.equal(result._tag, 'Ok');
  return result.value;
})();

const files = (source: Uint8Array): WorkspaceFilePort => ({
  canonicalizeRoot: () => Effect.succeed(ok('/repo')),
  observeChanges: () => Effect.succeed(ok({
    headRevision: 'a'.repeat(40),
    changedPaths: [],
    addedPaths: [],
    deletedPaths: [],
    renamed: [],
  })),
  snapshot: () => Effect.succeed(ok({
    headRevision: 'a'.repeat(40),
    files: [{
      repoPath: 'src/index.ts' as never,
      digest: 'b'.repeat(64) as never,
      sizeBytes: source.byteLength,
      state: 'tracked' as const,
      observedAtMs: 1,
    }],
    removedPaths: [],
  })),
  readExact: () => Effect.succeed(ok({ bytes: source, digest: 'b'.repeat(64) as never })),
});

test('warm structural reuse is invalidated when parser identity changes', async () => {
  const source = Buffer.from('export function index() { return true; }\n');
  let calls = 0;
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      calls += 1;
      return Effect.succeed(ok({
        repoPath: input.repoPath,
        sourceDigest: 'b'.repeat(64) as never,
        symbols: [],
        hasSyntaxErrors: false,
      }));
    },
  };

  const first = await Effect.runPromise(buildLocalCodeIndex(files(source), workspaceId, '/repo', {
    generation: 1,
    parserVersion: 'parser-v1',
    scopeFingerprint: 'scope-v1',
    structural,
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') return;
  assert.equal(first.value.fileManifest[0]?.parserVersion, 'parser-v1');

  const reused = await Effect.runPromise(buildLocalCodeIndex(files(source), workspaceId, '/repo', {
    generation: 2,
    previous: first.value,
    parserVersion: 'parser-v1',
    scopeFingerprint: 'scope-v1',
    structural,
  }));
  assert.equal(reused._tag, 'Ok');
  assert.equal(calls, 1);
  if (reused._tag === 'Ok') {
    assert.equal(reused.value.structuralAnalysesByPath?.size, 1);
    assert.deepEqual(
      [...(reused.value.structuralAnalysesByPath ?? new Map()).entries()],
      [...(first.value.structuralAnalysesByPath ?? new Map()).entries()],
    );
  }

  const priorAnalysis = first.value.structuralAnalysesByPath?.get('src/index.ts' as never);
  assert.ok(priorAnalysis);
  const corruptReuse = await Effect.runPromise(buildLocalCodeIndex(files(source), workspaceId, '/repo', {
    generation: 3,
    previous: {
      ...first.value,
      structuralAnalysesByPath: new Map([[
        'src/index.ts' as never,
        { ...priorAnalysis!, sourceDigest: 'c'.repeat(64) as never },
      ]]),
    },
    parserVersion: 'parser-v1',
    scopeFingerprint: 'scope-v1',
    structural,
  }));
  assert.equal(corruptReuse._tag, 'Err');
  if (corruptReuse._tag === 'Err') assert.equal(corruptReuse.error.code, 'INVALID_RETRIEVAL');

  const rebuilt = await Effect.runPromise(buildLocalCodeIndex(files(source), workspaceId, '/repo', {
    generation: 4,
    previous: first.value,
    parserVersion: 'parser-v2',
    scopeFingerprint: 'scope-v1',
    structural,
  }));
  assert.equal(rebuilt._tag, 'Ok');
  assert.equal(calls, 2);
});


test('pre-materialized snapshot avoids a second repository snapshot during incremental rebuild', async () => {
  const source = Buffer.from('export function index() { return true; }\n');
  let snapshotCalls = 0;
  const port: WorkspaceFilePort = {
    ...files(source),
    snapshot: () => {
      snapshotCalls += 1;
      throw new Error('incremental rebuild must use the supplied authoritative snapshot');
    },
  };
  const structural: StructuralAnalysisPort = {
    extract: (input) => Effect.succeed(ok({
      repoPath: input.repoPath,
      sourceDigest: 'b'.repeat(64) as never,
      symbols: [],
      hasSyntaxErrors: false,
    })),
  };
  const snapshot = {
    headRevision: 'a'.repeat(40),
    files: [{
      repoPath: 'src/index.ts' as never,
      digest: 'b'.repeat(64) as never,
      sizeBytes: source.byteLength,
      state: 'tracked' as const,
      observedAtMs: 2,
    }],
    removedPaths: [],
  };
  const built = await Effect.runPromise(buildLocalCodeIndex(port, workspaceId, '/repo', {
    generation: 2,
    parserVersion: 'parser-v1',
    scopeFingerprint: 'scope-v1',
    structural,
    snapshot,
  }));
  assert.equal(built._tag, 'Ok');
  assert.equal(snapshotCalls, 0);
});
