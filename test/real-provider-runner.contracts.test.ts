import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('real provider runner has a bounded, process-tree-safe cleanup path', async () => {
  execFileSync(process.execPath, ['--check', 'scripts/real-provider-e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const script = await readFile('scripts/real-provider-e2e.mjs', 'utf8');
  for (const token of [
    'ACE_REAL_PROVIDER_TIMEOUT_MS',
    'detached: process.platform !== \'win32\'',
    'child.once(\'exit\'',
    'const stopChild = async',
    "signalChild('SIGTERM')",
    "signalChild('SIGKILL')",
    'await stopChild()',
  ]) assert.ok(script.includes(token), token);
});

test('real provider runner rejects a dead MCP child instead of waiting for the request deadline', async () => {
  const script = await readFile('scripts/real-provider-e2e.mjs', 'utf8');
  assert.match(script, /for \(const waiter of waiters\.values\(\)\) waiter\.reject\(error\)/u);
  assert.match(script, /MCP child exited before response/u);
  assert.match(script, /MCP request \$\{id\} timed out after \$\{requestTimeoutMs\}ms/u);
});
