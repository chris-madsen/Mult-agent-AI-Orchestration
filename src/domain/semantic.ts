import type { DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { ContentDigest } from './workspace.js';

export type StructuralKind =
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'enum'
  | 'method'
  | 'struct'
  | 'trait'
  | 'impl'
  | 'module'
  | 'field'
  | 'enum_variant'
  | 'import'
  | 'export'
  | 'unknown';

export interface StructuralSymbol {
  readonly name: string;
  readonly kind: StructuralKind;
  /** Provider-native node kind; never used as a semantic identity. */
  readonly providerKind?: string;
  /** Canonical language name reported by the structural provider. */
  readonly language?: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  /** Optional exact byte offsets supplied by a structural provider. */
  readonly startByteOffset?: number;
  readonly endByteOffset?: number;
  /** Exact identifier-node location; columns are UTF-8 bytes, one-based. */
  readonly nameStartLine?: number;
  readonly nameStartColumn?: number;
  readonly nameEndLine?: number;
  readonly nameEndColumn?: number;
  readonly isImport?: boolean;
  readonly isExported?: boolean;
}

export interface StructuralIdentifier {
  readonly name: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly startByteOffset: number;
  readonly endByteOffset: number;
}

export interface StructuralScope {
  readonly startLine: number;
  readonly endLine: number;
}

export interface StructuralAnalysis {
  readonly repoPath: string;
  readonly sourceDigest: ContentDigest;
  readonly symbols: readonly StructuralSymbol[];
  /** Identifier occurrences emitted by the same official structural provider. */
  readonly identifiers?: readonly StructuralIdentifier[];
  /** Parent header scopes from the SAME native tree parse, not a second pass. */
  readonly scopes?: readonly StructuralScope[];
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

const kinds: ReadonlySet<string> = new Set([
  'class', 'function', 'interface', 'type', 'enum', 'method', 'struct', 'trait',
  'impl', 'module', 'field', 'enum_variant', 'import', 'export', 'unknown',
]);

export const makeStructuralAnalysis = (input: {
  readonly repoPath: unknown;
  readonly sourceDigest: unknown;
  readonly symbols: readonly StructuralSymbol[];
  readonly identifiers?: readonly StructuralIdentifier[];
  readonly scopes?: readonly StructuralScope[];
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
    const byteOffsets = [symbol.startByteOffset, symbol.endByteOffset];
    const suppliedByteOffsets = byteOffsets.filter((value) => value !== undefined);
    if (suppliedByteOffsets.length !== 0
      && (suppliedByteOffsets.length !== 2
        || !suppliedByteOffsets.every((value) => Number.isSafeInteger(value) && (value as number) >= 0)
        || (symbol.endByteOffset as number) <= (symbol.startByteOffset as number))) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}].byte_range`, message: 'structural byte range must be complete and increasing' });
    }
    if (symbol.providerKind !== undefined && symbol.providerKind.trim().length === 0) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}].provider_kind`, message: 'provider kind must not be empty' });
    }
    if (symbol.language !== undefined && symbol.language.trim().length === 0) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}].language`, message: 'structural language must not be empty' });
    }
    if (![symbol.startLine, symbol.startColumn, symbol.endLine, symbol.endColumn].every((value) => Number.isSafeInteger(value) && value >= 1)) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}]`, message: 'invalid structural range' });
    }
    const nameCoordinates = [symbol.nameStartLine, symbol.nameStartColumn, symbol.nameEndLine, symbol.nameEndColumn];
    const suppliedNameCoordinates = nameCoordinates.filter((value) => value !== undefined);
    if (suppliedNameCoordinates.length !== 0
      && (suppliedNameCoordinates.length !== 4
        || !suppliedNameCoordinates.every((value) => Number.isSafeInteger(value) && (value as number) >= 1))) {
      return err({ code: 'INVALID_RETRIEVAL', path: `symbols[${index}].name_range`, message: 'structural name range must be complete and positive' });
    }
  }
  for (const [index, identifier] of (input.identifiers ?? []).entries()) {
    if (identifier.name.trim().length === 0) {
      return err({ code: 'INVALID_RETRIEVAL', path: `identifiers[${index}]`, message: 'structural identifier name is required' });
    }
    if (![identifier.startLine, identifier.startColumn, identifier.endLine, identifier.endColumn].every(
      (value) => Number.isSafeInteger(value) && value >= 1,
    )) {
      return err({ code: 'INVALID_RETRIEVAL', path: `identifiers[${index}]`, message: 'invalid structural identifier range' });
    }
    if (identifier.endLine < identifier.startLine
      || (identifier.endLine === identifier.startLine && identifier.endColumn <= identifier.startColumn)) {
      return err({ code: 'INVALID_RETRIEVAL', path: `identifiers[${index}]`, message: 'structural identifier source range must increase' });
    }
    if (![identifier.startByteOffset, identifier.endByteOffset].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) || identifier.endByteOffset <= identifier.startByteOffset) {
      return err({ code: 'INVALID_RETRIEVAL', path: `identifiers[${index}].byte_range`, message: 'structural identifier byte range must increase' });
    }
  }
  for (const [index, scope] of (input.scopes ?? []).entries()) {
    if (!Number.isSafeInteger(scope.startLine) || !Number.isSafeInteger(scope.endLine)
      || scope.startLine < 1 || scope.endLine < scope.startLine) {
      return err({ code: 'INVALID_RETRIEVAL', path: `scopes[${index}]`, message: 'invalid structural scope' });
    }
  }
  return ok({
    repoPath: input.repoPath.trim(),
    sourceDigest: input.sourceDigest as ContentDigest,
    symbols: input.symbols.map((symbol) => ({ ...symbol })),
    ...(input.identifiers === undefined
      ? {}
      : { identifiers: input.identifiers.map((identifier) => ({ ...identifier })) }),
    ...(input.scopes === undefined ? {} : { scopes: input.scopes.map((scope) => ({ ...scope })) }),
    hasSyntaxErrors: input.hasSyntaxErrors,
  });
};
