#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { makeAsyncFileMemoryArchive } from '../dist/adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../dist/adapters/file-projection-outbox.js';
import { makeGraphitiMcpPort } from '../dist/adapters/graphiti-mcp.js';
import { makeFileProviderTrace } from '../dist/adapters/provider-trace.js';
import { defaultLocalPolicy } from '../dist/domain/policy.js';
import { makeEpisodeId } from '../dist/domain/memory.js';
import { makeWorkspaceId } from '../dist/domain/workspace.js';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

if (process.env.ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY !== 'true') {
  throw new Error('ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true is required');
}
if (process.env.ACE_ENABLE_TEST_FAILPOINTS !== 'true'
  || process.env.ACE_TEST_FAILPOINT !== 'after_graphiti_enqueue_before_outbox_receipt') {
  throw new Error('Graphiti crash worker requires the explicit test failpoint opt-in');
}

const fixturePath = resolve(required('ACE_GRAPHITI_CRASH_FIXTURE'));
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
if (fixture.schema_version !== 1 || fixture.status !== 'frozen') {
  throw new Error('Graphiti crash worker requires the committed frozen synthetic fixture');
}

const workspace = makeWorkspaceId(required('ACE_WORKSPACE_ID'));
const episodeId = makeEpisodeId(required('ACE_GRAPHITI_CRASH_EPISODE_ID'));
if (workspace._tag === 'Err' || episodeId._tag === 'Err') {
  throw new Error('invalid isolated Graphiti crash identifiers');
}
const occurredAtMs = Date.parse(fixture.occurred_at);
if (!Number.isSafeInteger(occurredAtMs)) throw new Error('fixture occurred_at is invalid');
const content = Buffer.from(fixture.content, 'utf8');
const contentDigest = createHash('sha256').update(content).digest('hex');
const archiveRoot = resolve(required('ACE_MEMORY_ARCHIVE_ROOT'));
const archive = await makeAsyncFileMemoryArchive(archiveRoot);
const outbox = await makeFileProjectionOutbox(join(archiveRoot, 'projection-outbox'));
const command = required('ACE_GRAPHITI_COMMAND');
const args = JSON.parse(required('ACE_GRAPHITI_ARGS_JSON'));
if (!Array.isArray(args) || !args.every((item) => typeof item === 'string')) {
  throw new Error('ACE_GRAPHITI_ARGS_JSON must decode to a string array');
}

const episode = {
  episodeId: episodeId.value,
  workspaceId: workspace.value,
  sessionId: 'graphiti-crash-recovery-e2e',
  sourcePointer: fixture.source_pointer,
  occurredAtMs,
  importedAtMs: Date.now(),
  contentDigest,
  content,
  searchText: fixture.search_text,
  memoryHint: 'project',
  tombstoned: false,
};

const archived = await archive.importEpisode(episode);
if (archived._tag === 'Err') throw new Error(`${archived.error.code}: ${archived.error.message}`);
const queued = await outbox.begin(episode.episodeId, 'ace-graphiti-crash-e2e-v1');
if (queued._tag === 'Err') throw new Error(`${queued.error.code}: ${queued.error.message}`);

const graphiti = await makeGraphitiMcpPort({
  command,
  args,
  groupId: required('ACE_GRAPHITI_GROUP_ID'),
  workspaceId: workspace.value,
  policy: defaultLocalPolicy(workspace.value),
  archive,
  trace: makeFileProviderTrace(process.env.ACE_PROVIDER_TRACE_FILE),
  providerVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'graphiti-mcp/crash-e2e',
});

const projected = await Effect.runPromise(graphiti.projection.project({
  episodeId: episode.episodeId,
  occurredAtMs: episode.occurredAtMs,
  extractorVersion: 'ace-graphiti-crash-e2e-v1',
  claims: [{
    original_digest: episode.contentDigest,
    text: episode.searchText,
    original_pointer: episode.sourcePointer,
  }],
}));
if (projected._tag === 'Err') {
  await graphiti.close();
  throw new Error(`${projected.error.code}: ${projected.error.message}`);
}

// Intentionally do NOT persist the provider receipt. The durable outbox still
// contains the pre-enqueue pending intent, reproducing the acknowledgement gap
// where Graphiti may have accepted work but ACE dies before recording that fact.
process.stderr.write(
  `ace graphiti test failpoint reached name=after_graphiti_enqueue_before_outbox_receipt provider_status=${projected.value.status}\n`,
);
process.kill(process.pid, 'SIGKILL');
throw new Error('Graphiti crash failpoint failed to terminate the process');
