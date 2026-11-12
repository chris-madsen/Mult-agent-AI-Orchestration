#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// Even a toolchain/lockfile change stays bounded in PRs. The nightly workflow
// owns the exhaustive suite. This small smoke set is a safety net, not a claim
// that the PR covered every consumer of a changed dependency.
const BROAD_CONFIG_TRIGGERS = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.eslint.json',
  '.eslintrc.cjs',
  'scripts/run-affected-tests.mjs',
]);
const SMOKE_TESTS = new Set([
  'test/foundation.test.ts',
  'test/mcp-sdk-runtime.conformance.test.ts',
  'test/public-contract-compatibility.contracts.test.ts',
  'test/runtime-provenance.contracts.test.ts',
]);

const normalize = (value) => value.replaceAll('\\', '/').replace(/^\.\//u, '');

const git = (args, { allowFailure = false } = {}) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.status === 0 ? result.stdout.trim() : '';
};

// Git quotes non-ASCII paths by default; -z is required for correct impact
// selection. In particular, a renamed/unicode source must not silently select
// zero tests merely because Git printed a quoted path.
const gitPaths = (args) => {
  const result = spawnSync('git', [...args, '-z'], { encoding: null, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(' ')} -z failed: ${String(result.stderr ?? '')}`);
  }
  return result.stdout.toString('utf8').split('\\0').filter(Boolean).map(normalize);
};

export const parseImports = (source) => {
  const specifiers = new Set();
  const sourceFile = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const addModuleSpecifier = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const hasRuntimeBinding = clause === undefined
        || (!clause.isTypeOnly && (
          clause.name !== undefined
          || bindings === undefined
          || ts.isNamespaceImport(bindings)
          || bindings.elements.length === 0
          || bindings.elements.some((element) => !element.isTypeOnly)
        ));
      if (hasRuntimeBinding) addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)
      && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) {
      addModuleSpecifier(node.moduleReference.expression);
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const hasRuntimeExport = !node.isTypeOnly && (
        clause === undefined
        || ts.isNamespaceExport(clause)
        || clause.elements.length === 0
        || clause.elements.some((element) => !element.isTypeOnly)
      );
      if (hasRuntimeExport) addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length >= 1) {
      addModuleSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
  const broadConfiguration = changedFiles.some((file) => BROAD_CONFIG_TRIGGERS.has(file));

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

  if (broadConfiguration) {
    const smoke = tests.filter((file) => SMOKE_TESTS.has(file));
    for (const file of smoke.length > 0 ? smoke : tests.slice(0, 3)) selected.add(file);
  }
  return {
    mode: broadConfiguration ? 'smoke' : selected.size === 0 ? 'none' : 'affected',
    tests: [...selected].sort(),
    reasons: [
      ...(broadConfiguration ? ['broad config changed: bounded smoke + affected tests; exhaustive suite runs nightly'] : []),
      ...(selected.size === 0 ? ['NO MATCHING TESTS: do not treat this as behavioral acceptance'] : []),
    ],
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
    for (const file of gitPaths(['diff', '--name-only', '--diff-filter=ACDMRT', `${base}...HEAD`])) changed.add(file);
  }
  for (const file of gitPaths(['diff', '--name-only', '--diff-filter=ACDMRT'])) changed.add(file);
  for (const file of gitPaths(['diff', '--cached', '--name-only', '--diff-filter=ACDMRT'])) changed.add(file);
  for (const file of gitPaths(['ls-files', '--others', '--exclude-standard'])) changed.add(file);
  return [...changed].sort();
};

const runSelfTest = () => {
  const trackedFiles = [
    'src/a.ts',
    'src/b.ts',
    'src/shared-types.ts',
    'src/type-only-consumer.ts',
    'src/value-consumer.ts',
    'test/a.test.ts',
    'test/b.test.ts',
    'test/script.test.ts',
    'test/type-only-consumer.test.ts',
    'test/value-consumer.test.ts',
    'scripts/report.ts',
  ];
  const contents = new Map([
    ['src/a.ts', 'export const a = 1;'],
    ['src/b.ts', "import { a } from './a.js'; export const b = a;"],
    ['src/shared-types.ts', 'export type Shared = { value: string }; export const value = 1;'],
    ['src/type-only-consumer.ts', "import type { Shared } from './shared-types.js'; export const accept = (_value: Shared) => true;"],
    ['src/value-consumer.ts', "import { value } from './shared-types.js'; export const doubled = value * 2;"],
    ['test/a.test.ts', "import { a } from '../src/a.js';"],
    ['test/b.test.ts', "import { b } from '../src/b.js';"],
    ['test/script.test.ts', "const script = 'scripts/report.ts';"],
    ['test/type-only-consumer.test.ts', "import { accept } from '../src/type-only-consumer.js';"],
    ['test/value-consumer.test.ts', "import { doubled } from '../src/value-consumer.js';"],
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
  const broad = selectAffectedTests({ trackedFiles, changedFiles: ['package.json'], contents });
  assert.equal(broad.mode, 'smoke');
  assert.ok(broad.tests.length > 0 && broad.tests.length < trackedFiles.length);
  const mixed = selectAffectedTests({ trackedFiles, changedFiles: ['package.json', 'src/a.ts'], contents });
  assert.ok(mixed.tests.includes('test/b.test.ts'), 'broad config must preserve changed-code dependents');
  assert.deepEqual(
    selectAffectedTests({ trackedFiles, changedFiles: ['scripts/report.ts'], contents }).tests,
    ['test/script.test.ts'],
  );
  assert.deepEqual(
    selectAffectedTests({ trackedFiles, changedFiles: ['src/shared-types.ts'], contents }).tests,
    ['test/value-consumer.test.ts'],
  );
  assert.deepEqual(
    parseImports(`
      import type { Alpha } from './alpha.js';
      import { type Beta } from './beta.js';
      export type { Gamma } from './gamma.js';
      export { type Delta } from './delta.js';
    `),
    [],
  );
  assert.deepEqual(
    parseImports(`
      import './side-effect.js';
      import main, { type Shape, value } from './mixed.js';
      export * from './exports.js';
      const lazy = import('./lazy.js');
    `).sort(),
    ['./exports.js', './lazy.js', './mixed.js', './side-effect.js'],
  );
  assert.deepEqual(
    parseImports(`
      import dependency = require('./dependency.js');
      import type TypeDependency = require('./type-dependency.js');
      const lazy = import('./lazy-with-options.js', {});
    `).sort(),
    ['./dependency.js', './lazy-with-options.js'],
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
  const trackedFiles = gitPaths(['ls-files', 'src', 'test', 'scripts']).filter((file) => existsSync(file));
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
  // PR/inner-loop selector must never invoke npm test/full suite implicitly.
  const command = ['exec', '--', 'tsx', '--test', ...selection.tests];
  const npmInvocation = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', ['npm.cmd', ...command].join(' ')]]
    : ['npm', command];
  const result = spawnSync(npmInvocation[0], npmInvocation[1], { stdio: 'inherit' });
  process.exitCode = result.error === undefined ? (result.status ?? 1) : 1;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
