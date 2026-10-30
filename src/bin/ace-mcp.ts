#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { QdrantClient } from '@qdrant/js-client-rest';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { makeAsyncFileMemoryArchive } from '../adapters/file-memory-archive.js';
import { makeFileDecisionHistory } from '../adapters/file-decision-history.js';
import { makeGraphitiMcpPort } from '../adapters/graphiti-mcp.js';
import { makeGitHistoryPort } from '../adapters/git-history.js';
import { makeHostWorkspacePort, makeMtlsHostHelperTransport } from '../adapters/host-worktree-helper.js';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort, validateLocalQdrantBaseUrl } from '../adapters/http-provider-boundaries.js';
import { buildLocalCodeIndex, type LocalCodeIndexBuild } from '../adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import {
  makeProcessEmbeddingPort,
  verifiedEmbeddingIdentityFingerprint,
  type ResolvedEmbeddingConfig,
} from '../adapters/process-embedding.js';
import {
  makeProcessSparseEmbeddingPort,
  sparseEmbeddingIdentityFingerprint,
} from '../adapters/process-sparse-embedding.js';
import { makeFileProviderTrace } from '../adapters/provider-trace.js';
import { makeFileRetrievalBenchmarkTrace } from '../adapters/retrieval-benchmark-trace.js';
import { makeProcessRerankerPort } from '../adapters/process-reranker.js';
import {
  codeIndexKey,
  qdrantCollectionName,
  ensureQdrantCollection,
  makeQdrantContextProvider,
  type QdrantContextConfig,
  probeQdrantService,
  mutateQdrantChangedPaths,
  reuseOrPopulateQdrantSnapshot,
} from '../adapters/qdrant-context-provider.js';
import { makeAstGrepStructuralPort, resolveAstGrepProviderIdentity } from '../adapters/ast-grep-structural.js';
import { buildRepoMapDelta } from '../adapters/repo-map-structural.js';
import {
  lspLanguageIdForPath,
  makeLspSemanticAnalysisPort,
  resolveLspProviderIdentity,
} from '../adapters/lsp-semantic.js';
import { makeVertexRagRetrievalPort } from '../adapters/vertex-rag.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
import type { MemorySearchPort, WorkspaceFilePort } from '../application/ports.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import { makeWorkspaceId, type RepoPath, type WorkspaceId } from '../domain/workspace.js';
import { isSensitiveSourcePath } from '../domain/sensitive-path.js';
import { structuralLanguageForPath } from '../domain/structural-language.js';
import type { RepoMapSymbolId } from '../domain/repo-map.js';
import type { RetrievalBenchmarkTraceSink } from '../domain/retrieval-benchmark.js';
import {
  workspaceManifestFromSnapshot,
  workspaceManifestEqual,
  workspaceSnapshotFromManifest,
  type WorkspaceManifestDelta,
} from '../domain/workspace-manifest.js';
import { observeWorkspace, registerWorkspace } from '../application/workspace-service.js';
import { readVerifiedSemanticSnapshot, semanticSnapshotIdentity } from '../application/semantic-snapshot.js';
import {
  candidateMembershipByPath,
  makeWorkspaceSync,
  observeWorkspaceManifest,
  type WorkspaceSync,
} from '../application/workspace-sync.js';
import { verifyCompiledRuntimeProvenance } from '../application/runtime-provenance.js';
import { makeMcpGateway, type CapabilityReadiness } from '../gateway/mcp-gateway.js';
import { makeContextTransformService } from '../application/context-transform-service.js';
import { makeContextAssembler } from '../application/context-assembler.js';
import { makeRepoMapService, type RepoMapService } from '../application/repo-map-service.js';
import {
  makeLspServerDescriptor,
  makeLspServerRegistry,
} from '../application/lsp/server-registry.js';
import { knownLspServers, selectInstalledLspServersForPaths } from '../application/lsp/claw-discovery.js';
import { makeRoutedLspSession } from '../application/lsp/routed-semantic.js';
import { makeGatewayProjectionService } from '../application/gateway-projection-service.js';
import { runContextBridgeStdio } from '../transport/context-bridge-stdio.js';
import { runGatewayProjectionHttp } from '../transport/gateway-projection-http.js';
import { runMcpSdkStdio } from '../transport/mcp-sdk-stdio.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
};

const optionalPath = (value: string | undefined, fallback: string): string =>
  resolve(value === undefined || value.trim().length === 0 ? fallback : value.trim());

const optionalCommand = (value: string | undefined, fallback: string): string =>
  value === undefined || value.trim().length === 0 ? fallback : value.trim();

const configuredStringArray = (name: string, fallback: readonly string[]): readonly string[] => {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${name} must be a JSON array of strings`, { cause });
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return parsed;
};

const configuredLanguageIds = (name: string): Readonly<Record<string, string>> | undefined => {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${name} must be a JSON object mapping extensions to language IDs`, { cause });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object mapping extensions to language IDs`);
  }
  const entries = Object.entries(parsed);
  if (!entries.every(([extension, languageId]) => extension.startsWith('.') && typeof languageId === 'string' && languageId.length > 0)) {
    throw new Error(`${name} must map dot-prefixed extensions to non-empty language IDs`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
};

const commandBoundaryExists = (value: string): boolean => {
  if (value.includes('/') || value.includes('\\') || /^[A-Za-z]:/u.test(value)) return existsSync(value);
  return value.trim().length > 0;
};

const defaultEmbeddingModel = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const defaultEmbeddingRevision = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42';
const defaultFastEmbedArtifactModel = 'qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q';
const defaultFastEmbedArtifactRevision = 'faf4aa4225822f3bc6376869cb1164e8e3feedd0';
const defaultEmbeddingPreprocessing = 'raw_text_v1';

type RuntimeTestFailpoint = 'after_qdrant_verify_before_publish';

const configuredRuntimeTestFailpoint = (): RuntimeTestFailpoint | undefined => {
  const requested = process.env.ACE_TEST_FAILPOINT?.trim();
  if (requested === undefined || requested.length === 0) return undefined;
  if (process.env.ACE_ENABLE_TEST_FAILPOINTS !== 'true') {
    throw new Error('ACE_TEST_FAILPOINT requires ACE_ENABLE_TEST_FAILPOINTS=true');
  }
  if (requested !== 'after_qdrant_verify_before_publish') {
    throw new Error('ACE_TEST_FAILPOINT is not a supported failpoint');
  }
  return requested;
};

const gcloudAccessToken = (): string | undefined => {
  try {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return token.length === 0 ? undefined : token;
  } catch {
    return undefined;
  }
};

const makeDocumentationProvider = (
  workspaceId: WorkspaceId,
  http: ReturnType<typeof makeFetchHttpPort>,
  providerTrace: ReturnType<typeof makeFileProviderTrace>,
) => {
  const project = process.env.ACE_VERTEX_PROJECT?.trim();
  const corpusId = process.env.ACE_VERTEX_CORPUS_ID?.trim();
  if (process.env.ACE_ENABLE_VERTEX !== 'true' || project === undefined || corpusId === undefined) return undefined;
  const cloudOptIn = process.env.ACE_CLOUD_DOCS_OPT_IN === 'true';
  const policy = {
    ...defaultLocalPolicy(workspaceId),
    cloudOptIn,
    allowedCloudProviders: cloudOptIn ? ['vertex'] as const : [],
    allowedCloudDataClassesByProvider: cloudOptIn
      ? { vertex: ['project_document'] as const }
      : {},
  };
  return makeVertexRagRetrievalPort({
    project,
    location: process.env.ACE_VERTEX_LOCATION?.trim() || 'europe-west4',
    corpusId,
    accessToken: gcloudAccessToken,
    policy,
    http,
    trace: providerTrace,
    providerVersion: process.env.ACE_VERTEX_PROVIDER_VERSION?.trim() || 'vertex-rag/v1beta1',
  });
};

const main = async (): Promise<void> => {
  const sourceRuntime = /[\\/]src[\\/]/u.test(fileURLToPath(import.meta.url));
  const runtimeRoot = resolve(
    process.env.ACE_RUNTIME_ROOT?.trim() || resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  );
  if (sourceRuntime) {
    if (process.env.ACE_ALLOW_SOURCE_RUNTIME !== 'true') {
      throw new Error('source ACE runtime requires explicit ACE_ALLOW_SOURCE_RUNTIME=true; compiled dist provenance is mandatory otherwise');
    }
    process.stderr.write('ace-mcp source runtime explicitly allowed for development/test; compiled provenance was not used\n');
  } else {
    const provenance = await verifyCompiledRuntimeProvenance(runtimeRoot, fileURLToPath(import.meta.url));
    if (provenance._tag === 'Err') throw new Error(`${provenance.error.code}: ${provenance.error.message}`);
    process.stderr.write(`ace-mcp runtime provenance runtime_id=${provenance.value.runtimeId} source_commit=${provenance.value.sourceCommit} source_manifest_sha256=${provenance.value.sourceManifestSha256} executable_sha256=${provenance.value.executableSha256} runtime_root=${runtimeRoot} node=${process.version} build_node=${provenance.value.buildRuntime.node} mcp_client=${provenance.value.buildRuntime.mcpClientSdk} mcp_server=${provenance.value.buildRuntime.mcpServerSdk}\n`);
    process.stderr.write(`ace-mcp provider identities embedding=${process.env.ACE_EMBEDDING_PROVIDER?.trim() || 'fastembed/onnx'}|model=${process.env.ACE_EMBEDDING_MODEL?.trim() || defaultEmbeddingModel} sparse=${process.env.ACE_SPARSE_EMBEDDING_MODEL?.trim() || 'Qdrant/bm25'} qdrant=${process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2'} lsp=${process.env.ACE_LSP_SERVER?.trim() || 'typescript-language-server'} reranker=${process.env.ACE_RERANKER_MODEL?.trim() || 'disabled'}\n`);
  }
  const runtimeTestFailpoint = configuredRuntimeTestFailpoint();
  const rootPath = resolve(required('ACE_WORKSPACE_ROOT'));
  const allowedRoots = (process.env.ACE_ALLOWED_ROOTS ?? rootPath)
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => resolve(value));
  const stateDirectory = optionalPath(process.env.ACE_STATE_DIR, `${homedir()}/.local/state/ace`);
  const artifactDirectory = optionalPath(process.env.ACE_ARTIFACT_DIR, `${stateDirectory}/artifacts`);
  const configuredWorkspaceId = process.env.ACE_WORKSPACE_ID?.trim();
  const helperUrl = process.env.ACE_WORKTREE_HELPER_URL?.trim();
  let files: WorkspaceFilePort;
  if (helperUrl !== undefined && helperUrl.length > 0) {
    if (configuredWorkspaceId === undefined || configuredWorkspaceId.length === 0) {
      throw new Error('ACE_WORKSPACE_ID is required when ACE_WORKTREE_HELPER_URL is configured');
    }
    const workspaceId = makeWorkspaceId(configuredWorkspaceId);
    if (workspaceId._tag === 'Err') throw new Error(workspaceId.error.message);
    const helper = await makeMtlsHostHelperTransport({
      endpoint: helperUrl,
      caFile: required('ACE_WORKTREE_HELPER_TLS_CA'),
      certificateFile: required('ACE_WORKTREE_HELPER_TLS_CERT'),
      privateKeyFile: required('ACE_WORKTREE_HELPER_TLS_KEY'),
    });
    if (helper._tag === 'Err') throw new Error(`${helper.error.code}: ${helper.error.message}`);
    files = makeHostWorkspacePort(workspaceId.value, helper.value);
  } else {
    files = makeNodeWorkspacePort({ allowedRoots });
  }
  const workspaceState = resolve(
    stateDirectory,
    helperUrl === undefined || helperUrl.length === 0 ? 'workspaces.json' : 'workspaces-host-helper.json',
  );
  const store = makeFileWorkspaceStore(workspaceState);
  const ports = {
    clock: { nowMs: () => Date.now() },
    ids: { newWorkspaceId: () => configuredWorkspaceId ?? randomUUID(), newRequestId: () => randomUUID() },
    files,
    store,
  };
  const registered = await Effect.runPromise(registerWorkspace(ports, { rootPath }));
  if (registered._tag === 'Err') throw new Error(`${registered.error.code}: ${registered.error.message}`);
  const observed = await Effect.runPromise(observeWorkspace(ports, registered.value.workspaceId));
  if (observed._tag === 'Err') throw new Error(`${observed.error.code}: ${observed.error.message}`);
  const observationEpoch = observed.value.observationEpoch;
  const rerankerModeRaw = process.env.ACE_RERANKER_MODE?.trim() || 'disabled';
  if (!['disabled', 'optional', 'required'].includes(rerankerModeRaw)) {
    throw new Error('ACE_RERANKER_MODE must be disabled, optional, or required');
  }
  const rerankerMode = rerankerModeRaw as 'disabled' | 'optional' | 'required';
  const readiness: Record<string, CapabilityReadiness> = {
    worktree: {
      state: 'ready',
      reason: helperUrl === undefined || helperUrl.length === 0 ? 'local_exact_read_ready' : 'authenticated_host_helper_ready',
    },
    code_retrieval: { state: 'not_ready', reason: 'provider_not_initialized' },
    unified_context: { state: 'not_ready', reason: 'provider_not_initialized' },
    semantic_lsp: { state: 'not_ready', reason: 'provider_not_initialized' },
    sparse_embedding: { state: 'not_ready', reason: 'provider_not_initialized' },
    reranker: rerankerMode === 'disabled'
      ? { state: 'disabled', reason: 'reranker_disabled' }
      : { state: 'not_ready', reason: 'provider_not_initialized' },
    project_memory: process.env.ACE_ENABLE_GRAPHITI === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'graphiti_disabled' },
    documentation: process.env.ACE_ENABLE_VERTEX === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'vertex_disabled' },
  };
  const astGrepCommand = optionalCommand(
    process.env.ACE_AST_GREP_COMMAND,
    resolve(runtimeRoot, 'node_modules/.bin/ast-grep'),
  );
  // Auto reuses @ast-grep/napi for the verified JS/TS def/ref parser and
  // keeps the already-batched CLI outline for unsupported grammars.
  const astGrepProviderRaw = process.env.ACE_AST_GREP_PROVIDER?.trim() || 'auto';
  if (!['cli', 'napi', 'auto'].includes(astGrepProviderRaw)) {
    throw new Error('ACE_AST_GREP_PROVIDER must be cli, napi, or auto');
  }
  const astGrepProvider = astGrepProviderRaw as 'cli' | 'napi' | 'auto';
  const lspCommand = optionalCommand(
    process.env.ACE_LSP_COMMAND,
    resolve(runtimeRoot, 'node_modules/.bin/typescript-language-server'),
  );
  const lspArgs = configuredStringArray('ACE_LSP_ARGS', ['--stdio']);
  const lspServerName = optionalCommand(process.env.ACE_LSP_SERVER, 'typescript-language-server');
  const lspLanguageIds = configuredLanguageIds('ACE_LSP_LANGUAGE_IDS');
  const embeddingWorkerArgs = configuredStringArray('ACE_EMBEDDING_WORKER_ARGS_JSON', []);
  const sparseEmbeddingWorkerArgs = configuredStringArray('ACE_SPARSE_EMBEDDING_WORKER_ARGS_JSON', []);
  const rerankerWorkerArgs = configuredStringArray('ACE_RERANKER_WORKER_ARGS_JSON', []);
  const artifacts = makeFileArtifactStore(artifactDirectory);
  const providerTrace = makeFileProviderTrace(process.env.ACE_PROVIDER_TRACE_FILE);
  const benchmarkTracePath = process.env.ACE_BENCHMARK_TRACE_FILE?.trim();
  const benchmarkRepositoryId = process.env.ACE_BENCHMARK_REPOSITORY_ID?.trim();
  let benchmarkTrace: RetrievalBenchmarkTraceSink | undefined;
  if (benchmarkTracePath !== undefined && benchmarkTracePath.length > 0) {
    const resolvedBenchmarkTracePath = resolve(benchmarkTracePath);
    let sourceCommit = process.env.ACE_EVIDENCE_SOURCE_COMMIT?.trim();
    if (sourceCommit === undefined || sourceCommit.length === 0) {
      try {
        sourceCommit = execFileSync('git', ['-C', rootPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      } catch {
        sourceCommit = undefined;
      }
    }
    benchmarkTrace = await makeFileRetrievalBenchmarkTrace(resolvedBenchmarkTracePath, {
      ...(sourceCommit === undefined || sourceCommit.length === 0 ? {} : { sourceCommit }),
      runnerVersion: process.env.ACE_BENCHMARK_RUNNER_VERSION?.trim() || 'ace-harness/0.1.0',
    });
  }
  const history = makeGitHistoryPort({ trace: providerTrace, providerVersion: 'git/cli' });
  let memory: MemorySearchPort | undefined;
  let closeMemory: (() => Promise<void>) | undefined;
  let closeSemantics: (() => void) | undefined;
  const lspRegistry = makeLspServerRegistry();
  let closeReranker: (() => void) | undefined;
  let closeSparseEmbeddings: (() => void) | undefined;
  if (process.env.ACE_ENABLE_GRAPHITI === 'true') {
    const archiveRoot = resolve(required('ACE_MEMORY_ARCHIVE_ROOT'));
    const command = required('ACE_GRAPHITI_COMMAND');
    let args: string[];
    try {
      const decoded: unknown = JSON.parse(required('ACE_GRAPHITI_ARGS_JSON'));
      if (!Array.isArray(decoded) || !decoded.every((item) => typeof item === 'string')) {
        throw new Error('ACE_GRAPHITI_ARGS_JSON must decode to a string array');
      }
      args = decoded;
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : 'ACE_GRAPHITI_ARGS_JSON is invalid');
    }
    const archive = await makeAsyncFileMemoryArchive(archiveRoot);
    const decisionHistory = makeFileDecisionHistory(
      resolve(process.env.ACE_MEMORY_DECISIONS_PATH?.trim() || join(archiveRoot, 'decisions.json')),
    );
    try {
      const graphiti = await makeGraphitiMcpPort({
        command,
        args,
        groupId: required('ACE_GRAPHITI_GROUP_ID'),
        workspaceId: registered.value.workspaceId,
        policy: defaultLocalPolicy(registered.value.workspaceId),
        archive,
        decisionHistory,
        trace: providerTrace,
        providerVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'graphiti-mcp/unknown',
      });
      memory = graphiti.memory;
      closeMemory = graphiti.close;
      if (memory === undefined) throw new Error('Graphiti archive-backed memory search was not initialized');
      readiness.project_memory = { state: 'degraded', reason: 'provider_initialized_not_health_probed' };
      process.stderr.write(`ace-mcp temporal memory configured workspace_id=${registered.value.workspaceId}\n`);
    } catch (cause) {
      readiness.project_memory = { state: 'not_ready', reason: 'graphiti_startup_failed' };
      process.stderr.write(`ace-mcp memory NOT_READY: ${cause instanceof Error ? cause.message : 'Graphiti startup failed'}\n`);
    }
  }
  const scopeFingerprint = process.env.ACE_INDEX_SCOPE_FINGERPRINT?.trim()
    || createHash('sha256').update('ace-scope/default-v1', 'utf8').digest('hex');
  let context: ReturnType<typeof makeQdrantContextProvider> | undefined;
  let effectiveStructuralProviderIdentity = astGrepProvider === 'napi'
    ? process.env.ACE_AST_GREP_NAPI_VERSION?.trim() || 'ast-grep/napi@0.51.0'
    : process.env.ACE_AST_GREP_VERSION?.trim() || 'ast-grep/0.51.0';
  if (process.env.ACE_ENABLE_EXPERIMENTAL_QDRANT === 'true') {
    const http = makeFetchHttpPort();
    const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
    const qdrantAllowedHosts = (process.env.ACE_QDRANT_LOCAL_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0);
    const qdrantEndpoint = validateLocalQdrantBaseUrl(qdrantUrl, qdrantAllowedHosts);
    if (qdrantEndpoint._tag === 'Err') throw new Error(qdrantEndpoint.error.message);
    const qdrantApiKey = process.env.ACE_QDRANT_API_KEY?.trim();
    const qdrantTimeoutMs = Number(process.env.ACE_QDRANT_TIMEOUT_MS ?? '5000');
    if (!Number.isSafeInteger(qdrantTimeoutMs) || qdrantTimeoutMs < 100 || qdrantTimeoutMs > 600_000) {
      throw new Error('ACE_QDRANT_TIMEOUT_MS must be an integer between 100 and 600000');
    }
    const qdrantClient = new QdrantClient({
      url: qdrantEndpoint.value,
      timeout: qdrantTimeoutMs,
      ...(qdrantApiKey === undefined || qdrantApiKey.length === 0 ? {} : { apiKey: qdrantApiKey }),
      checkCompatibility: false,
    });
    const embeddingModel = process.env.ACE_EMBEDDING_MODEL?.trim() || defaultEmbeddingModel;
    const embeddingProvider = process.env.ACE_EMBEDDING_PROVIDER?.trim() || 'fastembed/onnx';
    const embeddingRevision = process.env.ACE_EMBEDDING_MODEL_REVISION?.trim() || defaultEmbeddingRevision;
    const embeddingArtifactModel = process.env.ACE_EMBEDDING_ARTIFACT_MODEL?.trim()
      || (embeddingProvider === 'fastembed/onnx' ? defaultFastEmbedArtifactModel : embeddingModel);
    const embeddingArtifactRevision = process.env.ACE_EMBEDDING_ARTIFACT_REVISION?.trim()
      || (embeddingProvider === 'fastembed/onnx' ? defaultFastEmbedArtifactRevision : embeddingRevision);
    const embeddingArtifactDigest = process.env.ACE_EMBEDDING_ARTIFACT_DIGEST?.trim() || 'unverified';
    const embeddingPreprocessing = process.env.ACE_EMBEDDING_PREPROCESSING?.trim() || defaultEmbeddingPreprocessing;
    const embeddingPinned = process.env.ACE_REQUIRE_PINNED_EMBEDDING === 'true';
    const embeddingExecutionMode = embeddingPinned ? 'pinned' as const : 'experimental-unpinned' as const;
    if (embeddingPinned
      && (!/^[a-f0-9]{40}$/u.test(embeddingRevision)
        || !/^[a-f0-9]{40}$/u.test(embeddingArtifactRevision)
        || !/^[a-f0-9]{64}$/u.test(embeddingArtifactDigest))) {
      throw new Error('ACE_REQUIRE_PINNED_EMBEDDING requires model/artifact revisions and a 64-character artifact digest');
    }
    const embeddingDimension = Number(process.env.ACE_EMBEDDING_DIMENSION ?? '384');
    if (!Number.isSafeInteger(embeddingDimension) || embeddingDimension < 1) throw new Error('ACE_EMBEDDING_DIMENSION must be a positive integer');
    const embeddingTimeoutMs = Number(process.env.ACE_EMBEDDING_TIMEOUT_MS ?? '120000');
    if (!Number.isSafeInteger(embeddingTimeoutMs) || embeddingTimeoutMs < 100 || embeddingTimeoutMs > 3_600_000) {
      throw new Error('ACE_EMBEDDING_TIMEOUT_MS must be an integer between 100 and 3600000');
    }
    const embeddingConfig: ResolvedEmbeddingConfig = {
      provider: embeddingProvider,
      model: embeddingModel,
      modelRevision: embeddingRevision,
      artifactModel: embeddingArtifactModel,
      artifactRevision: embeddingArtifactRevision,
      artifactDigest: embeddingArtifactDigest,
      dimension: embeddingDimension,
      preprocessing: embeddingPreprocessing,
      executionMode: embeddingExecutionMode,
      pinned: embeddingPinned,
    };
    const embeddingEnvironment: Record<string, string> = {
      ACE_EMBEDDING_PROVIDER: embeddingProvider,
      ACE_EMBEDDING_MODEL: embeddingModel,
      ACE_EMBEDDING_MODEL_REVISION: embeddingRevision,
      ACE_EMBEDDING_ARTIFACT_MODEL: embeddingArtifactModel,
      ACE_EMBEDDING_ARTIFACT_REVISION: embeddingArtifactRevision,
      ACE_EMBEDDING_DIMENSION: String(embeddingDimension),
      ACE_EMBEDDING_PREPROCESSING: embeddingPreprocessing,
      ACE_EMBEDDING_EXECUTION_MODE: embeddingExecutionMode,
      ACE_EMBEDDING_PINNED: String(embeddingPinned),
      ...(embeddingArtifactDigest === 'unverified' ? {} : { ACE_EMBEDDING_ARTIFACT_DIGEST: embeddingArtifactDigest }),
    };
    for (const name of ['ACE_EMBEDDING_PYTHON', 'ACE_EMBEDDING_LD_LIBRARY_PATH', 'FASTEMBED_CACHE_PATH', 'HF_HOME', 'HF_HUB_CACHE']) {
      const value = process.env[name]?.trim();
      if (value !== undefined && value.length > 0) embeddingEnvironment[name] = value;
    }
    if (process.env.ACE_ENABLE_TEST_FAILPOINTS === 'true') {
      const delay = process.env.ACE_EMBEDDING_DELAY_MS?.trim();
      if (delay !== undefined && delay.length > 0) embeddingEnvironment.ACE_EMBEDDING_DELAY_MS = delay;
    }
    const retrievalStrategyRaw = process.env.ACE_RETRIEVAL_STRATEGY?.trim() || 'hybrid_rrf';
    if (!['dense', 'sparse', 'hybrid_rrf'].includes(retrievalStrategyRaw)) {
      throw new Error('ACE_RETRIEVAL_STRATEGY must be dense, sparse, or hybrid_rrf');
    }
    const retrievalStrategy = retrievalStrategyRaw as 'dense' | 'sparse' | 'hybrid_rrf';
    const sparseEmbeddingModel = process.env.ACE_SPARSE_EMBEDDING_MODEL?.trim() || 'Qdrant/bm25';
    const sparseEmbeddingWorker = process.env.ACE_SPARSE_EMBEDDING_WORKER?.trim()
      || resolve(runtimeRoot, 'scripts/fastembed-sparse-worker.sh');
    const sparseEmbeddingTimeoutMs = Number(process.env.ACE_SPARSE_EMBEDDING_TIMEOUT_MS ?? '120000');
    if (!Number.isSafeInteger(sparseEmbeddingTimeoutMs)
      || sparseEmbeddingTimeoutMs < 100
      || sparseEmbeddingTimeoutMs > 3_600_000) {
      throw new Error('ACE_SPARSE_EMBEDDING_TIMEOUT_MS must be an integer between 100 and 3600000');
    }
    const candidateLimit = Number(process.env.ACE_CONTEXT_CANDIDATE_LIMIT ?? '6');
    if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 20) throw new Error('ACE_CONTEXT_CANDIDATE_LIMIT must be an integer between 1 and 20');
    const rerankerCandidateLimit = Number(process.env.ACE_RERANKER_CANDIDATE_LIMIT ?? String(Math.min(50, candidateLimit * 4)));
    if (!Number.isSafeInteger(rerankerCandidateLimit) || rerankerCandidateLimit < candidateLimit || rerankerCandidateLimit > 50) {
      throw new Error('ACE_RERANKER_CANDIDATE_LIMIT must be an integer between ACE_CONTEXT_CANDIDATE_LIMIT and 50');
    }
    const rerankerTimeoutMs = Number(process.env.ACE_RERANKER_TIMEOUT_MS ?? '120000');
    if (!Number.isSafeInteger(rerankerTimeoutMs) || rerankerTimeoutMs < 100 || rerankerTimeoutMs > 3_600_000) {
      throw new Error('ACE_RERANKER_TIMEOUT_MS must be an integer between 100 and 3600000');
    }
    const rerankerModel = process.env.ACE_RERANKER_MODEL?.trim();
    const rerankerWorker = process.env.ACE_RERANKER_WORKER?.trim() || resolve(runtimeRoot, 'scripts/fastembed-reranker-worker.sh');
    let reranker: ReturnType<typeof makeProcessRerankerPort> | undefined;
    if (rerankerMode !== 'disabled') {
      if (rerankerModel === undefined || rerankerModel.length === 0 || !commandBoundaryExists(rerankerWorker)) {
        readiness.reranker = { state: 'not_ready', reason: 'reranker_configuration_missing' };
      } else {
        const rerankerEnvironment: Record<string, string> = { ACE_RERANKER_MODEL: rerankerModel };
        for (const name of ['ACE_RERANKER_PYTHON', 'ACE_RERANKER_THREADS', 'FASTEMBED_CACHE_PATH', 'HF_HOME', 'HF_HUB_CACHE']) {
          const value = process.env[name]?.trim();
          if (value !== undefined && value.length > 0) rerankerEnvironment[name] = value;
        }
        const candidate = makeProcessRerankerPort({
          command: rerankerWorker,
          args: rerankerWorkerArgs,
          expectedModel: rerankerModel,
          timeoutMs: rerankerTimeoutMs,
          providerVersion: `fastembed/cross-encoder|model=${rerankerModel}`,
          trace: providerTrace,
          env: rerankerEnvironment,
        });
        const probe = await Effect.runPromise(candidate.probe());
        if (probe._tag === 'Ok') {
          reranker = candidate;
          closeReranker = candidate.close;
          readiness.reranker = { state: 'ready', reason: 'real_reranker_preflight_passed' };
        } else {
          candidate.close();
          readiness.reranker = { state: 'not_ready', reason: 'reranker_provider_unavailable' };
          process.stderr.write(`ace-mcp reranker NOT_READY: provider preflight failed (${probe.error.code})\n`);
        }
      }
    }
    const workspaceKey = createHash('sha256').update(registered.value.workspaceId).digest('hex').slice(0, 12);
    const generation = observationEpoch;
    const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
      || resolve(runtimeRoot, embeddingProvider === 'sentence-transformers/pytorch'
        ? 'scripts/sentence-transformers-worker.sh'
        : 'scripts/fastembed-worker.sh');
    const handleQdrantUnavailable = (errorCode: string): void => {
      readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_collection_unavailable' };
      readiness.unified_context = { state: 'not_ready', reason: 'qdrant_collection_unavailable' };
      process.stderr.write(`ace-mcp context NOT_READY: qdrant service unavailable (${errorCode})\n`);
    };
    const qdrantReachable = await Effect.runPromise(probeQdrantService(
      http,
      qdrantUrl,
      qdrantAllowedHosts,
      qdrantClient,
    ));
    if (qdrantReachable._tag === 'Err') {
      handleQdrantUnavailable(qdrantReachable.error.code);
    } else if (!commandBoundaryExists(embeddingWorker)
      || (retrievalStrategy !== 'dense' && !commandBoundaryExists(sparseEmbeddingWorker))
      || (astGrepProvider !== 'napi' && !commandBoundaryExists(astGrepCommand))) {
      readiness.code_retrieval = { state: 'not_ready', reason: 'provider_runtime_missing' };
      readiness.unified_context = { state: 'not_ready', reason: 'provider_runtime_missing' };
      process.stderr.write('ace-mcp context NOT_READY: configured embedding/ast-grep runtime files are missing\n');
    } else {
      const embeddings = makeProcessEmbeddingPort({
        command: embeddingWorker,
        args: embeddingWorkerArgs,
        dimension: embeddingDimension,
        timeoutMs: embeddingTimeoutMs,
        providerVersion: `${embeddingProvider}|model=${embeddingModel}@${embeddingRevision}|artifact=${embeddingArtifactModel}@${embeddingArtifactRevision}#${embeddingArtifactDigest}`,
        trace: providerTrace,
        env: embeddingEnvironment,
        expectedIdentity: embeddingConfig,
      });
      const sparseEnvironment: Record<string, string> = {
        ACE_SPARSE_EMBEDDING_MODEL: sparseEmbeddingModel,
      };
      for (const name of [
        'ACE_SPARSE_EMBEDDING_PYTHON',
        'ACE_SPARSE_EMBEDDING_LD_LIBRARY_PATH',
        'ACE_SPARSE_EMBEDDING_LD_PRELOAD',
        'ACE_SPARSE_EMBEDDING_THREADS',
        'FASTEMBED_CACHE_PATH',
        'HF_HOME',
        'HF_HUB_CACHE',
      ]) {
        const value = process.env[name]?.trim();
        if (value !== undefined && value.length > 0) sparseEnvironment[name] = value;
      }
      const sparseEmbeddings = retrievalStrategy === 'dense' ? undefined : makeProcessSparseEmbeddingPort({
        command: sparseEmbeddingWorker,
        args: sparseEmbeddingWorkerArgs,
        timeoutMs: sparseEmbeddingTimeoutMs,
        expectedModel: sparseEmbeddingModel,
        providerVersion: `fastembed/sparse|model=${sparseEmbeddingModel}`,
        trace: providerTrace,
        env: sparseEnvironment,
      });
      const closeEmbeddingWorker = (): void => embeddings.close();
      const closeSparseWorker = (): void => sparseEmbeddings?.close();
      closeSparseEmbeddings = closeSparseWorker;
      process.once('SIGTERM', closeEmbeddingWorker);
      process.once('SIGTERM', closeSparseWorker);
      process.once('SIGINT', closeEmbeddingWorker);
      process.once('SIGINT', closeSparseWorker);
      process.stdin.once('end', () => setTimeout(closeEmbeddingWorker, 5_000));
      process.stdin.once('end', () => setTimeout(closeSparseWorker, 5_000));
      const embeddingReady = await Effect.runPromise(embeddings.probe());
      const sparseReady = embeddingReady._tag === 'Ok' && sparseEmbeddings !== undefined
        ? await Effect.runPromise(sparseEmbeddings.probe())
        : undefined;
      if (embeddingReady._tag === 'Err') {
        embeddings.close();
        sparseEmbeddings?.close();
        if (embeddingReady.error.path === 'embedding.identity') {
          throw new Error(`embedding provider identity/configuration trust boundary failed (${embeddingReady.error.code}: ${embeddingReady.error.message})`);
        }
        readiness.code_retrieval = { state: 'not_ready', reason: 'embedding_provider_unavailable' };
        readiness.unified_context = { state: 'not_ready', reason: 'embedding_provider_unavailable' };
        process.stderr.write(`ace-mcp context NOT_READY: embedding provider preflight failed (${embeddingReady.error.code})\n`);
      } else if (sparseReady?._tag === 'Err') {
        embeddings.close();
        sparseEmbeddings?.close();
        if (sparseReady.error.path === 'sparse_embedding.identity') {
          throw new Error(`sparse embedding identity/configuration trust boundary failed (${sparseReady.error.code}: ${sparseReady.error.message})`);
        }
        readiness.sparse_embedding = { state: 'not_ready', reason: 'sparse_embedding_provider_unavailable' };
        readiness.code_retrieval = { state: 'not_ready', reason: 'sparse_embedding_provider_unavailable' };
        readiness.unified_context = { state: 'not_ready', reason: 'sparse_embedding_provider_unavailable' };
        process.stderr.write(`ace-mcp context NOT_READY: sparse embedding provider preflight failed (${sparseReady.error.code})\n`);
      } else {
        const effectiveEmbedding = embeddings.identity();
        const effectiveSparseEmbedding = sparseEmbeddings?.identity();
        if (effectiveEmbedding === undefined
          || (retrievalStrategy !== 'dense' && effectiveSparseEmbedding === undefined)) {
          embeddings.close();
          sparseEmbeddings?.close();
          readiness.sparse_embedding = { state: 'not_ready', reason: 'sparse_embedding_identity_unavailable' };
          readiness.code_retrieval = { state: 'not_ready', reason: 'retrieval_identity_unavailable' };
          readiness.unified_context = { state: 'not_ready', reason: 'retrieval_identity_unavailable' };
          process.stderr.write('ace-mcp context NOT_READY: required embedding provider returned no verified identity\n');
        } else {
          readiness.sparse_embedding = effectiveSparseEmbedding === undefined
            ? { state: 'disabled', reason: 'dense_only_no_sparse_worker' }
            : { state: 'ready', reason: 'real_sparse_embedding_preflight_passed' };
          const embeddingFingerprint = verifiedEmbeddingIdentityFingerprint(effectiveEmbedding);
          const sparseEmbeddingFingerprint = effectiveSparseEmbedding === undefined
            ? 'disabled'
            : sparseEmbeddingIdentityFingerprint(effectiveSparseEmbedding);
          const structuralOptions = {
            command: astGrepCommand,
            provider: astGrepProvider,
            providerVersion: astGrepProvider === 'napi'
              ? process.env.ACE_AST_GREP_NAPI_VERSION?.trim() || 'ast-grep/napi@0.51.0'
              : process.env.ACE_AST_GREP_VERSION?.trim() || 'ast-grep/0.51.0',
            trace: providerTrace,
          };
          const structuralIdentity = await Effect.runPromise(resolveAstGrepProviderIdentity(structuralOptions));
          if (structuralIdentity._tag === 'Ok') effectiveStructuralProviderIdentity = structuralIdentity.value.version;
          const structuralFingerprint = structuralIdentity._tag === 'Ok'
            ? structuralIdentity.value.fingerprint
            : createHash('sha256')
              .update(`unverified-structural-runtime:${randomUUID()}`, 'utf8')
              .digest('hex');
          const retrievalFingerprint = createHash('sha256')
            .update(JSON.stringify({
              schema: retrievalStrategy === 'dense' ? 'dense-qdrant-v1' : 'hybrid-qdrant-local-sparse-v2',
              embedding: embeddingFingerprint,
              sparseEmbedding: sparseEmbeddingFingerprint,
              structural: structuralFingerprint,
              denseVector: 'dense',
              sparseVector: 'sparse',
              sparseModel: effectiveSparseEmbedding?.model ?? null,
              sparsePreprocessing: effectiveSparseEmbedding?.preprocessing ?? null,
              fusion: retrievalStrategy === 'dense' ? 'none' : 'rrf',
            }), 'utf8')
            .digest('hex');
          if (structuralIdentity._tag === 'Err') {
            process.stderr.write(`ace retrieval warning: structural identity unverified; cache disabled and cross-restart snapshot reuse intentionally disabled (${structuralIdentity.error.code})\n`);
          }
          const structural = makeAstGrepStructuralPort(structuralOptions);
          const repoMapService = makeRepoMapService();
          const repoMapSymbolIdsByPath = new Map<RepoPath, readonly RepoMapSymbolId[]>();
          let activeRepoMap: RepoMapService | undefined;
          let latestBuild: LocalCodeIndexBuild | undefined;
          let nextGeneration = generation;
          let workspaceSync: WorkspaceSync | undefined;
          let latestPublished: QdrantContextConfig | undefined;
          let semanticSnapshot: {
            readonly files: Readonly<Record<string, string>>;
            readonly manifest: LocalCodeIndexBuild['fileManifest'];
          } | undefined;
          const retrievalRelevantPath = (repoPath: string): boolean =>
            !isSensitiveSourcePath(repoPath)
            && (structuralLanguageForPath(repoPath) !== undefined
              || /(?:^|\/)(?:tsconfig(?:\..+)?\.json|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(repoPath));
          const publishBuild = async (
            build: LocalCodeIndexBuild,
            buildGeneration: number,
            verification: 'full' | 'incremental' = 'full',
            changedPaths: readonly RepoPath[] = [],
            delta?: WorkspaceManifestDelta,
            deltaMetrics?: {
              readonly added: number;
              readonly changed: number;
              readonly deleted: number;
              readonly renamed: number;
              readonly unchanged: number;
            },
          ): Promise<Result<QdrantContextConfig, DomainError>> => {
            for (const warning of build.warnings) process.stderr.write(`ace retrieval warning: ${warning}\n`);
            const sourceKey = codeIndexKey(build.index, build.coverage, retrievalFingerprint, build.fileManifest);
            const collection = qdrantCollectionName(workspaceKey, embeddingFingerprint, retrievalFingerprint);
            const inspected = await Effect.runPromise(ensureQdrantCollection(
              http,
              qdrantUrl,
              collection,
              effectiveEmbedding.dimension,
              qdrantAllowedHosts,
              qdrantApiKey,
              qdrantClient,
              retrievalStrategy === 'dense' ? 'dense' : 'hybrid',
            ));
            if (inspected._tag === 'Err') return inspected;
            const buildQdrant = makeQdrantCodeCandidatePort({
              baseUrl: qdrantUrl,
              collection,
              client: qdrantClient,
              allowedHosts: qdrantAllowedHosts,
              providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
              trace: providerTrace,
            });
            const sourceFiles = await Effect.runPromise(readVerifiedSemanticSnapshot(
              files,
              registered.value.rootPath,
              build.indexedPaths,
              build.fileManifest,
              semanticSnapshot,
            ));
            if (sourceFiles._tag === 'Err') return sourceFiles;
            const sourceBytesByPath = new Map<RepoPath, Uint8Array>(
              Object.entries(sourceFiles.value).map(([repoPath, source]) => [repoPath as RepoPath, new TextEncoder().encode(source)]),
            );
            const changedPathSet = verification === 'incremental' ? new Set(changedPaths) : undefined;
            const removedSymbolIds = verification === 'incremental'
              ? changedPaths.flatMap((repoPath) => repoMapSymbolIdsByPath.get(repoPath) ?? [])
              : [];
            const structuralAnalyses = [...(build.structuralAnalysesByPath?.values() ?? [])];
            const missingReferenceCoverage = structuralAnalyses.filter((analysis) =>
              analysis.symbols.length > 0 && analysis.identifiers === undefined);
            if (missingReferenceCoverage.length > 0
              || !structuralAnalyses.some((analysis) => analysis.identifiers !== undefined)) {
              activeRepoMap = undefined;
              process.stderr.write(`ace-mcp RepoMap NOT_READY: shared def/ref records incomplete for ${missingReferenceCoverage.length} structural files; refusing a second parser pass\n`);
            } else {
              const repoMapDelta = await Effect.runPromise(buildRepoMapDelta({
                candidates: build.index.candidates,
                structuralAnalyses,
                sourceBytesByPath,
                ...(changedPathSet === undefined ? {} : { upsertPaths: changedPathSet }),
                removedSymbolIds,
              }));
              if (repoMapDelta._tag === 'Err') {
                activeRepoMap = undefined;
                process.stderr.write(`ace-mcp RepoMap NOT_READY: structural graph assembly failed (${repoMapDelta.error.code})\n`);
              } else {
                const updatedRepoMap = await Effect.runPromise(repoMapService.update(repoMapDelta.value));
                if (updatedRepoMap._tag === 'Err') {
                  activeRepoMap = undefined;
                  process.stderr.write(`ace-mcp RepoMap NOT_READY: structural graph update failed (${updatedRepoMap.error.code})\n`);
                } else {
                  for (const repoPath of changedPaths) repoMapSymbolIdsByPath.delete(repoPath);
                  for (const symbol of repoMapDelta.value.upserted) {
                    repoMapSymbolIdsByPath.set(symbol.repoPath, [
                      ...(repoMapSymbolIdsByPath.get(symbol.repoPath) ?? []),
                      symbol.id,
                    ]);
                  }
                  for (const [repoPath, ids] of repoMapSymbolIdsByPath) {
                    repoMapSymbolIdsByPath.set(repoPath, [...new Set(ids)]);
                  }
                  activeRepoMap = repoMapService;
                }
              }
            }
            // Pinned Claw descriptors + existing vscode-jsonrpc/registry:
            // each installed language server owns only its known extensions.
            const lspOverridden = [
              'ACE_LSP_COMMAND', 'ACE_LSP_ARGS', 'ACE_LSP_SERVER', 'ACE_LSP_LANGUAGE_IDS',
            ].some((name) => process.env[name] !== undefined);
            const discovered = lspOverridden ? [] : selectInstalledLspServersForPaths(
              build.indexedPaths,
              (entry) => {
                const candidate = entry.command === 'typescript-language-server'
                  ? resolve(runtimeRoot, 'node_modules/.bin/typescript-language-server') : entry.command;
                try {
                  const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 1_000 });
                  return probe.error === undefined;
                } catch { return false; }
              },
            );
            const serverPlans = discovered.length > 0 ? discovered.map((entry) => ({
              command: entry.command === 'typescript-language-server'
                ? resolve(runtimeRoot, 'node_modules/.bin/typescript-language-server') : entry.command,
              args: entry.args,
              serverName: entry.command,
              languageIds: entry.languageIds,
            })) : [{
              command: lspCommand,
              args: lspArgs,
              serverName: lspServerName,
              languageIds: lspLanguageIds ?? (lspServerName === 'typescript-language-server'
                ? knownLspServers().find((entry) => entry.command === 'typescript-language-server')?.languageIds ?? {}
                : {}),
            }];
            const providerIdentities = await Promise.all(serverPlans.map((plan) =>
              commandBoundaryExists(plan.command)
                ? Effect.runPromise(resolveLspProviderIdentity({
                  command: plan.command, args: plan.args,
                  serverName: plan.serverName, snapshotIdentity: sourceKey,
                }))
                : Promise.resolve(undefined)));
            const semanticProviderVersion = serverPlans.map((plan, index) => {
              const identity = providerIdentities[index];
              return `${plan.serverName}:${identity?._tag === 'Ok' ? identity.value.version : 'unavailable'}`;
            }).join('|');
            const configIdentity = build.workspaceManifest.files
              .filter((file) => /^tsconfig(?:\..+)?\.json$/u.test(file.repoPath))
              .map((file) => `${file.repoPath}:${file.sourceDigest}`).sort().join('|') || 'absent';
            const declarationIdentity = build.workspaceManifest.files
              .filter((file) => file.repoPath.endsWith('.d.ts'))
              .map((file) => `${file.repoPath}:${file.sourceDigest}`).sort().join('|') || 'absent';
            const packageLockIdentity = build.workspaceManifest.files
              .filter((file) => /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(file.repoPath))
              .map((file) => `${file.repoPath}:${file.sourceDigest}`).sort().join('|') || 'absent';
            const semanticIdentity = semanticSnapshotIdentity({
              indexKey: sourceKey,
              tsconfigIdentity: configIdentity,
              projectReferencesIdentity: configIdentity,
              moduleResolutionIdentity: 'node-next|allowJs=true|checkJs=false|target=es2022',
              declarationsIdentity: declarationIdentity,
              packageLockIdentity,
              providerIdentity: serverPlans.map((plan, index) => {
                const identity = providerIdentities[index];
                return `${plan.command}|${identity?._tag === 'Ok' ? identity.value.fingerprint : 'unverified'}`;
              }).join('|'),
            });
            // Keep process identity independent from source generation. A
            // reused session is refreshed through its serialized lifecycle;
            // retain the lease until this publication commits so a prior
            // generation cannot close the shared process underneath it.
            const acquiredRoutes: {
              readonly lease: { readonly session: ReturnType<typeof makeLspSemanticAnalysisPort>; readonly created: boolean; readonly release: () => void };
              readonly languageIds: Readonly<Record<string, string>>;
            }[] = [];
            for (const [index, plan] of serverPlans.entries()) {
              const identity = providerIdentities[index];
              // Optional unavailable servers never block non-LSP retrieval.
              if (identity?._tag !== 'Ok') continue;
              const descriptor = makeLspServerDescriptor({
                workspaceId: registered.value.workspaceId,
                rootPath: registered.value.rootPath,
                command: plan.command, args: plan.args,
                serverName: plan.serverName, languageIds: plan.languageIds,
              });
              const acquired = await Effect.runPromise(lspRegistry.acquire(descriptor, () =>
                makeLspSemanticAnalysisPort({
                  command: plan.command, args: plan.args,
                  serverName: plan.serverName, rootPath: registered.value.rootPath,
                  files: sourceFiles.value, languageIds: plan.languageIds,
                  providerVersion: identity.value.version,
                  snapshotIdentity: semanticIdentity, trace: providerTrace,
                })));
              if (acquired._tag === 'Err') {
                for (const route of acquiredRoutes) route.lease.release();
                return acquired;
              }
              acquiredRoutes.push({ lease: acquired.value, languageIds: plan.languageIds });
            }
            const semantics = makeRoutedLspSession(acquiredRoutes.map(({ lease, languageIds }) =>
              ({ session: lease.session, languageIds })));
            const semanticLease = {
              session: semantics,
              created: acquiredRoutes.every((route) => route.lease.created),
              release: (): void => { for (const route of acquiredRoutes) route.lease.release(); },
            };
            const lspConfigured = acquiredRoutes.some((route) =>
              build.indexedPaths.some((file) => lspLanguageIdForPath(file, route.languageIds) !== undefined));
            if (!lspConfigured) {
              process.stderr.write('ace-mcp semantic LSP NOT_READY: no installed server for indexed source languages\n');
            }
            let finalManifest;
            if (verification === 'incremental') {
              const verificationProbe = await Effect.runPromise(observeWorkspaceManifest(
                files,
                registered.value.rootPath,
                build.workspaceManifest,
                retrievalRelevantPath,
              ));
              if (verificationProbe._tag === 'Err') {
                semanticLease.release();
                return verificationProbe;
              }
              finalManifest = verificationProbe.value.manifest ?? build.workspaceManifest;
            } else {
              const finalSnapshot = await Effect.runPromise(files.snapshot(registered.value.rootPath, Date.now()));
              if (finalSnapshot._tag === 'Err') {
                semanticLease.release();
                return finalSnapshot;
              }
              finalManifest = workspaceManifestFromSnapshot(finalSnapshot.value, scopeFingerprint);
            }
            if (!workspaceManifestEqual(build.workspaceManifest, finalManifest)) {
              semanticLease.release();
              return err(domainError('WORKTREE_RACED', 'workspace_manifest', 'workspace changed while assembling the semantic snapshot'));
            }
            semanticSnapshot = { files: sourceFiles.value, manifest: build.fileManifest };
            // Verify authoritative source bytes and prepare semantic context before
            // publishing or pruning Qdrant points. On a raced/failed exact read,
            // retain the last-known-good physical index for the active generation.
            const indexed = await Effect.runPromise(verification === 'incremental'
              ? mutateQdrantChangedPaths(
                build.index,
                buildQdrant,
                embeddings,
                registered.value.workspaceId,
                changedPaths,
                sourceKey,
                embeddingFingerprint,
                sparseEmbeddings,
                {
                  http,
                  baseUrl: qdrantUrl,
                  collection,
                  allowedHosts: qdrantAllowedHosts,
                  client: qdrantClient,
                },
                new Set(build.coverage.failures.map((failure) => failure.repoPath)),
              )
              : reuseOrPopulateQdrantSnapshot(
                build.index, buildQdrant, embeddings, http, qdrantUrl, collection,
                registered.value.workspaceId, sourceKey, qdrantAllowedHosts, true, undefined,
                embeddingFingerprint, collection,
                sparseEmbeddings,
                qdrantClient,
                true, // stable physical membership permits mixed index_key values after changed-path publication
              ));
            if (indexed._tag === 'Err') { semanticLease.release(); return indexed; }
            process.stderr.write(`ace-mcp qdrant candidate verified workspace_id=${registered.value.workspaceId} index_key=${sourceKey} collection=${collection} publication_mode=stable_collection_direct reused_vectors=${indexed.value.reusedVectorCount}\n`);
            if (runtimeTestFailpoint === 'after_qdrant_verify_before_publish') {
              process.stderr.write('ace test failpoint reached name=after_qdrant_verify_before_publish\n');
              process.kill(process.pid, 'SIGKILL');
              throw new Error('test failpoint failed to terminate the process');
            }
            // Refresh a reused semantic session only after all fallible
            // manifest and Qdrant preparation has succeeded. From this point
            // to the returned publication there are no awaited provider
            // operations, so a failed preparation cannot leave the previous
            // Qdrant publication paired with a newer LSP snapshot.
            for (const route of acquiredRoutes.filter((item) => !item.lease.created)) {
              const refreshed = await Effect.runPromise(route.lease.session.refresh(sourceFiles.value, semanticIdentity));
              if (refreshed._tag === 'Err') {
                semanticLease.release();
                return refreshed;
              }
            }
            const qdrant = makeQdrantCodeCandidatePort({
              baseUrl: qdrantUrl,
              collection,
              client: qdrantClient,
              allowedHosts: qdrantAllowedHosts,
              providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
              trace: providerTrace,
            });
            const oldCloseSemantics = closeSemantics;
            closeSemantics = semanticLease.release;
            if (oldCloseSemantics !== undefined) oldCloseSemantics();
            readiness.semantic_lsp = lspConfigured
              ? { state: 'degraded', reason: 'provider_configured_lazy_not_health_probed' }
              : { state: 'not_ready', reason: 'lsp_provider_unavailable' };
            const documentation = makeDocumentationProvider(registered.value.workspaceId, http, providerTrace);
            if (process.env.ACE_ENABLE_VERTEX === 'true') {
              readiness.documentation = process.env.ACE_CLOUD_DOCS_OPT_IN !== 'true'
                ? { state: 'disabled', reason: 'cloud_docs_opt_in_false' }
                : documentation === undefined
                  ? { state: 'not_ready', reason: 'vertex_configuration_missing' }
                  : { state: 'degraded', reason: 'provider_configured_not_health_probed' };
            }
            const requiredRerankerMissing = rerankerMode === 'required' && reranker === undefined;
            readiness.code_retrieval = requiredRerankerMissing
              ? { state: 'not_ready', reason: 'required_reranker_unavailable' }
              : build.coverage.failedPaths === 0
                ? { state: 'ready', reason: 'real_provider_preflight_passed' }
                : { state: 'degraded', reason: 'index_coverage_partial' };
            readiness.unified_context = requiredRerankerMissing
              ? { state: 'not_ready', reason: 'required_reranker_unavailable' }
              : build.coverage.failedPaths === 0
                ? { state: 'ready', reason: 'real_code_context_preflight_passed' }
                : { state: 'degraded', reason: 'index_coverage_partial' };
            process.stderr.write(`ace-mcp real retrieval workspace_id=${registered.value.workspaceId} generation=${buildGeneration} indexed_paths=${build.indexedPaths.length} candidates=${build.index.candidates.length} coverage_failed=${build.coverage.failedPaths} delta_added=${deltaMetrics?.added ?? delta?.added.length ?? 0} delta_changed=${deltaMetrics?.changed ?? delta?.changed.length ?? 0} delta_deleted=${deltaMetrics?.deleted ?? delta?.deleted.length ?? 0} delta_renamed=${deltaMetrics?.renamed ?? delta?.renamed.length ?? 0} delta_unchanged=${deltaMetrics?.unchanged ?? (delta === undefined ? build.indexedPaths.length : 0)} source_snapshot_digest=${build.coverage.sourceSnapshotDigest} embedding_identity=${embeddingFingerprint.slice(0, 12)} sparse_identity=${sparseEmbeddingFingerprint.slice(0, 12)} retrieval_mode=${retrievalStrategy} sparse_model=${effectiveSparseEmbedding?.model ?? 'disabled'} structural_identity=${structuralFingerprint.slice(0, 12)} lsp_identity=${semanticProviderVersion} retrieval_fingerprint=${retrievalFingerprint} index_key=${sourceKey} index_mode=${indexed.value.reused ? 'warm_reused' : 'rebuilt'} reused_vectors=${indexed.value.reusedVectorCount} collection=${collection} publication_mode=stable_collection_direct\n`);
            return ok({
              workspaceId: registered.value.workspaceId,
              rootPath: registered.value.rootPath,
              files,
              qdrant,
              embeddings,
              ...(sparseEmbeddings === undefined ? {} : { sparseEmbeddings }),
              artifacts,
              semantics,
              newRequestId: () => randomUUID(),
              ...(indexed.value.reused ? {} : { generation: buildGeneration }),
              indexKey: sourceKey,
              candidateLimit,
              retrievalStrategy,
              ...(rerankerMode === 'disabled' ? {} : { rerankerMode }),
              ...(reranker === undefined ? {} : { reranker }),
              ...(rerankerMode === 'disabled' ? {} : { rerankerCandidateLimit }),
              coverage: build.coverage,
              workspaceManifest: finalManifest,
              scopeFingerprint,
              semanticSnapshotIdentity: semanticIdentity,
              trace: providerTrace,
              ...(benchmarkTrace === undefined ? {} : { benchmarkTrace }),
              ...(benchmarkRepositoryId === undefined ? {} : { benchmarkRepositoryId }),
              benchmarkProviderIdentities: {
                dense: `${effectiveEmbedding.provider}|model=${effectiveEmbedding.model}|revision=${effectiveEmbedding.modelRevision}|artifact=${effectiveEmbedding.artifactRevision}`,
                sparse: effectiveSparseEmbedding === undefined
                  ? 'disabled'
                  : `${effectiveSparseEmbedding.provider}|model=${effectiveSparseEmbedding.model}|runtime=${effectiveSparseEmbedding.runtimeVersion}|artifact=${effectiveSparseEmbedding.artifactDigest}`,
                qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
                structural: effectiveStructuralProviderIdentity,
                semantic: semanticProviderVersion,
                reranker: rerankerModel === undefined ? 'disabled' : `fastembed/cross-encoder|model=${rerankerModel}`,
              },
              history,
              ...(documentation === undefined ? {} : { documentation }),
              ...(memory === undefined ? {} : { memory }),
              ...(activeRepoMap === undefined ? {} : { repoMap: activeRepoMap }),
            });
          };
          const reconcileRuntime: NonNullable<QdrantContextConfig['reconcile']> = (currentManifest, delta) => {
            const sync = workspaceSync;
            if (sync === undefined) return Effect.succeed(err(domainError('NOT_READY', 'workspace_sync', 'workspace synchronization is not initialized')));
            return Effect.gen(function*() {
              const refreshed = yield* sync.refresh({ manifest: currentManifest, delta });
              if (refreshed._tag === 'Err') return refreshed;
              const published = latestPublished;
              if (published === undefined) return err(domainError('NOT_READY', 'workspace_sync', 'synchronized publication is not available'));
              process.stderr.write(`ace-mcp workspace reconciled changed=${delta.changed.length} added=${delta.added.length} deleted=${delta.deleted.length} renamed=${delta.renamed.length} scope_changed=${delta.scopeChanged} refreshed=${String(refreshed.value.refreshed)}\n`);
              return ok({
                ...published,
                reconcile: reconcileRuntime,
                workspaceSync: sync,
                qdrantStableCollection: true,
              });
            });
          };
          const startupObservation = await Effect.runPromise(files.observeChanges(registered.value.rootPath));
          const startupDeltaMetrics = startupObservation._tag === 'Ok'
            ? {
              added: startupObservation.value.addedPaths.length,
              changed: startupObservation.value.changedPaths.length,
              deleted: startupObservation.value.deletedPaths.length,
              renamed: startupObservation.value.renamed.length,
              unchanged: 0,
            }
            : undefined;
          const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
            generation,
            scopeFingerprint,
            structural,
            parserVersion: structuralFingerprint,
          }));
          if (built._tag === 'Err') {
            embeddings.close();
            readiness.code_retrieval = { state: 'not_ready', reason: 'structural_index_failed' };
            readiness.unified_context = { state: 'not_ready', reason: 'structural_index_failed' };
            process.stderr.write(`ace-mcp context NOT_READY: structural index failed (${built.error.code})\n`);
          } else {
            const published = await publishBuild(built.value, generation, 'full', [], undefined, startupDeltaMetrics);
            if (published._tag === 'Err') {
              embeddings.close();
              readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_index_failed' };
              readiness.unified_context = { state: 'not_ready', reason: 'qdrant_index_failed' };
              process.stderr.write(`ace-mcp context NOT_READY: retrieval publication failed (${published.error.code}: ${published.error.message})\n`);
            } else {
              latestBuild = built.value;
              latestPublished = published.value;
              const initialIndexKey = published.value.indexKey;
              if (initialIndexKey === undefined) {
                readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_index_key_missing' };
                readiness.unified_context = { state: 'not_ready', reason: 'qdrant_index_key_missing' };
              } else {
                workspaceSync = makeWorkspaceSync({
                  initial: {
                    workspaceId: registered.value.workspaceId,
                    workspaceManifest: built.value.workspaceManifest,
                    generation,
                    indexKey: initialIndexKey,
                    candidateIdsByPath: candidateMembershipByPath(built.value.index.candidates.map((candidate) => ({ candidate, score: 0, freshness: 'unknown' }))),
                  },
                  observeChanges: (current, forceExactPaths) => observeWorkspaceManifest(
                    files,
                    registered.value.rootPath,
                    current.workspaceManifest,
                    retrievalRelevantPath,
                    forceExactPaths,
                  ),
                  rebuild: ({ nextManifest, delta }) => Effect.promise(async () => {
                    if (latestBuild === undefined) return err(domainError('NOT_READY', 'workspace_sync', 'initial retrieval snapshot is not available'));
                    const rebuildGeneration = nextGeneration + 1;
                    const rebuilt = await Effect.runPromise(buildLocalCodeIndex(
                      files,
                      registered.value.workspaceId,
                      registered.value.rootPath,
                      {
                        generation: rebuildGeneration,
                        previous: latestBuild,
                        scopeFingerprint,
                        structural,
                        parserVersion: structuralFingerprint,
                        snapshot: workspaceSnapshotFromManifest(nextManifest, Date.now()),
                      },
                    ));
                    if (rebuilt._tag === 'Err') return rebuilt;
                    if (!workspaceManifestEqual(rebuilt.value.workspaceManifest, nextManifest)) {
                      return err(domainError('WORKTREE_RACED', 'workspace_manifest', 'workspace changed during reconciliation'));
                    }
                    const changedPaths = [
                      ...delta.changed,
                      ...delta.added,
                      ...delta.deleted,
                      ...delta.renamed.flatMap((entry) => [entry.from, entry.to]),
                    ];
                    const nextPublished = await publishBuild(rebuilt.value, rebuildGeneration, 'incremental', changedPaths, delta);
                    if (nextPublished._tag === 'Err') return nextPublished;
                    const nextIndexKey = nextPublished.value.indexKey;
                    if (nextIndexKey === undefined) return err(domainError('NOT_READY', 'workspace_sync', 'synchronized publication has no index key'));
                    latestBuild = rebuilt.value;
                    nextGeneration = rebuildGeneration;
                    latestPublished = nextPublished.value;
                    return ok({
                      workspaceId: registered.value.workspaceId,
                      workspaceManifest: nextPublished.value.workspaceManifest ?? rebuilt.value.workspaceManifest,
                      generation: rebuildGeneration,
                      indexKey: nextIndexKey,
                      candidateIdsByPath: candidateMembershipByPath(rebuilt.value.index.candidates.map((candidate) => ({ candidate, score: 0, freshness: 'unknown' }))),
                    });
                  }),
                });
                context = makeQdrantContextProvider({
                  ...published.value,
                  reconcile: reconcileRuntime,
                  workspaceSync,
                  qdrantStableCollection: true,
                });
              }
            }
          }
        }
      }
    }
  } else {
    readiness.code_retrieval = { state: 'not_ready', reason: 'real_provider_disabled' };
    readiness.unified_context = { state: 'not_ready', reason: 'real_provider_disabled' };
    process.stderr.write('ace-mcp context NOT_READY: enable ACE_ENABLE_EXPERIMENTAL_QDRANT=true for the real local Qdrant+FastEmbed+ast-grep+TypeScript-LS composition; provider outage remains not_ready\n');
  }
  const gateway = makeMcpGateway({
    clock: ports.clock,
    ids: ports.ids,
    files,
    store,
    artifacts,
    ...(context === undefined ? {} : { context }),
    ...(memory === undefined ? {} : { memory }),
    readiness: () => ({ ...readiness }),
  });
  const contextBridge = context === undefined
    ? undefined
    : makeContextTransformService({
      ids: ports.ids,
      store,
      context,
      assembler: makeContextAssembler(),
      providerIdentities: {
        dense: process.env.ACE_EMBEDDING_PROVIDER?.trim() || 'fastembed/onnx',
        sparse: process.env.ACE_SPARSE_EMBEDDING_MODEL?.trim() || 'Qdrant/bm25',
        qdrant: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
        structural: effectiveStructuralProviderIdentity,
        semantic: process.env.ACE_LSP_VERSION?.trim() || 'typescript-language-server/6.0.2',
      },
    });
  try {
    if (process.env.ACE_GATEWAY_HTTP_MODE === 'true') {
      if (contextBridge === undefined) throw new Error('ACE gateway HTTP requires a ready context provider');
      await runGatewayProjectionHttp(makeGatewayProjectionService(contextBridge));
    } else if (process.env.ACE_CONTEXT_BRIDGE_MODE === 'true') {
      if (contextBridge === undefined) throw new Error('ACE context bridge requires a ready context provider');
      await runContextBridgeStdio(contextBridge);
    } else {
      await runMcpSdkStdio(gateway, benchmarkTrace === undefined ? {} : { benchmarkTrace });
    }
  } finally {
    let cleanupError: unknown;
    try {
      if (closeSemantics !== undefined) closeSemantics();
      await Effect.runPromise(lspRegistry.close());
      if (closeReranker !== undefined) closeReranker();
      if (closeSparseEmbeddings !== undefined) closeSparseEmbeddings();
      if (closeMemory !== undefined) await closeMemory();
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        if (benchmarkTrace !== undefined) await benchmarkTrace.close();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError instanceof Error) throw cleanupError;
    if (cleanupError !== undefined) throw new Error('ACE cleanup failed');
  }
};

try {
  await main();
} catch (error) {
  process.stderr.write(`ace-mcp failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
