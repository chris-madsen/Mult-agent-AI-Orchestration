#!/usr/bin/env node
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { exportCodexHistory } from '../adapters/codex-session-history.js';
import { makeAsyncFileMemoryArchive } from '../adapters/file-memory-archive.js';
import { makeGraphitiMcpPort } from '../adapters/graphiti-mcp.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import { makeWorkspaceId } from '../domain/workspace.js';
import { deleteEpisodeWithProjection } from '../application/retained-memory.js';
import { makeEpisodeId } from '../domain/memory.js';

const required = (key: string): string => {
  const v = process.env[key];
  if (!v?.trim()) throw new Error(key + ' is required');
  return v.trim();
};
const run = async (): Promise<void> => {
  const [operation, subject] = process.argv.slice(2);
  if (operation !== 'import' && operation !== 'delete') throw new Error('Usage: ace-memory import <codex-history.jsonl> | delete <episode-id>');
  if (!subject) throw new Error('source path / episode ID required');
  const workspace = makeWorkspaceId(required('ACE_WORKSPACE_ID'));
  if (workspace._tag === 'Err') throw new Error(workspace.error.message);
  const archive = await makeAsyncFileMemoryArchive(resolve(required('ACE_MEMORY_ARCHIVE_ROOT')));
  const graphiti = await makeGraphitiMcpPort({
    command: required('ACE_GRAPHITI_COMMAND'),
    args: JSON.parse(required('ACE_GRAPHITI_ARGS_JSON')) as string[],
    groupId: required('ACE_GRAPHITI_GROUP_ID'),
    workspaceId: workspace.value,
    policy: defaultLocalPolicy(workspace.value),
  });
  try {
    if (operation === 'delete') {
      const episodeId = makeEpisodeId(subject);
      if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
      const deleted = await Effect.runPromise(deleteEpisodeWithProjection(archive, graphiti.projection, episodeId.value));
      if (deleted._tag === 'Err') throw new Error(deleted.error.message);
      process.stdout.write(JSON.stringify({ episode_id: episodeId.value, purged: true }) + '\n');
      return;
    }
    const exported = await exportCodexHistory(resolve(subject), workspace.value, Date.now());
    if (exported._tag === 'Err') throw new Error(exported.error.message);
    for (const episode of exported.value.episodes) {
      const saved = await archive.importEpisode(episode);
      if (saved._tag === 'Err') throw new Error(saved.error.message);
      const projected = await Effect.runPromise(graphiti.projection.project({
        episodeId: episode.episodeId, extractorVersion: 'ace-history-v1',
        claims: [{ original_digest: episode.contentDigest, text: episode.searchText, original_pointer: episode.sourcePointer }],
      }));
      if (projected._tag === 'Err') throw new Error(projected.error.message);
      process.stdout.write(JSON.stringify({ episode_id: episode.episodeId, persisted: true, projection_status: projected.value.status }) + '\n');
    }
  } finally {
    await graphiti.close();
  }
};
run().catch((error: unknown) => {
  process.stderr.write('ACE memory: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
  process.exitCode = 1;
});
