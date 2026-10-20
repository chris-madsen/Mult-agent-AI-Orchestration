import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { ProviderTraceSink, SemanticAnalysisPort, SemanticQuery } from '../application/ports.js';
import { recoverResult } from '../application/effect-result.js';
import type {
  SemanticDefinition,
  SemanticDiagnostic,
  SemanticLocation,
  SemanticReference,
} from '../domain/semantic.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

export interface LspSemanticOptions {
  readonly command: string;
  /** Arguments used to start the server in stdio mode; TS defaults to --stdio. */
  readonly args?: readonly string[];
  readonly rootPath: string;
  readonly files: Readonly<Record<string, string>>;
  /** Extension-to-LSP language mapping supplied by the selected server. */
  readonly languageIds?: Readonly<Record<string, string>>;
  /** Human-readable server identity; defaults to the production TS server. */
  readonly serverName?: string;
  /** Keep stdio referenced for a long-lived host such as the MCP server. */
  readonly keepProcessAlive?: boolean;
  readonly providerVersion?: string;
  readonly snapshotIdentity?: string;
  readonly timeoutMs?: number;
  /** Debounce publishDiagnostics notifications before exposing a snapshot. */
  readonly diagnosticSettleMs?: number;
  readonly trace?: ProviderTraceSink;
}

export interface LspProviderIdentity {
  readonly provider: 'lsp';
  readonly server: string;
  readonly protocol: 'lsp';
  readonly protocolVersion: 1;
  readonly command: string;
  readonly args: readonly string[];
  readonly version: string;
  readonly snapshotIdentity: string;
  readonly fingerprint: string;
}

interface LspPosition { readonly line: number; readonly character: number }
interface LspRange { readonly start: LspPosition; readonly end: LspPosition }
interface LspLocation { readonly uri: string; readonly range: LspRange }
interface LspLocationLink {
  readonly targetUri: string;
  readonly targetRange: LspRange;
  readonly targetSelectionRange?: LspRange;
}

interface LspDiagnostic {
  readonly range: LspRange;
  readonly message: string;
  readonly severity?: number;
  readonly code?: number | string;
}

interface LspRuntime {
  readonly child: ChildProcessWithoutNullStreams;
  readonly connection: MessageConnection;
  readonly files: ReadonlyMap<string, string>;
  readonly diagnostics: ReadonlyMap<string, readonly LspDiagnostic[]>;
  readonly waitForDiagnostics: (uri: string, timeoutMs: number) => Promise<readonly LspDiagnostic[]>;
  readonly refProcess: () => void;
  readonly unrefProcess: () => void;
  readonly close: () => void;
}

const failure = (pathName: string, message: string, code: DomainError['code'] = 'EXTERNAL_UNAVAILABLE'): Result<never, DomainError> =>
  err(domainError(code, pathName, message));

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

type RefCountedStream = { readonly ref?: () => void; readonly unref?: () => void };

const setStreamRef = (stream: NodeJS.ReadableStream | NodeJS.WritableStream, referenced: boolean): void => {
  const method = (stream as unknown as RefCountedStream)[referenced ? 'ref' : 'unref'];
  method?.call(stream);
};

export const lspLanguageIdForPath = (repoPath: string, languageIds?: Readonly<Record<string, string>>): string | undefined => {
  const extension = path.extname(repoPath).toLocaleLowerCase();
  const configured = languageIds?.[extension];
  if (configured !== undefined) return configured;
  switch (extension) {
    case '.ts': return 'typescript';
    case '.tsx': return 'typescriptreact';
    case '.js':
    case '.mjs':
    case '.cjs': return 'javascript';
    case '.jsx': return 'javascriptreact';
    default: return undefined;
  }
};

const languageIdForPath = lspLanguageIdForPath;

const uriFor = (rootPath: string, repoPath: string): string =>
  pathToFileURL(path.resolve(rootPath, repoPath)).toString();

const repoPathForUri = (rootPath: string, uri: unknown): string | undefined => {
  if (!nonEmptyString(uri) || !uri.startsWith('file:')) return undefined;
  try {
    const relative = path.relative(path.resolve(rootPath), fileURLToPath(uri));
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
    return relative.split(path.sep).join('/');
  } catch {
    return undefined;
  }
};

const validPosition = (value: unknown): value is LspPosition => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  return Number.isSafeInteger(position.line) && (position.line as number) >= 0
    && Number.isSafeInteger(position.character) && (position.character as number) >= 0;
};

const validRange = (value: unknown): value is LspRange => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>;
  return validPosition(range.start) && validPosition(range.end);
};

const locationFromLsp = (rootPath: string, value: unknown, files: ReadonlyMap<string, string>): SemanticLocation | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Partial<LspLocation> & Partial<LspLocationLink>;
  const uri = 'uri' in item ? item.uri : item.targetUri;
  const range = 'range' in item ? item.range : item.targetSelectionRange ?? item.targetRange;
  const repoPath = repoPathForUri(rootPath, uri);
  if (repoPath === undefined || !validRange(range) || !files.has(repoPath)) return undefined;
  return {
    repoPath,
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
};

const asLocationArray = (value: unknown): readonly unknown[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];

const displayHover = (value: unknown): { readonly display: string; readonly documentation?: string } | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const contents = (value as { contents?: unknown }).contents;
  if (typeof contents === 'string') return { display: contents };
  if (typeof contents === 'object' && contents !== null && !Array.isArray(contents)) {
    const markdown = (contents as { value?: unknown }).value;
    return typeof markdown === 'string' ? { display: markdown } : undefined;
  }
  if (!Array.isArray(contents)) return undefined;
  const parts = contents.flatMap((part): string[] => {
    if (typeof part === 'string') return [part];
    if (typeof part !== 'object' || part === null || Array.isArray(part)) return [];
    const item = part as { value?: unknown };
    return typeof item.value === 'string' ? [item.value] : [];
  });
  if (parts.length === 0) return undefined;
  return { display: parts[0] ?? '', ...(parts.length > 1 ? { documentation: parts.slice(1).join('\n') } : {}) };
};

const diagnosticCategory = (severity: unknown): SemanticDiagnostic['category'] => {
  if (severity === 1) return 'error';
  if (severity === 2) return 'warning';
  if (severity === 3) return 'suggestion';
  return 'message';
};

const serverArgs = (options: Pick<LspSemanticOptions, 'args'>): readonly string[] => options.args ?? ['--stdio'];

const runVersion = (command: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.on('error', reject);
  child.on('close', (code) => {
    const version = Buffer.concat(stdout).toString('utf8').trim();
    if (code === 0 && version.length > 0) resolve(version);
    else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `LSP server version probe exited with ${code ?? 'unknown'}`));
  });
});

export const resolveLspProviderIdentity = (options: Pick<LspSemanticOptions, 'command' | 'args' | 'snapshotIdentity' | 'serverName'>): Effect.Effect<Result<LspProviderIdentity, DomainError>> =>
  recoverResult(Effect.tryPromise({
    try: async () => {
      try {
        const version = await runVersion(options.command);
        const stable = {
          provider: 'lsp' as const,
          server: options.serverName ?? 'typescript-language-server',
          protocol: 'lsp' as const,
          protocolVersion: 1 as const,
          command: options.command,
          args: [...serverArgs(options)],
          version,
          snapshotIdentity: options.snapshotIdentity ?? 'unbound',
        };
        return ok({ ...stable, fingerprint: createHash('sha256').update(JSON.stringify(stable)).digest('hex') });
      } catch (cause) {
        return failure('lsp.identity', cause instanceof Error ? cause.message : 'LSP server identity probe failed', 'UNSUPPORTED_PROVIDER');
      }
    },
    catch: () => domainError('UNSUPPORTED_PROVIDER', 'lsp.identity', 'LSP server identity probe failed'),
  }));

const startRuntime = async (options: LspSemanticOptions): Promise<Result<LspRuntime, DomainError>> => {
  try {
    const child = spawn(options.command, serverArgs(options), {
      cwd: options.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.unref();
    const refProcess = (): void => {
      setStreamRef(child.stdin, true);
      setStreamRef(child.stdout, true);
      setStreamRef(child.stderr, true);
    };
    const unrefProcess = (): void => {
      setStreamRef(child.stdin, false);
      setStreamRef(child.stdout, false);
      setStreamRef(child.stderr, false);
    };
    const files = new Map(Object.entries(options.files));
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const diagnostics = new Map<string, readonly LspDiagnostic[]>();
    const diagnosticWaiters = new Map<string, Array<(value: readonly LspDiagnostic[]) => void>>();
    const diagnosticSettleTimers = new Map<string, NodeJS.Timeout>();
    const diagnosticSettleMs = options.diagnosticSettleMs ?? 250;
    connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      if (typeof params !== 'object' || params === null || Array.isArray(params)) return;
      const value = params as { uri?: unknown; diagnostics?: unknown };
      if (!nonEmptyString(value.uri) || !Array.isArray(value.diagnostics)) return;
      const uri = value.uri;
      const items = value.diagnostics.flatMap((item): LspDiagnostic[] => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
        const diagnostic = item as Partial<LspDiagnostic>;
        return validRange(diagnostic.range) && nonEmptyString(diagnostic.message)
          ? [diagnostic as LspDiagnostic]
          : [];
      });
      diagnostics.set(uri, items);
      const previousTimer = diagnosticSettleTimers.get(uri);
      if (previousTimer !== undefined) clearTimeout(previousTimer);
      diagnosticSettleTimers.set(uri, setTimeout(() => {
        diagnosticSettleTimers.delete(uri);
        const settled = diagnostics.get(uri) ?? items;
        for (const resolve of diagnosticWaiters.get(uri) ?? []) resolve(settled);
        diagnosticWaiters.delete(uri);
      }, diagnosticSettleMs));
    });
    connection.onRequest('workspace/configuration', () => []);
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.listen();
    await connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(path.resolve(options.rootPath)).toString(),
      workspaceFolders: [{ uri: pathToFileURL(path.resolve(options.rootPath)).toString(), name: path.basename(options.rootPath) }],
      capabilities: {
        textDocument: { definition: { linkSupport: true }, references: {}, hover: {}, publishDiagnostics: {} },
        workspace: { workspaceFolders: true, configuration: true },
      },
      initializationOptions: {},
    });
    await connection.sendNotification('initialized', {});
    for (const [repoPath, source] of files) {
      const languageId = languageIdForPath(repoPath, options.languageIds);
      if (languageId === undefined) continue;
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri: uriFor(options.rootPath, repoPath), languageId, version: 1, text: source },
      });
    }
    const close = (): void => {
      for (const timer of diagnosticSettleTimers.values()) clearTimeout(timer);
      diagnosticSettleTimers.clear();
      diagnosticWaiters.clear();
      connection.dispose();
      child.kill('SIGTERM');
    };
    const waitForDiagnostics = (uri: string, timeoutMs: number): Promise<readonly LspDiagnostic[]> => {
      const current = diagnostics.get(uri);
      if (current !== undefined) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(diagnostics.get(uri) ?? current), diagnosticSettleMs);
        });
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiters = diagnosticWaiters.get(uri) ?? [];
          diagnosticWaiters.set(uri, waiters.filter((item) => item !== resolve));
          reject(new Error('LSP diagnostics notification timed out'));
        }, timeoutMs);
        const waiter = (value: readonly LspDiagnostic[]): void => {
          clearTimeout(timer);
          resolve(value);
        };
        diagnosticWaiters.set(uri, [...(diagnosticWaiters.get(uri) ?? []), waiter]);
      });
    };
    if (options.keepProcessAlive !== false) refProcess();
    else unrefProcess();
    return ok({ child, connection, files, diagnostics, waitForDiagnostics, refProcess, unrefProcess, close });
  } catch (cause) {
    return failure('lsp.start', cause instanceof Error ? cause.message : 'LSP server failed to initialize', 'UNSUPPORTED_PROVIDER');
  }
};

const withTimeout = async <Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LSP request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const makeLspSemanticAnalysisPort = (options: LspSemanticOptions): SemanticAnalysisPort & { readonly close: () => void } => {
  let runtimePromise: Promise<Result<LspRuntime, DomainError>> | undefined;
  const runtime = (): Promise<Result<LspRuntime, DomainError>> => {
    runtimePromise ??= startRuntime(options);
    return runtimePromise;
  };
  const query = <Value>(
    queryInput: SemanticQuery,
    operationName: string,
    operation: (active: LspRuntime, fileUri: string, position: LspPosition) => Promise<Result<Value, DomainError>>,
  ): Effect.Effect<Result<Value, DomainError>> => recoverResult(Effect.tryPromise({
      try: async () => {
        const startedAtMs = Date.now();
        const active = await runtime();
        let result: Result<Value, DomainError>;
        if (active._tag === 'Err') result = active;
        else if (options.snapshotIdentity !== undefined && queryInput.snapshotIdentity !== options.snapshotIdentity) {
          result = failure('snapshot_identity', 'semantic query is bound to a different source/configuration generation', 'NOT_READY');
        } else {
          const source = active.value.files.get(queryInput.repoPath);
          const languageId = languageIdForPath(queryInput.repoPath, options.languageIds);
          if (source === undefined || languageId === undefined) {
            result = failure('repo_path', 'source file has no configured LSP document', 'UNSUPPORTED_PROVIDER');
          } else if (!Number.isSafeInteger(queryInput.line) || queryInput.line < 1 || !Number.isSafeInteger(queryInput.column) || queryInput.column < 1) {
            result = failure('position', 'line and column must be positive integers', 'INVALID_INPUT');
          } else {
            active.value.refProcess();
            try {
              result = await operation(active.value, uriFor(options.rootPath, queryInput.repoPath), {
                line: queryInput.line - 1,
                character: queryInput.column - 1,
              });
            } finally {
              if (options.keepProcessAlive === false) active.value.unrefProcess();
            }
          }
        }
        providerTraceEvent(options.trace ?? noopProviderTrace, {
          provider: 'lsp',
          providerVersion: options.providerVersion ?? `${options.serverName ?? 'typescript-language-server'}/unknown`,
          operation: operationName,
          status: result._tag === 'Ok' ? 'success' : 'failure',
          durationMs: Math.max(0, Date.now() - startedAtMs),
          ...(queryInput.requestId === undefined ? {} : { requestId: queryInput.requestId }),
          ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
        });
        return result;
      },
      catch: (cause) => domainError('EXTERNAL_UNAVAILABLE', 'lsp', cause instanceof Error ? cause.message : 'LSP provider request failed'),
    }));

  return {
    definition: (input) => query(input, 'definition', async (active, uri, position) => {
      try {
        const response = await withTimeout(active.connection.sendRequest<unknown>('textDocument/definition', {
          textDocument: { uri },
          position,
        }), options.timeoutMs ?? 15_000);
        return ok(asLocationArray(response).flatMap((item): SemanticDefinition[] => {
          const location = locationFromLsp(options.rootPath, item, active.files);
          return location === undefined ? [] : [{ location }];
        }));
      } catch (cause) {
        return failure('lsp.definition', cause instanceof Error ? cause.message : 'LSP definition request failed');
      }
    }),
    references: (input) => query(input, 'references', async (active, uri, position) => {
      try {
        const response = await withTimeout(active.connection.sendRequest<unknown>('textDocument/references', {
          textDocument: { uri },
          position,
          context: { includeDeclaration: true },
        }), options.timeoutMs ?? 15_000);
        const definitionResponse = await withTimeout(active.connection.sendRequest<unknown>('textDocument/definition', {
          textDocument: { uri },
          position,
        }), options.timeoutMs ?? 15_000);
        const definitions = asLocationArray(definitionResponse).flatMap((item) => {
          const location = locationFromLsp(options.rootPath, item, active.files);
          return location === undefined ? [] : [location];
        });
        return ok(asLocationArray(response).flatMap((item): SemanticReference[] => {
          const location = locationFromLsp(options.rootPath, item, active.files);
          return location === undefined ? [] : [{
            location,
            isDefinition: definitions.some((definition) => definition.repoPath === location.repoPath
              && definition.startLine === location.startLine
              && definition.startColumn === location.startColumn),
          }];
        }));
      } catch (cause) {
        return failure('lsp.references', cause instanceof Error ? cause.message : 'LSP references request failed');
      }
    }),
    typeInfo: (input) => query(input, 'type_info', async (active, uri, position) => {
      try {
        const response = await withTimeout(active.connection.sendRequest<unknown>('textDocument/hover', {
          textDocument: { uri },
          position,
        }), options.timeoutMs ?? 15_000);
        return ok(displayHover(response));
      } catch (cause) {
        return failure('lsp.hover', cause instanceof Error ? cause.message : 'LSP hover request failed');
      }
    }),
    diagnostics: (input): Effect.Effect<Result<readonly SemanticDiagnostic[], DomainError>> => recoverResult(Effect.tryPromise({
      try: async () => {
        const startedAtMs = Date.now();
        const active = await runtime();
        let result: Result<readonly SemanticDiagnostic[], DomainError>;
        if (active._tag === 'Err') result = active;
        else if (languageIdForPath(input.repoPath, options.languageIds) === undefined || !active.value.files.has(input.repoPath)) {
          result = failure('repo_path', 'source file has no configured LSP document', 'UNSUPPORTED_PROVIDER');
        } else {
          try {
            if (options.keepProcessAlive === false) active.value.refProcess();
            const uri = uriFor(options.rootPath, input.repoPath);
            const items = active.value.diagnostics.get(uri)
              ?? await active.value.waitForDiagnostics(uri, options.timeoutMs ?? 15_000);
            result = ok(items.flatMap((diagnostic): SemanticDiagnostic[] => {
              const location = locationFromLsp(options.rootPath, {
                uri,
                range: diagnostic.range,
              }, active.value.files);
              return [{
                ...(location === undefined ? {} : { location }),
                message: diagnostic.message,
                category: diagnosticCategory(diagnostic.severity),
                code: typeof diagnostic.code === 'number' ? diagnostic.code : 0,
              }];
            }));
          } catch (cause) {
            result = failure('lsp.diagnostics', cause instanceof Error ? cause.message : 'LSP diagnostics request failed');
          } finally {
            if (options.keepProcessAlive === false) active.value.unrefProcess();
          }
        }
        providerTraceEvent(options.trace ?? noopProviderTrace, {
          provider: 'lsp',
          providerVersion: options.providerVersion ?? `${options.serverName ?? 'typescript-language-server'}/unknown`,
          operation: 'diagnostics',
          status: result._tag === 'Ok' ? 'success' : 'failure',
          durationMs: Math.max(0, Date.now() - startedAtMs),
          ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
        });
        return result;
      },
      catch: (cause) => domainError('EXTERNAL_UNAVAILABLE', 'lsp.diagnostics', cause instanceof Error ? cause.message : 'LSP diagnostics failed'),
    })),
    close: (): void => {
      if (runtimePromise !== undefined) void runtimePromise.then((active) => { if (active._tag === 'Ok') active.value.close(); });
    },
  };
};
