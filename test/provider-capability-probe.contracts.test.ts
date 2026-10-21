import assert from 'node:assert/strict';
import test from 'node:test';

const probe = await import('../scripts/provider-capability-probe-lib.mjs');

test('provider probe resolves Windows executable suffixes without requiring shell lookup', () => {
  const files = new Set([
    'C:\\tools\\ast-grep.exe',
    'C:\\tools\\typescript-language-server.cmd',
  ]);
  const fileExists = (value: string): boolean => files.has(value);
  assert.equal(probe.resolveExecutable('ast-grep', {
    platform: 'win32',
    pathValue: 'C:\\tools',
    fileExists,
  }), 'C:\\tools\\ast-grep.exe');
  assert.equal(probe.resolveExecutable('typescript-language-server', {
    platform: 'win32',
    pathValue: 'C:\\tools',
    fileExists,
  }), 'C:\\tools\\typescript-language-server.cmd');
});

test('provider probe keeps Linux commands on PATH and marks unavailable commands explicitly', () => {
  const files = new Set(['/usr/bin/harbor', '/usr/bin/wsl.exe']);
  const fileExists = (value: string): boolean => files.has(value);
  const spawn = (command: string, args: readonly string[]) => ({
    status: command === '/usr/bin/harbor' || (command === '/usr/bin/wsl.exe' && args[0] === '--') ? 0 : 1,
    stdout: 'provider/1.0\n',
    stderr: '',
  });
  const available = probe.runResolved('harbor', ['--version'], {
    platform: 'linux',
    pathValue: '/usr/bin',
    fileExists,
    spawn,
  });
  assert.equal(available.status, 'available');
  assert.equal(available.resolvedCommand, '/usr/bin/harbor');
  const unavailable = probe.runResolved('missing', [], {
    platform: 'linux',
    pathValue: '/usr/bin',
    fileExists,
    spawn,
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.match(unavailable.reason ?? '', /command not found/u);
});

test('provider probe uses WSL transport for Linux-only providers on Windows', () => {
  const calls: string[][] = [];
  const result = probe.runResolved('harbor', ['--version'], {
    platform: 'win32',
    pathValue: 'C:\\Windows\\System32',
    fileExists: (value: string): boolean => value === 'C:\\Windows\\System32\\wsl.exe',
    wsl: true,
    spawn: (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: 'harbor 0.24.0\n', stderr: '' };
    },
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(calls, [['C:\\Windows\\System32\\wsl.exe', '--', 'bash', '-lc', "exec 'harbor' '--version'"]]);
  assert.equal(result.transport, 'wsl');
});

test('provider probe marks project-external terminal-bench tools as not required', async () => {
  const report = await probe.buildProviderReport({
    platform: 'linux',
    pathValue: '',
    fetchImpl: async () => new Response('ok', { status: 200 }),
  });
  assert.equal(report.commands.find((item) => item.command === 'tb')?.status, 'not_required');
  assert.equal(report.commands.find((item) => item.command === 'terminal-bench')?.status, 'not_required');
});

test('health probes use endpoints and expose no request payload', async () => {
  const calls: string[] = [];
  const result = await probe.httpHealthProbe('qdrant', 'http://127.0.0.1:6333/healthz', async (url: string) => {
    calls.push(url);
    return new Response('healthz check passed\n', { status: 200 });
  });
  assert.equal(result.status, 'available');
  assert.deepEqual(calls, ['http://127.0.0.1:6333/healthz']);
  assert.equal('query' in result, false);
  assert.equal('token' in result, false);
  assert.equal('source' in result, false);
});
