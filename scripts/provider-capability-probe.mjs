import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const run = (command, args = []) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error !== undefined) return { available: false, reason: result.error.message };
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return result.status === 0
    ? { available: true, output: output.split('\n')[0] ?? '' }
    : { available: false, exitCode: result.status, output: output.split('\n')[0] ?? '' };
};

const commandProbe = (command, args = ['--version']) => ({ command, ...run(command, args) });
const python = existsSync('.venv-system/bin/python') ? '.venv-system/bin/python' : 'python3';
const pythonProbe = (module) => ({ module, python, ...run(python, ['-c', `import ${module}; print(${module}.__file__)`]) });
const graphitiFalkorHealth = run(python, ['-c', [
  'import asyncio',
  'from graphiti_core.driver.falkordb_driver import FalkorDriver',
  "async def main():",
  "    await FalkorDriver(host='127.0.0.1', port=6379, database='ace_healthcheck').health_check()",
  "    print('graphiti-falkor-driver-health-ok')",
  'asyncio.run(main())',
].join('\n')]);
const k3sKubeconfig = '/etc/rancher/k3s/k3s.yaml';
const kubeconfig = existsSync(k3sKubeconfig) ? k3sKubeconfig : undefined;
const kubectlArgs = (args) => kubeconfig === undefined ? args : ['--kubeconfig', kubeconfig, ...args];

const report = {
  generatedAt: new Date().toISOString(),
  commands: [
    commandProbe('harbor'),
    commandProbe('tb'),
    commandProbe('terminal-bench'),
    commandProbe('qdrant'),
    commandProbe('codex'),
    commandProbe('kubectl', ['version', '--client=true', '--output=json']),
  ],
  pythonModules: [
    pythonProbe('harbor'),
    pythonProbe('terminal_bench'),
    pythonProbe('graphiti_core'),
    pythonProbe('tree_sitter'),
    pythonProbe('ast_grep_py'),
    pythonProbe('pygls'),
  ],
  codexJsonCapability: run('codex', ['exec', '--json', '--help']),
  kubernetesContext: {
    kubeconfig: kubeconfig ?? 'kubectl default configuration',
    ...run('kubectl', kubectlArgs(['config', 'current-context'])),
  },
  kubernetesCluster: run('kubectl', kubectlArgs(['get', 'nodes', '--no-headers'])),
  localServices: {
    qdrantHealth: run('curl', ['-fsS', 'http://127.0.0.1:6333/healthz']),
    graphitiFalkorDriverHealth: graphitiFalkorHealth,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
