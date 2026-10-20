import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { decodeStrictSourceText } from '../src/domain/source-text.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import { ok } from '../src/domain/result.js';
import type { StructuralAnalysisPort, WorkspaceFilePort } from '../src/application/ports.js';

const workspace = makeWorkspaceId('strict-source-text-workspace');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);

test('strict source decoder accepts valid Unicode without replacement', () => {
  const bytes = Buffer.from('export const привет = "данные";\n', 'utf8');
  const decoded = decodeStrictSourceText(bytes);
  assert.equal(decoded._tag, 'Ok');
  if (decoded._tag === 'Ok') assert.equal(decoded.text, 'export const привет = "данные";\n');
});

test('strict source decoder rejects malformed UTF-8 and binary control bytes', () => {
  const malformed = decodeStrictSourceText(new Uint8Array([0x65, 0x78, 0x70, 0xc3, 0x28]));
  assert.deepEqual(malformed, { _tag: 'Err', kind: 'invalid_utf8' });

  const binary = decodeStrictSourceText(new Uint8Array([0x65, 0x78, 0x70, 0x00, 0x6f, 0x72, 0x74]));
  assert.deepEqual(binary, { _tag: 'Err', kind: 'binary_source' });
});

test('binary and malformed UTF-8 source never reaches structural provider', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-strict-source-'));
  const root = join(parent, 'repo');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'binary.ts'), Buffer.from([0x65, 0x78, 0x70, 0x00, 0x6f, 0x72, 0x74]));
  await writeFile(join(root, 'malformed.ts'), Buffer.from([0x65, 0x78, 0x70, 0xc3, 0x28]));
  await writeFile(join(root, 'valid.ts'), 'export function valid(): string { return "ok"; }\n', 'utf8');

  let structuralCalls = 0;
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      structuralCalls += 1;
      const digest = createHash('sha256').update(input.source).digest('hex');
      return Effect.succeed(ok({
        repoPath: input.repoPath,
        sourceDigest: digest as never,
        symbols: [{
          name: 'valid',
          kind: 'function',
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: Buffer.from(input.source).length + 1,
          nameStartLine: 1,
          nameStartColumn: 17,
          nameEndLine: 1,
          nameEndColumn: 22,
        }],
        hasSyntaxErrors: false,
      }));
    },
  };

  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const built = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, root, {
    generation: 1,
    structural,
  }));
  assert.equal(built._tag, 'Ok');
  if (built._tag === 'Err') throw new Error(built.error.message);

  assert.equal(structuralCalls, 1, 'only valid UTF-8 text may reach the parser');
  assert.equal(built.value.index.candidates.length, 1);
  assert.deepEqual(
    built.value.coverage.failures.map((failure) => [failure.repoPath, failure.kind]).sort(),
    [['binary.ts', 'binary_source'], ['malformed.ts', 'invalid_utf8']],
  );
  assert.equal(built.value.coverage.failedPaths, 2);
  assert.equal(built.value.coverage.schemaVersion, 1);
  assert.match(built.value.coverage.sourceSnapshotDigest, /^[a-f0-9]{64}$/u);
  assert.equal(built.value.coverage.failureCounts.binary_source, 1);
  assert.equal(built.value.coverage.failureCounts.invalid_utf8, 1);
  assert.ok(built.value.warnings.some((warning) => warning.includes('binary.ts: binary_source')));
  assert.ok(built.value.warnings.some((warning) => warning.includes('malformed.ts: invalid_utf8')));

  const manifestByPath = new Map(built.value.fileManifest.map((item) => [item.repoPath, item]));
  assert.equal(manifestByPath.get('binary.ts' as never)?.candidateIds.length, 0);
  assert.equal(manifestByPath.get('malformed.ts' as never)?.candidateIds.length, 0);
});

test('source changed after the workspace snapshot is excluded as digest-raced evidence', async () => {
  const observedDigest = '1'.repeat(64);
  const currentDigest = '2'.repeat(64);
  let structuralCalls = 0;
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(ok({
      headRevision: 'a'.repeat(40),
      files: [{
        repoPath: 'raced.ts' as never,
        digest: observedDigest as never,
        sizeBytes: 10,
        state: 'tracked' as const,
        observedAtMs: 1,
      }],
      removedPaths: [],
      gitStatus: 'available' as const,
    })),
    readExact: () => Effect.succeed(ok({
      bytes: Buffer.from('export function raced() {}\n', 'utf8'),
      digest: currentDigest as never,
    })),
  };
  const structural: StructuralAnalysisPort = {
    extract: () => {
      structuralCalls += 1;
      return Effect.succeed(ok({
        repoPath: 'raced.ts',
        sourceDigest: currentDigest as never,
        symbols: [],
        hasSyntaxErrors: false,
      }));
    },
  };
  const built = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, '/repo', {
    generation: 1,
    structural,
  }));
  assert.equal(built._tag, 'Ok');
  if (built._tag === 'Err') throw new Error(built.error.message);
  assert.equal(structuralCalls, 0);
  assert.equal(built.value.index.candidates.length, 0);
  assert.deepEqual(built.value.coverage.failures.map((failure) => failure.kind), ['digest_raced']);
  assert.equal(built.value.coverage.failureCounts.digest_raced, 1);
});

test('incremental index catch-up reuses unchanged structural files and invalidates on scope changes', async () => {
  const sourceByPath = new Map<string, string>([
    ['a.ts', 'export function alpha(): string { return "a1"; }\n'],
    ['b.ts', 'export function beta(): string { return "b1"; }\n'],
  ]);
  let structuralCalls = 0;
  const digestFor = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
  const files: WorkspaceFilePort = {
    canonicalizeRoot: () => Effect.succeed(ok('/repo')),
    snapshot: () => Effect.succeed(ok({
      headRevision: 'a'.repeat(40),
      files: [...sourceByPath.entries()].map(([repoPath, value]) => ({
        repoPath: repoPath as never,
        digest: digestFor(value) as never,
        sizeBytes: Buffer.byteLength(value, 'utf8'),
        state: 'tracked' as const,
        observedAtMs: Date.now(),
      })),
      removedPaths: [],
      gitStatus: 'available' as const,
    })),
    readExact: (_rootPath, repoPath) => {
      const value = sourceByPath.get(repoPath);
      if (value === undefined) return Effect.succeed({ _tag: 'Err', error: { code: 'FILE_NOT_FOUND' } } as never);
      return Effect.succeed(ok({ bytes: Buffer.from(value, 'utf8'), digest: digestFor(value) as never }));
    },
  };
  const structural: StructuralAnalysisPort = {
    extract: (input) => {
      structuralCalls += 1;
      const text = Buffer.from(input.source).toString('utf8');
      const name = text.includes('alpha') ? 'alpha' : 'beta';
      return Effect.succeed(ok({
        repoPath: input.repoPath,
        sourceDigest: digestFor(text) as never,
        symbols: [{
          name,
          kind: 'function' as const,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: Buffer.byteLength(text, 'utf8') + 1,
          nameStartLine: 1,
          nameStartColumn: text.indexOf(name) + 1,
          nameEndLine: 1,
          nameEndColumn: text.indexOf(name) + name.length + 1,
        }],
        hasSyntaxErrors: false,
      }));
    },
  };

  const first = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, '/repo', {
    generation: 1,
    structural,
    scopeFingerprint: 'scope-a',
  }));
  assert.equal(first._tag, 'Ok');
  if (first._tag === 'Err') throw new Error(first.error.message);
  assert.equal(structuralCalls, 2);

  sourceByPath.set('b.ts', 'export function beta(): string { return "b2"; }\n');
  const changed = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, '/repo', {
    generation: 2,
    structural,
    scopeFingerprint: 'scope-a',
    previous: first.value,
  }));
  assert.equal(changed._tag, 'Ok');
  if (changed._tag === 'Err') throw new Error(changed.error.message);
  assert.equal(structuralCalls, 3, 'only the changed file should invoke ast-grep during catch-up');
  assert.ok(changed.value.index.candidates.some((candidate) => candidate.text.includes('a1')));
  assert.ok(changed.value.index.candidates.some((candidate) => candidate.text.includes('b2')));
  assert.equal(changed.value.workspaceManifest.scopeFingerprint, 'scope-a');

  const scopeChanged = await Effect.runPromise(buildLocalCodeIndex(files, workspace.value, '/repo', {
    generation: 3,
    structural,
    scopeFingerprint: 'scope-b',
    previous: changed.value,
  }));
  assert.equal(scopeChanged._tag, 'Ok');
  assert.equal(structuralCalls, 5, 'scope changes must invalidate all structural reuse');
});
