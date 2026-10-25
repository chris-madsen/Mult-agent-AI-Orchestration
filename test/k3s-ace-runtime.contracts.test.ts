import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ACE image requires an operator-supplied pinned base and contains pinned local provider runtimes', async () => {
  const dockerfile = await readFile('Dockerfile.ace', 'utf8');
  assert.match(dockerfile, /^ARG ACE_NODE_IMAGE\nFROM \$\{ACE_NODE_IMAGE\}/mu);
  assert.match(dockerfile, /ACE_AST_GREP_COMMAND=\/opt\/ace\/node_modules\/\.bin\/ast-grep/u);
  assert.match(dockerfile, /fastembed==0\.7\.4 onnxruntime==1\.23\.2/u);
  assert.match(dockerfile, /npm ci --ignore-scripts/u);
  assert.match(dockerfile, /npm prune --omit=dev --ignore-scripts/u);
  assert.match(dockerfile, /USER node/u);
  assert.doesNotMatch(dockerfile, /(?:TOKEN|PASSWORD|PRIVATE_KEY)=\S+/u);
});

test('k3s ACE runtime stays stdio-only and fail-closed by default', async () => {
  const manifest = await readFile('infra/k8s/ace-local/ace-mcp.yaml', 'utf8');
  assert.match(manifest, /image: registry\.invalid\/ace-harness:replace-with-signed-digest/u);
  assert.match(manifest, /automountServiceAccountToken: false/u);
  assert.match(manifest, /runAsNonRoot: true/u);
  assert.match(manifest, /readOnlyRootFilesystem: true/u);
  assert.match(manifest, /drop: \["ALL"\]/u);
  assert.doesNotMatch(manifest, /ACE_ALLOW_LOCAL_FALLBACK/u);
  assert.match(manifest, /ACE_REQUIRE_PINNED_EMBEDDING: "true"/u);
  assert.match(manifest, /ACE_ENABLE_VERTEX: "false"/u);
  assert.match(manifest, /ACE_ENABLE_GRAPHITI: "false"/u);
  assert.match(manifest, /name: ace-runtime-release\n\s+optional: false/u);
  assert.match(manifest, /secretName: ace-worktree-client-mtls\n\s+optional: false/u);
  assert.match(manifest, /ingress: \[\]/u);
  assert.doesNotMatch(manifest, /\nkind: Service\n/u);
});

test('default network policy opens no generic web egress and requires a site-specific host-helper overlay', async () => {
  const manifest = await readFile('infra/k8s/ace-local/ace-mcp.yaml', 'utf8');
  assert.match(manifest, /port: 6333/u);
  assert.match(manifest, /port: 6379/u);
  assert.match(manifest, /port: 53/u);
  assert.doesNotMatch(manifest, /port: 80(?:\D|$)/u);
  assert.doesNotMatch(manifest, /port: 443(?:\D|$)/u);
  assert.doesNotMatch(manifest, /0\.0\.0\.0\/0/u);
});

test('kubectl launcher preserves official MCP stdio and never allocates a terminal', async () => {
  const launcher = await readFile('scripts/kubectl-ace-mcp.sh', 'utf8');
  assert.match(launcher, /kubectl .* exec -i /u);
  assert.doesNotMatch(launcher, /exec -it /u);
  assert.match(launcher, /node \/opt\/ace\/dist\/bin\/ace-mcp\.js/u);
});
