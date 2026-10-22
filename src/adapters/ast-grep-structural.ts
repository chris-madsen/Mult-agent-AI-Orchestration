import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeStructuralAnalysis, type StructuralAnalysis, type StructuralKind, type StructuralSymbol } from '../domain/semantic.js';
import { makeContentDigest } from '../domain/workspace.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ProviderTraceSink, StructuralAnalysisPort } from '../application/ports.js';
import { recoverResult } from '../application/effect-result.js';
import { structuralLanguageForPath } from '../domain/structural-language.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';
import { providerUsesWindowsShell, resolveProviderCommand } from './provider-command.js';

export interface AstGrepStructuralOptions {
  readonly command: string;
  readonly timeoutMs?: number;
  readonly providerVersion?: string;
  readonly trace?: ProviderTraceSink;
}

export interface AstGrepProviderIdentity {
  readonly provider: 'ast-grep';
  readonly protocolSchema: 1;
  readonly command: string;
  readonly version: string;
  readonly fingerprint: string;
}

interface OutlineRange {
  readonly byteOffset?: { readonly start?: unknown; readonly end?: unknown };
  readonly start?: { readonly line?: unknown; readonly column?: unknown };
  readonly end?: { readonly line?: unknown; readonly column?: unknown };
}

interface OutlineItem {
  readonly name?: unknown;
  readonly symbolType?: unknown;
  readonly astKind?: unknown;
  readonly range?: unknown;
  readonly isImport?: unknown;
  readonly isExported?: unknown;
  readonly members?: unknown;
}

interface OutlineResponse {
  readonly language?: unknown;
  readonly items?: unknown;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizedKinds: ReadonlySet<string> = new Set([
  'class', 'function', 'interface', 'type', 'enum', 'method', 'struct', 'trait',
  'impl', 'module', 'field', 'enum_variant', 'import', 'export',
]);

const normalizedKind = (value: string): StructuralKind =>
  normalizedKinds.has(value) ? value as StructuralKind : 'unknown';

// ast-grep outline exposes the declaration *node* range but not the identifier
// range required for LSP definition requests. Recover a name anchor only when
// it is unambiguous in the node's declaration header; never guess from the
// function body or treat arbitrary text matches as semantic proof.
const anchorableKinds: ReadonlySet<StructuralKind> = new Set([
  'class', 'function', 'interface', 'type', 'enum', 'method', 'struct', 'trait', 'impl', 'module',
]);
const identifierName = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u;
const identifierBoundary = /[\p{ID_Continue}$]/u;

const nameAnchorFromOutline = (
  source: Uint8Array,
  startOffset: number,
  endOffset: number,
  name: string,
  kind: StructuralKind,
): Pick<StructuralSymbol, 'nameStartLine' | 'nameStartColumn' | 'nameEndLine' | 'nameEndColumn'> => {
  if (!anchorableKinds.has(kind) || !identifierName.test(name)) return {};
  const bytes = Buffer.from(source);
  const preview = bytes.subarray(startOffset, Math.min(endOffset, startOffset + 1024)).toString('utf8');
  // Stop before a body, type/value assignment or parameter list. A search in
  // an entire symbol can accidentally select a recursive call or a namesake.
  const terminators = ['(', '{', '=', ';'].map((item) => preview.indexOf(item)).filter((index) => index >= 0);
  const header = preview.slice(0, terminators.length === 0 ? preview.length : Math.min(...terminators));
  if (header.includes('//') || header.includes('/*') || /['"\x60]/u.test(header)) return {};
  const matches: number[] = [];
  for (let from = 0; from < header.length;) {
    const index = header.indexOf(name, from);
    if (index < 0) break;
    const before = index === 0 ? '' : String.fromCodePoint(header.codePointAt(index - 1) ?? 0);
    const after = header.slice(index + name.length, index + name.length + 2);
    if ((before.length === 0 || !identifierBoundary.test(before))
      && (after.length === 0 || !identifierBoundary.test(after))) matches.push(index);
    from = index + name.length;
  }
  if (matches.length !== 1) return {};
  const offset = startOffset + Buffer.byteLength(header.slice(0, matches[0]), 'utf8');
  const length = Buffer.byteLength(name, 'utf8');
  if (offset < startOffset || offset + length > endOffset
    || !bytes.subarray(offset, offset + length).equals(Buffer.from(name, 'utf8'))) return {};
  const position = (at: number): { line: number; column: number } => {
    let line = 1;
    let lineStart = 0;
    // Offset conversion uses UTF-8 byte columns, not JS UTF-16 columns.
    for (let i = 0; i < at; i += 1) {
      if (bytes[i] === 10) { line += 1; lineStart = i + 1; }
    }
    return { line, column: at - lineStart + 1 };
  };
  const start = position(offset);
  const end = position(offset + length);
  return {
    nameStartLine: start.line,
    nameStartColumn: start.column,
    nameEndLine: end.line,
    nameEndColumn: end.column,
  };
};

const invalidResponse = (path: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_EXTERNAL_RESPONSE', path, message));

const parseOutline = (
  decoded: unknown,
  repoPath: string,
  source: Uint8Array,
): Result<StructuralAnalysis, DomainError> => {
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return invalidResponse('ast_grep', 'outline response must be an object');
  }
  const response = decoded as OutlineResponse;
  if (!nonEmptyString(response.language) || !Array.isArray(response.items)) {
    return invalidResponse('ast_grep', 'outline response requires language and items');
  }
  const language = response.language;
  const symbols: StructuralSymbol[] = [];
  const visit = (raw: unknown, path: string): Result<void, DomainError> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return invalidResponse(path, 'outline item must be an object');
    }
    const item = raw as OutlineItem;
    if (!nonEmptyString(item.name) || !nonEmptyString(item.symbolType) || !nonEmptyString(item.astKind)
      || typeof item.range !== 'object' || item.range === null || Array.isArray(item.range)) {
      return invalidResponse(path, 'outline item has an invalid identity');
    }
    const name = item.name;
    const symbolType = item.symbolType;
    const astKind = item.astKind;
    const range = item.range as OutlineRange;
    const byteOffset = range.byteOffset;
    const start = range.start;
    const end = range.end;
    if (typeof byteOffset !== 'object' || byteOffset === null
      || !positiveInteger(byteOffset.start) || !positiveInteger(byteOffset.end)
      || byteOffset.end <= byteOffset.start
      || typeof start !== 'object' || start === null
      || typeof end !== 'object' || end === null
      || !positiveInteger(start.line) || !positiveInteger(start.column)
      || !positiveInteger(end.line) || !positiveInteger(end.column)
      || byteOffset.end > source.byteLength) {
      return invalidResponse(`${path}.range`, 'outline item has an invalid byte range');
    }
    const kind = normalizedKind(symbolType);
    const nameAnchor = nameAnchorFromOutline(source, byteOffset.start, byteOffset.end, name, kind);
    symbols.push({
      name,
      kind,
      ...nameAnchor,
      providerKind: astKind,
      language,
      startLine: start.line + 1,
      startColumn: start.column + 1,
      endLine: end.line + 1,
      endColumn: end.column + 1,
      startByteOffset: byteOffset.start,
      endByteOffset: byteOffset.end,
      isImport: item.isImport === true,
      isExported: item.isExported === true,
    });
    if (item.members !== undefined) {
      if (!Array.isArray(item.members)) return invalidResponse(`${path}.members`, 'outline members must be an array');
      for (const [memberIndex, member] of item.members.entries()) {
        const nested = visit(member, `${path}.members[${memberIndex}]`);
        if (nested._tag === 'Err') return nested;
      }
    }
    return ok(undefined);
  };
  for (const [index, raw] of response.items.entries()) {
    const item = visit(raw, `ast_grep.items[${index}]`);
    if (item._tag === 'Err') return item;
  }
  const digest = makeContentDigest(createHash('sha256').update(source).digest('hex'));
  if (digest._tag === 'Err') return digest;
  return makeStructuralAnalysis({
    repoPath,
    sourceDigest: digest.value,
    symbols,
    hasSyntaxErrors: false,
  });
};

const run = (
  command: string,
  args: readonly string[],
  input: Uint8Array | undefined,
  timeoutMs: number,
): Promise<{ readonly stdout: string; readonly stderr: string }> => new Promise((resolve, reject) => {
  const resolvedCommand = resolveProviderCommand(command);
  const child = spawn(resolvedCommand, [...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: providerUsesWindowsShell(resolvedCommand),
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let settled = false;
  const finish = (failure?: Error): void => {
    if (settled) return;
    settled = true;
    if (failure === undefined) {
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    } else {
      reject(failure);
    }
  };
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    finish(new Error('ast-grep provider timed out'));
  }, timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.on('error', (cause) => finish(cause instanceof Error ? cause : new Error('ast-grep provider failed to start')));
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) finish();
    else finish(new Error(Buffer.concat(stderr).toString('utf8').trim() || `ast-grep exited with code ${code ?? 'unknown'}`));
  });
  child.stdin.end(input === undefined ? undefined : Buffer.from(input));
});

const commandVersion = (command: string): Effect.Effect<Result<string, DomainError>> =>
  recoverResult(Effect.tryPromise<Result<string, DomainError>, DomainError>({
    try: async () => {
      try {
        const result = await run(command, ['--version'], undefined, 10_000);
        const version = result.stdout.trim();
        return nonEmptyString(version)
          ? ok(version)
          : err(domainError('INVALID_EXTERNAL_RESPONSE', 'ast_grep.version', 'ast-grep version is empty'));
      } catch (cause) {
        return err(domainError('UNSUPPORTED_PROVIDER', 'ast_grep.version', cause instanceof Error ? cause.message : 'ast-grep version probe failed'));
      }
    },
    catch: () => domainError('UNSUPPORTED_PROVIDER', 'ast_grep.version', 'ast-grep version probe failed'),
  }));

export const resolveAstGrepProviderIdentity = (
  options: AstGrepStructuralOptions,
): Effect.Effect<Result<AstGrepProviderIdentity, DomainError>> => Effect.gen(function* () {
  const command = resolveProviderCommand(options.command);
  const version = yield* commandVersion(command);
  if (version._tag === 'Err') return version;
  const stable = {
    provider: 'ast-grep' as const,
    protocolSchema: 1 as const,
    command,
    version: version.value,
  };
  return ok({
    ...stable,
    fingerprint: createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex'),
  });
});

export const makeAstGrepStructuralPort = (options: AstGrepStructuralOptions): StructuralAnalysisPort => ({
  extract: (input) => {
    const startedAtMs = Date.now();
    const operation = recoverResult(Effect.tryPromise<Result<StructuralAnalysis, DomainError>, DomainError>({
      try: async () => {
        const language = structuralLanguageForPath(input.repoPath);
        if (language === undefined) {
          return err(domainError('UNSUPPORTED_PROVIDER', 'ast_grep.language', `no ast-grep language is registered for ${input.repoPath}`));
        }
        let result: { readonly stdout: string };
        try {
          result = await run(resolveProviderCommand(options.command), [
            'outline', '--stdin', '--lang', language.language,
            '--json=stream', '--items', 'all', '--view', 'expanded',
          ], input.source, options.timeoutMs ?? 10_000);
        } catch (cause) {
          return err(domainError('UNSUPPORTED_PROVIDER', 'ast_grep', cause instanceof Error ? cause.message : 'ast-grep provider failed'));
        }
        const lines = result.stdout.trim().split('\n').filter((line) => line.trim().length > 0);
        if (lines.length !== 1) return invalidResponse('ast_grep', 'outline must return exactly one JSON object');
        let decoded: unknown;
        try { decoded = JSON.parse(lines[0] as string) as unknown; } catch {
          return invalidResponse('ast_grep', 'outline returned invalid JSON');
        }
        return parseOutline(decoded, input.repoPath, input.source);
      },
      catch: () => domainError('UNSUPPORTED_PROVIDER', 'ast_grep', 'ast-grep provider boundary failed'),
    }));
    return Effect.map(operation, (result) => {
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'ast_grep',
        providerVersion: options.providerVersion ?? 'ast-grep/unknown',
        operation: 'outline',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  },
});
