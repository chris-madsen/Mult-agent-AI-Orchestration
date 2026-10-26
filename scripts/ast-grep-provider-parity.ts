import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeAstGrepStructuralPort } from '../src/adapters/ast-grep-structural.js';
import { compareStructuralAnalyses } from '../src/application/ast-grep-parity.js';

const command = process.env.ACE_AST_GREP_COMMAND?.trim() || resolve('node_modules/.bin/ast-grep');
const fixture = process.argv[2] ?? 'test/fixtures/ast-grep-parity/representative.ts';
const source = new Uint8Array(await readFile(fixture));
const repoPath = fixture.replaceAll('\\', '/');
const cli = makeAstGrepStructuralPort({ command, provider: 'cli', providerVersion: 'parity-cli' });
const napi = makeAstGrepStructuralPort({ command, provider: 'napi', providerVersion: 'parity-napi' });
const [cliResult, napiResult] = await Promise.all([
  Effect.runPromise(cli.extract({ repoPath, source })),
  Effect.runPromise(napi.extract({ repoPath, source })),
]);
if (cliResult._tag === 'Err') throw new Error(`CLI parity extraction failed: ${cliResult.error.message}`);
if (napiResult._tag === 'Err') throw new Error(`NAPI parity extraction failed: ${napiResult.error.message}`);
const report = compareStructuralAnalyses(cliResult.value, napiResult.value);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.equivalent) process.exitCode = 2;
