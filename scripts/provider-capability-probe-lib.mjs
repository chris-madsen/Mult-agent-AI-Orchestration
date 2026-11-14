import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const providerStatuses = Object.freeze([
  'available',
  'unavailable',
  'not_applicable',
  'not_required',
]);

const firstLine = (value) => value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? '';

const pathCandidates = (command, platform) => {
  if (platform !== 'win32') return [command];
  if (/\.(?:cmd|exe|bat)$/iu.test(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
};

const hasPathSeparator = (value) => value.includes('/') || value.includes('\\');

export const resolveExecutable = (command, {
  platform = process.platform,
  pathValue = process.env.PATH ?? process.env.Path ?? '',
  fileExists = existsSync,
} = {}) => {
  const pathApi = platform === 'win32' ? win32 : posix;
  const candidates = pathCandidates(command, platform);
  if (hasPathSeparator(command) || pathApi.isAbsolute(command)) {
    return candidates.find((candidate) => fileExists(candidate));
  }
  const entries = pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const entry of entries) {
    for (const candidate of candidates) {
      const resolved = pathApi.join(entry, candidate);
      if (fileExists(resolved)) return resolved;
    }
  }
  return undefined;
};

const safeError = (error) => {
  if (!(error instanceof Error)) return 'command failed';
  return firstLine(error.message).replace(/(?:bearer|token|password|secret)[^\s]*/giu, '[redacted]');
};

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const wslPythonPath = () => {
  if (process.env.ACE_WSL_PYTHON?.trim().length > 0) return process.env.ACE_WSL_PYTHON;
  const currentDirectory = process.cwd();
  const windowsDrivePath = /^([A-Za-z]):[\\/](.*)$/u.exec(currentDirectory);
  if (windowsDrivePath?.[1] !== undefined && windowsDrivePath[2] !== undefined) {
    return `/mnt/${windowsDrivePath[1].toLowerCase()}/${windowsDrivePath[2].replaceAll('\\', '/')}/.venv-system/bin/python`;
  }
  return 'python3';
};

const findWindowsPackageExecutable = (name, platform) => {
  if (platform !== 'win32') return undefined;
  const packageRoot = process.env.LOCALAPPDATA === undefined
    ? undefined
    : win32.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (packageRoot === undefined || !existsSync(packageRoot)) return undefined;
  try {
    for (const packageName of readdirSync(packageRoot)) {
      if (!packageName.toLowerCase().startsWith('kubernetes.kubectl_')) continue;
      const candidate = win32.join(packageRoot, packageName, name);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const runResolved = (command, args = [], {
  platform = process.platform,
  wsl = false,
  resolve = resolveExecutable,
  spawn = spawnSync,
  pathValue = process.env.PATH ?? process.env.Path ?? '',
  fileExists = existsSync,
} = {}) => {
  const commandToRun = wsl ? 'wsl.exe' : command;
  const resolved = resolve(commandToRun, { platform, pathValue, fileExists });
  if (resolved === undefined) {
    return {
      status: 'unavailable',
      command,
      ...(wsl ? { transport: 'wsl' } : {}),
      reason: `command not found: ${commandToRun}`,
    };
  }
  const commandArgs = wsl
    ? ['--', 'bash', '-lc', `exec ${[command, ...args].map(shellQuote).join(' ')}`]
    : args;
  try {
    const result = spawn(resolved, commandArgs, {
      encoding: 'utf8',
      timeout: 10_000,
      ...(platform === 'win32' && /\.cmd$/iu.test(resolved) ? { shell: true } : {}),
    });
    const output = firstLine(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    if (result.error !== undefined) {
      return {
        status: 'unavailable',
        command,
        resolvedCommand: resolved,
        ...(wsl ? { transport: 'wsl' } : {}),
        reason: safeError(result.error),
      };
    }
    return {
      status: result.status === 0 ? 'available' : 'unavailable',
      command,
      resolvedCommand: resolved,
      ...(wsl ? { transport: 'wsl' } : {}),
      ...(output.length > 0 ? { identity: output } : {}),
      ...(result.status !== 0 ? { exitCode: result.status, ...(output.length > 0 ? { reason: output } : {}) } : {}),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      command,
      resolvedCommand: resolved,
      ...(wsl ? { transport: 'wsl' } : {}),
      reason: safeError(error),
    };
  }
};

export const commandProbe = (command, args = ['--version'], options = {}) => ({
  ...runResolved(command, args, options),
});

const requiredWsl = (platform) => platform === 'win32';

const providerCommand = (command, args, options = {}) => commandProbe(command, args, {
  ...options,
  wsl: options.wsl ?? requiredWsl(options.platform ?? process.platform),
});

const pythonCommand = (platform) => platform === 'win32' ? wslPythonPath() : (
  existsSync('.venv-system/bin/python') ? '.venv-system/bin/python' : 'python3'
);

const pythonProbe = (module, platform) => ({
  module,
  ...providerCommand(pythonCommand(platform), [
    '-c',
    `import ${module}; print(${module}.__file__)`,
  ], { platform, wsl: requiredWsl(platform) }),
});

const graphitiFalkorHealth = (platform) => providerCommand(pythonCommand(platform), ['-c', [
  'import asyncio',
  'from graphiti_core.driver.falkordb_driver import FalkorDriver',
  'async def main():',
  "    await FalkorDriver(host='127.0.0.1', port=6379, database='ace_healthcheck').health_check()",
  "    print('graphiti-falkor-driver-health-ok')",
  'asyncio.run(main())',
].join('\n')], { platform, wsl: requiredWsl(platform) });

export const httpHealthProbe = async (name, url, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== 'function') {
    return { name, url, status: 'unavailable', reason: 'fetch is unavailable' };
  }
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    const body = firstLine(await response.text());
    return {
      name,
      url,
      status: response.ok ? 'available' : 'unavailable',
      ...(body.length > 0 ? { identity: body } : {}),
      ...(response.ok ? {} : { reason: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return { name, url, status: 'unavailable', reason: safeError(error) };
  }
};

export const buildProviderReport = async ({
  platform = process.platform,
  pathValue = process.env.PATH ?? process.env.Path ?? '',
  fetchImpl = globalThis.fetch,
} = {}) => {
  const commandOptions = { platform, pathValue };
  const wsl = requiredWsl(platform);
  const kubectlCommand = commandProbe('kubectl', ['version', '--client=true', '--output=json'], commandOptions);
  const resolvedKubectl = kubectlCommand.status === 'available'
    ? kubectlCommand.resolvedCommand
    : findWindowsPackageExecutable('kubectl.exe', platform);
  const kubectl = resolvedKubectl === undefined
    ? kubectlCommand
    : commandProbe(resolvedKubectl, ['version', '--client=true', '--output=json'], commandOptions);
  const commands = [
    commandProbe('ast-grep', ['--version'], commandOptions),
    commandProbe('typescript-language-server', ['--version'], commandOptions),
    providerCommand('harbor', ['--version'], { ...commandOptions, wsl }),
    {
      command: 'tb',
      status: 'not_required',
      reason: 'ACE uses the Harbor CLI; terminal-bench is not a project dependency',
    },
    {
      command: 'terminal-bench',
      status: 'not_required',
      reason: 'ACE uses the Harbor CLI; terminal-bench is not a project dependency',
    },
    providerCommand('codex', ['--version'], { ...commandOptions, wsl }),
    kubectl,
  ];
  const python = pythonCommand(platform);
  const pythonModules = [
    pythonProbe('harbor', platform),
    pythonProbe('terminal_bench', platform),
    pythonProbe('graphiti_core', platform),
    pythonProbe('pygls', platform),
  ];
  const kubeconfig = '/etc/rancher/k3s/k3s.yaml';
  const kubeconfigAvailable = existsSync(kubeconfig);
  const kubectlArgs = (args) => kubeconfigAvailable ? ['--kubeconfig', kubeconfig, ...args] : args;
  const kubernetesCommand = resolvedKubectl ?? 'kubectl';
  const kubernetesContext = {
    kubeconfig: kubeconfigAvailable ? kubeconfig : 'kubectl default configuration',
    ...commandProbe(kubernetesCommand, kubectlArgs(['config', 'current-context']), commandOptions),
  };
  const kubernetesCluster = commandProbe(kubernetesCommand, kubectlArgs(['get', 'nodes', '--no-headers']), commandOptions);
  const qdrantLocalHealth = await httpHealthProbe('qdrant', 'http://127.0.0.1:6333/healthz', fetchImpl);
  const qdrantHealth = qdrantLocalHealth.status === 'available' || !wsl
    ? qdrantLocalHealth
    : (() => {
      const viaWsl = providerCommand('curl', ['-fsS', '--max-time', '5', 'http://127.0.0.1:6333/healthz'], {
        ...commandOptions,
        wsl: true,
      });
      return {
        name: qdrantLocalHealth.name,
        url: qdrantLocalHealth.url,
        ...viaWsl,
      };
    })();
  const [falkorHealth] = await Promise.all([
    Promise.resolve(graphitiFalkorHealth(platform)),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    platform,
    commands,
    python: { command: python, ...(wsl ? { transport: 'wsl' } : {}) },
    pythonModules,
    codexJsonCapability: providerCommand('codex', ['exec', '--json', '--help'], { ...commandOptions, wsl }),
    kubernetesContext,
    kubernetesCluster,
    localServices: {
      qdrantHealth,
      graphitiFalkorDriverHealth: falkorHealth,
    },
  };
};

export const isMain = (url) => process.argv[1] !== undefined
  && fileURLToPath(url).replaceAll('\\', '/') === process.argv[1].replaceAll('\\', '/');
