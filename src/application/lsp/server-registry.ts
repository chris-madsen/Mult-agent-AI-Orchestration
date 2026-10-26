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

export interface LspServerRegistry {
  readonly acquire: <Session extends LspRegistrySession>(
    key: string,
    create: () => Session,
  ) => Effect.Effect<Result<LspRegistryLease<Session>, DomainError>>;
  readonly close: () => Effect.Effect<void>;
}

interface Entry {
  readonly session: LspRegistrySession;
  refs: number;
}

export const makeLspServerRegistry = (): LspServerRegistry => {
  const entries = new Map<string, Entry>();
  let closed = false;
  return {
    acquire: <Session extends LspRegistrySession>(key: string, create: () => Session) => Effect.sync(() => {
      if (closed) return err(domainError('NOT_READY', 'lsp_registry', 'LSP server registry is closed'));
      let entry = entries.get(key);
      if (entry === undefined) {
        try {
          entry = { session: create(), refs: 0 };
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
          entry!.refs -= 1;
          if (entry!.refs <= 0) {
            entry!.session.close();
            entries.delete(key);
          }
        },
      });
    }),
    close: () => Effect.sync(() => {
      if (closed) return;
      closed = true;
      for (const entry of entries.values()) entry.session.close();
      entries.clear();
    }),
  };
};
