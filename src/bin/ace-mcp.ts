#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { makeFetchHttpPort, makeQdrantCodeCandidatePort } from '../adapters/http-provider-boundaries.js';
import { makeOllamaEmbeddingPort } from '../adapters/ollama-embedding.js';
import { ensureQdrantCollection, makeQdrantContextProvider, populateQdrantFromStructuralIndex } from '../adapters/qdrant-context-provider.js';
import { makeTypeScriptLanguageServicePort } from '../adapters/typescript-language-service.js';
import { buildLocalCodeIndex } from '../adapters/local-code-index.js';
import { makeLocalContextProvider } from '../adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import { makeTreeSitterStructuralPort } from '../adapters/tree-sitter-structural.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
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

// No cloud inference by accidental URL: private source/model payloads stay loopback-only.
const requireLoopback = (name: string): string => {
  const raw = required(name);
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(name + ' must use an explicit local HTTP endpoint; outbound private code is not authorized');
  }
  return url.origin;
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
  // No pretend success: the local lexical provider is a consciously enabled
  // degraded fallback, NOT the selected Qdrant/embeddings/AST/LSP production path.
  const allowLocalFallback = process.env.ACE_ALLOW_LOCAL_FALLBACK === 'true';
  const structuralHelper = process.env.ACE_TREE_SITTER_HELPER?.trim();
  const artifacts = makeFileArtifactStore(artifactDirectory);
  let context: ReturnType<typeof makeLocalContextProvider> | ReturnType<typeof makeQdrantContextProvider> | undefined;
  if (process.env.ACE_ENABLE_EXPERIMENTAL_QDRANT === 'true') {
    // This is an explicit, still-unapproved integration spike. Every selected provider
    // MUST be real before the MCP endpoint reports success. No SHA-256 pseudo-vectors.
    const helperPath = resolve(required('ACE_TREE_SITTER_HELPER'));
    const qdrantUrl = requireLoopback('ACE_QDRANT_URL');
    const ollamaUrl = requireLoopback('ACE_OLLAMA_URL');
    const model = required('ACE_EMBED_MODEL');
    const collection = required('ACE_QDRANT_COLLECTION');
    const structural = makeTreeSitterStructuralPort({
      helperPath,
      ...(process.env.ACE_PYTHON_COMMAND === undefined ? {} : { pythonCommand: process.env.ACE_PYTHON_COMMAND }),
    });
    // Every startup has a new searchable generation. Old or removed symbols
    // cannot leak into new retrieval even while an older Qdrant point exists.
    const generation = Date.now();
    const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
      generation, structural, extensions: ['.ts', '.tsx', '.js', '.jsx'],
    }));
    if (built._tag === 'Err') throw new Error(built.error.code + ': ' + built.error.message);
    if (built.value.index.candidates.length === 0) throw new Error('Structural index has no verified symbols; Qdrant not ready');
    for (const warning of built.value.warnings) process.stderr.write('ace structural warning: ' + warning + '\n');
    const http = makeFetchHttpPort();
    const embeddings = makeOllamaEmbeddingPort({ endpoint: ollamaUrl, model, http });
    const qdrant = makeQdrantCodeCandidatePort({
      baseUrl: qdrantUrl, collection, http, apiKey: () => process.env.ACE_QDRANT_API_KEY,
    });
    const probe = await Effect.runPromise(embeddings.embedMany([built.value.index.candidates[0]?.text ?? '']));
    if (probe._tag === 'Err') throw new Error(probe.error.code + ': ' + probe.error.message);
    const dimension = probe.value[0]?.length;
    if (dimension === undefined) throw new Error('Ollama returned no embedding dimension');
    const collectionReady = await Effect.runPromise(ensureQdrantCollection(http, qdrantUrl, collection, dimension, process.env.ACE_QDRANT_API_KEY));
    if (collectionReady._tag === 'Err') throw new Error(collectionReady.error.code + ': ' + collectionReady.error.message);
    const populated = await Effect.runPromise(populateQdrantFromStructuralIndex(built.value.index, qdrant, embeddings));
    if (populated._tag === 'Err') throw new Error(populated.error.code + ': ' + populated.error.message);
    const sourceMap: Record<string, string> = {};
    for (const repoPath of built.value.indexedPaths) {
      if (repoPath.endsWith('.ts') || repoPath.endsWith('.tsx') || repoPath.endsWith('.js') || repoPath.endsWith('.jsx')) {
        const exact = await Effect.runPromise(files.readExact(registered.value.rootPath, repoPath));
        if (exact._tag === 'Ok') sourceMap[repoPath] = Buffer.from(exact.value.bytes).toString('utf8');
      }
    }
    const semantics = makeTypeScriptLanguageServicePort({ rootPath: registered.value.rootPath, files: sourceMap });
    context = makeQdrantContextProvider({
      workspaceId: registered.value.workspaceId,
      rootPath: registered.value.rootPath,
      files, qdrant, embeddings, semantics, artifacts, generation,
      newRequestId: () => randomUUID(),
    });
    process.stderr.write('ace-mcp EXPERIMENTAL real Qdrant/Ollama/Tree-sitter/TypeScript-LS pipeline indexed symbols=' + populated.value + '\n');
  } else if (allowLocalFallback) {
    const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, {
      generation: 1,
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
    process.stderr.write('ace-mcp context NOT_READY: real Qdrant + embeddings + AST + LSP composition not configured; set ACE_ALLOW_LOCAL_FALLBACK=true only for explicit degraded lexical search\n');
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
