import { Effect } from 'effect';
import { domainError, type DomainError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { SemanticAnalysisPort } from '../ports.js';

export interface LspRegistrySession extends SemanticAnalysisPort {
  readonly close: () => void;
  readonly refresh: (
    files: Readonly<Record<string, string>>,
    snapshotIdentity: string,
  ) => Effect.Effect<Result<void, DomainError>>;
}

export interface LspRegistryLease<Session extends LspRegistrySession = LspRegistrySession> {
  readonly session: Session;
  readonly release: () => void;
}

export interface LspServerDescriptor {
  readonly key: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly serverName: string;
  readonly languageIds?: Readonly<Record<string, string>>;
}

export interface LspRegistryStatus {
  readonly descriptor: LspServerDescriptor;
  readonly refs: number;
  readonly state: 'ready';
}

export interface LspServerRegistry {
  readonly acquire: <Session extends LspRegistrySession>(
    descriptor: LspServerDescriptor,
    create: () => Session,
  ) => Effect.Effect<Result<LspRegistryLease<Session>, DomainError>>;
  readonly inspect: () => readonly LspRegistryStatus[];
  readonly close: () => Effect.Effect<void>;
}

interface Entry {
  readonly descriptor: LspServerDescriptor;
  readonly session: LspRegistrySession;
  refs: number;
}

export const makeLspServerRegistry = (): LspServerRegistry => {
  const entries = new Map<string, Entry>();
  let closed = false;
  return {
    acquire: <Session extends LspRegistrySession>(descriptor: LspServerDescriptor, create: () => Session) => Effect.sync(() => {
      if (closed) return err(domainError('NOT_READY', 'lsp_registry', 'LSP server registry is closed'));
      if (descriptor.key.trim().length === 0) return err(domainError('INVALID_INPUT', 'lsp_registry.key', 'LSP server descriptor key is required'));
      const key = descriptor.key;
      let entry = entries.get(key);
      if (entry === undefined) {
        try {
          entry = { descriptor, session: create(), refs: 0 };
          entries.set(key, entry);
        } catch (cause) {
          return err(domainError(
            'UNSUPPORTED_PROVIDER',
            'lsp_registry',
            cause instanceof Error ? cause.message : 'LSP server factory failed',
          ));
        }
      }
      entry.refs += 1;
      let released = false;
      return ok({
        session: entry.session as Session,
        release: (): void => {
          if (released) return;
          released = true;
          // Registry-wide shutdown already closed the session. A delayed
          // lease release must not close it twice (or delete a replacement).
          if (entries.get(key) !== entry) return;
          entry!.refs -= 1;
          if (entry!.refs <= 0) {
            entry!.session.close();
            entries.delete(key);
          }
        },
      });
    }),
    inspect: () => [...entries.values()].map((entry) => ({
      descriptor: entry.descriptor,
      refs: entry.refs,
      state: 'ready' as const,
    })),
    close: () => Effect.sync(() => {
      if (closed) return;
      closed = true;
      for (const entry of entries.values()) entry.session.close();
      entries.clear();
    }),
  };
};
