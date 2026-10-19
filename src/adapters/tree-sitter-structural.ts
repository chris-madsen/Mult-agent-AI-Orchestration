import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeStructuralAnalysis, type StructuralAnalysis, type StructuralKind, type StructuralSymbol } from '../domain/semantic.js';
import { makeContentDigest } from '../domain/workspace.js';
import { err, type Result } from '../domain/result.js';
import type { ProviderTraceSink, StructuralAnalysisPort } from '../application/ports.js';
import { recoverResult } from '../application/effect-result.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

export interface TreeSitterOptions {
  readonly pythonCommand?: string;
  readonly helperPath: string;
  readonly timeoutMs?: number;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
}

const externalError = (message: string): Result<never, DomainError> =>
  err(domainError('UNSUPPORTED_PROVIDER', 'tree_sitter', message));

export interface TreeSitterProviderIdentity {
  readonly provider: 'tree-sitter';
  readonly protocolSchema: 2;
  readonly pythonVersion: string;
  readonly treeSitterVersion: string;
  readonly grammarVersion: string;
  readonly helperSha256: string;
  readonly fingerprint: string;
}

const identityFrom = (
  decoded: unknown,
  helperSha256: string,
): Result<TreeSitterProviderIdentity, DomainError> => {
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'tree_sitter.identity', 'Tree-sitter identity response must be an object'));
  }
  const value = decoded as Record<string, unknown>;
  if (value.provider !== 'tree-sitter'
    || value.protocol_schema !== 2
    || typeof value.python !== 'string' || value.python.trim().length === 0
    || typeof value.tree_sitter !== 'string' || value.tree_sitter.trim().length === 0 || value.tree_sitter === 'missing'
    || typeof value.tree_sitter_typescript !== 'string' || value.tree_sitter_typescript.trim().length === 0 || value.tree_sitter_typescript === 'missing') {
    return err(domainError('INVALID_EXTERNAL_RESPONSE', 'tree_sitter.identity', 'Tree-sitter runtime identity is incomplete'));
  }
  const stable = {
    provider: 'tree-sitter' as const,
    protocolSchema: 2 as const,
    pythonVersion: value.python,
    treeSitterVersion: value.tree_sitter,
    grammarVersion: value.tree_sitter_typescript,
    helperSha256,
  };
  return ok({
    ...stable,
    fingerprint: createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex'),
  });
};

export const resolveTreeSitterProviderIdentity = (
  options: TreeSitterOptions,
): Effect.Effect<Result<TreeSitterProviderIdentity, DomainError>> =>
  recoverResult(Effect.tryPromise<Result<TreeSitterProviderIdentity, DomainError>, DomainError>({
    try: async () => {
      let helper: Uint8Array;
      try {
        helper = new Uint8Array(await readFile(options.helperPath));
      } catch {
        return err(domainError('UNSUPPORTED_PROVIDER', 'tree_sitter.identity', 'Tree-sitter helper could not be read for identity binding'));
      }
      const helperSha256 = createHash('sha256').update(helper).digest('hex');
      let result: { readonly stdout: string };
      try {
        result = await runProvider(
          options.pythonCommand ?? 'python3',
          options.helperPath,
          JSON.stringify({ operation: 'identity' }),
          options.timeoutMs ?? 10_000,
        );
      } catch (cause) {
        return externalError(cause instanceof Error ? cause.message : 'Tree-sitter identity probe failed');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(result.stdout) as unknown;
      } catch {
        return err(domainError('INVALID_EXTERNAL_RESPONSE', 'tree_sitter.identity', 'Tree-sitter identity probe returned invalid JSON'));
      }
      return identityFrom(decoded, helperSha256);
    },
    catch: () => domainError('UNSUPPORTED_PROVIDER', 'tree_sitter.identity', 'Tree-sitter identity probe failed'),
  }));

const mapSymbol = (value: unknown): StructuralSymbol | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || typeof candidate.kind !== 'string') return undefined;
  const numbers = [candidate.start_line, candidate.start_column, candidate.end_line, candidate.end_column];
  if (!numbers.every((item) => typeof item === 'number' && Number.isSafeInteger(item))) return undefined;
  const nameNumbers = [candidate.name_start_line, candidate.name_start_column, candidate.name_end_line, candidate.name_end_column];
  const hasNameRange = nameNumbers.every((item) => typeof item === 'number' && Number.isSafeInteger(item));
  return {
    name: candidate.name,
    kind: candidate.kind as StructuralKind,
    startLine: candidate.start_line as number,
    startColumn: candidate.start_column as number,
    endLine: candidate.end_line as number,
    endColumn: candidate.end_column as number,
    ...(hasNameRange ? {
      nameStartLine: candidate.name_start_line as number,
      nameStartColumn: candidate.name_start_column as number,
      nameEndLine: candidate.name_end_line as number,
      nameEndColumn: candidate.name_end_column as number,
    } : {}),
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
  extract: (input) => {
    const startedAtMs = Date.now();
    const operation = recoverResult(Effect.tryPromise<Result<StructuralAnalysis, DomainError>, DomainError>({
      try: async () => {
        let sourceText: string;
        try {
          sourceText = new TextDecoder('utf-8', { fatal: true }).decode(input.source);
        } catch {
          return err(domainError('INVALID_INPUT', 'source', 'Tree-sitter source must be valid UTF-8; byte replacement is forbidden'));
        }
        let result: { readonly stdout: string };
        try {
          result = await runProvider(options.pythonCommand ?? 'python3', options.helperPath, JSON.stringify({ path: input.repoPath, source: sourceText }), options.timeoutMs ?? 10_000);
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
    }));
    return Effect.map(operation, (result) => {
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'tree_sitter',
        providerVersion: options.providerVersion ?? 'tree-sitter/unknown',
        operation: 'extract',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  },
});
