#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FULL_SUITE_TRIGGERS = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.eslint.json',
  '.eslintrc.cjs',
  'scripts/run-affected-tests.mjs',
]);

const normalize = (value) => value.replaceAll('\\', '/').replace(/^\.\//u, '');

const git = (args, { allowFailure = false } = {}) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.status === 0 ? result.stdout.trim() : '';
};

const lines = (value) => value.split(/\r?\n/u).map((line) => normalize(line.trim())).filter(Boolean);

export const parseImports = (source) => {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
};

export const resolveRelativeImport = (importer, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const candidates = [];
  if (/\.(?:js|mjs|cjs)$/u.test(base)) {
    candidates.push(base.replace(/\.(?:js|mjs|cjs)$/u, '.ts'));
  } else if (/\.ts$/u.test(base)) {
    candidates.push(base);
  } else {
    candidates.push(`${base}.ts`, posix.join(base, 'index.ts'));
  }
  return candidates[0] ?? null;
};

export const selectAffectedTests = ({ trackedFiles, changedFiles, contents }) => {
  const tests = trackedFiles.filter((file) => /^test\/[^/]+\.test\.ts$/u.test(file)).sort();
  if (changedFiles.some((file) => FULL_SUITE_TRIGGERS.has(file))) {
    return { mode: 'full', tests, reasons: ['broad test/build configuration changed'] };
  }

  const codeFiles = trackedFiles.filter((file) => /^(?:src|test)\/.*\.ts$/u.test(file));
  const reverse = new Map();
  for (const importer of codeFiles) {
    const source = contents.get(importer) ?? '';
    for (const specifier of parseImports(source)) {
      const target = resolveRelativeImport(importer, specifier);
      if (!target) continue;
      const importers = reverse.get(target) ?? new Set();
      importers.add(importer);
      reverse.set(target, importers);
    }
  }

  const selected = new Set(changedFiles.filter((file) => /^test\/[^/]+\.test\.ts$/u.test(file)));
  const queue = changedFiles.filter((file) => file.startsWith('src/'));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const importer of reverse.get(current) ?? []) {
      if (/^test\/[^/]+\.test\.ts$/u.test(importer)) selected.add(importer);
      if (importer.startsWith('src/') && !seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }

  // CLI/evidence tests often execute scripts instead of importing them. Use a narrow textual
  // reference fallback rather than declaring every scripts/ change to affect the full suite.
  for (const changed of changedFiles.filter((file) => file.startsWith('scripts/'))) {
    const basename = posix.basename(changed).replace(/\.(?:ts|mjs|js|py|sh)$/u, '');
    for (const testFile of tests) {
      const source = contents.get(testFile) ?? '';
      if (source.includes(changed) || (basename.length >= 8 && source.includes(basename))) {
        selected.add(testFile);
      }
    }
  }

  return {
    mode: selected.size === 0 ? 'none' : 'affected',
    tests: [...selected].sort(),
    reasons: selected.size === 0 ? ['no dependent deterministic TypeScript tests discovered'] : [],
  };
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  let base = process.env.ACE_TEST_BASE ?? null;
  let dryRun = false;
  let selfTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--self-test') selfTest = true;
    else if (arg === '--base') {
      base = args[index + 1] ?? null;
      index += 1;
    } else if (arg?.startsWith('--base=')) base = arg.slice('--base='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { base, dryRun, selfTest };
};

const detectBase = (explicitBase) => explicitBase ?? 'HEAD';

const changedFilesFromGit = (base) => {
  const changed = new Set();
  if (base !== 'HEAD') {
    for (const file of lines(git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]))) changed.add(file);
  }
  for (const file of lines(git(['diff', '--name-only', '--diff-filter=ACMR']))) changed.add(file);
  for (const file of lines(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']))) changed.add(file);
  for (const file of lines(git(['ls-files', '--others', '--exclude-standard']))) changed.add(file);
  return [...changed].sort();
};

const runSelfTest = () => {
  const trackedFiles = [
    'src/a.ts',
    'src/b.ts',
    'test/a.test.ts',
    'test/b.test.ts',
    'test/script.test.ts',
    'scripts/report.ts',
  ];
  const contents = new Map([
    ['src/a.ts', 'export const a = 1;'],
    ['src/b.ts', "import { a } from './a.js'; export const b = a;"],
    ['test/a.test.ts', "import { a } from '../src/a.js';"],
    ['test/b.test.ts', "import { b } from '../src/b.js';"],
    ['test/script.test.ts', "const script = 'scripts/report.ts';"],
    ['scripts/report.ts', 'export {};'],
  ]);

  assert.deepEqual(
    selectAffectedTests({ trackedFiles, changedFiles: ['src/a.ts'], contents }).tests,
    ['test/a.test.ts', 'test/b.test.ts'],
  );
  assert.equal(
    selectAffectedTests({ trackedFiles, changedFiles: ['docs/readme.md'], contents }).mode,
    'none',
  );
  assert.equal(
    selectAffectedTests({ trackedFiles, changedFiles: ['package.json'], contents }).mode,
    'full',
  );
  assert.deepEqual(
    selectAffectedTests({ trackedFiles, changedFiles: ['scripts/report.ts'], contents }).tests,
    ['test/script.test.ts'],
  );
  console.log('[test-impact] self-test PASS');
};

const main = () => {
  const { base: explicitBase, dryRun, selfTest } = parseArgs();
  if (selfTest) {
    runSelfTest();
    return;
  }
  const base = detectBase(explicitBase);
  // `git ls-files` also reports paths deleted in the working tree. Never pass
  // those stale paths to the test runner after a test file is intentionally
  // removed as part of a provider migration.
  const trackedFiles = lines(git(['ls-files', 'src', 'test', 'scripts'])).filter((file) => existsSync(file));
  const changedFiles = changedFilesFromGit(base);
  const contents = new Map();
  for (const file of trackedFiles) {
    if (/\.(?:ts|mjs|js|py|sh)$/u.test(file) && existsSync(file)) {
      contents.set(file, readFileSync(file, 'utf8'));
    }
  }

  const selection = selectAffectedTests({ trackedFiles, changedFiles, contents });
  console.log(`[test-impact] base=${base}`);
  console.log(`[test-impact] changed=${changedFiles.length} mode=${selection.mode} tests=${selection.tests.length}`);
  if (changedFiles.length > 0) console.log(changedFiles.map((file) => `  changed: ${file}`).join('\n'));
  if (selection.reasons.length > 0) console.log(selection.reasons.map((reason) => `  reason: ${reason}`).join('\n'));
  if (selection.tests.length > 0) console.log(selection.tests.map((file) => `  test: ${file}`).join('\n'));

  if (dryRun || selection.mode === 'none') return;
  const command = selection.mode === 'full'
    ? ['test']
    : ['exec', '--', 'tsx', '--test', ...selection.tests];
  const npmInvocation = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', ['npm.cmd', ...command].join(' ')]]
    : ['npm', command];
  const result = spawnSync(npmInvocation[0], npmInvocation[1], { stdio: 'inherit' });
  process.exitCode = result.error === undefined ? (result.status ?? 1) : 1;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
