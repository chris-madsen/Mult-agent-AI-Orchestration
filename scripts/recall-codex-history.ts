import { writeFile, mkdir } from 'node:fs/promises';
import { exportCodexHistory } from '../src/adapters/codex-session-history.js';
import { searchMemory } from '../src/domain/memory.js';
import { makeWorkspaceId } from '../src/domain/workspace.js';

const argumentsList = process.argv.slice(2);
const sourcePath = argumentsList.length > 1 ? argumentsList[0] as string : `${process.env.HOME ?? ''}/.codex/history.jsonl`;
const query = (argumentsList.length > 1 ? argumentsList.slice(1) : argumentsList).join(' ') || 'workspace';
const workspace = makeWorkspaceId('local-codex-history-smoke');
if (workspace._tag === 'Err') throw new Error(workspace.error.message);
const exported = await exportCodexHistory(sourcePath, workspace.value, Date.now());
if (exported._tag === 'Err') throw new Error(exported.error.message);
const result = searchMemory(exported.value.episodes, query);
const cursors = new Map(exported.value.cursors.map((cursor) => [cursor.lineNumber, cursor]));
const hits = result.hits.slice(0, 20).map((hit) => {
  const lineNumber = Number(hit.episode.sourcePointer.match(/#(\d+):/u)?.[1] ?? 0);
  const cursor = cursors.get(lineNumber);
  return {
    episodeId: hit.episode.episodeId,
    occurredAtMs: hit.episode.occurredAtMs,
    sourceDigest: exported.value.sourceDigest,
    lineNumber,
    byteStart: cursor?.byteStart,
    byteEnd: cursor?.byteEnd,
    matchingTerms: hit.matchingExcerpt,
  };
});
const report = {
  sourceDigest: exported.value.sourceDigest,
  episodeCount: exported.value.episodes.length,
  query,
  hitCount: result.hits.length,
  hits,
  rawContentIncluded: false,
};
await mkdir('.ace', { recursive: true });
await writeFile('.ace/codex-history-recall.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ episodeCount: report.episodeCount, hitCount: report.hitCount, rawContentIncluded: report.rawContentIncluded, report: '.ace/codex-history-recall.json' })}\n`);
