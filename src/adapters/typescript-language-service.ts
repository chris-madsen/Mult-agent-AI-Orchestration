import { resolve } from 'node:path';
import type ts from 'typescript';
import type { ProviderTraceSink, SemanticAnalysisPort } from '../application/ports.js';
import { makeLspSemanticAnalysisPort } from './lsp-semantic.js';

/** Backward-compatible factory backed by the maintained LSP client. */
export interface TypeScriptLanguageServiceOptions {
  readonly rootPath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly compilerOptions?: ts.CompilerOptions;
  readonly providerVersion?: string;
  readonly snapshotIdentity?: string;
  readonly timeoutMs?: number;
  readonly trace?: ProviderTraceSink;
}

export const makeTypeScriptLanguageServicePort = (
  options: TypeScriptLanguageServiceOptions,
): SemanticAnalysisPort & { readonly close: () => void } => {
  const port = makeLspSemanticAnalysisPort({
    command: process.env.ACE_LSP_COMMAND?.trim() || resolve('node_modules/.bin/typescript-language-server'),
    rootPath: options.rootPath,
    files: options.files,
    keepProcessAlive: false,
    ...(options.providerVersion === undefined ? {} : { providerVersion: options.providerVersion }),
    ...(options.snapshotIdentity === undefined ? {} : { snapshotIdentity: options.snapshotIdentity }),
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.trace === undefined ? {} : { trace: options.trace }),
  });
  // Keep one LSP session for the lifetime of the compatibility port so a
  // caller can issue definition, references and hover queries consistently.
  // The child is explicitly unref'ed by the generic client, so short-lived
  // legacy callers do not keep the host process alive; callers that retain the
  // port can still close it explicitly.
  return {
    definition: port.definition,
    references: port.references,
    typeInfo: port.typeInfo,
    diagnostics: port.diagnostics,
    close: port.close,
  };
};
