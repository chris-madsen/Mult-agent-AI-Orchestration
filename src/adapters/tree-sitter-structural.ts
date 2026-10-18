import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeStructuralAnalysis, type StructuralAnalysis, type StructuralKind, type StructuralSymbol } from '../domain/semantic.js';
import { makeContentDigest } from '../domain/workspace.js';
import { err, type Result } from '../domain/result.js';
import type { StructuralAnalysisPort } from '../application/ports.js';
import { recoverResult } from '../application/effect-result.js';

interface TreeSitterOptions {
  readonly pythonCommand?: string;
  readonly helperPath: string;
  readonly timeoutMs?: number;
}

const externalError = (message: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'tree_sitter', message));

const mapSymbol = (value: unknown): StructuralSymbol | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || typeof candidate.kind !== 'string') return undefined;
  const numbers = [candidate.start_line, candidate.start_column, candidate.end_line, candidate.end_column];
  if (!numbers.every((item) => typeof item === 'number' && Number.isSafeInteger(item))) return undefined;
  return {
    name: candidate.name,
    kind: candidate.kind as StructuralKind,
    startLine: candidate.start_line as number,
    startColumn: candidate.start_column as number,
    endLine: candidate.end_line as number,
    endColumn: candidate.end_column as number,
  };
};

const runProvider = (command: string, helperPath: string, input: string, timeoutMs: number): Promise<{ readonly stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [helperPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(stdout).toString('utf8') });
      else reject(new Error(Buffer.concat(stderr).toString('utf8') || `Tree-sitter exited with code ${code ?? 'unknown'}`));
    });
    child.stdin.end(input);
  });

export const makeTreeSitterStructuralPort = (options: TreeSitterOptions): StructuralAnalysisPort => ({
  extract: (input) => recoverResult(Effect.tryPromise<Result<StructuralAnalysis, DomainError>, DomainError>({
    try: async () => {
      let result: { readonly stdout: string };
      try {
        result = await runProvider(options.pythonCommand ?? 'python3', options.helperPath, JSON.stringify({ path: input.repoPath, source: Buffer.from(input.source).toString('utf8') }), options.timeoutMs ?? 10_000);
      } catch (cause) {
        return externalError(cause instanceof Error ? cause.message : 'Tree-sitter provider failed');
      }
      let decoded: unknown;
      try { decoded = JSON.parse(result.stdout) as unknown; } catch { return externalError('Tree-sitter provider returned invalid JSON'); }
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'tree_sitter', 'Tree-sitter response shape is invalid'));
      }
      const body = decoded as Record<string, unknown>;
      if (!Array.isArray(body.symbols) || typeof body.has_error !== 'boolean') {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'tree_sitter', 'Tree-sitter response shape is invalid'));
      }
      const symbols: StructuralSymbol[] = [];
      for (const [index, value] of body.symbols.entries()) {
        const symbol = mapSymbol(value);
        if (symbol === undefined) return err(domainError('INVALID_EXTERNAL_RESPONSE', `tree_sitter.symbols[${index}]`, 'Tree-sitter symbol shape is invalid'));
        symbols.push(symbol);
      }
      const digest = makeContentDigest(createHash('sha256').update(input.source).digest('hex'));
      if (digest._tag === 'Err') return digest;
      return makeStructuralAnalysis({ repoPath: input.repoPath, sourceDigest: digest.value, symbols, hasSyntaxErrors: body.has_error });
    },
    catch: () => domainError('UNSUPPORTED_PROVIDER', 'tree_sitter', 'Tree-sitter provider boundary failed'),
  })),
});
