#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../adapters/http-provider-boundaries.js';
import { buildLocalCodeIndex } from '../adapters/local-code-index.js';
import { makeLocalContextProvider } from '../adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import { makeProcessEmbeddingPort } from '../adapters/process-embedding.js';
import { makeFileProviderTrace } from '../adapters/provider-trace.js';
import { ensureQdrantCollection, makeQdrantContextProvider, pruneQdrantOtherGenerations, reuseOrPopulateQdrantSnapshot } from '../adapters/qdrant-context-provider.js';
import { makeTreeSitterStructuralPort } from '../adapters/tree-sitter-structural.js';
import { makeTypeScriptLanguageServicePort } from '../adapters/typescript-language-service.js';
import { makeVertexRagRetrievalPort } from '../adapters/vertex-rag.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import type { RepoPath, WorkspaceId } from '../domain/workspace.js';
import { observeWorkspace, registerWorkspace } from '../application/workspace-service.js';
import { makeMcpGateway } from '../gateway/mcp-gateway.js';
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
  files: ReturnType<typeof makeNodeWorkspacePort>,
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
  const workspaceState = resolve(stateDirectory, 'workspaces.json');
  const files = makeNodeWorkspacePort({ allowedRoots });
  const store = makeFileWorkspaceStore(workspaceState);
  const configuredWorkspaceId = process.env.ACE_WORKSPACE_ID?.trim();
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
  const sourceSnapshot = observed.value.lastObservation === undefined
    ? `generation:${observationEpoch}`
    : JSON.stringify({
      headRevision: observed.value.lastObservation.headRevision,
      files: [...observed.value.lastObservation.files]
        .sort((left, right) => left.repoPath.localeCompare(right.repoPath))
        .map((file) => [file.repoPath, file.digest, file.sizeBytes]),
      removedPaths: [...observed.value.lastObservation.removedPaths].sort(),
    });
  // No pretend success: the local lexical provider is a consciously enabled
  // degraded fallback, NOT the selected Qdrant/embeddings/AST/LSP production path.
  const allowLocalFallback = process.env.ACE_ALLOW_LOCAL_FALLBACK === 'true';
  const structuralHelper = process.env.ACE_TREE_SITTER_HELPER?.trim();
  const artifacts = makeFileArtifactStore(artifactDirectory);
  const providerTrace = makeFileProviderTrace(process.env.ACE_PROVIDER_TRACE_FILE);
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
    const embeddingArtifactDigest = process.env.ACE_EMBEDDING_ARTIFACT_DIGEST?.trim() || 'unverified';
    const embeddingPreprocessing = process.env.ACE_EMBEDDING_PREPROCESSING?.trim() || defaultEmbeddingPreprocessing;
    if (process.env.ACE_REQUIRE_PINNED_EMBEDDING === 'true'
      && (!/^[a-f0-9]{40}$/u.test(embeddingRevision) || !/^[a-f0-9]{64}$/u.test(embeddingArtifactDigest))) {
      throw new Error('ACE_REQUIRE_PINNED_EMBEDDING requires a model revision and 64-character artifact digest');
    }
    const embeddingDimension = Number(process.env.ACE_EMBEDDING_DIMENSION ?? '384');
    if (!Number.isSafeInteger(embeddingDimension) || embeddingDimension < 1) throw new Error('ACE_EMBEDDING_DIMENSION must be a positive integer');
    const candidateLimit = Number(process.env.ACE_CONTEXT_CANDIDATE_LIMIT ?? '6');
    if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 20) throw new Error('ACE_CONTEXT_CANDIDATE_LIMIT must be an integer between 1 and 20');
    const workspaceKey = createHash('sha256').update(registered.value.workspaceId).digest('hex').slice(0, 12);
    const modelKey = createHash('sha256').update(`${embeddingProvider}|${embeddingModel}|${embeddingRevision}|${embeddingArtifactDigest}|${embeddingPreprocessing}|${embeddingDimension}`).digest('hex').slice(0, 12);
    // A model revision alone is not enough to isolate vectors: the same
    // workspace id and observation epoch may be reused for a changed checkout
    // or a paired fixture. Keep the collection stable, but isolate each
    // snapshot by an opaque source index key.
    const sourceKey = createHash('sha256').update(sourceSnapshot).digest('hex').slice(0, 12);
    const generation = observationEpoch;
    const collection = process.env.ACE_QDRANT_COLLECTION?.trim() || `ace_code_${workspaceKey}_${modelKey}`;
    const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
      || resolve(embeddingProvider === 'sentence-transformers/pytorch'
        ? 'scripts/sentence-transformers-worker.sh'
        : 'scripts/fastembed-worker.sh');
    const inspected = await Effect.runPromise(ensureQdrantCollection(http, qdrantUrl, collection, embeddingDimension, qdrantAllowedHosts));
    if (inspected._tag === 'Err') {
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
          process.stderr.write(`ace-mcp degraded retrieval workspace_id=${registered.value.workspaceId} generation=${generation} reason=qdrant_unavailable\n`);
        }
      } else {
        process.stderr.write(`ace-mcp context NOT_READY: qdrant collection check failed (${inspected.error.code})\n`);
      }
    } else if (!existsSync(embeddingWorker) || !existsSync(structuralPath) || !commandBoundaryExists(structuralPython)) {
      process.stderr.write('ace-mcp context NOT_READY: configured FastEmbed/Tree-sitter runtime files are missing\n');
    } else {
      const embeddings = makeProcessEmbeddingPort({
        command: embeddingWorker,
        dimension: embeddingDimension,
        providerVersion: `${embeddingProvider}|${embeddingModel}|${embeddingRevision}|${embeddingArtifactDigest}`,
        trace: providerTrace,
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
      const structural = makeTreeSitterStructuralPort({
        helperPath: structuralPath,
        pythonCommand: structuralPython,
        providerVersion: process.env.ACE_TREE_SITTER_VERSION?.trim() || 'tree-sitter/0.26.0',
        trace: providerTrace,
      });
      const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
        generation,
        structural,
      }));
      if (built._tag === 'Err') {
        embeddings.close();
        process.stderr.write(`ace-mcp context NOT_READY: structural index failed (${built.error.code})\n`);
      } else {
        for (const warning of built.value.warnings) process.stderr.write(`ace retrieval warning: ${warning}\n`);
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
          registered.value.workspaceId, sourceKey, qdrantAllowedHosts,
        ));
        if (indexed._tag === 'Err') {
          embeddings.close();
          process.stderr.write(`ace-mcp context NOT_READY: Qdrant indexing failed (${indexed.error.code}: ${indexed.error.message})\n`);
        } else {
          const pruned = await Effect.runPromise(pruneQdrantOtherGenerations(
            http, qdrantUrl, collection, registered.value.workspaceId, generation, qdrantAllowedHosts, sourceKey,
          ));
          if (pruned._tag === 'Err') process.stderr.write(`ace retrieval warning: obsolete Qdrant generation cleanup failed (${pruned.error.code})\n`);
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
          const documentation = makeDocumentationProvider(registered.value.workspaceId, http);
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
            ...(documentation === undefined ? {} : { documentation }),
          });
          process.stderr.write(`ace-mcp real retrieval workspace_id=${registered.value.workspaceId} generation=${generation} indexed_paths=${built.value.indexedPaths.length} candidates=${built.value.index.candidates.length} index_mode=${indexed.value.reused ? 'warm_reused' : 'rebuilt'} collection=${collection}\n`);
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
    context = makeLocalContextProvider({
      workspaceId: registered.value.workspaceId,
      rootPath: registered.value.rootPath,
      index: built.value.index,
      files,
      newRequestId: () => randomUUID(),
    });
  } else {
    process.stderr.write('ace-mcp context NOT_READY: enable ACE_ENABLE_EXPERIMENTAL_QDRANT=true for the real local Qdrant+FastEmbed+Tree-sitter+TypeScript-LS composition, or ACE_ALLOW_LOCAL_FALLBACK=true for explicit degraded lexical search\n');
  }
  const gateway = makeMcpGateway({
    clock: ports.clock,
    ids: ports.ids,
    files,
    store,
    artifacts,
    ...(context === undefined ? {} : { context }),
  });
  await runMcpSdkStdio(gateway);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`ace-mcp failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
