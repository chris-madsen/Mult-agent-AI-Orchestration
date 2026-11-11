import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('../scripts/sdlc-preflight.mjs', import.meta.url).pathname;
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return result.stdout;
};
const fixture = (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'ace-sdlc-'));
  try {
    run('git', ['init', '-q', '-b', 'main', root], root);
    run('git', ['config', 'user.name', 'ACE test'], root);
    run('git', ['config', 'user.email', 'ace@example.invalid'], root);
    for (const path of [
      'AGENTS.md', 'docs/operations/ai-assisted-sdlc.md',
      'docs/research/sdlc/PROMPTS-ACE.md', 'docs/plans/fixture-plan.md',
    ]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `# ${path}\n`);
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {
      'test:affected': 'node ./test', 'verify:pr': 'node ./test',
      'worktree:preflight': 'node ./worktree',
    } }));
    run('git', ['add', '.'], root);
    run('git', ['commit', '-qm', 'test fixture'], root);
    fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
};
const preflight = (root, args) => {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { cwd: root, encoding: 'utf8' });
  return { code: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
};

test('T0 research records local HEAD, does not invent origin/main or run tools', () => fixture((root) => {
  const { code, data } = preflight(root, ['--tier', 'T0', '--stage', 'research']);
  assert.equal(code, 0);
  assert.equal(data.verdict, 'READY_FOR_AGENT');
  assert.match(data.source.head, /^[a-f0-9]{40}$/);
  assert.equal(data.source.cachedOriginMain, null);
  assert.equal(data.tools['verify:pr'], 'DECLARED_NOT_EXECUTED');
  assert.equal(data.checks.find((x) => x.id === 'G02').status, 'N/A');
}));

test('implementation on main is blocked even with plan and task ID', () => fixture((root) => {
  const { code, data } = preflight(root, ['--tier', 'T1', '--stage', 'implement', '--task-id', 'local-1', '--plan', 'docs/plans/fixture-plan.md']);
  assert.equal(code, 2);
  assert.equal(data.verdict, 'BLOCKED');
  assert.equal(data.checks.find((x) => x.id === 'G00-BRANCH').status, 'BLOCKED');
}));

test('T1 implementation requires an existing plan and task ID', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-1'], root);
  const { code, data } = preflight(root, ['--tier', 'T1', '--stage', 'implement']);
  assert.equal(code, 2);
  assert.equal(data.checks.find((x) => x.id === 'G00-TASK').status, 'BLOCKED');
  assert.equal(data.checks.find((x) => x.id === 'G00-PLAN').status, 'BLOCKED');
}));

test('T1 plan presence never implies owner approval or test execution', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-1'], root);
  const { code, data } = preflight(root, ['--tier', 'T1', '--stage', 'implement', '--task-id', 'local-1', '--plan', 'docs/plans/fixture-plan.md']);
  assert.equal(code, 0);
  assert.equal(data.verdict, 'REVIEW_REQUIRED');
  assert.equal(data.canonical.plan.status, 'PRESENT_NOT_APPROVED');
  assert.equal(data.checks.find((x) => x.id === 'G00-TASK').status, 'REVIEW_REQUIRED');
}));

test('T2 implementation without G02 evidence fails closed', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-2'], root);
  const { code, data } = preflight(root, ['--tier', 'T2', '--stage', 'implement', '--task-id', 'local-2', '--plan', 'docs/plans/fixture-plan.md']);
  assert.equal(code, 2);
  assert.equal(data.checks.find((x) => x.id === 'G02').status, 'BLOCKED');
}));

test('existing T2 crosswalk remains REVIEW_REQUIRED, never automatic G02 PASS', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-2'], root);
  const { code, data } = preflight(root, ['--tier', 'T2', '--stage', 'implement', '--task-id', 'local-2', '--plan', 'docs/plans/fixture-plan.md', '--g02', 'docs/plans/fixture-plan.md']);
  assert.equal(code, 0);
  assert.equal(data.verdict, 'REVIEW_REQUIRED');
  assert.equal(data.checks.find((x) => x.id === 'G02').status, 'REVIEW_REQUIRED');
}));

test('G02 path cannot escape the canonical plan directory', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-2'], root);
  const { code, data } = preflight(root, ['--tier', 'T2', '--stage', 'implement', '--task-id', 'local-2', '--plan', 'docs/plans/fixture-plan.md', '--g02', 'AGENTS.md']);
  assert.equal(code, 2);
  assert.equal(data.canonical.g02.status, 'INVALID_PATH');
}));

test('dirty working tree is explicit review requirement', () => fixture((root) => {
  writeFileSync(join(root, 'scratch.txt'), 'unsaved local content');
  const { code, data } = preflight(root, ['--tier', 'T0', '--stage', 'research']);
  assert.equal(code, 0);
  assert.equal(data.verdict, 'REVIEW_REQUIRED');
  assert.equal(data.source.dirty, true);
}));

test('missing canonical instructions are BLOCKED', () => fixture((root) => {
  rmSync(join(root, 'AGENTS.md'));
  const { code, data } = preflight(root, ['--tier', 'T0', '--stage', 'research']);
  assert.equal(code, 2);
  assert.equal(data.checks.find((x) => x.id === 'SOURCE:AGENTS.md').status, 'BLOCKED');
}));

test('unknown tier or stage fails before reporting false readiness', () => fixture((root) => {
  const result = spawnSync(process.execPath, [cli, '--root', root, '--tier', 'T3', '--stage', 'implement'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /explicit --tier/);
}));

test('untrusted task ID is never rendered as a shell command suggestion', () => fixture((root) => {
  run('git', ['switch', '-q', '-c', 'codex/local-1'], root);
  const injected = '$(touch /tmp/should-never-execute)';
  const { code, data } = preflight(root, [
    '--tier', 'T1', '--stage', 'implement', '--task-id', injected,
    '--plan', 'docs/plans/fixture-plan.md',
  ]);
  assert.equal(code, 0);
  assert.equal(data.selection.taskId, injected);
  assert.equal(data.verdict, 'REVIEW_REQUIRED');
  assert.equal(data.next.join(' ').includes(injected), false);
  assert.equal(data.checks.map((c) => c.reason).join(' ').includes(injected), false);
}));
