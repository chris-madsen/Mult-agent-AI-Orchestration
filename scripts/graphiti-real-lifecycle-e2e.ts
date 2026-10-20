import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { makeAsyncFileMemoryArchive } from '../src/adapters/file-memory-archive.js';
import { makeFileProjectionOutbox } from '../src/adapters/file-projection-outbox.js';
import { makeGraphitiMcpPort } from '../src/adapters/graphiti-mcp.js';
import { makeFileProviderTrace } from '../src/adapters/provider-trace.js';
import { runGraphitiLifecycleGate } from '../src/application/graphiti-lifecycle-gate.js';
import { makeEpisodeId, type SessionEpisode } from '../src/domain/memory.js';
import { defaultLocalPolicy } from '../src/domain/policy.js';
import { makeWorkspaceId, type ContentDigest } from '../src/domain/workspace.js';

interface Fixture {
  readonly schema_version: 1;
  readonly status: 'frozen';
  readonly source_pointer: string;
  readonly occurred_at: string;
  readonly content: string;
  readonly search_text: string;
  readonly query: string;
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const main = async (): Promise<void> => {
  if (process.env.ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY !== 'true') {
    throw new Error('Set ACE_GRAPHITI_E2E_ACK_SYNTHETIC_ONLY=true; this gate is restricted to the committed synthetic fixture.');
  }
  const command = required('ACE_GRAPHITI_COMMAND');
  const argsRaw = JSON.parse(required('ACE_GRAPHITI_ARGS_JSON')) as unknown;
  if (!Array.isArray(argsRaw) || !argsRaw.every((value) => typeof value === 'string')) {
    throw new Error('ACE_GRAPHITI_ARGS_JSON must decode to a string array');
  }

  const [fixtureArg = 'benchmarks/fixtures/graphiti-memory-lifecycle-v1.json', outputArg = 'artifacts/graphiti-real-lifecycle/evidence.json'] = process.argv.slice(2);
  const fixturePath = resolve(fixtureArg);
  const outputPath = resolve(outputArg);
  const fixtureBytes = await readFile(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString('utf8')) as Fixture;
  if (fixture.schema_version !== 1 || fixture.status !== 'frozen') throw new Error('unsupported or unfrozen Graphiti E2E fixture');
  const occurredAtMs = Date.parse(fixture.occurred_at);
  if (!Number.isSafeInteger(occurredAtMs)) throw new Error('fixture occurred_at must be a valid millisecond timestamp');

  const workspace = makeWorkspaceId(`graphiti-e2e-${randomUUID()}`);
  const episodeId = makeEpisodeId(`graphiti-e2e-${randomUUID()}`);
  if (workspace._tag === 'Err' || episodeId._tag === 'Err') throw new Error('could not construct isolated E2E identifiers');
  const content = Buffer.from(fixture.content, 'utf8');
  const contentDigest = createHash('sha256').update(content).digest('hex') as ContentDigest;
  const episode: SessionEpisode = {
    episodeId: episodeId.value,
    workspaceId: workspace.value,
    sessionId: 'graphiti-real-lifecycle-e2e',
    sourcePointer: fixture.source_pointer,
    occurredAtMs,
    importedAtMs: Date.now(),
    contentDigest,
    content,
    searchText: fixture.search_text,
    memoryHint: 'project',
    tombstoned: false,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  const tracePath = resolve(dirname(outputPath), 'provider-trace.jsonl');
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'ace-graphiti-real-e2e-'));
  const archive = await makeAsyncFileMemoryArchive(resolve(archiveRoot, 'archive'));
  const outbox = await makeFileProjectionOutbox(resolve(archiveRoot, 'outbox'));
  const groupId = `ace-e2e-${randomUUID()}`;
  const graphiti = await makeGraphitiMcpPort({
    command,
    args: argsRaw,
    groupId,
    workspaceId: workspace.value,
    policy: defaultLocalPolicy(workspace.value),
    archive,
    trace: makeFileProviderTrace(tracePath),
    providerVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'graphiti-mcp/real-e2e',
  });
  if (graphiti.memory === undefined) throw new Error('archive-backed Graphiti memory search was not initialized');

  try {
    const result = await runGraphitiLifecycleGate({
      episode,
      query: fixture.query,
      extractorVersion: 'ace-graphiti-real-e2e-v1',
      requestId: `graphiti-e2e-request-${randomUUID()}`,
      archive,
      outbox,
      projection: graphiti.projection,
      projectionState: graphiti.projectionState,
      memory: graphiti.memory,
      projectionPollAttempts: Number(process.env.ACE_GRAPHITI_E2E_POLL_ATTEMPTS ?? '120'),
      projectionPollDelayMs: Number(process.env.ACE_GRAPHITI_E2E_POLL_DELAY_MS ?? '500'),
    });
    if (result._tag === 'Err') throw new Error(`${result.error.code}: ${result.error.message}`);

    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
    if (!/^[a-f0-9]{40,64}$/u.test(sourceCommit)) throw new Error('could not resolve exact Graphiti evidence source commit');
    const evidence = {
      evidence: 'real-graphiti-lifecycle',
      sourceCommit,
      fixture: fixtureArg,
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
      workspaceId: workspace.value,
      groupId,
      lifecycle: result.value,
      providerTrace: tracePath,
      graphitiVersion: process.env.ACE_GRAPHITI_VERSION?.trim() || 'unknown',
      inference: {
        llm: process.env.ACE_GRAPHITI_LLM_ID?.trim() || 'unknown',
        embedder: process.env.ACE_GRAPHITI_EMBEDDER_ID?.trim() || 'unknown',
        reranker: process.env.ACE_GRAPHITI_RERANKER_ID?.trim() || 'unknown',
      },
    };
    await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify({ status: 'PASS', output: outputArg, requestId: result.value.requestId }) + '\n');
  } finally {
    await graphiti.close();
    await rm(archiveRoot, { recursive: true, force: true });
  }
};

await main();
