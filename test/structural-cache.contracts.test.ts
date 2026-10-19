import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFileStructuralAnalysisCache } from '../src/adapters/file-structural-analysis-cache.js';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { codeIndexKey } from '../src/adapters/qdrant-context-provider.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeStructuralAnalysis } from '../src/domain/semantic.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { StructuralAnalysisPort } from '../src/application/ports.js';

const workspace = makeWorkspaceId('structural-cache-workspace');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

test('unchanged source reuses structural analysis while changed bytes force reparse', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-structural-cache-'));
  const root = join(parent, 'repo');
  const sourcePath = join(root, 'src', 'stable.ts');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(sourcePath, 'export function stable() { return 1; }\n', 'utf8');

  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const cache = await makeFileStructuralAnalysisCache(join(parent, 'cache'));
  const fingerprint = 'a'.repeat(64);
  let extracts = 0;
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      extracts += 1;
      const digest = createHash('sha256').update(input.source).digest('hex');
      const analyzed = makeStructuralAnalysis({
        repoPath: input.repoPath,
        sourceDigest: digest,
        symbols: [{
          name: 'stable',
          kind: 'function',
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: Buffer.from(input.source).length,
          nameStartLine: 1,
          nameStartColumn: 17,
          nameEndLine: 1,
          nameEndColumn: 23,
        }],
        hasSyntaxErrors: false,
      });
      return Effect.succeed(analyzed);
    },
  };

  const first = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 1,
    structural,
    structuralCache: cache,
    structuralProviderFingerprint: fingerprint,
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error(first.error.message);
  assert.equal(extracts, 1);
  assert.equal(first.value.structuralCacheHits, 0);
  assert.equal(first.value.structuralCacheMisses, 1);
  assert.equal(first.value.index.candidates.length, 1);

  const second = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 2,
    structural,
    structuralCache: cache,
    structuralProviderFingerprint: fingerprint,
  }));
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Err') throw new Error(second.error.message);
  assert.equal(extracts, 1, 'unchanged bytes must not invoke structural provider again');
  assert.equal(second.value.structuralCacheHits, 1);
  assert.equal(second.value.structuralCacheMisses, 0);
  assert.equal(second.value.index.candidates[0]?.generation, 2);

  const oldDigest = second.value.index.candidates[0]?.sourceDigest;
  await writeFile(sourcePath, 'export function stable() { return 2; }\n', 'utf8');
  const third = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 3,
    structural,
    structuralCache: cache,
    structuralProviderFingerprint: fingerprint,
  }));
  assert.equal(third._tag, 'Ok');
  if (third._tag === 'Err') throw new Error(third.error.message);
  assert.equal(extracts, 2, 'changed digest must force structural reparse');
  assert.equal(third.value.structuralCacheHits, 0);
  assert.equal(third.value.structuralCacheMisses, 1);
  assert.notEqual(third.value.index.candidates[0]?.sourceDigest, oldDigest);
});

test('structural cache is disabled rather than ambiguously keyed without a verified fingerprint', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-structural-cache-fingerprint-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export function a() {}\n', 'utf8');
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const cache = await makeFileStructuralAnalysisCache(join(parent, 'cache'));
  const structural: StructuralAnalysisPort = {
    extract: () => Effect.succeed(ok({
      repoPath: 'a.ts',
      sourceDigest: '0'.repeat(64) as never,
      symbols: [],
      hasSyntaxErrors: false,
    })),
  };
  const result = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 1,
    structural,
    structuralCache: cache,
  }));
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Err') assert.equal(result.error.code, 'INVALID_INPUT');
});


test('comment-only zero-symbol file participates in snapshot identity', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-zero-symbol-manifest-'));
  const root = join(parent, 'repo');
  const sourcePath = join(root, 'notes.ts');
  await mkdir(root, { recursive: true });
  await writeFile(sourcePath, '// retrieval note v1\n', 'utf8');
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      const sourceDigest = createHash('sha256').update(input.source).digest('hex');
      return Effect.succeed(ok({
        repoPath: input.repoPath,
        sourceDigest: sourceDigest as never,
        symbols: [],
        hasSyntaxErrors: false,
      }));
    },
  };
  const first = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 1,
    structural,
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error(first.error.message);
  assert.equal(first.value.index.candidates.length, 0);
  assert.equal(first.value.fileManifest.length, 1);
  assert.equal(first.value.fileManifest[0]?.repoPath, 'notes.ts');
  assert.equal(first.value.fileManifest[0]?.candidateIds.length, 0);
  const providerFingerprint = 'f'.repeat(64);
  const firstKey = codeIndexKey(
    first.value.index,
    first.value.coverage,
    providerFingerprint,
    first.value.fileManifest,
  );

  await writeFile(sourcePath, '// retrieval note v2\n', 'utf8');
  const second = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 2,
    structural,
  }));
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Err') throw new Error(second.error.message);
  assert.equal(second.value.index.candidates.length, 0);
  const secondKey = codeIndexKey(
    second.value.index,
    second.value.coverage,
    providerFingerprint,
    second.value.fileManifest,
  );
  assert.notEqual(second.value.fileManifest[0]?.sourceDigest, first.value.fileManifest[0]?.sourceDigest);
  assert.notEqual(secondKey, firstKey, 'zero-symbol source byte changes must invalidate warm snapshot reuse');
});
