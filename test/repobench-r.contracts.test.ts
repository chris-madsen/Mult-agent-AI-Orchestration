import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mapRepoBenchRecords, repoBenchSourceKey, type RepoBenchManifest, type RepoBenchRecord, type RepoBenchSourceFile } from '../src/domain/repobench-r.js';

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

const record = (id: string, snippet: string): RepoBenchRecord => ({
  id,
  repoName: 'repo-one',
  filePath: 'src/example.py',
  context: [snippet],
  goldSnippetIndex: 0,
  importStatement: 'from package import helper',
  code: 'return helper(value)',
  nextLine: 'return result',
});

const source = (content: string): RepoBenchSourceFile => ({
  repositoryId: 'repo-one',
  repoPath: 'src/example.py',
  source: content,
  sourceDigest: digest(content),
});

test('RepoBench-R maps one unambiguous gold snippet to a canonical exact span without leaking next_line', () => {
  const sourceText = 'def run(value):\n    return helper(value)\n';
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-1', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', 'src/example.py'), source(sourceText)]]),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.equal(result.value.holdout.status, 'frozen_multi_repository_holdout');
  assert.equal(result.value.holdout.cases.length, 1);
  assert.equal(result.value.holdout.cases[0]?.query.includes('return result'), false);
  assert.deepEqual(result.value.mappedRows[0]?.goldRange, {
    startLine: 2,
    endLine: 2,
    startColumn: 5,
    endColumn: 25,
  });
  assert.equal(result.value.invalidRows.length, 0);
});

test('RepoBench-R marks repeated gold snippets invalid instead of selecting an arbitrary occurrence', () => {
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-ambiguous', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', 'src/example.py'), source('return helper(value)\nreturn helper(value)\n')]]),
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /no unambiguous/u);
});

test('RepoBench-R blocks when a pinned source snapshot is missing', () => {
  const result = mapRepoBenchRecords(manifest, [record('case-missing', 'return helper(value)')], new Map());
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /source snapshot is missing/u);
});

test('RepoBench-R rejects a source digest that does not match the supplied bytes', () => {
  const result = mapRepoBenchRecords(
    manifest,
    [record('case-digest', 'return helper(value)')],
    new Map([[repoBenchSourceKey('repo-one', 'src/example.py'), {
      ...source('def run(value):\n    return helper(value)\n'),
      sourceDigest: 'd'.repeat(64),
    }]]),
  );
  assert.equal(result._tag, 'Err');
  if (result._tag === 'Ok') return;
  assert.match(result.error.message, /source identity is inconsistent/u);
});

test('RepoBench-R keeps valid rows and reports unmappable rows as INVALID', () => {
  const valid = record('case-valid', 'return helper(value)');
  const invalid = { ...record('case-invalid', 'not present'), nextLine: 'secret gold must not be used' };
  const result = mapRepoBenchRecords(
    manifest,
    [valid, invalid],
    new Map([[repoBenchSourceKey('repo-one', 'src/example.py'), source('def run(value):\n    return helper(value)\n')]]),
  );
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(result.error.message);
  assert.deepEqual(result.value.invalidRows.map((row) => row.reason), ['gold_snippet_not_found']);
  assert.deepEqual(result.value.holdout.cases.map((item) => item.id), ['case-valid']);
});
