import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { makeLspSemanticAnalysisPort, resolveLspProviderIdentity } from '../src/adapters/lsp-semantic.js';
import type { Result } from '../src/domain/result.js';

const mustOk = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result._tag !== 'Ok') throw new Error(String(result.error));
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
  'pub fn invalid() { missing_name(); }',
].join('\n') + '\n';
const cargo = '[package]\nname = "ace_non_ts_lsp_conformance"\nversion = "0.1.0"\nedition = "2021"\n';
const sourcePath = 'src/lib.rs';
const fixtureSha256 = sha256(`${cargo}\0${source}`);

try {
  await mkdir(join(rootPath, 'src'), { recursive: true });
  await writeFile(join(rootPath, 'Cargo.toml'), cargo, 'utf8');
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
  });
  try {
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
    assert.ok(diagnostics.length > 0, 'non-TS LSP must publish the invalid-identifier diagnostic');

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
      referenceCount: references.length,
      hover: hover.display,
      diagnosticCodes: diagnostics.map((item) => item.code),
      invariant: 'a non-TypeScript LSP resolves definitions, references, hover and diagnostics through the generic ACE port',
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ ...report, report: outputPath }, null, 2)}\n`);
  } finally {
    provider.close();
  }
} finally {
  await rm(parent, { recursive: true, force: true });
}
