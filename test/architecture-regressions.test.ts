import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { exportCodexHistory } from '../src/adapters/codex-session-history.js';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeLocalContextProvider } from '../src/adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { makeAstGrepStructuralPort } from '../src/adapters/ast-grep-structural.js';
import { makeTypeScriptLanguageServicePort } from '../src/adapters/typescript-language-service.js';
import { makeRequestId, mergeEvidence } from '../src/domain/retrieval.js';
import { makeEpisodeId, type SessionEpisode } from '../src/domain/memory.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import type { Result } from '../src/domain/result.js';

const mustOk = <T, E>(r: Result<T, E>): T => {
  assert.equal(r._tag, 'Ok');
  if (r._tag === 'Err') throw new Error(String(r.error));
  return r.value;
};
const workspaceId = mustOk(makeWorkspaceId('architecture-regression'));
const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

test('DBC-02 parsed TS function has an exact span, not a whole-file-per-symbol payload', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-ast-'));
  const root = join(parent, 'repo');
  await mkdir(join(root, 'src'), { recursive: true });
  const functionText = [
    'export function reconnect(input: string): string {',
    '  const retry = input.trim();',
    '  return retry;',
    '}',
  ].join('\n');
  const filler = Array.from({ length: 1996 }, (_, i) => '// unrelated line ' + i).join('\n');
  const full = functionText + '\n' + filler + '\n';
  await writeFile(join(root, 'src', 'connections.ts'), full);
  const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
  const indexed = mustOk(await Effect.runPromise(buildLocalCodeIndex(files, workspaceId, root, {
    generation: 1,
    structural: makeAstGrepStructuralPort({ command: join(process.cwd(), 'node_modules/.bin/ast-grep') }),
  })));
  const match = indexed.index.candidates.find((item) => item.symbolName === 'reconnect');
  assert.ok(match);
  assert.equal(match.range.startLine, 1);
  assert.equal(match.range.endLine, 4);
  assert.equal(match.text, functionText);
  assert.equal(match.sourceDigest, sha(Buffer.from(full)));
  assert.ok(!match.text.includes('unrelated line'));

  const requestFiles = {
    ...files,
    snapshot: () => { throw new Error('retrieval must not snapshot the entire worktree'); },
  };
  const provider = makeLocalContextProvider({
    workspaceId, rootPath: root, files: requestFiles, index: indexed.index,
    newRequestId: () => 'dbc02-retrieval',
  });
  const bundle = mustOk(await Effect.runPromise(provider.search({
    workspaceId, query: 'reconnect', includeDocs: false, includeMemory: false,
  })));
  assert.equal(bundle.evidence[0]?.content, functionText);
  assert.equal(bundle.complete, false, 'local fallback is not an approved Qdrant semantic provider');
});

test('DBC-06 a missing required source makes context incomplete even with fresh evidence', () => {
  const request = mustOk(makeRequestId('dbc06'));
  const result = mergeEvidence(request, 'search', [], [], ['qdrant']);
  assert.equal(result.complete, false);
  assert.ok(result.partialSources.includes('qdrant'));
});

test('DBC-04 write access must not be classified as a symbol definition', async () => {
  const { source, name } = { source: 'let count = 1;\ncount = 2;\nconsole.log(count);\n', name: 'count' };
  const service = makeTypeScriptLanguageServicePort({ rootPath: process.cwd(), files: { 'dbc04.ts': source } });
  const refs = mustOk(await Effect.runPromise(service.references({ repoPath: 'dbc04.ts', line: 1, column: source.indexOf(name) + 1 })));
  assert.equal(refs.length, 3);
  assert.equal(refs.filter((ref) => ref.isDefinition).length, 1);
  assert.equal(refs.find((ref) => ref.location.startLine === 2)?.isDefinition, false);
});

test('DBC-10 appending JSONL leaves existing episode identities stable', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ace-history-'));
  const file = join(folder, 'history.jsonl');
  const recordA = '{"session_id":"s1","ts":1700000000,"text":"first"}\n';
  const recordB = '{"session_id":"s1","ts":1700000001,"text":"second"}\n';
  await writeFile(file, recordA);
  const first = mustOk(await exportCodexHistory(file, workspaceId, 1700000002000));
  await writeFile(file, recordA + recordB);
  const second = mustOk(await exportCodexHistory(file, workspaceId, 1700000003000));
  assert.equal(second.episodes.length, 2);
  assert.equal(first.episodes[0]?.episodeId, second.episodes[0]?.episodeId);
  assert.notEqual(first.sourceDigest, second.sourceDigest);
});

test('DBC-11 deleting one episode never deletes shared content needed by another', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ace-shared-'));
  const archive = await makeAsyncFileMemoryArchive(root);
  const content = Buffer.from('{"shared":"original raw bytes"}\n');
  const makeEpisode = (id: string): SessionEpisode => ({
    episodeId: mustOk(makeEpisodeId(id)),
    workspaceId,
    sessionId: 'same-session',
    sourcePointer: 'codex://source/' + id,
    occurredAtMs: 1700000000000,
    importedAtMs: 1700000001000,
    contentDigest: sha(content) as SessionEpisode['contentDigest'],
    content, searchText: 'shared content', tombstoned: false,
  });
  const first = makeEpisode('reference-a');
  const second = makeEpisode('reference-b');
  mustOk(await archive.importEpisode(first));
  mustOk(await archive.importEpisode(second));
  mustOk(await archive.deleteEpisode(first.episodeId));
  const survivor = mustOk(await archive.readEpisode(second.episodeId));
  assert.deepEqual(Buffer.from(survivor.content), content);
  assert.equal((await archive.readEpisode(first.episodeId))._tag, 'Err');
  mustOk(await archive.deleteEpisode(second.episodeId));
});

test('RepoMap def/ref graph must not regain the old full-candidate LSP dependency', async () => {
  const source = await readFile(join(process.cwd(), 'src/adapters/repo-map-structural.ts'), 'utf8');
  assert.doesNotMatch(source, /SemanticAnalysisPort|input\.semantics|semantics\.references/u,
    'RepoMap must consume shared ast-grep def/ref records, never an LSP scan over candidates');
});

test('legacy handwritten MCP framing is removed; official SDK remains sole explicit-tool transport', async () => {
  await assert.rejects(
    readFile(join(process.cwd(), 'src/transport/mcp-stdio.ts'), 'utf8'),
    { code: 'ENOENT' },
  );
  const barrel = await readFile(join(process.cwd(), 'src/index.ts'), 'utf8');
  const runtime = await readFile(join(process.cwd(), 'src/bin/ace-mcp.ts'), 'utf8');
  assert.doesNotMatch(barrel, /transport\/mcp-stdio\.js/u);
  assert.match(runtime, /runMcpSdkStdio\(mcpGateway/u);
  assert.doesNotMatch(runtime, /runMcpStdio\(/u);
});

test('Bifrost model projection and native context bridge never construct an MCP gateway', async () => {
  const runtime = await readFile(join(process.cwd(), 'src/bin/ace-mcp.ts'), 'utf8');
  const httpStart = runtime.indexOf("if (process.env.ACE_GATEWAY_HTTP_MODE === 'true') {");
  const nativeStart = runtime.indexOf("} else if (process.env.ACE_CONTEXT_BRIDGE_MODE === 'true')", httpStart);
  const toolStart = runtime.indexOf('const mcpGateway = makeMcpGateway(', nativeStart);
  assert.ok(httpStart >= 0 && nativeStart > httpStart && toolStart > nativeStart);
  assert.match(runtime.slice(httpStart, nativeStart), /runGatewayProjectionHttp\(makeGatewayProjectionService/u);
  assert.doesNotMatch(runtime.slice(httpStart, nativeStart), /runMcpSdkStdio/u);
  assert.match(runtime, /mutually exclusive context-delivery owners/u);
});
