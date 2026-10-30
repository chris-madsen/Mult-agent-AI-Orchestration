import { spawn } from 'node:child_process';

export const spawnRealProviderProcess = (command, args, options = {}) => spawn(command, args, {
  ...options,
  detached: process.platform !== 'win32',
});

const directChildAlive = (child) => child.exitCode === null && child.signalCode === null;

const processGroupAlive = (child) => {
  if (process.platform === 'win32' || child.pid === undefined) return directChildAlive(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (cause) {
    return cause?.code === 'EPERM';
  }
};

export const realProviderProcessTreeAlive = (child) =>
  directChildAlive(child) || processGroupAlive(child);

const signalProcessTree = (child, signal) => {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The process group may already have exited; signal the direct child below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The direct child may have exited between the group and child signals.
  }
};

const waitForProcessTreeExit = async (child, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (realProviderProcessTreeAlive(child)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return true;
};

export const stopRealProviderProcess = async (
  child,
  { termTimeoutMs = 750, killTimeoutMs = 1_000 } = {},
) => {
  if (!realProviderProcessTreeAlive(child)) return;
  try {
    child.stdin?.end();
  } catch {
    // A concurrently exiting process can close stdin before cleanup begins.
  }
  signalProcessTree(child, 'SIGTERM');
  if (await waitForProcessTreeExit(child, termTimeoutMs)) return;
  signalProcessTree(child, 'SIGKILL');
  if (!await waitForProcessTreeExit(child, killTimeoutMs)) {
    throw new Error(`real-provider process tree did not exit after SIGKILL (pid=${child.pid ?? 'unknown'})`);
  }
};
