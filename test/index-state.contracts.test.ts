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

  const rebuilt = await Effect.runPromise(buildLocalCodeIndex(files(source), workspaceId, '/repo', {
    generation: 3,
    previous: first.value,
    parserVersion: 'parser-v2',
    scopeFingerprint: 'scope-v1',
    structural,
  }));
  assert.equal(rebuilt._tag, 'Ok');
  assert.equal(calls, 2);
});
