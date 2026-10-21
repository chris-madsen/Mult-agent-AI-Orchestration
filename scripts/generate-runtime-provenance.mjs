#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeRelevantPath, sourceManifestBytes } from '../dist/domain/runtime-provenance.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceManifestDigest = (entries) => digest(Buffer.from(sourceManifestBytes(entries), 'utf8'));
const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const paths = git(['ls-files', '--cached', '--others', '--exclude-standard'])
  .split('\n')
  .filter((path) => path.length > 0 && runtimeRelevantPath(path))
  .sort();
const sourceFiles = [];
for (const path of paths) {
  const bytes = await readFile(join(root, path));
  sourceFiles.push({ path, sha256: digest(bytes), sizeBytes: bytes.byteLength });
}
const dirtyRelevantPaths = git(['status', '--porcelain=v1', '--untracked-files=all'])
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => line.slice(3).split(' -> ').at(-1) ?? '')
  .filter((path) => runtimeRelevantPath(path));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dependencies = packageJson.dependencies ?? {};
const executablePath = 'dist/bin/ace-mcp.js';
const executableBytes = await readFile(join(root, executablePath));
const manifest = {
  schemaVersion: 1,
  runtimeRoot: root,
  executablePath,
  executableSha256: digest(executableBytes),
  sourceCommit: git(['rev-parse', 'HEAD']),
  sourceClean: dirtyRelevantPaths.length === 0,
  dirtyRelevantPaths: [...new Set(dirtyRelevantPaths)].sort(),
  sourceManifestSha256: sourceManifestDigest(sourceFiles),
  sourceFiles,
  runtime: {
    acePackage: `${packageJson.name ?? 'unknown'}@${packageJson.version ?? 'unknown'}`,
    node: process.version,
    typescript: dependencies.typescript ?? 'unknown',
    mcpClientSdk: dependencies['@modelcontextprotocol/client'] ?? 'unknown',
    mcpServerSdk: dependencies['@modelcontextprotocol/server'] ?? 'unknown',
  },
};
const output = join(root, 'dist/runtime-provenance.json');
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({
  output: relative(root, output).split('\\').join('/'),
  sourceCommit: manifest.sourceCommit,
  sourceManifestSha256: manifest.sourceManifestSha256,
  sourceClean: manifest.sourceClean,
  executableSha256: manifest.executableSha256,
  dirtyRelevantPaths: manifest.dirtyRelevantPaths,
}) + '\n');
