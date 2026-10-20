#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'ace-semantic-provider-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
const workspaceId = 'real-semantic-holdout-v1';
const fixtures = {
  'users.ts': `export type User = { id: string };\nexport function saveUser(record: User): void { repository.save(record); }\nexport function parseUser(input: string): User { return JSON.parse(input); }\nexport function deleteUser(id: string): void { repository.remove(id); }\n`,
  'workspace-files.ts': `export async function readExact(path: string): Promise<Uint8Array> { return fs.readFile(path); }\nexport async function writeExact(path: string, bytes: Uint8Array): Promise<void> { await fs.writeFile(path, bytes); }\nexport function hashContent(bytes: Uint8Array): string { return sha256(bytes); }\n`,
  'episodes.ts': `export async function removeEpisode(id: string): Promise<void> { await graph.removeEpisode(id); }\nexport async function addEpisode(text: string): Promise<void> { await graph.addEpisode(text); }\nexport async function searchMemory(query: string): Promise<Result[]> { return graph.search(query); }\n`,
};
for (const [path, source] of Object.entries(fixtures)) await writeFile(join(workspace, path), source);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/bin/ace-mcp.js'],
  cwd: resolve(import.meta.dirname, '..'),
  stderr: 'pipe',
  env: {
    ...process.env,
    ACE_WORKSPACE_ROOT: workspace,
    ACE_ALLOWED_ROOTS: root,
    ACE_STATE_DIR: join(root, 'state'),
    ACE_WORKSPACE_ID: workspaceId,
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_QDRANT_URL: process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333',
    ACE_EMBEDDING_WORKER: resolve(import.meta.dirname, 'fastembed-worker.sh'),
    ACE_AST_GREP_COMMAND: process.env.ACE_AST_GREP_COMMAND ?? resolve(import.meta.dirname, '../node_modules/.bin/ast-grep'),
  },
});
const client = new Client({ name: 'ace-semantic-holdout-client', version: '1.0.0' });
const cases = [
  { query: 'persist a user record', expected: 'users.ts', symbol: 'saveUser' },
  { query: 'read current workspace file bytes', expected: 'workspace-files.ts', symbol: 'readExact' },
  { query: 'удалить старый эпизод графа', expected: 'episodes.ts', symbol: 'removeEpisode' },
];

try {
  await client.connect(transport);
  const observations = [];
  for (const item of cases) {
    const result = await client.callTool({ name: 'ace_context', arguments: { workspace_id: workspaceId, query: item.query } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const bundle = result.structuredContent;
    assert.equal(bundle.complete, true, JSON.stringify(bundle));
    const expected = bundle.evidence.find((evidence) => evidence.citation.startsWith(`${item.expected}:`) && evidence.content.includes(`function ${item.symbol}`));
    assert.ok(expected, JSON.stringify(bundle));
    assert.equal(expected.freshness, 'current');
    observations.push({ query: item.query, citation: expected.citation, top1: bundle.evidence[0]?.citation, evidence_count: bundle.evidence.length });
  }
  const report = {
    status: 'provider-pass',
    dataset: 'inline_stage1_holdout_v1',
    provider: 'FastEmbed/ONNX sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    cases: observations,
    retrievalLimit: 6,
    recallAtLimit: observations.length / cases.length,
    top1Accuracy: observations.filter((item) => item.top1 === item.citation).length / cases.length,
    note: 'Exploratory three-case real-provider gate with a six-candidate response cap; the larger frozen holdout and production model approval remain open.',
  };
  await mkdir('benchmarks/reports', { recursive: true });
  await writeFile('benchmarks/reports/real-semantic-retrieval-e2e.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, report: 'benchmarks/reports/real-semantic-retrieval-e2e.json' }, null, 2));
} finally {
  await client.close();
  await rm(root, { recursive: true, force: true });
}
