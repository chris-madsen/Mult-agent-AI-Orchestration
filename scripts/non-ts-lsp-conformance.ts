import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { makeLspSemanticAnalysisPort, resolveLspProviderIdentity } from '../src/adapters/lsp-semantic.js';
import { makeRoutedLspSession } from '../src/application/lsp/routed-semantic.js';
import type { Result } from '../src/domain/result.js';

const mustOk = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result._tag !== 'Ok') throw new Error(JSON.stringify(result.error));
  return result.value;
};

const queryAt = (source: string, token: string, occurrence: number): { readonly line: number; readonly column: number } => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
  assert.ok(offset >= 0, `fixture token ${token} occurrence ${occurrence} must exist`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const parseArgs = (): readonly string[] => {
  const raw = process.env.ACE_NON_TS_LSP_ARGS ?? '[]';
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('ACE_NON_TS_LSP_ARGS must be a JSON array of strings');
  }
  return parsed;
};

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
if (!/^[a-f0-9]{40,64}$/u.test(sourceCommit)) throw new Error('could not resolve exact conformance source commit');

const command = process.env.ACE_NON_TS_LSP_COMMAND?.trim() || 'rust-analyzer';
const args = parseArgs();
const serverName = process.env.ACE_NON_TS_LSP_SERVER?.trim() || 'rust-analyzer';
const languageId = process.env.ACE_NON_TS_LSP_LANGUAGE_ID?.trim() || 'rust';
const extension = process.env.ACE_NON_TS_LSP_EXTENSION?.trim() || '.rs';
const outputPath = process.argv[2] || 'benchmarks/reports/non-ts-lsp-conformance.json';
const snapshotIdentity = sha256(JSON.stringify({ sourceCommit, command, args, serverName }));

const parent = await mkdtemp(join(tmpdir(), 'ace-non-ts-lsp-'));
const rootPath = join(parent, 'workspace');
const source = [
  'pub fn save() -> String { "ok".to_owned() }',
  'pub fn call() -> String { save() }',
  'pub fn invalid() -> u32 { "not-a-number".to_owned() }',
].join('\n') + '\n';
const sourcePath = 'src/lib.rs';
const cargoToml = [
  '[package]',
  'name = "ace-non-ts-lsp-fixture"',
  'version = "0.1.0"',
  'edition = "2021"',
  '',
].join('\n');
const fixtureSha256 = sha256(`${cargoToml}\0${source}`);

try {
  await mkdir(join(rootPath, 'src'), { recursive: true });
  await writeFile(join(rootPath, 'Cargo.toml'), cargoToml, 'utf8');
  await writeFile(join(rootPath, sourcePath), source, 'utf8');

  const identity = mustOk(await Effect.runPromise(resolveLspProviderIdentity({
    command,
    args,
    serverName,
    snapshotIdentity,
  })));
  const provider = makeLspSemanticAnalysisPort({
    command,
    args,
    serverName,
    providerVersion: identity.version,
    rootPath,
    files: { [sourcePath]: source },
    languageIds: { [extension]: languageId },
    snapshotIdentity,
    timeoutMs: Number(process.env.ACE_NON_TS_LSP_TIMEOUT_MS ?? 30_000),
    keepProcessAlive: false,
  });
  try {
    mustOk(await Effect.runPromise(provider.refresh({ [sourcePath]: source }, snapshotIdentity)));
    // Claw-style lazy startup begins on the first actual semantic request,
    // not on refresh(). Warm the real server before measuring its index delay.
    mustOk(await Effect.runPromise(provider.typeInfo({
      repoPath: sourcePath,
      ...queryAt(source, 'save', 0),
      snapshotIdentity,
    })));
    await wait(Number(process.env.ACE_NON_TS_LSP_SETTLE_MS ?? 5_000));
    const definition = mustOk(await Effect.runPromise(provider.definition({
      repoPath: sourcePath,
      ...queryAt(source, 'save', 1),
      snapshotIdentity,
    })));
    const references = mustOk(await Effect.runPromise(provider.references({
      repoPath: sourcePath,
      ...queryAt(source, 'save', 0),
      snapshotIdentity,
    })));
    const hover = mustOk(await Effect.runPromise(provider.typeInfo({
      repoPath: sourcePath,
      ...queryAt(source, 'save', 1),
      snapshotIdentity,
    })));
    const diagnostics = mustOk(await Effect.runPromise(provider.diagnostics({ repoPath: sourcePath })));

    assert.ok(definition.length > 0, 'non-TS LSP must resolve a definition');
    assert.ok(references.length > 0, 'non-TS LSP must return references');
    assert.ok(hover !== undefined, 'non-TS LSP must return hover/type information');
    assert.ok(diagnostics.length > 0, 'non-TS LSP conformance requires diagnostics for the invalid fixture');

    // Exercise the real multi-server router with the native Rust LSP plus
    // the pinned TypeScript language server in the SAME verified workspace.
    // No synthetic LSP server or second process-manager implementation.
    const tsSourcePath = 'src/main.ts';
    const tsSource = [
      'export function tsTarget(): string { return "ok"; }',
      'export function tsCaller(): string { return tsTarget(); }',
      '',
    ].join('\\n');
    await writeFile(join(rootPath, tsSourcePath), tsSource, 'utf8');
    const tsProvider = makeLspSemanticAnalysisPort({
      command: join(process.cwd(), 'node_modules/.bin/typescript-language-server'),
      args: ['--stdio'],
      serverName: 'typescript-language-server',
      rootPath,
      files: { [tsSourcePath]: tsSource },
      languageIds: { '.ts': 'typescript' },
      snapshotIdentity,
      timeoutMs: 30_000,
      keepProcessAlive: false,
    });
    let mixedTsDefinitionCount = 0;
    try {
      const routed = makeRoutedLspSession([
        { session: provider, languageIds: { [extension]: languageId } },
        { session: tsProvider, languageIds: { '.ts': 'typescript' } },
      ]);
      const tsDefinitions = mustOk(await Effect.runPromise(routed.definition({
        repoPath: tsSourcePath,
        ...queryAt(tsSource, 'tsTarget', 1),
        snapshotIdentity,
      })));
      assert.ok(tsDefinitions.length > 0,
        'real mixed-language router must resolve TS through TS LSP');
      mixedTsDefinitionCount = tsDefinitions.length;
      const routedRust = mustOk(await Effect.runPromise(routed.definition({
        repoPath: sourcePath,
        ...queryAt(source, 'save', 1),
        snapshotIdentity,
      })));
      assert.ok(routedRust.length > 0,
        'real mixed-language router must resolve Rust through Rust LSP');
      const unrelated = await Effect.runPromise(routed.definition({
        repoPath: 'src/unhandled.py', line: 1, column: 1, snapshotIdentity,
      }));
      assert.equal(unrelated._tag, 'Err',
        'unowned language is explicitly unsupported, not silently sent to TS/Rust');
    } finally {
      await tsProvider.close();
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceCommit,
      command: 'npm run test:real-non-ts-lsp',
      status: 'provider-pass',
      contract: 'generic-lsp-conformance',
      providerIdentity: identity,
      fixtureSha256,
      sourcePath,
      languageId,
      definitionCount: definition.length,
      mixedTsDefinitionCount,
      referenceCount: references.length,
      hover: hover.display,
      diagnosticCodes: diagnostics.map((item) => item.code),
      diagnosticSupport: 'non_empty_fixture_diagnostic',
      invariant: 'a non-TypeScript LSP resolves definitions, references, hover and diagnostics through the generic ACE port',
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ ...report, report: outputPath }, null, 2)}\n`);
  } finally {
    await provider.close();
  }
} finally {
  await rm(parent, { recursive: true, force: true });
}
