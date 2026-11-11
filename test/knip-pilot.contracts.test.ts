import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

type KnipIssue = {
  readonly file: string;
  readonly files?: readonly { readonly name: string }[];
  readonly exports?: readonly { readonly name: string }[];
  readonly dependencies?: readonly { readonly name: string }[];
  readonly devDependencies?: readonly { readonly name: string }[];
};

test('Knip pilot reports dead code and preserves the configured dynamic plugin entry', () => {
  const fixtureDirectory = resolve('.github/fixtures/knip');
  const knipCli = resolve('node_modules/knip/bin/knip.js');
  const result = spawnSync(
    process.execPath,
    [knipCli, '--directory', fixtureDirectory, '--reporter', 'json', '--no-progress', '--no-exit-code'],
    { encoding: 'utf8', timeout: 30_000 },
  );

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { readonly issues: readonly KnipIssue[] };

  assert.ok(report.issues.some(({ file, exports }) =>
    file === 'src/feature.ts' && exports?.some(({ name }) => name === 'unusedExport')));
  assert.ok(report.issues.some(({ file, dependencies }) =>
    file === 'package.json' && dependencies?.some(({ name }) => name === 'unused-fixture-dependency')));
  assert.ok(!report.issues.some(({ files }) =>
    files?.some(({ name }) => name === 'src/plugins/runtime-loaded.ts')));
});
