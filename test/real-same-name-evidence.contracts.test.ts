import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('same-name evidence records the executed LSP version instead of a manifest constant', async () => {
  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'ace-same-name-evidence-'));
  const wrapperPath = join(temporaryRoot, 'versioned-lsp.cjs');
  const actualServer = resolve(repositoryRoot, 'node_modules/.bin/typescript-language-server');
  await mkdir(join(temporaryRoot, 'benchmarks/reports'), { recursive: true });
  await symlink(resolve(repositoryRoot, 'node_modules'), join(temporaryRoot, 'node_modules'), 'dir');
  await writeFile(wrapperPath, [
    '#!/usr/bin/env node',
    'const { spawn } = require(\'node:child_process\');',
    `const actualServer = ${JSON.stringify(actualServer)};`,
    'if (process.argv[2] === \'--version\') {',
    '  process.stdout.write(\'9.9.9\\n\');',
    '} else {',
    '  const child = spawn(actualServer, process.argv.slice(2), { stdio: \'inherit\' });',
    '  child.once(\'error\', (cause) => { throw cause; });',
    '  child.once(\'exit\', (code, signal) => {',
    '    if (signal !== null) process.kill(process.pid, signal);',
    '    else process.exit(code ?? 1);',
    '  });',
    '}',
    '',
  ].join('\n'), 'utf8');
  await chmod(wrapperPath, 0o755);

  try {
    const { stdout: gitDirectory } = await execFileAsync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      resolve(repositoryRoot, 'scripts/real-same-name-lsp-e2e.ts'),
    ], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ACE_LSP_COMMAND: wrapperPath,
        GIT_DIR: gitDirectory.trim(),
      },
    });
    const report = JSON.parse(await readFile(
      join(temporaryRoot, 'benchmarks/reports/real-same-name-lsp-e2e.json'),
      'utf8',
    )) as { readonly provider?: unknown };
    assert.equal(typeof report.provider, 'string');
    assert.match(
      report.provider,
      /^ast-grep \S+ \+ typescript-language-server 9\.9\.9$/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
