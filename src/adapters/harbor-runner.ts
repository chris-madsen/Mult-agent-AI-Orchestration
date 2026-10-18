import { spawn } from 'node:child_process';
import { Effect } from 'effect';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandPort {
  readonly run: (executable: string, args: readonly string[], timeoutMs: number) => Promise<Result<CommandResult, ReturnType<typeof domainError>>>;
}

export interface HarborRunOutput {
  readonly status: 'completed' | 'failed';
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly jsonLines: readonly Readonly<Record<string, unknown>>[];
}

export interface HarborRunner {
  readonly run: (args: readonly string[], timeoutMs?: number) => Effect.Effect<Result<HarborRunOutput, ReturnType<typeof domainError>>>;
}

const parseJsonLines = (stdout: string): Result<readonly Readonly<Record<string, unknown>>[], ReturnType<typeof domainError>> => {
  const events: Readonly<Record<string, unknown>>[] = [];
  for (const [index, line] of stdout.split('\n').map((item) => item.trim()).filter((item) => item.length > 0).entries()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return err(domainError('INVALID_EXTERNAL_RESPONSE', `stdout[${index}]`, 'Harbor JSONL event must be an object'));
      events.push(parsed as Readonly<Record<string, unknown>>);
    } catch {
      return err(domainError('INVALID_EXTERNAL_RESPONSE', `stdout[${index}]`, 'Harbor stdout contains invalid JSONL'));
    }
  }
  return ok(events);
};

export const makeNodeCommandPort = (): CommandPort => ({
  run: (executable, args, timeoutMs) => new Promise((resolve) => {
    const child = spawn(executable, [...args], { shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (cause: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(err(domainError(cause.code === 'ENOENT' ? 'UNSUPPORTED_PROVIDER' : 'EXTERNAL_UNAVAILABLE', 'harbor', 'Harbor command could not be started')));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(ok({ exitCode: code ?? 1, stdout, stderr }));
    });
  }),
});

export const makeHarborRunner = (command: CommandPort, executable = 'harbor'): HarborRunner => ({
  run: (args, timeoutMs = 3_600_000) => Effect.catchAll(Effect.tryPromise<Result<HarborRunOutput, ReturnType<typeof domainError>>, ReturnType<typeof domainError>>({
    try: async () => {
      if (args.length === 0) return err(domainError('INVALID_INPUT', 'harbor_args', 'Harbor arguments must not be empty'));
      const result = await command.run(executable, args, timeoutMs);
      if (result._tag === 'Err') return result;
      const events = parseJsonLines(result.value.stdout);
      if (events._tag === 'Err') return events;
      return ok({
        status: result.value.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.value.exitCode,
        stdout: result.value.stdout,
        stderr: result.value.stderr,
        jsonLines: events.value,
      });
    },
    catch: () => domainError('EXTERNAL_UNAVAILABLE', 'harbor', 'Harbor runner failed unexpectedly'),
  }), (failure) => Effect.succeed(err(failure))),
});
