#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const usage = () => process.stdout.write('Usage: node scripts/ace-container-runtime-smoke.mjs --image <image>@sha256:<64hex> --bundle <bundle-dir> [--qdrant-url <url>]\n');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
let image;
let bundle;
let qdrantUrl = process.env.ACE_QDRANT_URL || 'http://127.0.0.1:6333';
while (args.length > 0) {
  const name = args.shift();
  const value = args.shift();
  if (name === '--image') image = value;
  else if (name === '--bundle') bundle = value;
  else if (name === '--qdrant-url') qdrantUrl = value;
  else throw new Error('Usage error: unknown argument');
}
if (image === undefined || bundle === undefined || !/^.+@sha256:[a-f0-9]{64}$/u.test(image)) {
  usage();
  process.exitCode = 2;
  process.exit();
}
const bundleRoot = resolve(bundle);
const manifestPath = resolve(bundleRoot, 'runtime-manifest.json');
if (!existsSync(manifestPath)) {
  process.stdout.write(JSON.stringify({ status: 'BLOCKED', reason: 'runtime-manifest.json is missing' }) + '\n');
  process.exitCode = 2;
  process.exit();
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const mount = `${bundleRoot}:/ace:ro`;
const run = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  // Import the compiled HTTP owner instead of the retired stdin bridge.
  const loaded = run('docker', ['run', '--rm', '--entrypoint', 'node', '-v', mount, image,
    '-e', 'import("file:///ace/dist/transport/context-rpc-http.js").then(() => process.stdout.write("gateway_import=READY\\n"))',
  ]);
  if (!loaded.includes('gateway_import=READY')) throw new Error('compiled Gateway transport could not be imported');
  const qdrantProbe = run('docker', ['run', '--rm', '--network', 'host', '--entrypoint', 'node', '-v', mount, image,
    '-e', `fetch(${JSON.stringify(`${qdrantUrl.replace(/\/$/u, '')}/collections`)}).then((response) => { if (!response.ok) process.exit(2); })`,
  ]);
  const healthCheck = `fetch("http://127.0.0.1:8765/internal/ace-context/v3/health", { headers: { authorization: "Bearer ace-container-smoke-secret" } }).then(async (r) => {
    const body = await r.json();
    if (r.status !== 200 || body.providerWire !== "not_certified") process.exit(1);
    process.stdout.write("gateway_health=READY\\n");
  }).catch(() => process.exit(1))`;
  const shell = [
    'set -eu',
    'mkdir -p /tmp/ace-gateway-smoke',
    'printf "export const aceSmoke = 1;\\n" > /tmp/ace-gateway-smoke/smoke.ts',
    'node /ace/dist/bin/ace-context-rpc.js >/tmp/ace-gateway-smoke.log 2>&1 & child=$!',
    'trap "kill $child 2>/dev/null || :" EXIT',
    `i=0; until node -e ${quote(healthCheck)}; do i=$((i+1)); if [ "$i" -ge 40 ]; then cat /tmp/ace-gateway-smoke.log >&2; exit 1; fi; sleep 0.2; done`,
  ].join('; ');
  const observed = run('docker', ['run', '--rm', '--network', 'none', '-v', mount,
    '-e', 'ACE_WORKSPACE_ROOT=/tmp/ace-gateway-smoke',
    '-e', 'ACE_ALLOWED_ROOTS=/tmp/ace-gateway-smoke',
    '-e', 'ACE_STATE_DIR=/tmp/ace-gateway-state',
    '-e', 'ACE_RUNTIME_ROOT=/ace',
    '-e', 'ACE_CONTEXT_RPC_SHARED_SECRET=ace-container-smoke-secret',
    '-e', 'ACE_ENABLE_EXPERIMENTAL_QDRANT=false',
    '--entrypoint', 'sh', image, '-lc', shell,
  ]);
  if (!observed.includes('gateway_health=READY')) throw new Error('Gateway liveness was not observed in the container');
  process.stdout.write(`${JSON.stringify({
    status: 'READY', gatewayImport: true, gatewayHttpLiveness: true,
    qdrantReachable: true, providerWireCertified: false,
    runtimeId: manifest.runtimeId, bundleSha256: manifest.bundleSha256,
  })}\\n`);
  void qdrantProbe;
} catch (error) {
  const reason = error instanceof Error ? error.message.split('\n')[0] : 'Gateway container smoke failed';
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', reason })}\\n`);
  process.exitCode = 2;
}
