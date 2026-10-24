#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const usage = () => process.stdout.write('Usage: node scripts/harbor-ace-runtime-probe.mjs --image <image>@sha256:<64hex> --bundle <bundle-dir>\n');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
let image;
let bundle;
while (args.length > 0) {
  const name = args.shift();
  const value = args.shift();
  if (name === '--image') image = value;
  else if (name === '--bundle') bundle = value;
  else throw new Error('Usage error: unknown argument');
}
if (image === undefined || bundle === undefined || !/^.+@sha256:[a-f0-9]{64}$/u.test(image)) {
  usage();
  process.exitCode = 2;
  process.exit();
}
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const bundleRoot = resolve(bundle);
const manifestPath = resolve(bundleRoot, 'runtime-manifest.json');
if (!existsSync(manifestPath)) {
  process.stdout.write(JSON.stringify({ status: 'BLOCKED', reason: 'runtime-manifest.json is missing' }) + '\n');
  process.exitCode = 2;
  process.exit();
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pythonProbe = [
  'import inspect, json',
  'from agent.context_engine import ContextEngine',
  'from integrations.hermes.ace_context_engine.engine import AceContextEngine',
  'signature = str(inspect.signature(ContextEngine.select_context))',
  'from importlib.metadata import version, PackageNotFoundError',
  'try: hermes = version("hermes-agent")',
  'except PackageNotFoundError: hermes = "unknown"',
  'print(json.dumps({"status":"READY","python":".".join(map(str, __import__("sys").version_info[:3])),"hermesVersion":hermes,"contextEngineSignature":signature,"pluginImport":True,"bridgeImport":True}))',
].join('\n');
try {
  const hermesProbe = [
    'set -e',
    'export PATH="$HOME/.local/bin:$PATH"',
    'if ! command -v hermes >/dev/null 2>&1; then curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup --branch v0.22.3; fi',
    `PYTHONPATH=/ace python3 -c ${shellQuote(pythonProbe)}`,
  ].join(' && ');
  const output = execFileSync('docker', [
    'run', '--rm', '--network', 'host',
    '-v', `${bundleRoot}:/ace:ro`,
    '--entrypoint', 'sh',
    image,
    '-lc', hermesProbe,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const result = JSON.parse(output.trim().split(/\r?\n/u).at(-1));
  const node = execFileSync('docker', ['run', '--rm', '--entrypoint', 'node', '-v', `${bundleRoot}:/ace:ro`, image, '--version'], { encoding: 'utf8' }).trim();
  const effect = execFileSync('docker', [
    'run', '--rm', '--entrypoint', 'node', '-v', `${bundleRoot}:/ace:ro`, image,
    '-e', 'import("file:///ace/dist/transport/context-bridge-stdio.js")',
  ], { encoding: 'utf8' });
  const ready = {
    ...result,
    node,
    effectImport: effect.trim() === '',
    runtimeId: manifest.runtimeId,
    bundleSha256: manifest.bundleSha256,
  };
  process.stdout.write(`${JSON.stringify(ready)}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : 'runtime probe failed';
  process.stdout.write(`${JSON.stringify({ status: 'BLOCKED', reason: detail })}\n`);
  process.exitCode = 2;
}
