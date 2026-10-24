#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFile } from 'node:fs';
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
const run = (command, commandArgs) => execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const effectProbe = run('docker', ['run', '--rm', '--entrypoint', 'node', '-v', mount, image, '-e', 'import("file:///ace/dist/transport/context-bridge-stdio.js").then(() => process.stdout.write("effect=READY\\n"))']);
  const qdrantProbe = run('docker', ['run', '--rm', '--network', 'host', '--entrypoint', 'node', '-v', mount, image, '-e',
    `fetch(${JSON.stringify(`${qdrantUrl.replace(/\/$/u, '')}/collections`)}).then((response) => { if (!response.ok) process.exit(2); })`]);
  const bridgeProbe = run('docker', [
    'run', '--rm', '--network', 'host', '-i', '-v', mount,
    '-e', 'ACE_WORKSPACE_ROOT=/tmp',
    '-e', 'ACE_ALLOWED_ROOTS=/tmp',
    '-e', 'ACE_RUNTIME_ROOT=/ace',
    '-e', 'ACE_RUNTIME_ID=ace-harbor-runtime-v1',
    '-e', `ACE_QDRANT_URL=${qdrantUrl}`,
    '--entrypoint', 'sh',
    image,
    '-lc', 'printf "{\\"type\\":\\"invalid\\"}\\n" | /ace/scripts/harbor-ace-context-bridge.sh 2>/dev/null',
  ]);
  const ready = bridgeProbe.split(/\r?\n/u).find((line) => line.includes('bridge_ready'));
  if (ready === undefined) throw new Error('bridge_ready was not observed');
  process.stdout.write(`${JSON.stringify({ status: 'READY', effectImport: effectProbe.includes('effect=READY'), bridgeReady: true, qdrantReachable: true, runtimeId: manifest.runtimeId, bundleSha256: manifest.bundleSha256 })}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : 'container runtime smoke failed';
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', reason: detail })}\n`);
  process.exitCode = 2;
}
