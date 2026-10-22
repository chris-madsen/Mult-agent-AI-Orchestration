import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { retrievalSourceManifestSha256 } from '../src/domain/retrieval-source-manifest.js';

const repositoryRoot = path.resolve('.');
const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
const freezer = path.resolve('scripts/freeze-retrieval-holdout.ts');

const git = (root: string, args: readonly string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

const sourceSpec = (revision: string): string => JSON.stringify({
  schemaVersion: 1,
  status: 'frozen_multi_repository_holdout',
  repositories: [
    { id: 'repo-a', revision },
    { id: 'repo-b', revision },
  ],
  cases: [
    {
      id: 'repo-a-case',
      repositoryId: 'repo-a',
      query: 'find the source behavior',
      relevantSpans: [{ repoPath: 'src/example.ts', startLine: 1, endLine: 1 }],
      critical: true,
      kind: 'behavior_without_name',
    },
    {
      id: 'repo-b-case',
      repositoryId: 'repo-b',
      query: 'find the source configuration',
      relevantSpans: [{ repoPath: 'src/example.ts', startLine: 1, endLine: 1 }],
      kind: 'exact_symbol_or_config',
    },
  ],
}, null, 2) + '\n';

const runFreeze = (source: string, holdout: string, manifests: string, checkout: string): void => {
  execFileSync(process.execPath, [tsxCli, freezer, source, holdout, manifests, `repo-a=${checkout}`, `repo-b=${checkout}`], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
};

test('external holdout freezer writes only to an external evidence directory', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'ace-external-holdout-'));
  try {
    await mkdir(path.join(temporaryRoot, 'src'), { recursive: true });
    await writeFile(path.join(temporaryRoot, 'src', 'example.ts'), 'export const value = 1;\n', 'utf8');
    execFileSync('git', ['-C', temporaryRoot, 'init', '--quiet']);
    execFileSync('git', ['-C', temporaryRoot, 'config', 'user.email', 'ace-tests@example.invalid']);
    execFileSync('git', ['-C', temporaryRoot, 'config', 'user.name', 'ACE tests']);
    execFileSync('git', ['-C', temporaryRoot, 'add', 'src/example.ts']);
    execFileSync('git', ['-C', temporaryRoot, 'commit', '--quiet', '-m', 'fixture']);
    const revision = git(temporaryRoot, ['rev-parse', 'HEAD']).trim();
    await writeFile(path.join(temporaryRoot, 'source-spec.json'), sourceSpec(revision), 'utf8');
    const holdout = path.join(temporaryRoot, 'evidence', 'holdout.json');
    const manifests = path.join(temporaryRoot, 'evidence', 'manifests');

    runFreeze(path.join(temporaryRoot, 'source-spec.json'), holdout, manifests, temporaryRoot);

    const generated = JSON.parse(await readFile(holdout, 'utf8')) as {
      readonly status: string;
      readonly repositories: readonly { readonly id: string; readonly revision: string }[];
      readonly cases: readonly unknown[];
    };
    assert.equal(generated.status, 'frozen_multi_repository_holdout');
    assert.deepEqual(generated.repositories.map((item) => item.id), ['repo-a', 'repo-b']);
    assert.deepEqual(generated.repositories.map((item) => item.revision), [revision, revision]);
    assert.equal(generated.cases.length, 2);
    const repoAManifestPath = path.join(manifests, 'manifest-repo-a.json');
    const repoAManifestBytes = await readFile(repoAManifestPath);
    const repoAManifest = JSON.parse(repoAManifestBytes.toString('utf8')) as {
      readonly repositoryId: string;
      readonly revision: string;
      readonly entries: readonly { readonly path: string; readonly sizeBytes: number; readonly sha256: string }[];
    };
    assert.match(repoAManifestBytes.toString('utf8'), /"repositoryId": "repo-a"/u);
    assert.equal(
      retrievalSourceManifestSha256(repoAManifest.repositoryId, repoAManifest.revision, repoAManifest.entries),
      createHash('sha256').update(repoAManifestBytes).digest('hex'),
    );
    assert.match(await readFile(path.join(manifests, 'manifest-repo-b.json'), 'utf8'), /"repositoryId": "repo-b"/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('external holdout freezer refuses tracked ACE output paths', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'ace-external-holdout-guard-'));
  try {
    const source = path.join(temporaryRoot, 'source-spec.json');
    await writeFile(source, sourceSpec('0'.repeat(40)), 'utf8');
    assert.throws(
      () => runFreeze(source, path.join(repositoryRoot, 'benchmarks', 'holdout.json'), path.join(repositoryRoot, 'benchmarks', 'manifests'), temporaryRoot),
      /external evidence directory/iu,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
