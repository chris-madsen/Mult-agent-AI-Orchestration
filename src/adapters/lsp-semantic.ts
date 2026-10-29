import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
import { providerUsesWindowsShell, resolveProviderCommand } from './provider-command.js';

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

export interface LspSemanticSession extends SemanticAnalysisPort {
  readonly close: () => Promise<void>;
  readonly refresh: (
    files: Readonly<Record<string, string>>,
    snapshotIdentity: string,
  ) => Effect.Effect<Result<void, DomainError>>;
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
  readonly files: Map<string, string>;
  readonly diagnostics: ReadonlyMap<string, readonly LspDiagnostic[]>;
  readonly waitForDiagnostics: (uri: string, timeoutMs: number) => Promise<readonly LspDiagnostic[]>;
  readonly updateFiles: (nextFiles: Readonly<Record<string, string>>) => Promise<Result<void, DomainError>>;
  readonly refProcess: () => void;
  readonly unrefProcess: () => void;
  readonly close: () => Promise<void>;
}

const failure = (pathName: string, message: string, code: DomainError['code'] = 'EXTERNAL_UNAVAILABLE'): Result<never, DomainError> =>
  err(domainError(code, pathName, message));

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

type RefCountedStream = { readonly ref?: () => void; readonly unref?: () => void };

const setStreamRef = (stream: NodeJS.ReadableStream | NodeJS.WritableStream, referenced: boolean): void => {
  const method = (stream as unknown as RefCountedStream)[referenced ? 'ref' : 'unref'];
  method?.call(stream);
};

const gracefulTerminationWaitMs = 750;
const forcedTerminationWaitMs = 250;

const terminateProviderProcess = (
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): void => {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process group may already have exited; fall back to the direct child.
    }
  }
  child.kill(signal);
};

const waitForProviderExit = async (
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolveExit) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(exited);
    };
    const onExit = (): void => finish(true);
    child.once('exit', onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    // The process may have exited between the initial exitCode check and
    // listener registration without another observable event.
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
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

const runVersion = async (command: string, timeoutMs: number): Promise<string> => {
  const resolvedCommand = resolveProviderCommand(command);
  const child = spawn(resolvedCommand, ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: providerUsesWindowsShell(resolvedCommand),
    detached: process.platform !== 'win32',
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const completed = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      const version = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0 && version.length > 0) resolve(version);
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `LSP server version probe exited with ${code ?? 'unknown'}`));
    });
  });
  try {
    return await withTimeout(completed, timeoutMs);
  } catch (cause) {
    if (child.exitCode === null && child.signalCode === null) {
      terminateProviderProcess(child, 'SIGTERM');
      if (!await waitForProviderExit(child, 250)) {
        terminateProviderProcess(child, 'SIGKILL');
        await waitForProviderExit(child, 250);
      }
    }
    throw cause;
  }
};

export const resolveLspProviderIdentity = (options: Pick<LspSemanticOptions, 'command' | 'args' | 'snapshotIdentity' | 'serverName' | 'timeoutMs'>): Effect.Effect<Result<LspProviderIdentity, DomainError>> =>
  recoverResult(Effect.tryPromise({
    try: async () => {
      try {
        const command = resolveProviderCommand(options.command);
        const version = await runVersion(command, options.timeoutMs ?? 15_000);
        const stable = {
          provider: 'lsp' as const,
          server: options.serverName ?? 'typescript-language-server',
          protocol: 'lsp' as const,
          protocolVersion: 1 as const,
          command,
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
  let cleanupChild: ChildProcessWithoutNullStreams | undefined;
  let cleanupConnection: MessageConnection | undefined;
  try {
    const command = resolveProviderCommand(options.command);
    const child = spawn(command, serverArgs(options), {
      cwd: options.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: providerUsesWindowsShell(command),
      detached: process.platform !== 'win32',
    });
    cleanupChild = child;
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
    const versions = new Map<string, number>();
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    cleanupConnection = connection;
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
    await withTimeout(connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(path.resolve(options.rootPath)).toString(),
      workspaceFolders: [{ uri: pathToFileURL(path.resolve(options.rootPath)).toString(), name: path.basename(options.rootPath) }],
      capabilities: {
        textDocument: { definition: { linkSupport: true }, references: {}, hover: {}, publishDiagnostics: {} },
        workspace: { workspaceFolders: true, configuration: true },
      },
      initializationOptions: {},
    }), options.timeoutMs ?? 15_000);
    await connection.sendNotification('initialized', {});
    for (const [repoPath, source] of files) {
      const languageId = languageIdForPath(repoPath, options.languageIds);
      if (languageId === undefined) continue;
      versions.set(repoPath, 1);
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri: uriFor(options.rootPath, repoPath), languageId, version: 1, text: source },
      });
    }
    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closePromise !== undefined) return closePromise;
      for (const timer of diagnosticSettleTimers.values()) clearTimeout(timer);
      diagnosticSettleTimers.clear();
      diagnosticWaiters.clear();
      closePromise = (async () => {
        try {
          await withTimeout(connection.sendRequest('shutdown'), options.timeoutMs ?? 15_000);
        } catch {
          // A dead or hung provider still gets the bounded termination fallback.
        }
        try {
          await connection.sendNotification('exit', undefined);
        } catch {
          // The transport may already be closed; termination below remains authoritative.
        }
        connection.dispose();
        if (!await waitForProviderExit(child, 250)) {
          terminateProviderProcess(child, 'SIGTERM');
          if (!await waitForProviderExit(child, 250)) {
            terminateProviderProcess(child, 'SIGKILL');
            await waitForProviderExit(child, 250);
          }
        }
      })();
      return closePromise;
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
    const updateFiles = async (nextFiles: Readonly<Record<string, string>>): Promise<Result<void, DomainError>> => {
      try {
        const next = new Map(Object.entries(nextFiles));
        for (const repoPath of files.keys()) {
          if (next.has(repoPath)) continue;
          const languageId = languageIdForPath(repoPath, options.languageIds);
          if (languageId !== undefined) {
            await connection.sendNotification('textDocument/didClose', {
              textDocument: { uri: uriFor(options.rootPath, repoPath) },
            });
          }
          files.delete(repoPath);
          versions.delete(repoPath);
        }
        for (const [repoPath, source] of next) {
          const languageId = languageIdForPath(repoPath, options.languageIds);
          if (languageId === undefined) continue;
          const previous = files.get(repoPath);
          if (previous === undefined) {
            versions.set(repoPath, 1);
            await connection.sendNotification('textDocument/didOpen', {
              textDocument: { uri: uriFor(options.rootPath, repoPath), languageId, version: 1, text: source },
            });
          } else if (previous !== source) {
            const version = (versions.get(repoPath) ?? 1) + 1;
            versions.set(repoPath, version);
            await connection.sendNotification('textDocument/didChange', {
              textDocument: { uri: uriFor(options.rootPath, repoPath), version },
              contentChanges: [{ text: source }],
            });
          }
          files.set(repoPath, source);
        }
        return ok(undefined);
      } catch (cause) {
        return failure('lsp.refresh', cause instanceof Error ? cause.message : 'LSP document refresh failed');
      }
    };
    if (options.keepProcessAlive !== false) refProcess();
    else unrefProcess();
    cleanupChild = undefined;
    cleanupConnection = undefined;
    return ok({ child, connection, files, diagnostics, waitForDiagnostics, updateFiles, refProcess, unrefProcess, close });
  } catch (cause) {
    try {
      cleanupConnection?.dispose();
    } catch {
      // Initialization failure cleanup is best-effort before process termination.
    }
    if (cleanupChild !== undefined && cleanupChild.exitCode === null && cleanupChild.signalCode === null) {
      terminateProviderProcess(cleanupChild, 'SIGTERM');
      if (!await waitForProviderExit(cleanupChild, gracefulTerminationWaitMs)) {
        terminateProviderProcess(cleanupChild, 'SIGKILL');
        await waitForProviderExit(cleanupChild, forcedTerminationWaitMs);
      }
    }
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

export const makeLspSemanticAnalysisPort = (options: LspSemanticOptions): LspSemanticSession => {
  let runtimePromise: Promise<Result<LspRuntime, DomainError>> | undefined;
  let activeSnapshotIdentity = options.snapshotIdentity;
  let activeFiles: Readonly<Record<string, string>> = { ...options.files };
  let closed = false;
  let sessionClosePromise: Promise<void> | undefined;
  let activeOperations = 0;
  const drainWaiters = new Set<() => void>();
  const beginOperation = (): (() => void) | undefined => {
    if (closed) return undefined;
    activeOperations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeOperations -= 1;
      if (activeOperations === 0) {
        for (const resolve of drainWaiters) resolve();
        drainWaiters.clear();
      }
    };
  };
  const waitForOperations = async (): Promise<void> => {
    if (activeOperations === 0) return;
    await new Promise<void>((resolveDrain) => drainWaiters.add(resolveDrain));
  };
  const runtime = (): Promise<Result<LspRuntime, DomainError>> => {
    // Admission is controlled by beginOperation(). Once an operation has been
    // admitted, retirement must drain it even if close() flips the terminal
    // flag before lazy runtime initialization reaches this point.
    if (runtimePromise !== undefined) return runtimePromise;
    const started = startRuntime({ ...options, files: activeFiles });
    runtimePromise = started;
    void started.then((active) => {
      if (runtimePromise !== started) return;
      if (active._tag === 'Err') {
        runtimePromise = undefined;
        return;
      }
      const invalidate = (): void => {
        if (runtimePromise === started) runtimePromise = undefined;
      };
      active.value.child.once('error', invalidate);
      active.value.child.once('exit', invalidate);
    });
    return started;
  };
  const query = <Value>(
    queryInput: SemanticQuery,
    operationName: string,
    operation: (active: LspRuntime, fileUri: string, position: LspPosition) => Promise<Result<Value, DomainError>>,
  ): Effect.Effect<Result<Value, DomainError>> => recoverResult(Effect.tryPromise({
      try: async () => {
        const startedAtMs = Date.now();
        const releaseOperation = beginOperation();
        if (releaseOperation === undefined) {
          return failure('lsp', 'semantic session is closed', 'NOT_READY');
        }
        try {
          const active = await runtime();
          let result: Result<Value, DomainError>;
          if (active._tag === 'Err') result = active;
          else if (activeSnapshotIdentity !== undefined && queryInput.snapshotIdentity !== activeSnapshotIdentity) {
            result = failure('snapshot_identity', 'semantic query is bound to a different source/configuration generation', 'NOT_READY');
          } else {
            const source = active.value.files.get(queryInput.repoPath);
            const languageId = languageIdForPath(queryInput.repoPath, options.languageIds);
            if (source === undefined || languageId === undefined) {
              result = failure('repo_path', 'source file has no configured LSP document', 'UNSUPPORTED_PROVIDER');
            } else if (!Number.isSafeInteger(queryInput.line) || queryInput.line < 1
              || !Number.isSafeInteger(queryInput.column) || queryInput.column < 1) {
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
        } finally {
          releaseOperation();
        }
      },
      catch: (cause) => domainError(
        'EXTERNAL_UNAVAILABLE',
        'lsp',
        cause instanceof Error ? cause.message : 'LSP provider request failed',
      ),
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
        const releaseOperation = beginOperation();
        if (releaseOperation === undefined) {
          return failure('lsp', 'semantic session is closed', 'NOT_READY');
        }
        try {
          const active = await runtime();
          let result: Result<readonly SemanticDiagnostic[], DomainError>;
          if (active._tag === 'Err') result = active;
          else if (languageIdForPath(input.repoPath, options.languageIds) === undefined
            || !active.value.files.has(input.repoPath)) {
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
              result = failure(
                'lsp.diagnostics',
                cause instanceof Error ? cause.message : 'LSP diagnostics request failed',
              );
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
        } finally {
          releaseOperation();
        }
      },
      catch: (cause) => domainError(
        'EXTERNAL_UNAVAILABLE',
        'lsp.diagnostics',
        cause instanceof Error ? cause.message : 'LSP diagnostics failed',
      ),
    })),
    close: (): Promise<void> => {
      if (sessionClosePromise !== undefined) return sessionClosePromise;
      closed = true;
      sessionClosePromise = (async () => {
        await waitForOperations();
        const pending = runtimePromise;
        runtimePromise = undefined;
        if (pending === undefined) return;
        const active = await pending;
        if (active._tag === 'Ok') await active.value.close();
      })();
      return sessionClosePromise;
    },
    refresh: (nextFiles: Readonly<Record<string, string>>, snapshotIdentity: string): Effect.Effect<Result<void, DomainError>> => recoverResult(Effect.tryPromise({
      try: async () => {
        const releaseOperation = beginOperation();
        if (releaseOperation === undefined) return failure('lsp', 'semantic session is closed', 'NOT_READY');
        try {
          const active = await runtime();
          if (active._tag === 'Err') return active;
          const updated = await active.value.updateFiles(nextFiles);
          if (updated._tag === 'Err') {
            await active.value.close();
            runtimePromise = undefined;
            return updated;
          }
          activeFiles = { ...nextFiles };
          activeSnapshotIdentity = snapshotIdentity;
          return ok(undefined);
        } finally {
          releaseOperation();
        }
      },
      catch: (cause) => domainError('EXTERNAL_UNAVAILABLE', 'lsp.refresh', cause instanceof Error ? cause.message : 'LSP refresh failed'),
    })),
  };
};
