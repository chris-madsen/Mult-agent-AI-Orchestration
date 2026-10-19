#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { exportCodexHistory } from '../adapters/codex-session-history.js';
import { makeAsyncFileMemoryArchive } from '../adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../adapters/file-projection-outbox.js';
import { makeGraphitiMcpPort } from '../adapters/graphiti-mcp.js';
import { defaultLocalPolicy } from '../domain/policy.js';
import { makeWorkspaceId } from '../domain/workspace.js';
import { deleteEpisodeWithProjection } from '../application/retained-memory.js';
import { makeEpisodeId } from '../domain/memory.js';
import { importMemoryEpisodes } from '../application/memory-import.js';
import { defaultMemoryAdmissionPolicy } from '../domain/memory-admission.js';

const required = (key: string): string => {
  const v = process.env[key];
  if (!v?.trim()) throw new Error(key + ' is required');
  return v.trim();
};
const run = async (): Promise<void> => {
  const [operation, subject] = process.argv.slice(2);
  if (operation !== 'import' && operation !== 'delete' && operation !== 'reconcile') {
    throw new Error('Usage: ace-memory import <codex-history.jsonl> | delete <episode-id> | reconcile');
  }
  if (operation !== 'reconcile' && !subject) throw new Error('source path / episode ID required');
  const workspace = makeWorkspaceId(required('ACE_WORKSPACE_ID'));
  if (workspace._tag === 'Err') throw new Error(workspace.error.message);
  const archiveRoot = resolve(required('ACE_MEMORY_ARCHIVE_ROOT'));
  const archive = await makeAsyncFileMemoryArchive(archiveRoot);
  const outbox = await makeFileProjectionOutbox(join(archiveRoot, 'projection-outbox'));
  const createGraphiti = async () => makeGraphitiMcpPort({
    command: required('ACE_GRAPHITI_COMMAND'),
    args: JSON.parse(required('ACE_GRAPHITI_ARGS_JSON')) as string[],
    groupId: required('ACE_GRAPHITI_GROUP_ID'),
    workspaceId: workspace.value,
    policy: defaultLocalPolicy(workspace.value),
  });
  if (operation === 'delete') {
    const episodeId = makeEpisodeId(subject);
    if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
    const graphiti = await createGraphiti();
    try {
      const deleted = await Effect.runPromise(deleteEpisodeWithProjection(archive, graphiti.projection, episodeId.value));
      if (deleted._tag === 'Err') throw new Error(deleted.error.message);
      process.stdout.write(JSON.stringify({ episode_id: episodeId.value, purged: true }) + '\n');
    } finally {
      await graphiti.close();
    }
    const receipts = await outbox.list();
    if (receipts._tag === 'Err') throw new Error(receipts.error.message);
    for (const receipt of receipts.value.filter((item) => item.episodeId === episodeId.value)) {
      const stored = await outbox.put({ ...receipt, status: 'tombstoned' });
      if (stored._tag === 'Err') throw new Error(stored.error.message);
    }
    return;
  }
  if (operation === 'reconcile') {
    const graphiti = await createGraphiti();
    try {
      const receipts = await outbox.list();
      if (receipts._tag === 'Err') throw new Error(receipts.error.message);
      let projected = 0;
      let retried = 0;
      let missingOriginal = 0;
      for (const receipt of receipts.value) {
        if (receipt.status === 'projected' || receipt.status === 'tombstoned') continue;
        const present = await Effect.runPromise(graphiti.projectionState.isPresent(receipt.episodeId));
        if (present._tag === 'Err') throw new Error(present.error.message);
        if (present.value) {
          const stored = await outbox.put({ ...receipt, status: 'projected' });
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          projected += 1;
          continue;
        }
        const original = await archive.readEpisode(receipt.episodeId);
        if (original._tag === 'Err') {
          missingOriginal += 1;
          continue;
        }
        const retry = await Effect.runPromise(graphiti.projection.project({
          episodeId: original.value.episodeId,
          occurredAtMs: original.value.occurredAtMs,
          extractorVersion: receipt.extractorVersion,
          claims: [{
            original_digest: original.value.contentDigest,
            text: original.value.searchText,
            original_pointer: original.value.sourcePointer,
          }],
        }));
        if (retry._tag === 'Err') {
          const stored = await outbox.put({
            ...receipt,
            status: 'incomplete',
            attempts: receipt.attempts + 1,
          });
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          continue;
        }
        const stored = await outbox.put({
          ...retry.value,
          attempts: Math.max(retry.value.attempts, receipt.attempts + 1),
        });
        if (stored._tag === 'Err') throw new Error(stored.error.message);
        retried += 1;
      }
      process.stdout.write(JSON.stringify({
        reconciled_projected: projected,
        retried_pending: retried,
        missing_original: missingOriginal,
      }) + '\n');
    } finally {
      await graphiti.close();
    }
    return;
  }
  const exported = await exportCodexHistory(resolve(subject as string), workspace.value, Date.now());
  if (exported._tag === 'Err') throw new Error(exported.error.message);
  const imported = await importMemoryEpisodes({
    episodes: exported.value.episodes,
    archive,
    createProjection: createGraphiti,
    extractorVersion: 'ace-history-v1',
    admissionPolicy: defaultMemoryAdmissionPolicy,
    outbox,
  });
  if (imported._tag === 'Err') throw new Error(imported.error.message);
  for (const outcome of imported.value) {
    process.stdout.write(JSON.stringify({
      episode_id: outcome.episodeId,
      persisted: outcome.persisted,
      memory_admission: outcome.admission.kind,
      admission_reason: outcome.admission.reason,
      ...(outcome.projectionStatus === undefined ? {} : { projection_status: outcome.projectionStatus }),
      ...(outcome.projectionErrorCode === undefined ? {} : { projection_error_code: outcome.projectionErrorCode }),
    }) + '\n');
  }
};
run().catch((error: unknown) => {
  process.stderr.write('ACE memory: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
  process.exitCode = 1;
});
