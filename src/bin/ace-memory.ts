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
import {
  deadLetterProjection,
  defaultProjectionRetryPolicy,
  makeEpisodeId,
  projectionRetryDue,
  recordProjectionEnqueue,
  repairProjection,
  scheduleProjectionRetry,
  type ProjectionRetryPolicy,
} from '../domain/memory.js';
import { importMemoryEpisodes } from '../application/memory-import.js';
import { defaultMemoryAdmissionPolicy } from '../domain/memory-admission.js';

const required = (key: string): string => {
  const v = process.env[key];
  if (!v?.trim()) throw new Error(key + ' is required');
  return v.trim();
};
const run = async (): Promise<void> => {
  const [operation, subject] = process.argv.slice(2);
  if (operation !== 'import' && operation !== 'delete' && operation !== 'reconcile' && operation !== 'repair') {
    throw new Error('Usage: ace-memory import <codex-history.jsonl> | delete <episode-id> | reconcile | repair <episode-id>');
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

  const integerEnv = (name: string, fallback: number): number => {
    const raw = process.env[name]?.trim();
    if (raw === undefined || raw.length === 0) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + ' must be a non-negative integer');
    return value;
  };
  const retryPolicy: ProjectionRetryPolicy = {
    maxAttempts: integerEnv('ACE_MEMORY_PROJECTION_MAX_ATTEMPTS', defaultProjectionRetryPolicy.maxAttempts),
    baseDelayMs: integerEnv('ACE_MEMORY_PROJECTION_BASE_DELAY_MS', defaultProjectionRetryPolicy.baseDelayMs),
    maxDelayMs: integerEnv('ACE_MEMORY_PROJECTION_MAX_DELAY_MS', defaultProjectionRetryPolicy.maxDelayMs),
  };
  if (retryPolicy.maxAttempts < 1 || retryPolicy.maxDelayMs < retryPolicy.baseDelayMs) {
    throw new Error('projection retry policy requires maxAttempts >= 1 and maxDelayMs >= baseDelayMs');
  }
  const verificationDelayMs = integerEnv('ACE_MEMORY_PROJECTION_VERIFY_DELAY_MS', retryPolicy.baseDelayMs);

  if (operation === 'repair') {
    const episodeId = makeEpisodeId(subject as string);
    if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
    const receipts = await outbox.list();
    if (receipts._tag === 'Err') throw new Error(receipts.error.message);
    let repaired = 0;
    for (const receipt of receipts.value.filter((item) =>
      item.episodeId === episodeId.value && (item.status === 'dead_letter' || item.status === 'incomplete'))) {
      const reset = repairProjection(receipt);
      if (reset._tag === 'Err') throw new Error(reset.error.message);
      const stored = await outbox.put(reset.value);
      if (stored._tag === 'Err') throw new Error(stored.error.message);
      repaired += 1;
    }
    process.stdout.write(JSON.stringify({ episode_id: episodeId.value, repaired_projection_receipts: repaired }) + '\n');
    return;
  }
  if (operation === 'delete') {
    const episodeId = makeEpisodeId(subject as string);
    if (episodeId._tag === 'Err') throw new Error(episodeId.error.message);
    const graphiti = await createGraphiti();
    try {
      const deleted = await Effect.runPromise(deleteEpisodeWithProjection(
        archive,
        graphiti.projection,
        graphiti.projectionState,
        episodeId.value,
      ));
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
      let deferred = 0;
      let deadLettered = 0;
      for (const receipt of receipts.value) {
        if (receipt.status === 'projected' || receipt.status === 'tombstoned' || receipt.status === 'dead_letter') continue;
        const nowMs = Date.now();
        if (!projectionRetryDue(receipt, nowMs)) {
          deferred += 1;
          continue;
        }
        const present = await Effect.runPromise(graphiti.projectionState.isPresent(receipt.episodeId));
        if (present._tag === 'Err') throw new Error(present.error.message);
        if (present.value) {
          const stored = await outbox.put({
            ...receipt,
            status: 'projected',
            nextAttemptAtMs: undefined,
            deadLetteredAtMs: undefined,
            lastErrorCode: undefined,
          });
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          projected += 1;
          continue;
        }
        if (receipt.attempts >= retryPolicy.maxAttempts) {
          const dead = deadLetterProjection(receipt, nowMs, 'PROJECTION_NOT_MATERIALIZED');
          if (dead._tag === 'Err') throw new Error(dead.error.message);
          const stored = await outbox.put(dead.value);
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          deadLettered += 1;
          continue;
        }
        const original = await archive.readEpisode(receipt.episodeId);
        if (original._tag === 'Err') {
          const failed = scheduleProjectionRetry(receipt, nowMs, original.error.code, retryPolicy);
          if (failed._tag === 'Err') throw new Error(failed.error.message);
          const stored = await outbox.put(failed.value);
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          if (failed.value.status === 'dead_letter') deadLettered += 1;
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
          const failed = scheduleProjectionRetry(receipt, nowMs, retry.error.code, retryPolicy);
          if (failed._tag === 'Err') throw new Error(failed.error.message);
          const stored = await outbox.put(failed.value);
          if (stored._tag === 'Err') throw new Error(stored.error.message);
          if (failed.value.status === 'dead_letter') deadLettered += 1;
          continue;
        }
        const enqueued = recordProjectionEnqueue(receipt, retry.value, nowMs, verificationDelayMs);
        if (enqueued._tag === 'Err') throw new Error(enqueued.error.message);
        const stored = await outbox.put(enqueued.value);
        if (stored._tag === 'Err') throw new Error(stored.error.message);
        retried += 1;
      }
      process.stdout.write(JSON.stringify({
        reconciled_projected: projected,
        retried_pending: retried,
        missing_original: missingOriginal,
        deferred_by_backoff: deferred,
        newly_dead_lettered: deadLettered,
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
