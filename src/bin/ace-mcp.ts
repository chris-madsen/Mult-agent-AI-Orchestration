#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { makeAsyncFileMemoryArchive } from '../adapters/file-memory-archive.js';
import { makeFileDecisionHistory } from '../adapters/file-decision-history.js';
import { makeGraphitiMcpPort } from '../adapters/graphiti-mcp.js';
import { makeHostWorkspacePort, makeMtlsHostHelperTransport } from '../adapters/host-worktree-helper.js';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../adapters/http-provider-boundaries.js';
import { buildLocalCodeIndex } from '../adapters/local-code-index.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import {
  makeProcessEmbeddingPort,
  verifiedEmbeddingIdentityFingerprint,
  type ResolvedEmbeddingConfig,
} from '../adapters/process-embedding.js';
import { makeFileProviderTrace } from '../adapters/provider-trace.js';
import {
  codeIndexKey,
  qdrantCollectionName,
  qdrantCurrentAlias,
  ensureQdrantCollection,
  makeQdrantContextProvider,
  probeQdrantService,
  resolveQdrantAlias,
  reuseOrPopulateQdrantSnapshot,
  switchQdrantAlias,
} from '../adapters/qdrant-context-provider.js';
import { makeAstGrepStructuralPort, resolveAstGrepProviderIdentity } from '../adapters/ast-grep-structural.js';
import { makeLspSemanticAnalysisPort, resolveLspProviderIdentity } from '../adapters/lsp-semantic.js';
import { makeVertexRagRetrievalPort } from '../adapters/vertex-rag.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
import type { MemorySearchPort, WorkspaceFilePort } from '../application/ports.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import { makeWorkspaceId, type WorkspaceId } from '../domain/workspace.js';
import { observeWorkspace, registerWorkspace } from '../application/workspace-service.js';
import { readVerifiedSemanticSnapshot, semanticSnapshotIdentity } from '../application/semantic-snapshot.js';
import { makeMcpGateway, type CapabilityReadiness } from '../gateway/mcp-gateway.js';
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

const commandBoundaryExists = (value: string): boolean => value.includes('/') ? existsSync(value) : true;

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
  const runtimeTestFailpoint = configuredRuntimeTestFailpoint();
  const rootPath = resolve(required('ACE_WORKSPACE_ROOT'));
  const allowedRoots = (process.env.ACE_ALLOWED_ROOTS ?? rootPath)
    .split(':')
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
  const readiness: Record<string, CapabilityReadiness> = {
    worktree: {
      state: 'ready',
      reason: helperUrl === undefined || helperUrl.length === 0 ? 'local_exact_read_ready' : 'authenticated_host_helper_ready',
    },
    code_retrieval: { state: 'not_ready', reason: 'provider_not_initialized' },
    unified_context: { state: 'not_ready', reason: 'provider_not_initialized' },
    semantic_lsp: { state: 'not_ready', reason: 'provider_not_initialized' },
    project_memory: process.env.ACE_ENABLE_GRAPHITI === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'graphiti_disabled' },
    documentation: process.env.ACE_ENABLE_VERTEX === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'vertex_disabled' },
  };
  const astGrepCommand = optionalCommand(
    process.env.ACE_AST_GREP_COMMAND,
    resolve('node_modules/.bin/ast-grep'),
  );
  const lspCommand = optionalCommand(
    process.env.ACE_LSP_COMMAND,
    resolve('node_modules/.bin/typescript-language-server'),
  );
  const artifacts = makeFileArtifactStore(artifactDirectory);
  const providerTrace = makeFileProviderTrace(process.env.ACE_PROVIDER_TRACE_FILE);
  let memory: MemorySearchPort | undefined;
  let closeMemory: (() => Promise<void>) | undefined;
  let closeSemantics: (() => void) | undefined;
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
  if (process.env.ACE_ENABLE_EXPERIMENTAL_QDRANT === 'true') {
    const http = makeFetchHttpPort();
    const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
    const qdrantAllowedHosts = (process.env.ACE_QDRANT_LOCAL_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0);
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
    const candidateLimit = Number(process.env.ACE_CONTEXT_CANDIDATE_LIMIT ?? '6');
    if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 20) throw new Error('ACE_CONTEXT_CANDIDATE_LIMIT must be an integer between 1 and 20');
    const workspaceKey = createHash('sha256').update(registered.value.workspaceId).digest('hex').slice(0, 12);
    const generation = observationEpoch;
    const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
      || resolve(embeddingProvider === 'sentence-transformers/pytorch'
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
    ));
    if (qdrantReachable._tag === 'Err') {
      handleQdrantUnavailable(qdrantReachable.error.code);
    } else if (!existsSync(embeddingWorker) || !existsSync(astGrepCommand) || !commandBoundaryExists(astGrepCommand)) {
      readiness.code_retrieval = { state: 'not_ready', reason: 'provider_runtime_missing' };
      readiness.unified_context = { state: 'not_ready', reason: 'provider_runtime_missing' };
      process.stderr.write('ace-mcp context NOT_READY: configured embedding/ast-grep runtime files are missing\n');
    } else {
      const embeddings = makeProcessEmbeddingPort({
        command: embeddingWorker,
        dimension: embeddingDimension,
        timeoutMs: embeddingTimeoutMs,
        providerVersion: `${embeddingProvider}|model=${embeddingModel}@${embeddingRevision}|artifact=${embeddingArtifactModel}@${embeddingArtifactRevision}#${embeddingArtifactDigest}`,
        trace: providerTrace,
        env: embeddingEnvironment,
        expectedIdentity: embeddingConfig,
      });
      const closeEmbeddingWorker = (): void => embeddings.close();
      process.once('SIGTERM', closeEmbeddingWorker);
      process.once('SIGINT', closeEmbeddingWorker);
      process.stdin.once('end', () => setTimeout(closeEmbeddingWorker, 5_000));
      const embeddingReady = await Effect.runPromise(embeddings.probe());
      if (embeddingReady._tag === 'Err') {
        embeddings.close();
        if (embeddingReady.error.path === 'embedding.identity') {
          throw new Error(`embedding provider identity/configuration trust boundary failed (${embeddingReady.error.code}: ${embeddingReady.error.message})`);
        }
        readiness.code_retrieval = { state: 'not_ready', reason: 'embedding_provider_unavailable' };
        readiness.unified_context = { state: 'not_ready', reason: 'embedding_provider_unavailable' };
        process.stderr.write(`ace-mcp context NOT_READY: embedding provider preflight failed (${embeddingReady.error.code})\n`);
      } else {
        const effectiveEmbedding = embeddings.identity();
        if (effectiveEmbedding === undefined) {
          embeddings.close();
          readiness.code_retrieval = { state: 'not_ready', reason: 'embedding_identity_unavailable' };
          readiness.unified_context = { state: 'not_ready', reason: 'embedding_identity_unavailable' };
          process.stderr.write('ace-mcp context NOT_READY: embedding provider preflight returned no verified effective identity\n');
        } else {
          const embeddingFingerprint = verifiedEmbeddingIdentityFingerprint(effectiveEmbedding);
          const structuralOptions = {
            command: astGrepCommand,
            providerVersion: process.env.ACE_AST_GREP_VERSION?.trim() || 'ast-grep/0.51.0',
            trace: providerTrace,
          };
          const structuralIdentity = await Effect.runPromise(resolveAstGrepProviderIdentity(structuralOptions));
          const structuralFingerprint = structuralIdentity._tag === 'Ok'
            ? structuralIdentity.value.fingerprint
            : createHash('sha256')
              .update(`unverified-structural-runtime:${randomUUID()}`, 'utf8')
              .digest('hex');
          const retrievalFingerprint = createHash('sha256')
            .update(JSON.stringify({
              embedding: embeddingFingerprint,
              structural: structuralFingerprint,
            }), 'utf8')
            .digest('hex');
          if (structuralIdentity._tag === 'Err') {
            process.stderr.write(`ace retrieval warning: structural identity unverified; cache disabled and cross-restart snapshot reuse intentionally disabled (${structuralIdentity.error.code})\n`);
          }
          const structural = makeAstGrepStructuralPort(structuralOptions);
          const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
            generation,
            scopeFingerprint,
            structural,
            parserVersion: structuralOptions.providerVersion,
          }));
          if (built._tag === 'Err') {
            embeddings.close();
            readiness.code_retrieval = { state: 'not_ready', reason: 'structural_index_failed' };
            readiness.unified_context = { state: 'not_ready', reason: 'structural_index_failed' };
            process.stderr.write(`ace-mcp context NOT_READY: structural index failed (${built.error.code})\n`);
          } else {
            for (const warning of built.value.warnings) process.stderr.write(`ace retrieval warning: ${warning}\n`);
            // Snapshot identity covers every successfully read in-scope source,
            // including files that produce zero symbols, plus the verified embedding
            // and structural parser runtime identities.
            const sourceKey = codeIndexKey(
              built.value.index,
              built.value.coverage,
              retrievalFingerprint,
              built.value.fileManifest,
            );
            const collection = qdrantCollectionName(workspaceKey, embeddingFingerprint, sourceKey);
            const currentAlias = qdrantCurrentAlias(workspaceKey, embeddingFingerprint);
            const inspected = await Effect.runPromise(ensureQdrantCollection(
              http,
              qdrantUrl,
              collection,
              effectiveEmbedding.dimension,
              qdrantAllowedHosts,
            ));
            if (inspected._tag === 'Err') {
              embeddings.close();
              await handleQdrantUnavailable(inspected.error.code);
            }
            if (inspected._tag === 'Ok') {
              const previousAlias = await Effect.runPromise(resolveQdrantAlias(
                http,
                qdrantUrl,
                currentAlias,
                qdrantAllowedHosts,
              ));
              if (previousAlias._tag === 'Err') {
                process.stderr.write(`ace retrieval warning: previous Qdrant alias could not be resolved; vectors will be recomputed (${previousAlias.error.code})\n`);
              }
              const buildQdrant = makeQdrantCodeCandidatePort({
                baseUrl: qdrantUrl,
                collection,
                http,
                allowedHosts: qdrantAllowedHosts,
                providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
                trace: providerTrace,
              });
              const indexed = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
                built.value.index, buildQdrant, embeddings, http, qdrantUrl, collection,
                registered.value.workspaceId, sourceKey, qdrantAllowedHosts, true, undefined,
                embeddingFingerprint,
                previousAlias._tag === 'Ok' ? previousAlias.value : undefined,
              ));
              if (indexed._tag === 'Err') {
                embeddings.close();
                readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_index_failed' };
                readiness.unified_context = { state: 'not_ready', reason: 'qdrant_index_failed' };
                process.stderr.write(`ace-mcp context NOT_READY: Qdrant indexing failed (${indexed.error.code}: ${indexed.error.message})\n`);
              } else {
                process.stderr.write(`ace-mcp qdrant candidate verified workspace_id=${registered.value.workspaceId} index_key=${sourceKey} collection=${collection} alias=${currentAlias} reused_vectors=${indexed.value.reusedVectorCount}\n`);
                if (runtimeTestFailpoint === 'after_qdrant_verify_before_publish') {
                  process.stderr.write(
                    'ace test failpoint reached name=after_qdrant_verify_before_publish\n',
                  );
                  process.kill(process.pid, 'SIGKILL');
                  throw new Error('test failpoint failed to terminate the process');
                }
                const switched = await Effect.runPromise(switchQdrantAlias(
                  http,
                  qdrantUrl,
                  currentAlias,
                  collection,
                  qdrantAllowedHosts,
                ));
                if (switched._tag === 'Err') {
                  embeddings.close();
                  readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_alias_unavailable' };
                  readiness.unified_context = { state: 'not_ready', reason: 'qdrant_alias_unavailable' };
                  process.stderr.write(`ace-mcp context NOT_READY: Qdrant alias publication failed (${switched.error.code})\n`);
                }
                if (switched._tag === 'Ok') {
                  const qdrant = makeQdrantCodeCandidatePort({
                    baseUrl: qdrantUrl,
                    collection: currentAlias,
                    http,
                    allowedHosts: qdrantAllowedHosts,
                    providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
                    trace: providerTrace,
                  });
                  const sourceFiles = await Effect.runPromise(readVerifiedSemanticSnapshot(
                    files,
                    registered.value.rootPath,
                    built.value.indexedPaths,
                    built.value.fileManifest,
                  ));
                  if (sourceFiles._tag === 'Err') {
                    embeddings.close();
                    throw new Error(`LSP semantic snapshot could not be bound to indexed source bytes (${sourceFiles.error.code})`);
                  }
                  const lspProviderIdentity = existsSync(lspCommand) && commandBoundaryExists(lspCommand)
                    ? await Effect.runPromise(resolveLspProviderIdentity({
                      command: lspCommand,
                      snapshotIdentity: sourceKey,
                    }))
                    : undefined;
                  const semanticProviderVersion = lspProviderIdentity?._tag === 'Ok'
                    ? lspProviderIdentity.value.version
                    : process.env.ACE_LSP_VERSION?.trim() || 'typescript-language-server/unavailable';
                  const configIdentity = built.value.workspaceManifest.files
                    .filter((file) => /^tsconfig(?:\..+)?\.json$/u.test(file.repoPath))
                    .map((file) => `${file.repoPath}:${file.sourceDigest}`)
                    .sort()
                    .join('|') || 'absent';
                  const declarationIdentity = built.value.workspaceManifest.files
                    .filter((file) => file.repoPath.endsWith('.d.ts'))
                    .map((file) => `${file.repoPath}:${file.sourceDigest}`)
                    .sort()
                    .join('|') || 'absent';
                  const packageLockIdentity = built.value.workspaceManifest.files
                    .filter((file) => /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(file.repoPath))
                    .map((file) => `${file.repoPath}:${file.sourceDigest}`)
                    .sort()
                    .join('|') || 'absent';
                  const semanticIdentity = semanticSnapshotIdentity({
                    indexKey: sourceKey,
                    tsconfigIdentity: configIdentity,
                    projectReferencesIdentity: configIdentity,
                    moduleResolutionIdentity: 'node-next|allowJs=true|checkJs=false|target=es2022',
                    declarationsIdentity: declarationIdentity,
                    packageLockIdentity,
                    providerIdentity: `${lspCommand}|${semanticProviderVersion}|${lspProviderIdentity?._tag === 'Ok' ? lspProviderIdentity.value.fingerprint : 'unverified'}`,
                  });
                  const semantics = makeLspSemanticAnalysisPort({
                    command: lspCommand,
                    rootPath: registered.value.rootPath,
                    files: sourceFiles.value,
                    providerVersion: semanticProviderVersion,
                    snapshotIdentity: semanticIdentity,
                    trace: providerTrace,
                  });
                  closeSemantics = semantics.close;
                  const firstLspPath = built.value.indexedPaths.find((repoPath) => /\.(?:c|m)?tsx?$|\.jsx?$/u.test(repoPath));
                  let lspReady = lspProviderIdentity?._tag === 'Ok' && firstLspPath !== undefined;
                  if (firstLspPath !== undefined && lspProviderIdentity?._tag === 'Ok') {
                    const languageServiceReady = await Effect.runPromise(semantics.diagnostics({ repoPath: firstLspPath }));
                    lspReady = languageServiceReady._tag === 'Ok';
                    if (!lspReady) process.stderr.write(`ace-mcp semantic LSP NOT_READY: preflight failed (${languageServiceReady._tag === 'Err' ? languageServiceReady.error.code : 'unknown'})\n`);
                  } else if (!lspReady) {
                    process.stderr.write(firstLspPath === undefined
                      ? 'ace-mcp semantic LSP NOT_READY: no LSP-capable source language is present in this workspace\n'
                      : 'ace-mcp semantic LSP NOT_READY: typescript-language-server identity is unavailable\n');
                  }
                  readiness.semantic_lsp = lspReady
                    ? { state: 'ready', reason: 'real_lsp_provider_preflight_passed' }
                    : { state: 'not_ready', reason: 'lsp_provider_unavailable' };
                  const documentation = makeDocumentationProvider(registered.value.workspaceId, http, providerTrace);
                  if (process.env.ACE_ENABLE_VERTEX === 'true') {
                    if (process.env.ACE_CLOUD_DOCS_OPT_IN !== 'true') {
                      readiness.documentation = { state: 'disabled', reason: 'cloud_docs_opt_in_false' };
                    } else if (documentation === undefined) {
                      readiness.documentation = { state: 'not_ready', reason: 'vertex_configuration_missing' };
                    } else {
                      readiness.documentation = { state: 'degraded', reason: 'provider_configured_not_health_probed' };
                    }
                  }
                  context = makeQdrantContextProvider({
                    workspaceId: registered.value.workspaceId,
                    rootPath: registered.value.rootPath,
                    files,
                    qdrant,
                    embeddings,
                    artifacts,
                    semantics,
                    newRequestId: () => randomUUID(),
                    // A warm index can have an older observation epoch; the precise
                    // content-derived indexKey is authoritative and every snippet is
                    // reverified against current bytes. Do not relabel its generation.
                    ...(indexed.value.reused ? {} : { generation }),
                    indexKey: sourceKey,
                    candidateLimit,
                    coverage: built.value.coverage,
                    workspaceManifest: built.value.workspaceManifest,
                    scopeFingerprint,
                    semanticSnapshotIdentity: semanticIdentity,
                    trace: providerTrace,
                    ...(documentation === undefined ? {} : { documentation }),
                    ...(memory === undefined ? {} : { memory }),
                  });
                  readiness.code_retrieval = built.value.coverage.failedPaths === 0
                    ? { state: 'ready', reason: 'real_provider_preflight_passed' }
                    : { state: 'degraded', reason: 'index_coverage_partial' };
                  readiness.unified_context = built.value.coverage.failedPaths === 0
                    ? { state: 'ready', reason: 'real_code_context_preflight_passed' }
                    : { state: 'degraded', reason: 'index_coverage_partial' };
                  process.stderr.write(`ace-mcp real retrieval workspace_id=${registered.value.workspaceId} generation=${generation} indexed_paths=${built.value.indexedPaths.length} candidates=${built.value.index.candidates.length} coverage_failed=${built.value.coverage.failedPaths} source_snapshot_digest=${built.value.coverage.sourceSnapshotDigest} embedding_identity=${embeddingFingerprint.slice(0, 12)} structural_identity=${structuralFingerprint.slice(0, 12)} lsp_identity=${semanticProviderVersion} retrieval_fingerprint=${retrievalFingerprint} index_key=${sourceKey} index_mode=${indexed.value.reused ? 'warm_reused' : 'rebuilt'} reused_vectors=${indexed.value.reusedVectorCount} collection=${collection} alias=${currentAlias}\n`);
                }
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
  try {
    await runMcpSdkStdio(gateway);
  } finally {
    if (closeSemantics !== undefined) closeSemantics();
    if (closeMemory !== undefined) await closeMemory();
  }
};

try {
  await main();
} catch (error) {
  process.stderr.write(`ace-mcp failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
