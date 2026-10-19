#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { makeFileQdrantSnapshotState, type SnapshotLease } from '../adapters/file-qdrant-snapshot-state.js';
import { makeFileStructuralAnalysisCache } from '../adapters/file-structural-analysis-cache.js';
import { makeAsyncFileMemoryArchive } from '../adapters/file-memory-archive.js';
import { makeGraphitiMcpPort } from '../adapters/graphiti-mcp.js';
import { makeHostWorkspacePort, makeMtlsHostHelperTransport } from '../adapters/host-worktree-helper.js';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../adapters/http-provider-boundaries.js';
import { buildLocalCodeIndex } from '../adapters/local-code-index.js';
import { makeLocalContextProvider } from '../adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import { makeProcessEmbeddingPort, type ResolvedEmbeddingConfig } from '../adapters/process-embedding.js';
import { makeFileProviderTrace } from '../adapters/provider-trace.js';
import {
  codeIndexKey,
  ensureQdrantCollection,
  makeQdrantContextProvider,
  pruneQdrantUnleasedSnapshots,
  reuseOrPopulateQdrantSnapshot,
} from '../adapters/qdrant-context-provider.js';
import { makeTreeSitterStructuralPort, resolveTreeSitterProviderIdentity } from '../adapters/tree-sitter-structural.js';
import { makeTypeScriptLanguageServicePort } from '../adapters/typescript-language-service.js';
import { makeVertexRagRetrievalPort } from '../adapters/vertex-rag.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
import type { MemorySearchPort, WorkspaceFilePort } from '../application/ports.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import { makeWorkspaceId, type RepoPath, type WorkspaceId } from '../domain/workspace.js';
import { observeWorkspace, registerWorkspace } from '../application/workspace-service.js';
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

const readSourceFiles = async (
  files: WorkspaceFilePort,
  rootPath: string,
  paths: readonly RepoPath[],
): Promise<Readonly<Record<string, string>>> => {
  const entries: Array<readonly [string, string]> = [];
  for (const repoPath of paths) {
    const source = await Effect.runPromise(files.readExact(rootPath, repoPath));
    if (source._tag === 'Ok') entries.push([repoPath, Buffer.from(source.value.bytes).toString('utf8')]);
  }
  return Object.fromEntries(entries);
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
    project_memory: process.env.ACE_ENABLE_GRAPHITI === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'graphiti_disabled' },
    documentation: process.env.ACE_ENABLE_VERTEX === 'true'
      ? { state: 'not_ready', reason: 'provider_not_initialized' }
      : { state: 'disabled', reason: 'vertex_disabled' },
  };
  // No pretend success: the local lexical provider is a consciously enabled
  // degraded fallback, NOT the selected Qdrant/embeddings/AST/LSP production path.
  const allowLocalFallback = process.env.ACE_ALLOW_LOCAL_FALLBACK === 'true';
  const structuralHelper = process.env.ACE_TREE_SITTER_HELPER?.trim();
  const artifacts = makeFileArtifactStore(artifactDirectory);
  const providerTrace = makeFileProviderTrace(process.env.ACE_PROVIDER_TRACE_FILE);
  let memory: MemorySearchPort | undefined;
  let closeMemory: (() => Promise<void>) | undefined;
  let snapshotLease: SnapshotLease | undefined;
  const snapshotState = await makeFileQdrantSnapshotState(resolve(stateDirectory, 'qdrant-snapshots'));
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
    try {
      const graphiti = await makeGraphitiMcpPort({
        command,
        args,
        groupId: required('ACE_GRAPHITI_GROUP_ID'),
        workspaceId: registered.value.workspaceId,
        policy: defaultLocalPolicy(registered.value.workspaceId),
        archive,
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
  const structuralPath = resolve(process.env.ACE_TREE_SITTER_HELPER?.trim() || 'scripts/tree-sitter-structural.py');
  const structuralPython = optionalCommand(process.env.ACE_TREE_SITTER_PYTHON, resolve('.venv-system/bin/python'));
  let context: ReturnType<typeof makeLocalContextProvider> | undefined;
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
    if (process.env.ACE_REQUIRE_PINNED_EMBEDDING === 'true'
      && (!/^[a-f0-9]{40}$/u.test(embeddingRevision)
        || !/^[a-f0-9]{40}$/u.test(embeddingArtifactRevision)
        || !/^[a-f0-9]{64}$/u.test(embeddingArtifactDigest))) {
      throw new Error('ACE_REQUIRE_PINNED_EMBEDDING requires model/artifact revisions and a 64-character artifact digest');
    }
    const embeddingDimension = Number(process.env.ACE_EMBEDDING_DIMENSION ?? '384');
    if (!Number.isSafeInteger(embeddingDimension) || embeddingDimension < 1) throw new Error('ACE_EMBEDDING_DIMENSION must be a positive integer');
    const embeddingConfig: ResolvedEmbeddingConfig = {
      provider: embeddingProvider,
      model: embeddingModel,
      modelRevision: embeddingRevision,
      artifactModel: embeddingArtifactModel,
      artifactRevision: embeddingArtifactRevision,
      artifactDigest: embeddingArtifactDigest,
      dimension: embeddingDimension,
      preprocessing: embeddingPreprocessing,
    };
    const embeddingEnvironment: Record<string, string> = {
      ACE_EMBEDDING_PROVIDER: embeddingProvider,
      ACE_EMBEDDING_MODEL: embeddingModel,
      ACE_EMBEDDING_MODEL_REVISION: embeddingRevision,
      ACE_EMBEDDING_ARTIFACT_MODEL: embeddingArtifactModel,
      ACE_EMBEDDING_ARTIFACT_REVISION: embeddingArtifactRevision,
      ACE_EMBEDDING_DIMENSION: String(embeddingDimension),
      ACE_EMBEDDING_PREPROCESSING: embeddingPreprocessing,
      ...(embeddingArtifactDigest === 'unverified' ? {} : { ACE_EMBEDDING_ARTIFACT_DIGEST: embeddingArtifactDigest }),
    };
    for (const name of ['ACE_EMBEDDING_PYTHON', 'ACE_EMBEDDING_LD_LIBRARY_PATH', 'FASTEMBED_CACHE_PATH', 'HF_HOME', 'HF_HUB_CACHE']) {
      const value = process.env[name]?.trim();
      if (value !== undefined && value.length > 0) embeddingEnvironment[name] = value;
    }
    const candidateLimit = Number(process.env.ACE_CONTEXT_CANDIDATE_LIMIT ?? '6');
    if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 20) throw new Error('ACE_CONTEXT_CANDIDATE_LIMIT must be an integer between 1 and 20');
    const workspaceKey = createHash('sha256').update(registered.value.workspaceId).digest('hex').slice(0, 12);
    const modelKey = createHash('sha256').update(`snapshot-v2|${embeddingProvider}|${embeddingModel}|${embeddingRevision}|${embeddingArtifactModel}|${embeddingArtifactRevision}|${embeddingArtifactDigest}|${embeddingPreprocessing}|${embeddingDimension}`).digest('hex').slice(0, 12);
    const generation = observationEpoch;
    const collection = process.env.ACE_QDRANT_COLLECTION?.trim() || `ace_code_${workspaceKey}_${modelKey}`;
    const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
      || resolve(embeddingProvider === 'sentence-transformers/pytorch'
        ? 'scripts/sentence-transformers-worker.sh'
        : 'scripts/fastembed-worker.sh');
    const inspected = await Effect.runPromise(ensureQdrantCollection(http, qdrantUrl, collection, embeddingDimension, qdrantAllowedHosts));
    if (inspected._tag === 'Err') {
      readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_collection_unavailable' };
      readiness.unified_context = { state: 'not_ready', reason: 'qdrant_collection_unavailable' };
      if (allowLocalFallback) {
        const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
          generation,
          ...(!existsSync(structuralPath) || !existsSync(structuralPython) ? {} : {
            structural: makeTreeSitterStructuralPort({ helperPath: structuralPath, pythonCommand: structuralPython }),
          }),
        }));
        if (built._tag === 'Err') {
          process.stderr.write(`ace-mcp context NOT_READY: qdrant failed and degraded index failed (${built.error.code})\n`);
        } else {
          context = makeLocalContextProvider({
            workspaceId: registered.value.workspaceId,
            rootPath: registered.value.rootPath,
            index: built.value.index,
            files,
            newRequestId: () => randomUUID(),
            failedSources: ['qdrant'],
            additionalWarnings: [`Qdrant unavailable: ${inspected.error.code}`],
          });
          readiness.code_retrieval = { state: 'degraded', reason: 'lexical_fallback_qdrant_unavailable' };
          readiness.unified_context = { state: 'degraded', reason: 'lexical_fallback_qdrant_unavailable' };
          process.stderr.write(`ace-mcp degraded retrieval workspace_id=${registered.value.workspaceId} generation=${generation} reason=qdrant_unavailable\n`);
        }
      } else {
        process.stderr.write(`ace-mcp context NOT_READY: qdrant collection check failed (${inspected.error.code})\n`);
      }
    } else if (!existsSync(embeddingWorker) || !existsSync(structuralPath) || !commandBoundaryExists(structuralPython)) {
      readiness.code_retrieval = { state: 'not_ready', reason: 'provider_runtime_missing' };
      readiness.unified_context = { state: 'not_ready', reason: 'provider_runtime_missing' };
      process.stderr.write('ace-mcp context NOT_READY: configured FastEmbed/Tree-sitter runtime files are missing\n');
    } else {
      const embeddings = makeProcessEmbeddingPort({
        command: embeddingWorker,
        dimension: embeddingDimension,
        providerVersion: `${embeddingProvider}|model=${embeddingModel}@${embeddingRevision}|artifact=${embeddingArtifactModel}@${embeddingArtifactRevision}#${embeddingArtifactDigest}`,
        trace: providerTrace,
        env: embeddingEnvironment,
        expectedIdentity: embeddingConfig,
      });
      const closeEmbeddingWorker = (): void => embeddings.close();
      process.once('SIGTERM', closeEmbeddingWorker);
      process.once('SIGINT', closeEmbeddingWorker);
      // The SDK may still be dispatching the final JSON-RPC message when the
      // input stream reaches EOF. Give in-flight retrieval a bounded grace
      // period before closing the long-lived embedding child.
      process.stdin.once('end', () => setTimeout(closeEmbeddingWorker, 5_000));
      const embeddingReady = await Effect.runPromise(embeddings.probe());
      if (embeddingReady._tag === 'Err') {
        embeddings.close();
        throw new Error(`embedding provider preflight failed (${embeddingReady.error.code})`);
      }
      const effectiveEmbedding = embeddings.identity();
      if (effectiveEmbedding === undefined) {
        embeddings.close();
        throw new Error('embedding provider preflight did not return a verified effective identity');
      }
      const embeddingFingerprint = createHash('sha256')
        .update(JSON.stringify(effectiveEmbedding), 'utf8')
        .digest('hex');
      const structuralOptions = {
        helperPath: structuralPath,
        pythonCommand: structuralPython,
        providerVersion: process.env.ACE_TREE_SITTER_VERSION?.trim() || 'tree-sitter/0.26.0',
        trace: providerTrace,
      };
      const structuralIdentity = await Effect.runPromise(resolveTreeSitterProviderIdentity(structuralOptions));
      const structuralCache = structuralIdentity._tag === 'Ok'
        ? await makeFileStructuralAnalysisCache(resolve(stateDirectory, 'structural-cache'))
        : undefined;
      if (structuralIdentity._tag === 'Err') {
        process.stderr.write(`ace retrieval warning: structural cache disabled because parser identity probe failed (${structuralIdentity.error.code})\n`);
      }
      const structural = makeTreeSitterStructuralPort(structuralOptions);
      const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
        generation,
        structural,
        ...(structuralCache === undefined || structuralIdentity._tag === 'Err' ? {} : {
          structuralCache,
          structuralProviderFingerprint: structuralIdentity.value.fingerprint,
        }),
      }));
      if (built._tag === 'Err') {
        embeddings.close();
        readiness.code_retrieval = { state: 'not_ready', reason: 'structural_index_failed' };
        readiness.unified_context = { state: 'not_ready', reason: 'structural_index_failed' };
        process.stderr.write(`ace-mcp context NOT_READY: structural index failed (${built.error.code})\n`);
      } else {
        for (const warning of built.value.warnings) process.stderr.write(`ace retrieval warning: ${warning}\n`);
        // Warm reuse is keyed from the exact structural candidate set actually
        // produced in this startup. It ignores observation epoch/timestamps,
        // but changes on source bytes, ranges, names or parser output.
        const sourceKey = codeIndexKey(built.value.index, built.value.coverage, embeddingFingerprint);
        const snapshotIdentity = {
          workspaceId: registered.value.workspaceId,
          indexKey: sourceKey,
          candidateIds: built.value.index.candidates.map((candidate) => candidate.candidateId),
          coverage: built.value.coverage,
          providerFingerprint: embeddingFingerprint,
        };
        const lease = await snapshotState.acquireLease(registered.value.workspaceId, sourceKey);
        if (lease._tag === 'Err') {
          embeddings.close();
          throw new Error(`Qdrant snapshot lease failed (${lease.error.code})`);
        }
        snapshotLease = lease.value;
        const published = await snapshotState.isPublished(snapshotIdentity);
        if (published._tag === 'Err') {
          embeddings.close();
          throw new Error(`Qdrant snapshot manifest check failed (${published.error.code})`);
        }
        const previous = await snapshotState.latestPublished(
          registered.value.workspaceId, embeddingFingerprint, sourceKey,
        );
        if (previous._tag === 'Err') {
          embeddings.close();
          throw new Error(`Qdrant prior snapshot lookup failed (${previous.error.code})`);
        }
        if (!published.value) {
          const begun = await snapshotState.beginBuild(snapshotIdentity);
          if (begun._tag === 'Err') {
            embeddings.close();
            throw new Error(`Qdrant snapshot manifest begin failed (${begun.error.code})`);
          }
        }
        const qdrant = makeQdrantCodeCandidatePort({
          baseUrl: qdrantUrl,
          collection,
          http,
          allowedHosts: qdrantAllowedHosts,
          providerVersion: process.env.ACE_QDRANT_VERSION?.trim() || 'qdrant/1.19.2',
          trace: providerTrace,
        });
        const indexed = await Effect.runPromise(reuseOrPopulateQdrantSnapshot(
          built.value.index, qdrant, embeddings, http, qdrantUrl, collection,
          registered.value.workspaceId, sourceKey, qdrantAllowedHosts, published.value, previous.value?.indexKey,
        ));
        if (indexed._tag === 'Err') {
          embeddings.close();
          readiness.code_retrieval = { state: 'not_ready', reason: 'qdrant_index_failed' };
          readiness.unified_context = { state: 'not_ready', reason: 'qdrant_index_failed' };
          process.stderr.write(`ace-mcp context NOT_READY: Qdrant indexing failed (${indexed.error.code}: ${indexed.error.message})\n`);
        } else {
          const publishedNow = await snapshotState.publish(snapshotIdentity);
          if (publishedNow._tag === 'Err') {
            embeddings.close();
            throw new Error(`Qdrant snapshot publish failed (${publishedNow.error.code})`);
          }
          const activeKeys = await snapshotState.activeIndexKeys(registered.value.workspaceId);
          if (activeKeys._tag === 'Err') {
            process.stderr.write(`ace retrieval warning: snapshot lease inspection failed (${activeKeys.error.code})\n`);
          } else {
            const retained = new Set(activeKeys.value);
            retained.add(sourceKey);
            const cleaned = await Effect.runPromise(pruneQdrantUnleasedSnapshots(
              http, qdrantUrl, collection, registered.value.workspaceId, retained, qdrantAllowedHosts,
            ));
            if (cleaned._tag === 'Err') {
              process.stderr.write(`ace retrieval warning: lease-aware snapshot cleanup failed (${cleaned.error.code})\n`);
            } else if (cleaned.value.length > 0) {
              process.stderr.write(`ace retrieval cleanup removed_snapshots=${cleaned.value.length}\n`);
            }
          }
          const sourceFiles = await readSourceFiles(files, registered.value.rootPath, built.value.indexedPaths);
          const semantics = makeTypeScriptLanguageServicePort({
            rootPath: registered.value.rootPath,
            files: sourceFiles,
            providerVersion: process.env.ACE_TYPESCRIPT_VERSION?.trim() || 'typescript/5.9.3',
            trace: providerTrace,
          });
          const firstIndexedPath = built.value.indexedPaths[0];
          if (firstIndexedPath === undefined) {
            embeddings.close();
            throw new Error('no source files passed the structural provider');
          }
          const languageServiceReady = await Effect.runPromise(semantics.diagnostics({ repoPath: firstIndexedPath }));
          if (languageServiceReady._tag === 'Err') {
            embeddings.close();
            throw new Error(`TypeScript language service preflight failed (${languageServiceReady.error.code})`);
          }
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
          process.stderr.write(`ace-mcp real retrieval workspace_id=${registered.value.workspaceId} generation=${generation} indexed_paths=${built.value.indexedPaths.length} candidates=${built.value.index.candidates.length} coverage_failed=${built.value.coverage.failedPaths} structural_cache_hits=${built.value.structuralCacheHits} structural_cache_misses=${built.value.structuralCacheMisses} embedding_identity=${embeddingFingerprint.slice(0, 12)} index_mode=${indexed.value.reused ? 'warm_reused' : 'rebuilt'} reused_vectors=${indexed.value.reusedVectorCount} collection=${collection}\n`);
        }
      }
    }
  } else if (allowLocalFallback) {
    const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
      generation: observationEpoch,
      ...(structuralHelper === undefined || structuralHelper === ''
        ? {}
        : { structural: makeTreeSitterStructuralPort({ helperPath: resolve(structuralHelper) }) }),
    }));
    if (built._tag === 'Err') throw new Error(`${built.error.code}: ${built.error.message}`);
    for (const warning of built.value.warnings) process.stderr.write(`ace fallback warning: ${warning}\n`);
    process.stderr.write(`ace-mcp degraded local fallback workspace_id=${registered.value.workspaceId} indexed_paths=${built.value.indexedPaths.length}\n`);
    readiness.code_retrieval = { state: 'degraded', reason: 'explicit_lexical_fallback' };
    readiness.unified_context = { state: 'degraded', reason: 'explicit_lexical_fallback' };
    context = makeLocalContextProvider({
      workspaceId: registered.value.workspaceId,
      rootPath: registered.value.rootPath,
      index: built.value.index,
      files,
      newRequestId: () => randomUUID(),
    });
  } else {
    readiness.code_retrieval = { state: 'not_ready', reason: 'real_provider_disabled' };
    readiness.unified_context = { state: 'not_ready', reason: 'real_provider_disabled' };
    process.stderr.write('ace-mcp context NOT_READY: enable ACE_ENABLE_EXPERIMENTAL_QDRANT=true for the real local Qdrant+FastEmbed+Tree-sitter+TypeScript-LS composition, or ACE_ALLOW_LOCAL_FALLBACK=true for explicit degraded lexical search\n');
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
    if (snapshotLease !== undefined) await snapshotLease.close();
    if (closeMemory !== undefined) await closeMemory();
  }
};

try {
  await main();
} catch (error) {
  process.stderr.write(`ace-mcp failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
