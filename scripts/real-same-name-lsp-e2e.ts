import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import {
  makeAstGrepStructuralPort,
  resolveAstGrepProviderIdentity,
} from '../src/adapters/ast-grep-structural.js';
import { resolveLspProviderIdentity } from '../src/adapters/lsp-semantic.js';
import { makeTypeScriptLanguageServicePort } from '../src/adapters/typescript-language-service.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import type { Result } from '../src/domain/result.js';

const mustOk = <Value, Error>(result: Result<Value, Error>): Value => {
  assert.equal(result._tag, 'Ok');
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};

const queryAt = (source: string, token: string, occurrence: number): { readonly line: number; readonly column: number } => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
  assert.ok(offset >= 0, `token ${token} occurrence ${occurrence} must exist`);
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

const workspaceId = mustOk(makeWorkspaceId('real-dbc04-same-name'));
const parent = await mkdtemp(join(tmpdir(), 'ace-real-dbc04-'));
const root = join(parent, 'workspace');
await mkdir(root);
const source = [
  'export class UserRepository {',
  '  save(value: string): string { return `user:${value}`; }',
  '}',
  'export class AuditRepository {',
  '  save(value: string): string { return `audit:${value}`; }',
  '}',
  'export function persistUser(repo: UserRepository, value: string): string { return repo.save(value); }',
  'export function persistAudit(repo: AuditRepository, value: string): string { return repo.save(value); }',
  'export function updateCounter(): number {',
  '  let count = 0;',
  '  count = count + 1;',
  '  return count;',
  '}',
].join('\n') + '\n';
const sourcePath = join(root, 'repositories.ts');
await writeFile(sourcePath, source);
const sourceBytes = await readFile(sourcePath);
const sourceDigest = createHash('sha256').update(sourceBytes).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
if (!/^[a-f0-9]{40,64}$/u.test(sourceCommit)) throw new Error('could not resolve exact same-name evidence source commit');

try {
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const structuralCommand = resolve('node_modules/.bin/ast-grep');
  const lspCommand = process.env.ACE_LSP_COMMAND?.trim() || resolve('node_modules/.bin/typescript-language-server');
  const structuralIdentity = mustOk(await Effect.runPromise(resolveAstGrepProviderIdentity({
    command: structuralCommand,
  })));
  const lspIdentity = mustOk(await Effect.runPromise(resolveLspProviderIdentity({
    command: lspCommand,
    snapshotIdentity: sourceCommit,
  })));
  const structural = makeAstGrepStructuralPort({ command: structuralCommand });
  const indexed = mustOk(await Effect.runPromise(buildLocalCodeIndex(files, workspaceId, root, { generation: 1, structural })));
  const saves = indexed.index.candidates.filter((candidate) => candidate.symbolName === 'save');
  assert.equal(saves.length, 2);
  assert.notEqual(saves[0]?.range.startLine, saves[1]?.range.startLine);
  assert.ok(saves.every((candidate) => candidate.sourceDigest === sourceDigest));
  assert.ok(saves.every((candidate) => candidate.text.includes('save')));

  const semantics = makeTypeScriptLanguageServicePort({ rootPath: root, files: { 'repositories.ts': source } });
  const userCall = queryAt(source, 'save', 2);
  const auditCall = queryAt(source, 'save', 3);
  const userDefinition = mustOk(await Effect.runPromise(semantics.definition({ repoPath: 'repositories.ts', ...userCall })));
  const auditDefinition = mustOk(await Effect.runPromise(semantics.definition({ repoPath: 'repositories.ts', ...auditCall })));
  assert.equal(userDefinition.length, 1);
  assert.equal(auditDefinition.length, 1);
  assert.equal(userDefinition[0]?.location.startLine, 2);
  assert.equal(auditDefinition[0]?.location.startLine, 5);
  assert.notEqual(userDefinition[0]?.location.startLine, auditDefinition[0]?.location.startLine);

  const userReferences = mustOk(await Effect.runPromise(semantics.references({ repoPath: 'repositories.ts', line: 2, column: 3 })));
  const auditReferences = mustOk(await Effect.runPromise(semantics.references({ repoPath: 'repositories.ts', line: 5, column: 3 })));
  assert.ok(userReferences.some((reference) => reference.location.startLine === userCall.line && !reference.isDefinition));
  assert.ok(auditReferences.some((reference) => reference.location.startLine === auditCall.line && !reference.isDefinition));
  assert.ok(!userReferences.some((reference) => reference.location.startLine === auditCall.line));
  assert.ok(!auditReferences.some((reference) => reference.location.startLine === userCall.line));

  const userType = mustOk(await Effect.runPromise(semantics.typeInfo({ repoPath: 'repositories.ts', ...queryAt(source, 'value', 0) })));
  assert.match(userType?.display ?? '', /string/u);
  const writeReferences = mustOk(await Effect.runPromise(semantics.references({ repoPath: 'repositories.ts', line: 10, column: 7 })));
  assert.equal(writeReferences.filter((reference) => reference.isDefinition).length, 1);
  assert.ok(writeReferences.some((reference) => reference.location.startLine === 11 && !reference.isDefinition));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit,
    command: 'npm run test:real-same-name',
    status: 'provider-pass',
    contract: 'DBC-04',
    provider: `${structuralIdentity.version} + ${lspIdentity.server} ${lspIdentity.version}`,
    source: 'repositories.ts',
    sourceDigest,
    structuralSaveSpans: saves.map((candidate) => candidate.range),
    userDefinition: userDefinition[0]?.location,
    auditDefinition: auditDefinition[0]?.location,
    userReferenceLines: userReferences.map((reference) => ({ line: reference.location.startLine, isDefinition: reference.isDefinition })),
    auditReferenceLines: auditReferences.map((reference) => ({ line: reference.location.startLine, isDefinition: reference.isDefinition })),
    writeReferenceLines: writeReferences.map((reference) => ({ line: reference.location.startLine, isDefinition: reference.isDefinition })),
    invariant: 'same-name methods remain distinct; assignment is not a definition',
  };
  await mkdir('benchmarks/reports', { recursive: true });
  await writeFile('benchmarks/reports/real-same-name-lsp-e2e.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, report: 'benchmarks/reports/real-same-name-lsp-e2e.json' }, null, 2));
} finally {
  await rm(parent, { recursive: true, force: true });
}
