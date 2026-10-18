import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('DBC-01 missing selected providers returns NOT_READY from the actual MCP executable', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ace-runtime-'));
  const workspace = join(parent, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'code.ts'), 'export function reconnect() { return true; }\n');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/bin/ace-mcp.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACE_WORKSPACE_ROOT: workspace,
      ACE_ALLOWED_ROOTS: parent,
      ACE_STATE_DIR: join(parent, 'state'),
      ACE_WORKSPACE_ID: 'dbc01-test-workspace',
      ACE_ALLOW_LOCAL_FALLBACK: 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('MCP timeout')), 10000);
      const onData = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        try { resolve(JSON.parse(output.slice(0, newline)) as unknown); } catch (error) { reject(error); }
      };
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error('MCP exited prematurely: ' + code)));
      child.stdout.on('data', onData);
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'ace_context', arguments: { workspace_id: 'dbc01-test-workspace', query: 'reconnect' } },
      }) + '\n');
    });
    const body = response as { result?: { isError?: boolean; structuredContent?: { status?: string; capability?: string } } };
    assert.equal(body.result?.isError, true);
    assert.equal(body.result?.structuredContent?.status, 'not_ready');
    assert.equal(body.result?.structuredContent?.capability, 'unified_context');
  } finally {
    child.kill('SIGTERM');
  }
});
