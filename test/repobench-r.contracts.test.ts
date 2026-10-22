import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  mapRepoBenchRecords,
  repoBenchSourceKey,
  repoBenchSourceManifestSha256,
  type RepoBenchManifest,
  type RepoBenchRecord,
  type RepoBenchSourceFile,
} from '../src/domain/repobench-r.js';
import { canonicalBenchmarkCandidateId } from '../src/domain/retrieval-benchmark.js';

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const revision = 'a'.repeat(40);
const manifest: RepoBenchManifest = {
  schemaVersion: 1,
  dataset: {
    datasetId: 'tianyang/repobench-r',
    config: 'python_cff',
    split: 'test_easy',
    revision,
    recordsSha256: 'b'.repeat(64),
  },
  repositories: [
    { id: 'repo-one', revision, sourceManifestSha256: 'c'.repeat(64) },
  ],
};

const goldPath = 'src/helpers.py';
const record = (id: string, snippet: string): RepoBenchRecord => ({
  id,
  repoName: 'repo-one',
  filePath: 'src/current.py',
  context: [{ identifier: 'helper', path: goldPath, snippet }],
  goldSnippetIndex: 0,
  importStatement: 'from package import helper',
  code: 'return helper(value)',
  nextLine: 'return result',
});

const source = (content: string, repoPath = goldPath): RepoBenchSourceFile => ({
  repositoryId: 'repo-one',
  repoPath,
  source: content,
  sourceDigest: digest(content),
  structuralCandidates: [{
    range: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 25 },
    startByteOffset: 0,
    endByteOffset: Buffer.byteLength(content, 'utf8'),
  }],
});

test('RepoBench-R maps the gold context object to its cross-file path and the containing ACE structural candidate', () => {
  const sourceText = 'def helper(value):\n    return helper(value)\n';
  const actualSource = source(sourceText);
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-1', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', goldPath), actualSource]]),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.holdout.status, 'frozen_multi_repository_holdout');
  assert.equal(result.value.holdout.cases.length, 1);
  assert.equal(result.value.holdout.cases[0]?.query.includes('return result'), false);
  assert.equal(result.value.mappedRows[0]?.repoPath, goldPath);
  assert.deepEqual(result.value.mappedRows[0]?.goldRange, {
    startLine: 2,
    endLine: 2,
    startColumn: 5,
    endColumn: 25,
  });
  const expectedCandidateId = canonicalBenchmarkCandidateId(
    'repo-one',
    goldPath,
    actualSource.sourceDigest,
    actualSource.structuralCandidates[0]!.range,
  );
  assert.deepEqual(result.value.holdout.cases[0]?.relevantCandidateIds, [expectedCandidateId]);
  assert.deepEqual(result.value.mappedRows[0]?.relevantCandidateIds, [expectedCandidateId]);
  assert.equal(result.value.invalidRows.length, 0);
});

test('RepoBench-R marks repeated gold snippets invalid instead of selecting an arbitrary occurrence', () => {
  const text = 'def helper(value):\n    return helper(value)\n    return helper(value)\n';
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-ambiguous', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', goldPath), source(text)]]),
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /no unambiguous/u);
});

test('RepoBench-R blocks when the pinned gold cross-file source snapshot is missing', () => {
  const result = mapRepoBenchRecords(manifest, [record('case-missing', 'return helper(value)')], new Map());
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /gold cross-file source snapshot is missing/u);
});

test('RepoBench-R rejects a source digest that does not match the supplied bytes', () => {
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-digest', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', goldPath), {
      ...source('def helper(value):\n    return helper(value)\n'),
      sourceDigest: 'd'.repeat(64),
    }]]),
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /source identity is inconsistent/u);
});

test('RepoBench-R rejects a gold span that cannot be represented by an actual ACE structural candidate', () => {
  const actual = source('prefix = 1\nreturn helper(value)\n');
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-no-structural', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', goldPath), { ...actual, structuralCandidates: [] }]]),
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /no unambiguous/u);
});

test('RepoBench-R keeps valid rows and reports unmappable rows as INVALID', () => {
  const valid = record('case-valid', 'return helper(value)');
  const invalid = { ...record('case-invalid', 'not present'), nextLine: 'secret gold must not be used' };
  const result = mapRepoBenchRecords(
    manifest,
    [valid, invalid],
    new Map([[repoBenchSourceKey('repo-one', goldPath), source('def helper(value):\n    return helper(value)\n')]]),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.deepEqual(result.value.invalidRows.map((row) => row.reason), ['gold_snippet_not_found']);
  assert.deepEqual(result.value.holdout.cases.map((item) => item.id), ['case-valid']);
});

test('RepoBench-R source manifest identity matches canonical frozen-manifest semantics', () => {
  const first = repoBenchSourceManifestSha256('repo-one', revision, [
    { path: 'b.py', sizeBytes: 2, sha256: '2'.repeat(64) },
    { path: 'a.py', sizeBytes: 1, sha256: '1'.repeat(64) },
  ]);
  const reordered = repoBenchSourceManifestSha256('repo-one', revision, [
    { path: 'a.py', sizeBytes: 1, sha256: '1'.repeat(64) },
    { path: 'b.py', sizeBytes: 2, sha256: '2'.repeat(64) },
  ]);
  const changed = repoBenchSourceManifestSha256('repo-one', revision, [
    { path: 'a.py', sizeBytes: 1, sha256: '3'.repeat(64) },
    { path: 'b.py', sizeBytes: 2, sha256: '2'.repeat(64) },
  ]);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/u);
});
