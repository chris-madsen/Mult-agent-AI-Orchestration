import type { DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { ContentDigest } from './workspace.js';

export type StructuralKind = 'class' | 'function' | 'interface' | 'type' | 'enum' | 'method';

export interface StructuralSymbol {
  readonly name: string;
  readonly kind: StructuralKind;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface StructuralAnalysis {
  readonly repoPath: string;
  readonly sourceDigest: ContentDigest;
  readonly symbols: readonly StructuralSymbol[];
  readonly hasSyntaxErrors: boolean;
}

export interface SemanticLocation {
  readonly repoPath: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface SemanticDefinition {
  readonly location: SemanticLocation;
  readonly name?: string;
  readonly kind?: string;
}

export interface SemanticReference {
  readonly location: SemanticLocation;
  readonly isDefinition: boolean;
}

export interface SemanticTypeInfo {
  readonly display: string;
  readonly documentation?: string;
}

export interface SemanticDiagnostic {
  readonly location?: SemanticLocation;
  readonly message: string;
  readonly category: 'warning' | 'error' | 'suggestion' | 'message';
  readonly code: number;
}

const kinds: ReadonlySet<string> = new Set(['class', 'function', 'interface', 'type', 'enum', 'method']);

export const makeStructuralAnalysis = (input: {
  readonly repoPath: unknown;
  readonly sourceDigest: unknown;
  readonly symbols: readonly StructuralSymbol[];
  readonly hasSyntaxErrors: unknown;
}): Result<StructuralAnalysis, DomainError> => {
  if (typeof input.repoPath !== 'string' || input.repoPath.trim().length === 0) {
    return err({ code: 'INVALID_RETRIEVAL', path: 'repo_path', message: 'structural path is required' });
  }
  if (typeof input.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.sourceDigest)) {
    return err({ code: 'INVALID_RETRIEVAL', path: 'source_digest', message: 'structural source digest must be SHA-256' });
  }
  if (typeof input.hasSyntaxErrors !== 'boolean') {
    return err({ code: 'INVALID_RETRIEVAL', path: 'has_syntax_errors', message: 'syntax error status must be boolean' });
  }
  for (const [index, symbol] of input.symbols.entries()) {
    if (!kinds.has(symbol.kind) || symbol.name.trim().length === 0) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}]`, message: 'invalid structural symbol' });
    }
    if (![symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn].every((value) => Number.isSafeInteger(value) && value >= 1)) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}]`, message: 'invalid structural range' });
    }
  }
  return ok({ repoPath: input.repoPath.trim(), sourceDigest: input.sourceDigest as ContentDigest, symbols: input.symbols.map((symbol) => ({ ...symbol })), hasSyntaxErrors: input.hasSyntaxErrors });
};
