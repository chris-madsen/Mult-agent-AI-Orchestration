import { existsSync } from 'node:fs';

const windowsSuffixes = ['.cmd', '.exe', '.bat'] as const;

export const resolveProviderCommand = (command: string): string => {
  if (process.platform !== 'win32' || /\.(?:cmd|exe|bat)$/iu.test(command)) return command;
  for (const suffix of windowsSuffixes) {
    const candidate = `${command}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return command;
};

export const providerUsesWindowsShell = (command: string): boolean =>
  process.platform === 'win32' && /\.cmd$/iu.test(command);
