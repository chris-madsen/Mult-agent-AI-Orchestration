import { extname } from 'node:path';
import { Effect } from 'effect';
import { domainError } from '../../domain/errors.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { DomainError } from '../../domain/errors.js';
import type { SemanticAnalysisPort } from '../ports.js';
import type { LspRegistrySession } from './server-registry.js';

/** Thin, extension-scoped routing; Claw server registry owns sessions. */
export interface LspRoute {
  readonly languageIds: Readonly<Record<string, string>>;
  readonly session: LspRegistrySession;
}

export const makeRoutedLspSession = (routes: readonly LspRoute[]): LspRegistrySession => {
  const selected = (repoPath: string): LspRegistrySession | undefined => {
    const extension = extname(repoPath).toLocaleLowerCase();
    return routes.find((route) => route.languageIds[extension] !== undefined)?.session;
  };
  const unavailable = <T>(): Effect.Effect<Result<T, DomainError>> =>
    Effect.succeed(err(domainError('UNSUPPORTED_PROVIDER', 'lsp.route', 'no configured LSP serves this file extension')));
  const routed: SemanticAnalysisPort = {
    definition: (input) => selected(input.repoPath)?.definition(input) ?? unavailable(),
    references: (input) => selected(input.repoPath)?.references(input) ?? unavailable(),
    typeInfo: (input) => selected(input.repoPath)?.typeInfo(input) ?? unavailable(),
    diagnostics: (input) => selected(input.repoPath)?.diagnostics(input) ?? unavailable(),
  };
  return {
    ...routed,
    // Session lifecycle is owned by the underlying LspServerRegistry leases.
    // Do not introduce a second shutdown owner in the routed façade.
    close: () => undefined,
    refresh: (files, snapshotIdentity) => Effect.promise(async () => {
      for (const route of routes) {
        const result = await Effect.runPromise(route.session.refresh(files, snapshotIdentity));
        if (result._tag === 'Err') return result;
      }
      return ok(undefined);
    }),
  };
};
