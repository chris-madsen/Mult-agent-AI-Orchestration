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
}

export interface AstGrepNapiOptions {
  readonly providerVersion?: string;
}

export const supportsAstGrepNapiPath = (repoPath: string): boolean => languageFor(repoPath) !== undefined;

const languageFor = (repoPath: string): { readonly language: string; readonly parser: Lang } | undefined => {
  const language = structuralLanguageForPath(repoPath)?.language;
  switch (language) {
    case 'javascript': return { language, parser: Lang.JavaScript };
    case 'typescript': return { language, parser: Lang.TypeScript };
    case 'tsx': return { language, parser: Lang.Tsx };
    case 'css': return { language, parser: Lang.Css };
    case 'html': return { language, parser: Lang.Html };
    default: return undefined;
  }
};

const kindFor = (nodeKind: string): StructuralKind | undefined => {
  switch (nodeKind) {
    case 'class_declaration': return 'class';
    case 'function_declaration':
    case 'function_expression':
    case 'arrow_function': return 'function';
    case 'interface_declaration': return 'interface';
    case 'type_alias_declaration': return 'type';
    case 'enum_declaration': return 'enum';
    case 'method_definition': return 'method';
    case 'import_statement': return 'import';
    case 'export_statement': return 'export';
    default: return undefined;
  }
};

const nameKinds = new Set(['identifier', 'type_identifier', 'property_identifier', 'namespace_identifier']);

const findName = (node: NapiNode): NapiNode | undefined => {
  for (const child of node.namedChildren()) {
    if (nameKinds.has(child.kind()) && /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(child.text())) return child;
    const nested = findName(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const isExported = (node: NapiNode): boolean =>
  node.ancestors().some((ancestor) => ancestor.kind() === 'export_statement');

const toSymbol = (
  node: NapiNode,
  language: string,
): StructuralSymbol | undefined => {
  const kind = kindFor(node.kind());
  if (kind === undefined) return undefined;
  const range = node.range();
  const nameNode = kind === 'import' || kind === 'export' ? undefined : findName(node);
  const name = nameNode?.text() ?? node.text().split(/\s+/u)[0] ?? node.kind();
  const nameRange = nameNode?.range();
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

export const makeAstGrepNapiStructuralPort = (
  options: AstGrepNapiOptions = {},
): StructuralAnalysisPort => ({
  extract: (input) => Effect.sync((): Result<StructuralAnalysis, DomainError> => {
    try {
      const language = languageFor(input.repoPath);
      if (language === undefined) {
        return err(domainError(
          'UNSUPPORTED_PROVIDER',
          'ast_grep_napi.language',
          `ast-grep NAPI does not provide a parser for ${input.repoPath}`,
        ));
      }
      const source = Buffer.from(input.source).toString('utf8');
      const root = parse(language.parser, source).root() as unknown as NapiNode;
      const symbols: StructuralSymbol[] = [];
      let hasSyntaxErrors = false;
      const visit = (node: NapiNode): void => {
        if (node.kind() === 'ERROR' || node.kind() === 'MISSING') hasSyntaxErrors = true;
        const symbol = toSymbol(node, language.language);
        if (symbol !== undefined) symbols.push(symbol);
        for (const child of node.namedChildren()) visit(child);
      };
      visit(root);
      const digest = makeContentDigest(createHash('sha256').update(input.source).digest('hex'));
      if (digest._tag === 'Err') return digest;
      const analyzed = makeStructuralAnalysis({
        repoPath: input.repoPath,
        sourceDigest: digest.value,
        symbols: symbols.sort((left, right) => left.startByteOffset! - right.startByteOffset! || left.endByteOffset! - right.endByteOffset!),
        hasSyntaxErrors,
      });
      return analyzed;
    } catch (cause) {
      return err(domainError(
        'UNSUPPORTED_PROVIDER',
        'ast_grep_napi',
        cause instanceof Error ? cause.message : `ast-grep NAPI ${options.providerVersion ?? 'unknown'} failed`,
      ));
    }
  }),
});
