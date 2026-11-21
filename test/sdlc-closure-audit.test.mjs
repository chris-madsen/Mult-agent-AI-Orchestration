import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const audit = resolve('scripts/sdlc-closure-audit.mjs');

test('SDLC closure audit passes the repository and labels external E2E honestly', () => {
  const run = spawnSync(process.execPath, [audit], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.structuralVerdict, 'PASS');
  assert.equal(result.providerAgentE2E, 'NOT_RUN_BY_THIS_GATE');
  assert.ok(result.results.every((entry) => entry.status === 'PASS'));
});

test('SDLC closure gate rejects a regression to unconditional OAuth-route denial', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-g11-oauth-closure-negative-'));
  try {
    const dir = join(root, 'src', 'application');
    mkdirSync(dir, { recursive: true });
    const current = readFileSync(resolve('src/application/gateway-attempt-authorization-service.ts'), 'utf8');
    const success = 'return yield* sendAllow(request, security);';
    assert.ok(current.includes(success), 'runtime must have a successful policy-authorized send path');
    const blocked = current.replace(success, "return yield* sendBlock(request, 'OAUTH_ROUTE_UNVERIFIED', security);");
    writeFileSync(join(dir, 'gateway-attempt-authorization-service.ts'), blocked);
    const run = spawnSync(process.execPath, [audit, '--root', root], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    const guard = result.results.find((entry) => entry.id === 'GATEWAY_PHYSICAL_SEND_POLICY');
    assert.equal(guard?.status, 'FAIL');
    assert.ok(guard?.forbidden?.includes("'OAUTH_ROUTE_UNVERIFIED'"));
    assert.ok(guard?.missing?.includes('return yield* sendAllow(request, security);'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SDLC closure audit fails closed when active-gate evidence is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-sdlc-closure-negative-'));
  try {
    const run = spawnSync(process.execPath, [audit, '--root', root], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    const result = JSON.parse(run.stdout);
    assert.equal(result.structuralVerdict, 'FAIL');
    assert.ok(result.results.some((entry) => entry.reason === 'missing_file'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('active OpenSpec guard rejects superseded integration changes and retired delivery requirements', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-openspec-closure-negative-'));
  try {
    const stale = join(root, 'openspec', 'changes', '009-bifrost-hermes-ownership');
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, 'proposal.md'), '# stale\nretired optional tool-call protocol\nbifrost:auto\n');
    const run = spawnSync(process.execPath, [audit, '--root', root, '--openspec-only'], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    const guard = result.results.find((entry) => entry.id === 'OPENSPEC_ACTIVE_GATEWAY_ONLY');
    assert.equal(guard?.status, 'FAIL');
    assert.ok(guard?.forbiddenActiveDirs?.includes('009-bifrost-hermes-ownership'));
    assert.ok(guard?.violations?.some((entry) => entry.forbidden.includes('retired optional tool-call protocol')));
    assert.ok(guard?.violations?.some((entry) => entry.forbidden.includes('bifrost:auto')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('architecture authority guard rejects a revived Hermes/tool delivery path', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-architecture-closure-negative-'));
  try {
    const arch = join(root, 'docs', 'docs', 'architecture');
    mkdirSync(arch, { recursive: true });
    for (const name of [
      '01-strategic-ddd.md',
      '02-event-storming.md',
      '03-tactical-ddd.md',
      '04-fsm-workflows.md',
      '05-contracts-and-deployment.md',
      '06-traceability-and-review.md',
      '07-architecture-fitness-contracts.md',
    ]) {
      writeFileSync(join(arch, name), '# current\n');
    }
    writeFileSync(join(arch, '05-contracts-and-deployment.md'), '# stale\nHermes ContextEngine\n');
    const run = spawnSync(process.execPath, [audit, '--root', root, '--architecture-only'], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    const guard = result.results.find((entry) => entry.id === 'ARCHITECTURE_GATEWAY_AUTHORITY');
    assert.equal(guard?.status, 'FAIL');
    assert.ok(guard?.violations?.some((entry) => entry.forbidden.includes('Hermes ContextEngine')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public contract authority guard rejects a handwritten live schema outside TypeSpec ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-public-contract-closure-negative-'));
  try {
    const rogue = join(root, 'contracts', 'manual');
    const typespec = join(root, 'typespec');
    mkdirSync(rogue, { recursive: true });
    mkdirSync(typespec, { recursive: true });
    writeFileSync(join(rogue, 'schema.json'), '{}\n');
    writeFileSync(join(typespec, 'responses-v2.tsp'), [
      'namespace ACE.ResponsesV2 {',
      'model ProjectionRequest { protocol: "openai.responses"; }',
      'union ProjectionDecision { PREPARED: {}; BLOCK: {}; }',
      '@route("/internal/ace-context/v3/project")',
      'op project(): ProjectionDecision;',
      '}',
      '',
    ].join('\n'));
    const run = spawnSync(process.execPath, [audit, '--root', root, '--contracts-only'], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    const guard = result.results.find((entry) => entry.id === 'PUBLIC_CONTRACT_TYPESPEC_AUTHORITY');
    assert.equal(guard?.status, 'FAIL');
    assert.ok(guard?.unexpected?.includes('contracts/manual/schema.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
