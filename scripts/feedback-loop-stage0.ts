import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
  readonly runtimeSourceCommit: string;
  readonly runtimeRoot: string;
  readonly workspaceSourceKind: 'real_git_checkout';
  readonly workspaceSourceCommit: string;
  readonly workspaceSourceManifestSha256: string;
  readonly workspaceRoot: string;
  readonly manualSemanticAnchorInjection: false;
  readonly sourceFiles: readonly Readonly<{ path: string; sizeBytes: number; sha256: string }>[];
  readonly preflightIndexedStructuralSymbols: number;
  readonly preflightAnchoredSymbols: number;
  readonly lspConfirmedRetrievedSymbols: number;
  readonly lspUnconfirmedRetrievedSymbols: number;
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

const parseArgs = (): { readonly outputDirectory: string; readonly sourceRoot: string; readonly workspaceRoot: string } => {
  const args = process.argv.slice(2);
  let outputDirectory = process.env.ACE_FEEDBACK_OUTPUT?.trim()
    || join('artifacts', 'feedback', `stage0-${new Date().toISOString().replaceAll(/[^0-9]/gu, '').slice(0, 14)}`);
  let sourceRoot = process.env.ACE_FEEDBACK_SOURCE_ROOT?.trim();
  let workspaceRoot = process.env.ACE_FEEDBACK_WORKSPACE_ROOT?.trim();
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--output') outputDirectory = args.shift() ?? outputDirectory;
    else if (current === '--source-root') sourceRoot = args.shift() ?? sourceRoot;
    else if (current === '--workspace-root') workspaceRoot = args.shift() ?? workspaceRoot;
    else throw new Error(`unknown argument: ${current}`);
  }
  if (sourceRoot === undefined || sourceRoot.length === 0) {
    throw new Error('BLOCKED: --source-root must point to a clean real Git checkout; synthetic fixtures are not accepted');
  }
  const resolvedSourceRoot = resolve(sourceRoot);
  const resolvedWorkspaceRoot = resolve(workspaceRoot ?? join(resolvedSourceRoot, 'src'));
  const relativeWorkspace = requireWithinSource(resolvedSourceRoot, resolvedWorkspaceRoot);
  if (relativeWorkspace === undefined) {
    throw new Error('BLOCKED: --workspace-root must remain inside --source-root');
  }
  return { outputDirectory: resolve(outputDirectory), sourceRoot: resolvedSourceRoot, workspaceRoot: resolvedWorkspaceRoot };
};

const requireWithinSource = (sourceRoot: string, workspaceRoot: string): string | undefined => {
  const relation = relative(resolve(sourceRoot), resolve(workspaceRoot)).split('\\').join('/');
  return isAbsolute(relation) || relation === '..' || relation.startsWith('../') ? undefined : relation.length === 0 ? '.' : relation;
};

const casesFor = (workspaceRelativePath: string): readonly SemanticCase[] => workspaceRelativePath === 'src/domain'
  ? [
    { id: 'function', query: 'makeWorkspaceId', expectedPath: 'workspace.ts', expectedSymbol: 'makeWorkspaceId', required: true },
    { id: 'function-2', query: 'validateFeedbackTaskManifest', expectedPath: 'feedback-loop-experiment.ts', expectedSymbol: 'validateFeedbackTaskManifest', required: true },
    { id: 'utf8-function', query: 'exactUtf8ByteRange', expectedPath: 'utf8-range.ts', expectedSymbol: 'exactUtf8ByteRange', required: false },
  ]
  : workspaceRelativePath === '.'
    ? [
      { id: 'function', query: 'makeWorkspaceId', expectedPath: 'src/domain/workspace.ts', expectedSymbol: 'makeWorkspaceId', required: true },
      { id: 'function-2', query: 'validateFeedbackTaskManifest', expectedPath: 'src/domain/feedback-loop-experiment.ts', expectedSymbol: 'validateFeedbackTaskManifest', required: true },
      { id: 'class', query: 'HarborBindingError', expectedPath: 'src/application/harbor-byte-binding.ts', expectedSymbol: 'HarborBindingError', required: true },
      { id: 'utf8-function', query: 'exactUtf8ByteRange', expectedPath: 'src/domain/utf8-range.ts', expectedSymbol: 'exactUtf8ByteRange', required: false },
    ]
  : [
    { id: 'function', query: 'makeWorkspaceId', expectedPath: 'domain/workspace.ts', expectedSymbol: 'makeWorkspaceId', required: true },
    { id: 'function-2', query: 'validateFeedbackTaskManifest', expectedPath: 'domain/feedback-loop-experiment.ts', expectedSymbol: 'validateFeedbackTaskManifest', required: true },
    { id: 'class', query: 'HarborBindingError', expectedPath: 'application/harbor-byte-binding.ts', expectedSymbol: 'HarborBindingError', required: false },
    { id: 'reexport', query: 'exactUtf8ByteRange', expectedPath: 'adapters/qdrant-context-provider.ts', expectedSymbol: 'exactUtf8ByteRange', required: false },
  ];

const gitText = (root: string, args: readonly string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const gitBytes = (root: string, args: readonly string[]): Buffer => execFileSync('git', ['-C', root, ...args]);

const realSourceIdentity = (root: string): {
  readonly revision: string;
  readonly files: readonly Readonly<{ path: string; sizeBytes: number; sha256: string }>[];
  readonly manifestSha256: string;
} => {
  const revision = gitText(root, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40,64}$/iu.test(revision)) throw new Error('BLOCKED: real source checkout did not provide an exact Git commit');
  if (gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']).length > 0) {
    throw new Error('BLOCKED: real source checkout is dirty; Stage-0 requires frozen source bytes');
  }
  const paths = gitBytes(root, ['ls-tree', '-r', '-z', '--name-only', revision]).toString('utf8')
    .split('\0').filter((path) => path.length > 0).sort((left, right) => left.localeCompare(right));
  const files = paths.map((path) => {
    const bytes = gitBytes(root, ['show', `${revision}:${path}`]);
    return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
  });
  return {
    revision,
    files,
    manifestSha256: sha256(new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, revision, files }, null, 2)}\n`)),
  };
};

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
  const { outputDirectory, sourceRoot, workspaceRoot } = parseArgs();
  await mkdir(outputDirectory, { recursive: true });
  const source = realSourceIdentity(sourceRoot);
  const workspace = workspaceRoot;
  const workspaceRelativePath = requireWithinSource(sourceRoot, workspaceRoot) ?? '.';
  const workspaceIdValue = `feedback-stage0-ts-${source.revision.slice(0, 12)}-${sha256(workspaceRelativePath).slice(0, 8)}`;
  const cases = casesFor(workspaceRelativePath);
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
    const workspaceId = mustOk(makeWorkspaceId(workspaceIdValue));
    const files = makeNodeWorkspacePort({ allowedRoots: [sourceRoot] });
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
        ACE_ALLOWED_ROOTS: sourceRoot,
        ACE_STATE_DIR: stateDirectory,
        ACE_ARTIFACT_DIR: join(outputDirectory, 'artifacts'),
        ACE_WORKSPACE_ID: workspaceIdValue,
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
        ACE_BENCHMARK_RUNNER_VERSION: 'ace-feedback-stage0/v2',
      },
    });
    stderr = [];
    transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    const client = new Client({ name: 'ace-feedback-stage0', version: '1.0.0' });
    try {
      await client.connect(transport, { timeout: 180_000, maxTotalTimeout: 300_000 });
      const readiness = await client.callTool({ name: 'ace_workspace_status', arguments: { workspace_id: workspaceIdValue } }, { timeout: 180_000, maxTotalTimeout: 300_000 });
      await writeFile(responsePath, `${JSON.stringify({ tool: 'ace_workspace_status', response: readiness })}\n`, 'utf8');
      const readinessBundle = object(readiness.structuredContent ?? {});
      if (readiness.isError === true || readinessBundle.index_status !== 'ready') {
        throw new Error(`NOT_READY: ${JSON.stringify(readinessBundle)}`);
      }
      const confirmedSymbols = new Set<string>();
      const unconfirmedSymbols = new Set<string>();
      for (const item of cases) {
        const response = await client.callTool({
          name: 'ace_context',
          arguments: {
            workspace_id: workspaceIdValue,
            query: item.query,
            intent: 'locate',
            include_code: true,
            include_docs: false,
            include_memory: false,
            include_history: false,
            source_obligations: { required: ['code', 'structural', 'lsp'] },
          },
        }, { timeout: 180_000, maxTotalTimeout: 300_000 });
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
        for (const entry of direct) {
          confirmedSymbols.add(`${String(entry.citation)}\0${String(entry.structuralName ?? item.expectedSymbol)}`);
        }
        for (const entry of uncertain) {
          unconfirmedSymbols.add(`${String(entry.citation)}\0${String(entry.structuralName ?? item.expectedSymbol)}`);
        }
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
      const hasRequiredLspProof = requiredCases.length > 0
        && requiredWithLspProof.length === requiredCases.length;
      const failedRequiredIds = requiredCases
        .filter((item) => !requiredWithLspProof.some((confirmed) => confirmed.id === item.id))
        .map((item) => item.id);
      status = hasRequiredLspProof ? 'PASS' : 'NOT_VERIFIED';
      reason = hasRequiredLspProof
        ? 'every required case returned current/direct symbol evidence with confirmed LSP definition'
        : `required cases without confirmed LSP proof: ${failedRequiredIds.join(', ') || 'none were configured'}`;
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
      const manifest: Stage0Manifest = {
        schemaVersion: 1,
        status,
        generatedAt: new Date().toISOString(),
        runtimeSourceCommit: runtimeCommit(),
        runtimeRoot: resolve('.'),
        workspaceSourceKind: 'real_git_checkout',
        workspaceSourceCommit: source.revision,
        workspaceSourceManifestSha256: source.manifestSha256,
        workspaceRoot: workspaceRelativePath,
        manualSemanticAnchorInjection: false,
        sourceFiles: source.files,
        preflightIndexedStructuralSymbols: indexedStructuralSymbols,
        preflightAnchoredSymbols: anchoredSymbols,
        lspConfirmedRetrievedSymbols: confirmedSymbols.size,
        lspUnconfirmedRetrievedSymbols: unconfirmedSymbols.size,
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
      runtimeSourceCommit: runtimeCommit(),
      runtimeRoot: resolve('.'),
      workspaceSourceKind: 'real_git_checkout',
      workspaceSourceCommit: source.revision,
      workspaceSourceManifestSha256: source.manifestSha256,
      workspaceRoot: workspaceRelativePath,
      manualSemanticAnchorInjection: false,
      sourceFiles: source.files,
      preflightIndexedStructuralSymbols: indexedStructuralSymbols,
      preflightAnchoredSymbols: anchoredSymbols,
      lspConfirmedRetrievedSymbols: 0,
      lspUnconfirmedRetrievedSymbols: 0,
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
  }
};

await main();
