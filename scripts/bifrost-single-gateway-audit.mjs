#!/usr/bin/env node
// No agent-facing ACE LLM gateway. Bifröst is the sole provider ingress;
// ACE exposes only a loopback, authenticated context projection/attempt RPC.
// This checks maintained implementation and operational guidance. Historical
// ADRs, dated research and archival OpenSpec plans retain their original record.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const active = (path) => [
  'src/', 'test/', 'scripts/', 'typespec/', 'integrations/', 'infra/',
  '.github/workflows/', 'docs/operations/', 'docs/docs/architecture/',
  'openspec/changes/013-gateway-g11-production-acceptance/',
].some((root) => path.startsWith(root)) || ['README.md','AGENTS.md','package.json','Dockerfile.ace','Makefile'].includes(path);
const banned = [
  'ace.gateway.v2',
  '/internal/ace-gateway/v2',
  'ace-gateway-http',
  'ace-gateway-projection',
  'ACE_GATEWAY_',
  'GatewayProjectionHttp',
  'ACE Gateway',
];
const mismatches = [];
for (const path of tracked) {
  if (!active(path) || path === 'scripts/bifrost-single-gateway-audit.mjs' || !existsSync(path)) continue;
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString('utf8').split('\n');
  for (let i=0; i<lines.length; i++) {
    for (const token of banned) {
      if (lines[i].includes(token)) mismatches.push({path, line: i+1, legacy: token});
    }
  }
  for (const token of ['src/generated/ace-gateway/', 'src/bin/ace-gateway-http.ts', 'src/transport/gateway-projection-http.ts']) {
    if (path.includes(token)) mismatches.push({path, line:0, legacy:'obsolete file path'});
  }
}
console.log(JSON.stringify({schemaVersion:'ace.bifrost-only-audit.v1',scanned:tracked.filter(active).length,violations:mismatches}));
if (mismatches.length) process.exitCode = 1;
