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
    case 'property_signature': return 'field';
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
  node.kind() === 'export_statement' || node.ancestors()[0]?.kind() === 'export_statement';

const utf16ToUtf8ByteOffsets = (source: string): readonly number[] => {
  const offsets = new Array<number>(source.length + 1).fill(-1);
  let utf16Offset = 0;
  let utf8Offset = 0;
  offsets[0] = 0;
  for (const char of source) {
    const utf16Width = char.length;
    const utf8Width = Buffer.byteLength(char, 'utf8');
    utf16Offset += utf16Width;
    utf8Offset += utf8Width;
    offsets[utf16Offset] = utf8Offset;
  }
  return offsets;
};

const nodeSymbol = (
  node: NapiNode,
  language: string,
  toBytePosition: (position: NapiRange['start']) => {
    readonly line: number;
    readonly column: number;
    readonly offset: number;
  },
): StructuralSymbol | undefined => {
  if (node.kind() === 'export_statement') return undefined;
  let kind = declarationKind(node.kind());
  let nameNode = node.field('name');

  if (node.kind() === 'property_identifier' && node.ancestors().some((ancestor) => ancestor.kind() === 'enum_body')) {
    kind = 'enum_variant';
    nameNode = node;
  }

  // Attribute "const retry = (...) => ..." to the declarator, not to the
  // first identifier in the arrow's parameters/body.
  if (node.kind() === 'variable_declarator') {
    const value = node.field('value');
    if (value === null || !['arrow_function', 'function_expression'].includes(value.kind())) return undefined;
    kind = 'function';
    nameNode = node.field('name');
  }

  if (kind === undefined) return undefined;
  const exportAncestor = node.ancestors()[0]?.kind() === 'export_statement'
    ? node.ancestors()[0]
    : undefined;
  const range = (exportAncestor ?? node).range();
  const named = isIdentifier(nameNode) ? nameNode : undefined;
  const name = kind === 'import' || kind === 'export'
    ? node.text().split(/\s+/u)[0] ?? node.kind()
    : named?.text();
  if (name === undefined || name.length === 0) return undefined;
  const start = toBytePosition(range.start);
  const end = toBytePosition(range.end);
  const nameRange = named?.range();
  const nameStart = nameRange === undefined ? undefined : toBytePosition(nameRange.start);
  const nameEnd = nameRange === undefined ? undefined : toBytePosition(nameRange.end);

  return {
    name,
    kind,
    providerKind: node.kind(),
    language,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    startByteOffset: start.offset,
    endByteOffset: end.offset,
    ...(nameStart === undefined || nameEnd === undefined ? {} : {
      nameStartLine: nameStart.line,
      nameStartColumn: nameStart.column,
      nameEndLine: nameEnd.line,
      nameEndColumn: nameEnd.column,
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

    const sourceBytes = Buffer.from(input.source);
    const sourceText = sourceBytes.toString('utf8');
    const root = parse(language.parser, sourceText).root() as unknown as NapiNode;
    // ast-grep NAPI's JS-facing `range().index` is a UTF-16 code-unit offset
    // (the Rust binding divides its internal JsDoc byte offset by two). ACE's
    // contracts use UTF-8 byte offsets/columns, so normalize every boundary.
    const utf16ToUtf8 = utf16ToUtf8ByteOffsets(sourceText);
    const lineStarts = [0];
    for (let offset = 0; offset < sourceBytes.length; offset += 1) {
      if (sourceBytes[offset] === 10) lineStarts.push(offset + 1);
    }
    const toBytePosition = (position: NapiRange['start']) => {
      const offset = utf16ToUtf8[position.index];
      const lineStart = lineStarts[position.line];
      if (offset === undefined || offset < 0 || lineStart === undefined || offset < lineStart) {
        throw new Error('ast-grep NAPI returned a position that cannot be mapped to UTF-8 bytes');
      }
      return { line: position.line + 1, column: offset - lineStart + 1, offset };
    };
    const symbols: StructuralSymbol[] = [];
    let hasSyntaxErrors = false;
    const visit = (node: NapiNode): void => {
      if (node.kind() === 'ERROR' || node.kind() === 'MISSING') hasSyntaxErrors = true;
      const symbol = nodeSymbol(node, language.language, toBytePosition);
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
