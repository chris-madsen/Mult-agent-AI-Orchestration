import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { Effect } from 'effect';
import { makeAstGrepStructuralPort } from '../src/adapters/ast-grep-structural.js';
import { compareStructuralAnalyses } from '../src/application/ast-grep-parity.js';

const command = process.env.ACE_AST_GREP_COMMAND?.trim() || resolve('node_modules/.bin/ast-grep');
const cli = makeAstGrepStructuralPort({ command, provider: 'cli', providerVersion: 'parity-cli' });
const napi = makeAstGrepStructuralPort({ command, provider: 'napi', providerVersion: 'parity-napi' });

const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'node_modules', '__pycache__']);

const collectFiles = async (input: string): Promise<string[]> => {
  const absolute = resolve(input);
  const metadata = await stat(absolute);
  if (metadata.isFile()) return sourceExtensions.has(extname(absolute).toLocaleLowerCase()) ? [absolute] : [];
  if (!metadata.isDirectory()) return [];
  const entries = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter((entry) => !entry.isDirectory() || !ignoredDirectories.has(entry.name))
    .map((entry) => collectFiles(resolve(absolute, entry.name))));
  return nested.flat().sort((left, right) => left.localeCompare(right));
};

const inputs = process.argv.slice(2);
const roots = inputs.length === 0 ? ['test/fixtures/ast-grep-parity/representative.ts'] : inputs;
const files = [...new Set((await Promise.all(roots.map(collectFiles))).flat())].sort();
if (files.length === 0) throw new Error('No JS/TS/TSX source files were found for parity comparison');

const reports = [];
for (const file of files) {
  const source = new Uint8Array(await readFile(file));
  const repoPath = (relative(process.cwd(), file) || file).replaceAll('\\', '/');
  const [cliResult, napiResult] = await Promise.all([
    Effect.runPromise(cli.extract({ repoPath, source })),
    Effect.runPromise(napi.extract({ repoPath, source })),
  ]);
  if (cliResult._tag === 'Err') throw new Error(`CLI parity extraction failed for ${repoPath}: ${cliResult.error.message}`);
  if (napiResult._tag === 'Err') throw new Error(`NAPI parity extraction failed for ${repoPath}: ${napiResult.error.message}`);
  reports.push(compareStructuralAnalyses(cliResult.value, napiResult.value));
}

const equivalent = reports.every((report) => report.equivalent);
process.stdout.write(JSON.stringify({ fileCount: reports.length, equivalent, reports }, null, 2) + '\n');
if (!equivalent) process.exitCode = 2;
