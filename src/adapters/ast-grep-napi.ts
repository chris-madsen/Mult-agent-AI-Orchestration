import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { Lang, parse } from '@ast-grep/napi';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, type Result } from '../domain/result.js';
import { makeStructuralAnalysis, type StructuralAnalysis, type StructuralKind, type StructuralSymbol } from '../domain/semantic.js';
import { makeContentDigest } from '../domain/workspace.js';
import type { StructuralAnalysisPort } from '../application/ports.js';
import { structuralLanguageForPath } from '../domain/structural-language.js';

interface NapiRange {
  readonly start: { readonly line: number; readonly column: number; readonly index: number };
  readonly end: { readonly line: number; readonly column: number; readonly index: number };
}
interface NapiNode {
  readonly kind: () => string;
  readonly text: () => string;
  readonly range: () => NapiRange;
  readonly namedChildren: () => readonly NapiNode[];
  readonly ancestors: () => readonly NapiNode[];
  readonly field: (name: string) => NapiNode | null;
}
const languageFor = (repoPath: string): { readonly language: string; readonly parser: Lang } | undefined => {
  const language = structuralLanguageForPath(repoPath)?.language;
  switch (language) {
    case 'javascript': return { language, parser: Lang.JavaScript };
    case 'typescript': return { language, parser: Lang.TypeScript };
    case 'tsx': return { language, parser: Lang.Tsx };
    // Keep auto mode on the CLI for languages whose NAPI grammar is available
    // but whose symbol extractor below has not reached outline parity yet.
    // Treating parseability as symbol-extraction support silently drops code.
    default: return undefined;
  }
};

export const supportsAstGrepNapiPath = (repoPath: string): boolean => languageFor(repoPath) !== undefined;

const declarationKind = (nodeKind: string): StructuralKind | undefined => {
  switch (nodeKind) {
    case 'class_declaration': return 'class';
    case 'function_declaration': return 'function';
    case 'interface_declaration': return 'interface';
    case 'type_alias_declaration': return 'type';
    case 'enum_declaration': return 'enum';
    case 'method_definition':
    case 'method_signature': return 'method';
    case 'import_statement': return 'import';
    case 'export_statement': return 'export';
    default: return undefined;
  }
};

const isIdentifier = (node: NapiNode | null | undefined): node is NapiNode =>
  node !== null && node !== undefined
  && ['identifier', 'type_identifier', 'property_identifier', 'namespace_identifier'].includes(node.kind())
  && /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(node.text());

const isExported = (node: NapiNode): boolean =>
  node.kind() === 'export_statement' || node.ancestors().some((ancestor) => ancestor.kind() === 'export_statement');

const nodeSymbol = (node: NapiNode, language: string): StructuralSymbol | undefined => {
  let kind = declarationKind(node.kind());
  let nameNode = node.field('name');

  // Attribute "const retry = (...) => ..." to the declarator, not to the
  // first identifier in the arrow's parameters/body.
  if (node.kind() === 'variable_declarator') {
    const value = node.field('value');
    if (value === null || !['arrow_function', 'function_expression'].includes(value.kind())) return undefined;
    kind = 'function';
    nameNode = node.field('name');
  }

  if (kind === undefined) return undefined;
  const range = node.range();
  const named = isIdentifier(nameNode) ? nameNode : undefined;
  const name = kind === 'import' || kind === 'export'
    ? node.text().split(/\s+/u)[0] ?? node.kind()
    : named?.text();
  if (name === undefined || name.length === 0) return undefined;
  const nameRange = named?.range();

  return {
    name,
    kind,
    providerKind: node.kind(),
    language,
    startLine: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
    startByteOffset: range.start.index,
    endByteOffset: range.end.index,
    ...(nameRange === undefined ? {} : {
      nameStartLine: nameRange.start.line + 1,
      nameStartColumn: nameRange.start.column + 1,
      nameEndLine: nameRange.end.line + 1,
      nameEndColumn: nameRange.end.column + 1,
    }),
    ...(isExported(node) ? { isExported: true } : {}),
    ...(kind === 'import' ? { isImport: true } : {}),
  };
};

const extractOne = (
  input: { readonly repoPath: string; readonly source: Uint8Array },
): Result<StructuralAnalysis, DomainError> => {
  try {
    const language = languageFor(input.repoPath);
    if (language === undefined) {
      return err(domainError(
        'UNSUPPORTED_PROVIDER',
        'ast_grep_napi.language',
        `ast-grep NAPI built-ins do not provide a parser for ${input.repoPath}`,
      ));
    }

    const root = parse(language.parser, Buffer.from(input.source).toString('utf8')).root() as unknown as NapiNode;
    const symbols: StructuralSymbol[] = [];
    let hasSyntaxErrors = false;
    const visit = (node: NapiNode): void => {
      if (node.kind() === 'ERROR' || node.kind() === 'MISSING') hasSyntaxErrors = true;
      const symbol = nodeSymbol(node, language.language);
      if (symbol !== undefined) symbols.push(symbol);
      for (const child of node.namedChildren()) visit(child);
    };
    visit(root);

    const digest = makeContentDigest(createHash('sha256').update(input.source).digest('hex'));
    if (digest._tag === 'Err') return digest;
    return makeStructuralAnalysis({
      repoPath: input.repoPath,
      sourceDigest: digest.value,
      symbols: symbols.sort((left, right) =>
        (left.startByteOffset ?? 0) - (right.startByteOffset ?? 0)
        || (left.endByteOffset ?? 0) - (right.endByteOffset ?? 0)),
      hasSyntaxErrors,
    });
  } catch (cause) {
    return err(domainError(
      'UNSUPPORTED_PROVIDER',
      'ast_grep_napi',
      cause instanceof Error ? cause.message : 'ast-grep NAPI failed',
    ));
  }
};

export const makeAstGrepNapiStructuralPort = (): StructuralAnalysisPort => ({
  extract: (input) => Effect.sync(() => extractOne(input)),
  extractMany: (inputs) => Effect.sync(() => inputs.map(extractOne)),
});
