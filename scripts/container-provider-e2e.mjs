#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repository = process.cwd();
const image = process.env.ACE_PROVIDER_IMAGE?.trim() || 'ace-retrieval-provider-debug:local';
const workspaceId = 'container-provider-official';
const transport = new StdioClientTransport({
  command: 'docker',
  args: [
    'run', '--rm', '-i', '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${repository}:/ace:ro`,
    '-v', 'ace-fastembed-cache:/root/.cache/huggingface',
    '-e', 'ACE_WORKSPACE_ROOT=/workspace',
    '-e', 'ACE_ALLOWED_ROOTS=/workspace',
    '-e', `ACE_WORKSPACE_ID=${workspaceId}`,
    '-e', 'ACE_STATE_DIR=/tmp/ace-state',
    '-e', 'ACE_ARTIFACT_DIR=/tmp/ace-artifacts',
    '-e', 'ACE_ENABLE_EXPERIMENTAL_QDRANT=true',
    '-e', 'ACE_ALLOW_LOCAL_FALLBACK=false',
    '-e', `ACE_QDRANT_URL=${process.env.ACE_QDRANT_URL?.trim() || 'http://172.17.0.1:6333'}`,
    '-e', 'ACE_QDRANT_LOCAL_HOSTS=172.17.0.1',
    '-e', 'ACE_EMBEDDING_WORKER=/ace/scripts/fastembed-worker.sh',
    '-e', 'ACE_EMBEDDING_PYTHON=python3',
    '-e', 'ACE_TREE_SITTER_HELPER=/ace/scripts/tree-sitter-structural.py',
    '-e', 'ACE_TREE_SITTER_PYTHON=python3',
    '-e', 'ACE_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    '-e', 'ACE_EMBEDDING_DIMENSION=384',
    image, 'node', '/ace/dist/bin/ace-mcp.js',
  ],
  stderr: 'inherit',
});
const client = new Client({ name: 'container-provider-official-client', version: '1.0.0' });
try {
  await client.connect(transport, { timeout: 300_000 });
  const result = await client.callTool({
    name: 'ace_context',
    arguments: { workspace_id: workspaceId, query: 'connection retry handler after transient failure' },
  }, { timeout: 300_000 });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const bundle = result.structuredContent;
  assert.equal(bundle.complete, true, JSON.stringify(bundle));
  assert.ok(bundle.evidence.some((item) => item.freshness === 'current'), JSON.stringify(bundle));
  console.log(JSON.stringify({
    status: 'provider-pass',
    transport: 'official-mcp-client->docker->ace-mcp',
    image,
    complete: bundle.complete,
    evidence: bundle.evidence.length,
    warnings: bundle.warnings,
  }));
} finally {
  await client.close();
}
