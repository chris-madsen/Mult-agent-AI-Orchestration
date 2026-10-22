import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  retrievalBenchmarkStages,
  validateRetrievalBenchmarkTraceArtifact,
  type RetrievalBenchmarkStage,
  type RetrievalBenchmarkStageStatus,
} from '../src/domain/retrieval-benchmark.js';
import type {
  RetrievalHoldout,
  RetrievalObservation,
  RetrievalStageRanks,
  RetrievalStrategyRun,
} from '../src/domain/retrieval-quality-evaluation.js';

const strategies = [
  'sparse',
  'dense',
  'hybrid_rrf',
  'hybrid_reranker',
  'hybrid_reranker_working_context',
] as const;
type BenchmarkStrategy = (typeof strategies)[number];

interface RepositoryBinding {
  readonly id: string;
  readonly root: string;
  readonly revision: string;
  readonly sourceManifestSha256: string;
}

interface TraceCandidate {
  readonly runtimeCandidateId: string;
  readonly canonicalCandidateId?: string;
  readonly repoPath: string;
  readonly sourceDigest: string;
  readonly range: { readonly startLine: number; readonly endLine: number; readonly startColumn?: number; readonly endColumn?: number };
}

interface TraceEvent {
  readonly requestId: string;
  readonly stage: RetrievalBenchmarkStage;
  readonly status?: RetrievalBenchmarkStageStatus;
  readonly candidates: readonly TraceCandidate[];
}

interface ContextBundle {
  readonly requestId?: string;
  readonly evidence?: readonly Readonly<Record<string, unknown>>[];
  readonly deliveryMetrics?: Readonly<Record<string, unknown>>;
}

const usage = (): never => {
  throw new Error(
    'Usage: tsx scripts/retrieval-benchmark-runner.ts <holdout.json> <output-dir> [--runtime-root <path>] <repository-id>=<checkout-root> [...repo mappings]',
  );
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const textBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const parseArgs = (): {
  readonly holdoutPath: string;
  readonly outputDirectory: string;
  readonly runtimeRoot: string;
  readonly mappings: readonly string[];
  readonly selectedStrategies: readonly BenchmarkStrategy[];
} => {
  const args = process.argv.slice(2);
  const holdoutArg = args.shift();
  const outputArg = args.shift();
  if (holdoutArg === undefined || outputArg === undefined) return usage();
  let runtimeRoot = resolve('.');
  const mappings: string[] = [];
  let selectedStrategies: readonly BenchmarkStrategy[] = strategies;
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--runtime-root') {
      const value = args.shift();
      if (value === undefined) return usage();
      runtimeRoot = resolve(value);
    } else if (current?.startsWith('--runtime-root=')) {
      runtimeRoot = resolve(current.slice('--runtime-root='.length));
    } else if (current === '--strategy') {
      const value = args.shift();
      if (value === undefined || !strategies.includes(value as BenchmarkStrategy)) return usage();
      selectedStrategies = [value as BenchmarkStrategy];
    } else if (current?.startsWith('--strategy=')) {
      const value = current.slice('--strategy='.length);
      if (!strategies.includes(value as BenchmarkStrategy)) return usage();
      selectedStrategies = [value as BenchmarkStrategy];
    } else if (current !== undefined) {
      mappings.push(current);
    }
  }
  if (mappings.length === 0) return usage();
  return { holdoutPath: resolve(holdoutArg), outputDirectory: resolve(outputArg), runtimeRoot, mappings, selectedStrategies };
};

const gitRevision = (root: string): string => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const parseBindings = (mappings: readonly string[], holdout: RetrievalHoldout): readonly RepositoryBinding[] => {
  const roots = new Map<string, string>();
  for (const mapping of mappings) {
    const separator = mapping.indexOf('=');
    if (separator < 1 || separator === mapping.length - 1) throw new Error(`invalid repository mapping: ${mapping}`);
    const id = mapping.slice(0, separator);
    if (roots.has(id)) throw new Error(`duplicate repository mapping: ${id}`);
    roots.set(id, resolve(mapping.slice(separator + 1)));
  }
  return (holdout.repositories ?? []).map((repository) => {
    const root = roots.get(repository.id);
    if (root === undefined || !existsSync(root)) throw new Error(`missing checkout for ${repository.id}`);
    const actual = gitRevision(root);
    if (actual !== repository.revision) {
      throw new Error(`repository ${repository.id} revision mismatch: expected ${repository.revision}, got ${actual}`);
    }
    return {
      id: repository.id,
      root,
      revision: repository.revision,
      sourceManifestSha256: repository.sourceManifestSha256,
    };
  });
};

const holdoutCaseFor = (holdout: RetrievalHoldout, repositoryId: string) =>
  holdout.cases.filter((item) => item.repositoryId === repositoryId);

const sourceSetRevision = (bindings: readonly RepositoryBinding[]): string => sha256(new TextEncoder().encode(JSON.stringify(
  [...bindings]
    .map(({ id, revision, sourceManifestSha256 }) => ({ id, revision, sourceManifestSha256 }))
    .sort((left, right) => left.id.localeCompare(right.id)),
)));

const windowsToWsl = (value: string): string => {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return value.replaceAll('\\', '/');
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const workerInvocation = (
  runtimeRoot: string,
  script: string,
  environment: Readonly<Record<string, string>>,
): Readonly<{ command: string; args: readonly string[] }> => {
  const scriptPath = join(runtimeRoot, 'scripts', script);
  if (process.platform !== 'win32') return { command: scriptPath, args: [] };
  const wslScript = windowsToWsl(scriptPath);
  const exports = Object.entries(environment)
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join('; ');
  const command = `${exports}; exec ${shellQuote(wslScript)}`;
  return { command: 'wsl.exe', args: ['--', 'bash', '-lc', command] };
};

const configuredWorkerEnvironment = (outputDirectory: string): Record<string, string> => ({
  FASTEMBED_CACHE_PATH: process.env.FASTEMBED_CACHE_PATH?.trim()
    || (process.platform === 'win32' ? windowsToWsl(resolve('..', 'ace-external', 'fastembed-cache')) : resolve('.cache/ace-fastembed')),
  HF_HOME: process.env.HF_HOME?.trim() || '',
  HF_HUB_CACHE: process.env.HF_HUB_CACHE?.trim() || '',
  ACE_EMBEDDING_ARTIFACT_DIGEST: process.env.ACE_EMBEDDING_ARTIFACT_DIGEST?.trim() || '',
  ACE_BENCHMARK_OUTPUT: outputDirectory,
});

const strategyEnvironment = (
  strategy: BenchmarkStrategy,
  runtimeRoot: string,
  outputDirectory: string,
): Record<string, string> => {
  const embeddingModel = process.env.ACE_EMBEDDING_MODEL?.trim()
    || 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
  const embeddingProvider = process.env.ACE_EMBEDDING_PROVIDER?.trim() || 'fastembed/onnx';
  const embeddingModelRevision = process.env.ACE_EMBEDDING_MODEL_REVISION?.trim()
    || 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42';
  const embeddingArtifactModel = process.env.ACE_EMBEDDING_ARTIFACT_MODEL?.trim()
    || 'qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q';
  const embeddingArtifactRevision = process.env.ACE_EMBEDDING_ARTIFACT_REVISION?.trim()
    || 'faf4aa4225822f3bc6376869cb1164e8e3feedd0';
  const fastembedCache = process.env.FASTEMBED_CACHE_PATH?.trim()
    || (process.platform === 'win32' ? windowsToWsl(resolve('..', 'ace-external', 'fastembed-cache')) : resolve('.cache/ace-fastembed'));
  const embedding = workerInvocation(
    runtimeRoot,
    'fastembed-worker.sh',
    {
      ACE_EMBEDDING_MODEL: embeddingModel,
      ACE_EMBEDDING_PROVIDER: embeddingProvider,
      ACE_EMBEDDING_MODEL_REVISION: embeddingModelRevision,
      ACE_EMBEDDING_ARTIFACT_MODEL: embeddingArtifactModel,
      ACE_EMBEDDING_ARTIFACT_REVISION: embeddingArtifactRevision,
      ACE_EMBEDDING_PREPROCESSING: process.env.ACE_EMBEDDING_PREPROCESSING?.trim() || 'raw_text_v1',
      ACE_EMBEDDING_EXECUTION_MODE: 'experimental-unpinned',
      ACE_EMBEDDING_PINNED: 'false',
      FASTEMBED_CACHE_PATH: fastembedCache,
    },
  );
  const sparse = workerInvocation(runtimeRoot, 'fastembed-sparse-worker.sh', {
    ACE_SPARSE_EMBEDDING_MODEL: process.env.ACE_SPARSE_EMBEDDING_MODEL?.trim() || 'Qdrant/bm25',
    ACE_SPARSE_EMBEDDING_LD_PRELOAD: process.env.ACE_SPARSE_EMBEDDING_LD_PRELOAD?.trim() || '',
    FASTEMBED_CACHE_PATH: fastembedCache,
  });
  const rerankerModel = process.env.ACE_RERANKER_MODEL?.trim() || 'jinaai/jina-reranker-v2-base-multilingual';
  const reranker = workerInvocation(runtimeRoot, 'fastembed-reranker-worker.sh', {
    ACE_RERANKER_MODEL: rerankerModel,
    FASTEMBED_CACHE_PATH: fastembedCache,
  });
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ACE_ENABLE_EXPERIMENTAL_QDRANT: 'true',
    ACE_RETRIEVAL_STRATEGY: strategy === 'sparse' ? 'sparse' : strategy === 'dense' ? 'dense' : 'hybrid_rrf',
    ACE_CONTEXT_CANDIDATE_LIMIT: process.env.ACE_CONTEXT_CANDIDATE_LIMIT?.trim() || '6',
    ACE_RERANKER_MODE: strategy.includes('reranker') ? 'required' : 'disabled',
    ACE_RERANKER_MODEL: rerankerModel,
    ACE_RERANKER_WORKER: reranker.command,
    ACE_RERANKER_WORKER_ARGS_JSON: JSON.stringify(reranker.args),
    ACE_EMBEDDING_WORKER: embedding.command,
    ACE_EMBEDDING_WORKER_ARGS_JSON: JSON.stringify(embedding.args),
    ACE_SPARSE_EMBEDDING_WORKER: sparse.command,
    ACE_SPARSE_EMBEDDING_WORKER_ARGS_JSON: JSON.stringify(sparse.args),
    ACE_AST_GREP_COMMAND: process.platform === 'win32'
      ? join(runtimeRoot, 'node_modules', '.bin', 'ast-grep.cmd')
      : join(runtimeRoot, 'node_modules', '.bin', 'ast-grep'),
    ACE_LSP_COMMAND: process.platform === 'win32'
      ? join(runtimeRoot, 'node_modules', '.bin', 'typescript-language-server.cmd')
      : join(runtimeRoot, 'node_modules', '.bin', 'typescript-language-server'),
    ACE_LSP_ARGS: JSON.stringify(['--stdio']),
    ACE_QDRANT_URL: process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333',
    ACE_QDRANT_LOCAL_HOSTS: process.env.ACE_QDRANT_LOCAL_HOSTS?.trim() || '127.0.0.1,localhost',
    ACE_QDRANT_VERSION: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
    ACE_BENCHMARK_RUNNER_VERSION: 'ace-generic-retrieval-runner/v1',
    ACE_EVIDENCE_SOURCE_COMMIT: process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim() || '',
    ...configuredWorkerEnvironment(outputDirectory),
  };
  if (strategy === 'hybrid_reranker_working_context') env.ACE_BENCHMARK_WORKING_CONTEXT = 'true';
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
};

const stageKey = (stage: RetrievalBenchmarkStage): keyof RetrievalStageRanks =>
  stage === 'working_context' ? 'workingContext' : stage;

const traceForRequest = (jsonl: string, requestId: string): readonly TraceEvent[] => jsonl
  .split(/\r?\n/u)
  .filter((line) => line.trim().length > 0)
  .flatMap((line) => {
    try {
      const decoded = JSON.parse(line) as TraceEvent;
      return decoded.requestId === requestId ? [decoded] : [];
    } catch {
      return [];
    }
  });

const ranksFor = (events: readonly TraceEvent[]) => {
  const stageRanks: RetrievalStageRanks = {
    dense: [], sparse: [], fused: [], workingContext: [], reranked: [], delivered: [],
  };
  const rawStageRanks: RetrievalStageRanks = {
    dense: [], sparse: [], fused: [], workingContext: [], reranked: [], delivered: [],
  };
  const stageStatuses = {} as Record<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>;
  for (const stage of retrievalBenchmarkStages) {
    const event = [...events].reverse().find((item) => item.stage === stage);
    const key = stageKey(stage);
    stageStatuses[stage] = event?.status ?? 'unavailable';
    stageRanks[key] = event?.candidates.map((candidate) => candidate.canonicalCandidateId ?? '')
      .filter((id) => id.length > 0) ?? [];
    rawStageRanks[key] = event?.candidates.map((candidate) => candidate.runtimeCandidateId) ?? [];
  }
  return { stageRanks, rawStageRanks, stageStatuses };
};

const numberMetric = (metrics: Readonly<Record<string, unknown>> | undefined, name: string): number | undefined => {
  const value = metrics?.[name];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const candidatePaths = (events: readonly TraceEvent[], stage: RetrievalBenchmarkStage): readonly string[] => {
  const event = [...events].reverse().find((item) => item.stage === stage);
  return event?.candidates.map((candidate) => candidate.repoPath) ?? [];
};

const readTrace = async (tracePath: string, receiptPath: string, requestIds: readonly string[]) => {
  const jsonl = await readFile(tracePath, 'utf8');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as unknown;
  const validation = validateRetrievalBenchmarkTraceArtifact(jsonl, receipt, requestIds);
  if (!validation.valid) throw new Error(`benchmark trace rejected: ${validation.failures.join(', ')}`);
  return { jsonl, receipt };
};

const runRepositoryStrategy = async (
  holdout: RetrievalHoldout,
  binding: RepositoryBinding,
  strategy: BenchmarkStrategy,
  outputDirectory: string,
  runtimeRoot: string,
): Promise<{ readonly observations: readonly RetrievalObservation[]; readonly requestIds: readonly string[]; readonly tracePath: string; readonly receiptPath: string; readonly providerIdentities: Readonly<Record<string, string>> }> => {
  const cases = holdoutCaseFor(holdout, binding.id);
  const runDirectory = join(outputDirectory, 'runs', binding.id, strategy);
  await mkdir(runDirectory, { recursive: true });
  const tracePath = join(runDirectory, 'retrieval-trace.jsonl');
  const receiptPath = `${tracePath}.receipt.json`;
  const providerTracePath = join(runDirectory, 'provider-trace.jsonl');
  const stateDirectory = join(runDirectory, 'state');
  const artifactDirectory = join(runDirectory, 'artifacts');
  const workspaceId = `h6-${binding.id}-${strategy.replaceAll('_', '-')}`;
  const env = {
    ...strategyEnvironment(strategy, runtimeRoot, outputDirectory),
    ACE_WORKSPACE_ROOT: binding.root,
    ACE_ALLOWED_ROOTS: binding.root,
    ACE_STATE_DIR: stateDirectory,
    ACE_ARTIFACT_DIR: artifactDirectory,
    ACE_WORKSPACE_ID: workspaceId,
    ACE_BENCHMARK_REPOSITORY_ID: binding.id,
    ACE_BENCHMARK_TRACE_FILE: tracePath,
    ACE_PROVIDER_TRACE_FILE: providerTracePath,
    ACE_EVIDENCE_SOURCE_COMMIT: binding.revision,
  };
  // A frozen scored run cannot silently fall back to the development/tsx
  // source entrypoint, which explicitly bypasses compiled provenance checks.
  if (!existsSync(join(runtimeRoot, 'dist', 'bin', 'ace-mcp.js'))) {
    throw new Error('BLOCKED: compiled ACE MCP is missing; build and verify runtime provenance before scoring a frozen holdout');
  }
  const runtimeArgs = ['dist/bin/ace-mcp.js'];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: runtimeArgs,
    cwd: runtimeRoot,
    stderr: 'pipe',
    env,
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ace ${binding.id}/${strategy}] ${chunk.toString('utf8')}`);
  });
  const client = new Client({ name: 'ace-retrieval-benchmark-runner', version: '1.0.0' });
  const observations: RetrievalObservation[] = [];
  const requestIds: string[] = [];
  const requestOptions = { timeout: 10 * 60_000, maxTotalTimeout: 15 * 60_000 };
  try {
    await client.connect(transport, { timeout: 10 * 60_000, maxTotalTimeout: 15 * 60_000 });
    process.stderr.write(`benchmark starting ${binding.id}/${strategy}\n`);
    const status = await client.callTool(
      { name: 'ace_workspace_status', arguments: { workspace_id: workspaceId } },
      requestOptions,
    );
    if (status.isError === true || (status.structuredContent as { index_status?: unknown }).index_status !== 'ready') {
      throw new Error(`ACE runtime is not ready for ${binding.id}/${strategy}: ${JSON.stringify(status.structuredContent)}`);
    }
    for (const item of cases) {
      const startedAt = performance.now();
      const contextArguments: Record<string, unknown> = {
        workspace_id: workspaceId,
        query: item.query,
        intent: 'locate',
        include_code: true,
        include_docs: false,
        include_memory: false,
        include_history: false,
      };
      if (strategy === 'hybrid_reranker_working_context' && item.focusedPath !== undefined) {
        contextArguments.working_context = { focused_path: item.focusedPath, open_paths: [item.focusedPath] };
      }
      const response = await client.callTool({ name: 'ace_context', arguments: contextArguments }, requestOptions);
      if (response.isError === true) throw new Error(`${binding.id}/${strategy}/${item.id}: MCP ace_context failed`);
      const bundle = response.structuredContent as ContextBundle;
      if (!nonEmpty(bundle.requestId)) throw new Error(`${binding.id}/${strategy}/${item.id}: missing request id`);
      requestIds.push(bundle.requestId);
      const traceText = await readFile(tracePath, 'utf8');
      const events = traceForRequest(traceText, bundle.requestId);
      const { stageRanks, rawStageRanks, stageStatuses } = ranksFor(events);
      const metrics = bundle.deliveryMetrics;
      const deliveredPaths = candidatePaths(events, 'delivered');
      const duplicateSourceHits = Math.max(0, deliveredPaths.length - new Set(deliveredPaths).size);
      const evidence = bundle.evidence ?? [];
      const observation: RetrievalObservation = {
        caseId: item.id,
        retrievedCandidateIds: stageRanks.delivered,
        rawRetrievedCandidateIds: rawStageRanks.delivered,
        payloadCharacters: evidence.reduce((total, entry) => total + (typeof entry.content === 'string' ? entry.content.length : 0), 0),
        duplicateSourceHits,
        // Native reads and expansion calls have not been instrumented.
        // Unknown values must not be turned into fabricated zero counts.
        expansionCalls: null,
        nativeReadDuplicates: null,
        latencyMs: Math.max(0, performance.now() - startedAt),
        payloadBytes: textBytes(bundle),
        ...(numberMetric(metrics, 'initialEvidenceBytes') === undefined ? {} : { initialEvidenceBytes: numberMetric(metrics, 'initialEvidenceBytes') }),
        ...(numberMetric(metrics, 'newContextBytes') === undefined ? {} : { newContextBytes: numberMetric(metrics, 'newContextBytes') }),
        ...(numberMetric(metrics, 'reusedContextBytes') === undefined ? {} : { reusedContextBytes: numberMetric(metrics, 'reusedContextBytes') }),
        ...(numberMetric(metrics, 'projectionBytesAvoided') === undefined ? {} : { projectionBytesAvoided: numberMetric(metrics, 'projectionBytesAvoided') }),
        ...(numberMetric(metrics, 'duplicateContentBytes') === undefined ? {} : { duplicateContentBytes: numberMetric(metrics, 'duplicateContentBytes') }),
        ...(numberMetric(metrics, 'uniqueContentBytes') === undefined ? {} : { uniqueContentBytes: numberMetric(metrics, 'uniqueContentBytes') }),
        ...(numberMetric(metrics, 'duplicateContextBytesAvoided') === undefined ? {} : { duplicateContextBytesAvoided: numberMetric(metrics, 'duplicateContextBytesAvoided') }),
        stageRanks,
        rawStageRanks,
        stageStatuses,
        stageLatencyMs: { total: Math.max(0, performance.now() - startedAt) },
      };
      observations.push(observation);
      process.stderr.write(`benchmark completed ${binding.id}/${strategy}/${observations.length}\n`);
    }
  } finally {
    await client.close();
  }
  const trace = await readTrace(tracePath, receiptPath, requestIds);
  const providerIdentities: Record<string, string> = {};
  for (const line of trace.jsonl.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as { providerIdentities?: Readonly<Record<string, string>> };
      for (const [key, value] of Object.entries(event.providerIdentities ?? {})) providerIdentities[key] = value;
    } catch {
      throw new Error(`benchmark trace contains malformed JSON after validation: ${sha256(new TextEncoder().encode(line))}`);
    }
  }
  return { observations, requestIds, tracePath, receiptPath, providerIdentities };
};

const main = async (): Promise<void> => {
  const parsed = parseArgs();
  const holdoutBytes = await readFile(parsed.holdoutPath);
  const holdoutSha256 = sha256(holdoutBytes);
  const holdout = JSON.parse(holdoutBytes.toString('utf8')) as RetrievalHoldout;
  if (holdout.status !== 'frozen_multi_repository_holdout') throw new Error('generic runner requires frozen_multi_repository_holdout');
  const bindings = parseBindings(parsed.mappings, holdout);
  await mkdir(parsed.outputDirectory, { recursive: true });
  const runtimeCommit = gitRevision(parsed.runtimeRoot);
  const boundSourceSetRevision = sourceSetRevision(bindings);
  for (const strategy of parsed.selectedStrategies) {
    const observations: RetrievalObservation[] = [];
    const tracePaths: string[] = [];
    const receiptPaths: string[] = [];
    const providerIdentities: Record<string, string> = {
      runner: 'ace-generic-retrieval-runner/v1',
      runtimeCommit,
      holdoutSha256,
      sourceSetRevision: boundSourceSetRevision,
    };
    for (const binding of bindings) {
      const result = await runRepositoryStrategy(
        holdout,
        binding,
        strategy,
        parsed.outputDirectory,
        parsed.runtimeRoot,
      );
      observations.push(...result.observations);
      tracePaths.push(result.tracePath);
      receiptPaths.push(result.receiptPath);
      for (const [key, value] of Object.entries(result.providerIdentities)) providerIdentities[`${binding.id}.${key}`] = value;
    }
    const run: RetrievalStrategyRun = {
      strategy,
      holdoutSha256,
      observations,
      // Multi-repository runs cannot truthfully identify their source with the
      // ACE runtime commit. Bind the complete repository set instead.
      sourceCommit: boundSourceSetRevision,
      runnerVersion: 'ace-generic-retrieval-runner/v1',
      providerIdentities,
      tracePaths,
      terminalTraceReceiptPaths: receiptPaths,
    };
    await writeFile(join(parsed.outputDirectory, `${strategy}.run.json`), JSON.stringify(run, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(JSON.stringify({
    status: 'retrieval_runs_written',
    holdoutSha256,
    cases: holdout.cases.length,
    repositories: bindings.map((binding) => ({
      id: binding.id,
      revision: binding.revision,
      sourceManifestSha256: binding.sourceManifestSha256,
    })),
    sourceSetRevision: boundSourceSetRevision,
    strategies: parsed.selectedStrategies,
    outputDirectory: parsed.outputDirectory,
  }) + '\n');
};

await main();
