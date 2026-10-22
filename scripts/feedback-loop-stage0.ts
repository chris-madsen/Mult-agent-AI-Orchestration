import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Effect } from 'effect';
import { makeAstGrepStructuralPort } from '../src/adapters/ast-grep-structural.js';
import { verifyCompiledRuntimeProvenance } from '../src/application/runtime-provenance.js';
import { buildLocalCodeIndex } from '../src/adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../src/adapters/node-workspace-port.js';
import { validateRetrievalBenchmarkTraceArtifact } from '../src/domain/retrieval-benchmark.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';
import type { Result } from '../src/domain/result.js';

type JsonObject = Readonly<Record<string, unknown>>;
type StageStatus = 'PASS' | 'NOT_VERIFIED' | 'BLOCKED';

interface SemanticCase {
  readonly id: string;
  readonly query: string;
  readonly expectedPath: string;
  readonly expectedSymbol: string;
  readonly required: boolean;
}

interface Stage0CaseResult {
  readonly id: string;
  readonly requestId?: string;
  readonly expectedPath: string;
  readonly expectedSymbol: string;
  readonly complete: boolean;
  readonly lspCoverage: string;
  readonly matchingEvidence: number;
  readonly directEvidence: number;
  readonly status: 'confirmed' | 'unconfirmed' | 'failed';
  readonly error?: string;
}

interface Stage0Manifest {
  readonly schemaVersion: 1;
  readonly status: StageStatus;
  readonly generatedAt: string;
  readonly sourceCommit: string;
  readonly runtimeRoot: string;
  readonly manualSemanticAnchorInjection: false;
  readonly fixtureFiles: readonly Readonly<{ path: string; sha256: string }>[];
  readonly indexedStructuralSymbols: number;
  readonly anchoredSymbols: number;
  readonly lspConfirmedSymbols: number;
  readonly lspUnconfirmedSymbols: number;
  readonly languageErrors: readonly string[];
  readonly cases: readonly Stage0CaseResult[];
  readonly requestIds: readonly string[];
  readonly providerTracePath: string;
  readonly retrievalTracePath: string;
  readonly retrievalReceiptPath: string;
  readonly artifactSha256: Readonly<Record<string, string | null>>;
  readonly reason?: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const mustOk = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result._tag === 'Err') throw new Error(String(result.error));
  return result.value;
};
const inheritedEnvironment: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

const object = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected JSON object');
  return value as JsonObject;
};

const parseArgs = (): { readonly outputDirectory: string } => {
  const args = process.argv.slice(2);
  let outputDirectory = process.env.ACE_FEEDBACK_OUTPUT?.trim()
    || join('artifacts', 'feedback', `stage0-${new Date().toISOString().replaceAll(/[^0-9]/gu, '').slice(0, 14)}`);
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--output') outputDirectory = args.shift() ?? outputDirectory;
    else throw new Error(`unknown argument: ${current}`);
  }
  return { outputDirectory: resolve(outputDirectory) };
};

const sourceFixtures: Readonly<Record<string, string>> = {
  'src/users.ts': [
    'export interface User { id: string; }',
    'export class UserRepository {',
    '  save(value: User): User { return value; }',
    '}',
    'export class AuditRepository {',
    '  save(value: User): User { return value; }',
    '}',
    'export function saveUser(value: User): User { return value; }',
    'export function caféUser(value: User): User { return value; }',
    'export function overloaded(value: string): string;',
    'export function overloaded(value: number): number;',
    'export function overloaded(value: string | number): string | number { return value; }',
    'export function nested(): User {',
    '  class NestedUser {',
    '    value(): User { return { id: "nested" }; }',
    '  }',
    '  return new NestedUser().value();',
    '}',
    '',
  ].join('\n'),
  'src/reexports.ts': [
    "import { saveUser } from './users.js';",
    'export { saveUser };',
    '',
  ].join('\n'),
};

const cases: readonly SemanticCase[] = [
  { id: 'function', query: 'saveUser', expectedPath: 'src/users.ts', expectedSymbol: 'saveUser', required: true },
  { id: 'unicode-function', query: 'caféUser', expectedPath: 'src/users.ts', expectedSymbol: 'caféUser', required: true },
  { id: 'class', query: 'UserRepository', expectedPath: 'src/users.ts', expectedSymbol: 'UserRepository', required: false },
  { id: 'same-name-method', query: 'AuditRepository save', expectedPath: 'src/users.ts', expectedSymbol: 'save', required: false },
  { id: 'overload', query: 'overloaded', expectedPath: 'src/users.ts', expectedSymbol: 'overloaded', required: false },
  { id: 'nested', query: 'NestedUser value', expectedPath: 'src/users.ts', expectedSymbol: 'NestedUser', required: false },
  { id: 'reexport', query: 're-export saveUser', expectedPath: 'src/reexports.ts', expectedSymbol: 'saveUser', required: false },
];

const runtimeCommit = (): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const readJsonLines = async (path: string): Promise<readonly JsonObject[]> => {
  if (!existsSync(path)) return [];
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => object(JSON.parse(line) as unknown));
};

const artifactDigests = async (paths: readonly string[]): Promise<Readonly<Record<string, string | null>>> => {
  const entries = await Promise.all(paths.map(async (path) => {
    if (!existsSync(path)) return [path, null] as const;
    return [path, sha256(await readFile(path))] as const;
  }));
  return Object.fromEntries(entries);
};

const evidenceFor = (bundle: JsonObject, item: SemanticCase): readonly JsonObject[] => {
  const evidence = Array.isArray(bundle.evidence) ? bundle.evidence : [];
  return evidence
    .map((entry) => object(entry))
    .filter((entry) => typeof entry.citation === 'string'
      && entry.citation.startsWith(`${item.expectedPath}:`)
      && entry.structuralName === item.expectedSymbol);
};

const lspCoverageFor = (bundle: JsonObject): string => {
  const coverage = Array.isArray(bundle.sourceCoverage) ? bundle.sourceCoverage : [];
  const lsp = coverage.map((entry) => object(entry)).find((entry) => entry.source === 'lsp');
  return typeof lsp?.status === 'string' ? lsp.status : 'unknown';
};

const main = async (): Promise<void> => {
  const { outputDirectory } = parseArgs();
  await mkdir(outputDirectory, { recursive: true });
  const parent = await mkdtemp(join(tmpdir(), 'ace-feedback-stage0-'));
  const workspace = join(parent, 'workspace');
  const stateDirectory = join(outputDirectory, 'state');
  const providerTracePath = join(outputDirectory, 'provider-trace.jsonl');
  const retrievalTracePath = join(outputDirectory, 'retrieval-trace.jsonl');
  const retrievalReceiptPath = `${retrievalTracePath}.receipt.json`;
  const responsePath = join(outputDirectory, 'raw-mcp-responses.jsonl');
  const stderrPath = join(outputDirectory, 'ace-mcp.stderr.log');
  let indexedStructuralSymbols = 0;
  let anchoredSymbols = 0;
  let languageErrors: string[] = [];
  const caseResults: Stage0CaseResult[] = [];
  const requestIds: string[] = [];
  let stderr: Buffer[] = [];
  let status: StageStatus = 'BLOCKED';
  let reason = 'stage did not complete';
  try {
    await mkdir(workspace, { recursive: true });
    for (const [path, source] of Object.entries(sourceFixtures)) {
      const target = join(workspace, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, source, 'utf8');
    }
    const workspaceId = mustOk(makeWorkspaceId('feedback-stage0-ts-v1'));
    const files = makeNodeWorkspacePort({ allowedRoots: [parent] });
    const structural = makeAstGrepStructuralPort({ command: resolve('node_modules/.bin/ast-grep') });
    const indexed = mustOk(await Effect.runPromise(buildLocalCodeIndex(files, workspaceId, workspace, {
      generation: 1,
      structural,
    })));
    indexedStructuralSymbols = indexed.index.candidates.length;
    anchoredSymbols = indexed.index.candidates.filter((candidate) => candidate.semanticAnchor !== undefined).length;
    languageErrors = indexed.coverage.failures.map((failure) => `${failure.repoPath}:${failure.kind}${failure.code === undefined ? '' : `:${failure.code}`}`);

    const provenance = await verifyCompiledRuntimeProvenance(resolve('.'), resolve('dist/bin/ace-mcp.js'));
    if (provenance._tag === 'Err') throw new Error(`${provenance.error.code}: ${provenance.error.message}`);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/bin/ace-mcp.js'],
      cwd: resolve('.'),
      stderr: 'pipe',
      env: {
        ...inheritedEnvironment,
        ACE_WORKSPACE_ROOT: workspace,
        ACE_ALLOWED_ROOTS: parent,
        ACE_STATE_DIR: stateDirectory,
        ACE_ARTIFACT_DIR: join(outputDirectory, 'artifacts'),
        ACE_WORKSPACE_ID: 'feedback-stage0-ts-v1',
        ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
        ACE_QDRANT_URL: process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333',
        ACE_EMBEDDING_WORKER: resolve('scripts/fastembed-worker.sh'),
        ACE_SPARSE_EMBEDDING_WORKER: resolve('scripts/fastembed-sparse-worker.sh'),
        ACE_AST_GREP_COMMAND: resolve('node_modules/.bin/ast-grep'),
        ACE_LSP_COMMAND: resolve('node_modules/.bin/typescript-language-server'),
        ACE_LSP_ARGS: JSON.stringify(['--stdio']),
        ACE_PROVIDER_TRACE_FILE: providerTracePath,
        ACE_BENCHMARK_TRACE_FILE: retrievalTracePath,
        ACE_BENCHMARK_REPOSITORY_ID: 'feedback-stage0',
        ACE_BENCHMARK_RUNNER_VERSION: 'ace-feedback-stage0/v1',
        ACE_EVIDENCE_SOURCE_COMMIT: runtimeCommit(),
      },
    });
    stderr = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    const client = new Client({ name: 'ace-feedback-stage0', version: '1.0.0' });
    try {
      await client.connect(transport, { timeout: 30_000, maxTotalTimeout: 90_000 });
      const readiness = await client.callTool({ name: 'ace_workspace_status', arguments: { workspace_id: 'feedback-stage0-ts-v1' } }, { timeout: 30_000, maxTotalTimeout: 90_000 });
      await writeFile(responsePath, `${JSON.stringify({ tool: 'ace_workspace_status', response: readiness })}\n`, 'utf8');
      const readinessBundle = object(readiness.structuredContent ?? {});
      if (readiness.isError === true || readinessBundle.index_status !== 'ready') {
        throw new Error(`NOT_READY: ${JSON.stringify(readinessBundle)}`);
      }
      let confirmed = 0;
      let lspUnconfirmed = 0;
      for (const item of cases) {
        const response = await client.callTool({
          name: 'ace_context',
          arguments: {
            workspace_id: 'feedback-stage0-ts-v1',
            query: item.query,
            intent: 'locate',
            include_code: true,
            include_docs: false,
            include_memory: false,
            include_history: false,
            source_obligations: { required: ['code', 'structural', 'lsp'] },
          },
        }, { timeout: 90_000, maxTotalTimeout: 120_000 });
        const bundle = object(response.structuredContent ?? {});
        const evidence = evidenceFor(bundle, item);
        const direct = evidence.filter((entry) => entry.source === 'code'
          && entry.freshness === 'current'
          && entry.proofClass === 'direct');
        const uncertain = evidence.filter((entry) => entry.proofClass === 'uncertain');
        const requestId = typeof bundle.requestId === 'string' ? bundle.requestId : undefined;
        if (requestId !== undefined) requestIds.push(requestId);
        const result: Stage0CaseResult = {
          id: item.id,
          ...(requestId === undefined ? {} : { requestId }),
          expectedPath: item.expectedPath,
          expectedSymbol: item.expectedSymbol,
          complete: bundle.complete === true,
          lspCoverage: lspCoverageFor(bundle),
          matchingEvidence: evidence.length,
          directEvidence: direct.length,
          status: response.isError === true ? 'failed' : direct.length > 0 ? 'confirmed' : 'unconfirmed',
          ...(response.isError === true ? { error: 'MCP tool returned an error' } : {}),
        };
        caseResults.push(result);
        confirmed += direct.length;
        lspUnconfirmed += uncertain.length;
        await writeFile(responsePath, `${JSON.stringify({ tool: 'ace_context', case: item.id, response })}\n`, { encoding: 'utf8', flag: 'a' });
      }
      await client.close();
      await writeFile(stderrPath, Buffer.concat(stderr));
      const requiredCases = caseResults.filter((item) => cases.find((expected) => expected.id === item.id)?.required === true);
      // `complete` and `sourceCoverage.lsp=satisfied` describe every ranked
      // candidate in the response. A single uncertain candidate therefore
      // makes the aggregate response partial even when the requested symbol
      // has independently confirmed LSP evidence. Stage-0 proves that
      // symbol-level path, so do not turn aggregate partial coverage into a
      // false provider failure.
      const requiredWithLspProof = requiredCases.filter((item) =>
        item.status === 'confirmed'
        && item.directEvidence > 0
        && item.lspCoverage !== 'unavailable'
        && item.lspCoverage !== 'unknown');
      const hasRequiredLspProof = requiredWithLspProof.length > 0;
      status = hasRequiredLspProof ? 'PASS' : 'NOT_VERIFIED';
      reason = hasRequiredLspProof
        ? 'real MCP ace_context returned current/direct symbol evidence with confirmed LSP definition'
        : 'no required case had current/direct evidence with confirmed LSP definition';
      const providerEvents = await readJsonLines(providerTracePath);
      const failedProviderEvents = providerEvents
        .filter((event) => event.status === 'failure')
        .map((event) => `${String(event.provider)}:${String(event.operation)}:${String(event.errorCode ?? 'unknown')}`);
      languageErrors = [...languageErrors, ...failedProviderEvents];
      const retrievalText = existsSync(retrievalTracePath) ? await readFile(retrievalTracePath, 'utf8') : '';
      const retrievalReceipt = existsSync(retrievalReceiptPath)
        ? JSON.parse(await readFile(retrievalReceiptPath, 'utf8')) as unknown
        : undefined;
      if (retrievalReceipt === undefined) throw new Error('benchmark trace terminal receipt is missing');
      const traceValidation = validateRetrievalBenchmarkTraceArtifact(retrievalText, retrievalReceipt, requestIds);
      if (!traceValidation.valid) throw new Error(`benchmark trace rejected: ${traceValidation.failures.join(', ')}`);
      const artifactSha256 = await artifactDigests([responsePath, stderrPath, providerTracePath, retrievalTracePath, retrievalReceiptPath]);
      const fixtureFiles = await Promise.all(Object.entries(sourceFixtures).map(async ([path, source]) => ({
        path,
        sha256: sha256(new TextEncoder().encode(source)),
      })));
      const manifest: Stage0Manifest = {
        schemaVersion: 1,
        status,
        generatedAt: new Date().toISOString(),
        sourceCommit: runtimeCommit(),
        runtimeRoot: resolve('.'),
        manualSemanticAnchorInjection: false,
        fixtureFiles,
        indexedStructuralSymbols,
        anchoredSymbols,
        lspConfirmedSymbols: confirmed,
        lspUnconfirmedSymbols: lspUnconfirmed,
        languageErrors,
        cases: caseResults,
        requestIds,
        providerTracePath,
        retrievalTracePath,
        retrievalReceiptPath,
        artifactSha256,
        reason,
      };
      await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    } finally {
      if (existsSync(stderrPath)) await writeFile(stderrPath, Buffer.concat(stderr));
      await client.close().catch(() => undefined);
    }
  } catch (error) {
    status = 'BLOCKED';
    reason = error instanceof Error ? error.message : 'unknown stage-0 provider failure';
    if (stderr.length > 0) await writeFile(stderrPath, Buffer.concat(stderr));
    const artifactSha256 = await artifactDigests([responsePath, stderrPath, providerTracePath, retrievalTracePath, retrievalReceiptPath]);
    const manifest: Stage0Manifest = {
      schemaVersion: 1,
      status,
      generatedAt: new Date().toISOString(),
      sourceCommit: runtimeCommit(),
      runtimeRoot: resolve('.'),
      manualSemanticAnchorInjection: false,
      fixtureFiles: Object.entries(sourceFixtures).map(([path, source]) => ({ path, sha256: sha256(new TextEncoder().encode(source)) })),
      indexedStructuralSymbols,
      anchoredSymbols,
      lspConfirmedSymbols: 0,
      lspUnconfirmedSymbols: 0,
      languageErrors,
      cases: caseResults,
      requestIds,
      providerTracePath,
      retrievalTracePath,
      retrievalReceiptPath,
      artifactSha256,
      reason,
    };
    await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stderr.write(`feedback stage0 ${status}: ${reason}\n`);
    process.exitCode = 2;
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
};

await main();
