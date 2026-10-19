import path from 'node:path';
import ts from 'typescript';
import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import type { SemanticAnalysisPort, SemanticQuery } from '../application/ports.js';
import type {
  SemanticDefinition,
  SemanticDiagnostic,
  SemanticLocation,
  SemanticReference,
} from '../domain/semantic.js';

export interface TypeScriptLanguageServiceOptions {
  readonly rootPath: string;
  readonly files: Readonly<Record<string, string>>;
  readonly compilerOptions?: ts.CompilerOptions;
}

const failure = (pathName: string, message: string): Result<never, DomainError> =>
  err(domainError('INVALID_INPUT', pathName, message));

const category = (value: ts.DiagnosticCategory): SemanticDiagnostic['category'] => {
  if (value === ts.DiagnosticCategory.Error) return 'error';
  if (value === ts.DiagnosticCategory.Warning) return 'warning';
  if (value === ts.DiagnosticCategory.Suggestion) return 'suggestion';
  return 'message';
};

const flattenMessage = (message: string | ts.DiagnosticMessageChain): string =>
  typeof message === 'string' ? message : ts.flattenDiagnosticMessageText(message, '\n');

const makeService = (options: TypeScriptLanguageServiceOptions): {
  readonly service: ts.LanguageService;
  readonly files: ReadonlyMap<string, string>;
} => {
  const files = new Map(Object.entries(options.files).map(([repoPath, source]) => [path.resolve(options.rootPath, repoPath), source]));
  const versions = new Map([...files.keys()].map((fileName) => [fileName, '1']));
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options.compilerOptions ?? {
      strict: true,
      allowJs: true,
      checkJs: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (fileName) => versions.get(path.resolve(fileName)) ?? '0',
    getScriptSnapshot: (fileName) => {
      const absolute = path.resolve(fileName);
      const source = files.get(absolute) ?? ts.sys.readFile(absolute);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => options.rootPath,
    getDefaultLibFileName: (config) => ts.getDefaultLibFilePath(config),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };
  return { service: ts.createLanguageService(host), files };
};

const validateQuery = (query: SemanticQuery, files: ReadonlyMap<string, string>, rootPath: string): Result<{ readonly fileName: string; readonly position: number }, DomainError> => {
  if (query.line < 1 || query.column < 1 || !Number.isSafeInteger(query.line) || !Number.isSafeInteger(query.column)) return failure('position', 'line and column must be positive integers');
  const fileName = path.resolve(rootPath, query.repoPath);
  const source = files.get(fileName);
  if (source === undefined) return failure('repo_path', 'source file is not included in the language-service project');
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const position = ts.getPositionOfLineAndCharacter(sourceFile, query.line - 1, query.column - 1);
  return ok({ fileName, position });
};

const locationFromSpan = (rootPath: string, files: ReadonlyMap<string, string>, fileName: string, span: ts.TextSpan): SemanticLocation | undefined => {
  const source = files.get(path.resolve(fileName));
  if (source === undefined) return undefined;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const start = sourceFile.getLineAndCharacterOfPosition(span.start);
  const end = sourceFile.getLineAndCharacterOfPosition(span.start + span.length);
  return { repoPath: path.relative(rootPath, fileName).split(path.sep).join('/'), startLine: start.line + 1, startColumn: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 };
};

const withQuery = <Value>(
  options: TypeScriptLanguageServiceOptions,
  runtime: ReturnType<typeof makeService>,
  query: SemanticQuery,
  operation: (service: ts.LanguageService, fileName: string, position: number, files: ReadonlyMap<string, string>) => Result<Value, DomainError>,
): Effect.Effect<Result<Value, DomainError>> => Effect.sync(() => {
    const { service, files } = runtime;
    const valid = validateQuery(query, files, options.rootPath);
    if (valid._tag === 'Err') return valid;
    return operation(service, valid.value.fileName, valid.value.position, files);
  });

export const makeTypeScriptLanguageServicePort = (options: TypeScriptLanguageServiceOptions): SemanticAnalysisPort => {
  // TypeScript LS creation is nontrivial; reuse the same immutable snapshot
  // for all semantic calls in one verified index generation.
  const runtime = makeService(options);
  return {
    definition: (query) => withQuery(options, runtime, query, (service, fileName, position, files) => {
      const definitions = service.getDefinitionAtPosition(fileName, position) ?? [];
      return ok(definitions.flatMap((item): SemanticDefinition[] => {
        const location = locationFromSpan(options.rootPath, files, item.fileName, item.textSpan);
        return location === undefined ? [] : [{ location, name: item.name, kind: item.kind }];
      }));
    }),
    references: (query) => withQuery(options, runtime, query, (service, fileName, position, files) => {
      const references = service.getReferencesAtPosition(fileName, position) ?? [];
      const definitions = service.getDefinitionAtPosition(fileName, position) ?? [];
      const declarationSpans = new Set(definitions.map((item) =>
        [path.resolve(item.fileName), item.textSpan.start, item.textSpan.length].join(':')));
      return ok(references.flatMap((item): SemanticReference[] => {
        const location = locationFromSpan(options.rootPath, files, item.fileName, item.textSpan);
        return location === undefined ? [] : [{ location, isDefinition: declarationSpans.has([path.resolve(item.fileName), item.textSpan.start, item.textSpan.length].join(':')) }];
      }));
    }),
    typeInfo: (query) => withQuery(options, runtime, query, (service, fileName, position) => {
      const info = service.getQuickInfoAtPosition(fileName, position);
      if (info === undefined) return ok(undefined);
      const display = ts.displayPartsToString(info.displayParts);
      const documentation = ts.displayPartsToString(info.documentation);
      return ok(documentation.length === 0 ? { display } : { display, documentation });
    }),
    diagnostics: ({ repoPath }) => Effect.sync(() => {
      const { service, files } = runtime;
      const fileName = path.resolve(options.rootPath, repoPath);
      if (!files.has(fileName)) return failure('repo_path', 'source file is not included in the language-service project');
      const diagnostics = [...service.getSyntacticDiagnostics(fileName), ...service.getSemanticDiagnostics(fileName)];
      return ok(diagnostics.map((diagnostic): SemanticDiagnostic => {
        const location = diagnostic.start === undefined || diagnostic.length === undefined
          ? undefined
          : locationFromSpan(options.rootPath, files, fileName, { start: diagnostic.start, length: diagnostic.length });
        return {
          ...(location === undefined ? {} : { location }),
          message: flattenMessage(diagnostic.messageText),
          category: category(diagnostic.category),
          code: diagnostic.code,
        };
      }));
    }),
  };
};
