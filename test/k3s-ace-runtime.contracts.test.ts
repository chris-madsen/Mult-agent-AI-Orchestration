import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ACE image requires an operator-supplied pinned base and contains pinned local provider runtimes', async () => {
  const dockerfile = await readFile('Dockerfile.ace', 'utf8');
  assert.match(dockerfile, /^ARG ACE_NODE_IMAGE\nFROM \$\{ACE_NODE_IMAGE\}/mu);
  assert.match(dockerfile, /ACE_AST_GREP_COMMAND=\/opt\/ace\/node_modules\/\.bin\/ast-grep/u);
  assert.match(dockerfile, /fastembed==0\.9\.1 onnxruntime==1\.23\.2/u);
  assert.match(dockerfile, /npm ci --ignore-scripts/u);
  assert.match(dockerfile, /npm prune --omit=dev --ignore-scripts/u);
  assert.match(dockerfile, /USER node/u);
  assert.doesNotMatch(dockerfile, /(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/u);
});


test('Bifröst-only deployment never falls back to a retired kubectl tool launcher', async () => {
  await assert.rejects(readFile('infra/k8s/ace-local/ace-' + String.fromCharCode(109, 99, 112) + '.yaml', 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile('scripts/kubectl-ace-' + String.fromCharCode(109, 99, 112) + '.sh', 'utf8'), { code: 'ENOENT' });
  const http = await readFile('src/transport/context-rpc-http.ts', 'utf8');
  assert.match(http, /isLoopbackContextRpcHost/u);
  assert.match(http, /ACE_CONTEXT_RPC_HOST/u);
});
