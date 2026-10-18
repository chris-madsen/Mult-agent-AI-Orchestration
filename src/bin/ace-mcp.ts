#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { makeFileArtifactStore } from '../adapters/file-artifact-store.js';
import { buildLocalCodeIndex } from '../adapters/local-code-index.js';
import { makeLocalContextProvider } from '../adapters/local-context-provider.js';
import { makeNodeWorkspacePort } from '../adapters/node-workspace-port.js';
import { makeFileWorkspaceStore } from '../application/file-workspace-store.js';
import { observeWorkspace, registerWorkspace } from '../application/workspace-service.js';
import { makeMcpGateway } from '../gateway/mcp-gateway.js';
import { runMcpStdio } from '../transport/mcp-stdio.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
};

const optionalPath = (value: string | undefined, fallback: string): string =>
  resolve(value === undefined || value.trim().length === 0 ? fallback : value.trim());

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
  const built = await Effect.runPromise(buildLocalCodeIndex(files, registered.value.workspaceId, registered.value.rootPath, { generation: 1 }));
  if (built._tag === 'Err') throw new Error(`${built.error.code}: ${built.error.message}`);
  for (const warning of built.value.warnings) process.stderr.write(`ace warning: ${warning}\n`);
  process.stderr.write(`ace-mcp ready workspace_id=${registered.value.workspaceId} indexed_paths=${built.value.indexedPaths.length}\n`);
  const context = makeLocalContextProvider({
    workspaceId: registered.value.workspaceId,
    rootPath: registered.value.rootPath,
    index: built.value.index,
    files,
    newRequestId: () => randomUUID(),
  });
  const gateway = makeMcpGateway({
    clock: ports.clock,
    ids: ports.ids,
    files,
    store,
    artifacts: makeFileArtifactStore(artifactDirectory),
    context,
  });
  await runMcpStdio(gateway);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`ace-mcp failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
