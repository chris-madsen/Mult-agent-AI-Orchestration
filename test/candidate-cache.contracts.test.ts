import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { makeFileCodeCandidateCache } from '../src/adapters/file-code-candidate-cache.js';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeCodeCandidate } from '../src/domain/retrieval.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { makeStructuralAnalysis } from '../src/domain/semantic.js';
import type { StructuralAnalysisPort } from '../src/application/ports.js';

const workspace = makeWorkspaceId('candidate-cache-workspace');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

const sourceDigest = 'a'.repeat(64) as never;
const providerFingerprint = 'b'.repeat(64);

test('file candidate cache binds entries to workspace, path, source digest and parser identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-candidate-cache-'));
  const cache = await makeFileCodeCandidateCache(root);
  const candidate = makeCodeCandidate({
    candidateId: 'candidate-a' as never,
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 30 },
    semanticAnchor: { line: 1, byteColumn: 17, endLine: 1, endByteColumn: 18 },
    symbolName: 'a',
    text: 'export function a() { return 1; }',
    sourceDigest,
    generation: 1 as never,
    indexedAtMs: 10,
    invalidated: false,
  });
  assert.equal(candidate._tag, 'Ok');
  if (candidate._tag === 'Err') throw new Error(candidate.error.message);

  const put = await Effect.runPromise(cache.put({
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    sourceDigest,
    providerFingerprint,
    entry: { candidates: [candidate.value], parserPartial: false },
  }));
  assert.equal(put._tag, 'Ok');

  const hit = await Effect.runPromise(cache.get({
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    sourceDigest,
    providerFingerprint,
  }));
  assert.equal(hit._tag, 'Ok');
  if (hit._tag === 'Err') throw new Error(hit.error.message);
  assert.equal(hit.value?.candidates[0]?.candidateId, 'candidate-a');

  const changedDigest = await Effect.runPromise(cache.get({
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    sourceDigest: 'c'.repeat(64) as never,
    providerFingerprint,
  }));
  assert.deepEqual(changedDigest, { _tag: 'Ok', value: undefined });

  const changedProvider = await Effect.runPromise(cache.get({
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    sourceDigest,
    providerFingerprint: 'd'.repeat(64),
  }));
  assert.deepEqual(changedProvider, { _tag: 'Ok', value: undefined });

  const [entry] = await readdir(root);
  assert.notEqual(entry, undefined);
  if (entry === undefined) return;
  await writeFile(join(root, entry), '{not-json', 'utf8');
  const corrupt = await Effect.runPromise(cache.get({
    workspaceId: workspace.value,
    repoPath: 'src/a.ts' as never,
    sourceDigest,
    providerFingerprint,
  }));
  assert.equal(corrupt._tag, 'Err');
  if (corrupt._tag === 'Err') assert.equal(corrupt.error.code, 'PERSISTENCE_FAILED');
});

test('local code index reuses unchanged candidate files and rebuilds changed or re-identified files', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-candidate-index-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  const sourcePath = join(root, 'stable.ts');
  await writeFile(sourcePath, 'export function stable() { return 1; }\n', 'utf8');
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const cache = await makeFileCodeCandidateCache(join(parent, 'candidate-cache'));
  let extracts = 0;
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      extracts += 1;
      const digest = createHash('sha256').update(input.source).digest('hex');
      return Effect.succeed(makeStructuralAnalysis({
        repoPath: input.repoPath,
        sourceDigest: digest,
        symbols: [{
          name: 'stable',
          kind: 'function',
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: Buffer.byteLength(input.source, 'utf8') + 1,
          nameStartLine: 1,
          nameStartColumn: 17,
          nameEndLine: 1,
          nameEndColumn: 23,
        }],
        hasSyntaxErrors: false,
      }));
    },
  };

  const first = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 1,
    structural,
    candidateCache: cache,
    candidateProviderFingerprint: providerFingerprint,
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error(first.error.message);
  assert.equal(extracts, 1);
  assert.equal(first.value.candidateCacheHits, 0);
  assert.equal(first.value.candidateCacheMisses, 1);

  const second = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 2,
    structural,
    candidateCache: cache,
    candidateProviderFingerprint: providerFingerprint,
  }));
  assert.equal(second._tag, 'Ok');
  if (second._tag === 'Err') throw new Error(second.error.message);
  assert.equal(extracts, 1, 'unchanged bytes must reuse candidates without structural parsing');
  assert.equal(second.value.candidateCacheHits, 1);
  assert.equal(second.value.candidateCacheMisses, 0);
  assert.equal(second.value.index.candidates[0]?.generation, 2);

  await writeFile(sourcePath, 'export function stable() { return 2; }\n', 'utf8');
  const third = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 3,
    structural,
    candidateCache: cache,
    candidateProviderFingerprint: providerFingerprint,
  }));
  assert.equal(third._tag, 'Ok');
  if (third._tag === 'Err') throw new Error(third.error.message);
  assert.equal(extracts, 2, 'changed bytes must invalidate candidate cache');
  assert.equal(third.value.candidateCacheHits, 0);
  assert.equal(third.value.candidateCacheMisses, 1);

  const fourth = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 4,
    structural,
    candidateCache: cache,
    candidateProviderFingerprint: 'e'.repeat(64),
  }));
  assert.equal(fourth._tag, 'Ok');
  if (fourth._tag === 'Err') throw new Error(fourth.error.message);
  assert.equal(extracts, 3, 'provider identity changes must invalidate candidate cache');
  assert.equal(fourth.value.candidateCacheHits, 0);
  assert.equal(fourth.value.candidateCacheMisses, 1);
});
