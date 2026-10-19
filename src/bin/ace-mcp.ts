#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
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
import { ensureQdrantCollection, makeQdrantContextProvider, populateQdrantFromStructuralIndex } from '../adapters/qdrant-context-provider.js';
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

const defaultEmbeddingModel = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

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
  const policy = {
    ...defaultLocalPolicy(workspaceId),
    cloudOptIn: true,
    allowedCloudProviders: ['vertex'] as const,
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
  const generation = observed.value.observationEpoch;
  // No pretend success: the local lexical provider is a consciously enabled
  // degraded fallback, NOT the selected Qdrant/embeddings/AST/LSP production path.
  const allowLocalFallback = process.env.ACE_ALLOW_LOCAL_FALLBACK === 'true';
  const structuralHelper = process.env.ACE_TREE_SITTER_HELPER?.trim();
  const artifacts = makeFileArtifactStore(artifactDirectory);
  const structuralPath = resolve(process.env.ACE_TREE_SITTER_HELPER?.trim() || 'scripts/tree-sitter-structural.py');
  const structuralPython = optionalPath(process.env.ACE_TREE_SITTER_PYTHON, '.venv-system/bin/python');
  let context: ReturnType<typeof makeLocalContextProvider> | undefined;
  if (process.env.ACE_ENABLE_EXPERIMENTAL_QDRANT === 'true') {
    const http = makeFetchHttpPort();
    const qdrantUrl = process.env.ACE_QDRANT_URL?.trim() || 'http://127.0.0.1:6333';
    const embeddingModel = process.env.ACE_EMBEDDING_MODEL?.trim() || defaultEmbeddingModel;
    const collection = process.env.ACE_QDRANT_COLLECTION?.trim()
      || `ace_code_paraphrase_multilingual_minilm_l12_v2_g${generation}`;
    const embeddingWorker = process.env.ACE_EMBEDDING_WORKER?.trim()
      || resolve('scripts/fastembed-worker.sh');
    const embeddingDimension = Number(process.env.ACE_EMBEDDING_DIMENSION ?? '384');
    const inspected = await Effect.runPromise(ensureQdrantCollection(http, qdrantUrl, collection, embeddingDimension));
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
    } else if (embeddingModel !== defaultEmbeddingModel && process.env.ACE_QDRANT_COLLECTION === undefined) {
      process.stderr.write('ace-mcp context NOT_READY: a non-default embedding model requires an explicit versioned ACE_QDRANT_COLLECTION\n');
    } else if (!existsSync(embeddingWorker) || !existsSync(structuralPath) || !existsSync(structuralPython)) {
      process.stderr.write('ace-mcp context NOT_READY: configured FastEmbed/Tree-sitter runtime files are missing\n');
    } else {
      const embeddings = makeProcessEmbeddingPort({ command: embeddingWorker, dimension: embeddingDimension });
      const closeEmbeddingWorker = (): void => embeddings.close();
      process.once('SIGTERM', closeEmbeddingWorker);
      process.once('SIGINT', closeEmbeddingWorker);
      // The SDK may still be dispatching the final JSON-RPC message when the
      // input stream reaches EOF. Give in-flight retrieval a bounded grace
      // period before closing the long-lived embedding child.
      process.stdin.once('end', () => setTimeout(closeEmbeddingWorker, 5_000));
      const structural = makeTreeSitterStructuralPort({ helperPath: structuralPath, pythonCommand: structuralPython });
      const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
        generation,
        structural,
      }));
      if (built._tag === 'Err') {
        embeddings.close();
        process.stderr.write(`ace-mcp context NOT_READY: structural index failed (${built.error.code})\n`);
      } else {
        for (const warning of built.value.warnings) process.stderr.write(`ace retrieval warning: ${warning}\n`);
        const indexed = await Effect.runPromise(populateQdrantFromStructuralIndex(built.value.index, makeQdrantCodeCandidatePort({ baseUrl: qdrantUrl, collection, http }), embeddings));
        if (indexed._tag === 'Err') {
          embeddings.close();
          process.stderr.write(`ace-mcp context NOT_READY: Qdrant indexing failed (${indexed.error.code}: ${indexed.error.message})\n`);
        } else {
          const sourceFiles = await readSourceFiles(files, registered.value.rootPath, built.value.indexedPaths);
          const semantics = makeTypeScriptLanguageServicePort({ rootPath: registered.value.rootPath, files: sourceFiles });
          const documentation = makeDocumentationProvider(registered.value.workspaceId, http);
          context = makeQdrantContextProvider({
            workspaceId: registered.value.workspaceId,
            rootPath: registered.value.rootPath,
            files,
            qdrant: makeQdrantCodeCandidatePort({ baseUrl: qdrantUrl, collection, http }),
            embeddings,
            artifacts,
            semantics,
            newRequestId: () => randomUUID(),
            generation,
            ...(documentation === undefined ? {} : { documentation }),
          });
          process.stderr.write(`ace-mcp real retrieval workspace_id=${registered.value.workspaceId} generation=${generation} indexed_paths=${built.value.indexedPaths.length} candidates=${built.value.index.candidates.length} collection=${collection}\n`);
        }
      }
    }
  } else if (allowLocalFallback) {
    const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
      generation,
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
