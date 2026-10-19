import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { domainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import { makeEpisode, makeEpisodeId, type SessionEpisode } from '../domain/memory.js';
import type { ContentDigest, WorkspaceId } from '../domain/workspace.js';

export interface CodexHistoryCursor {
  readonly sourceDigest: ContentDigest;
  readonly lineNumber: number;
  readonly byteStart: number;
  readonly byteEnd: number;
}

export interface CodexHistoryExport {
  readonly sourcePath: string;
  readonly sourceDigest: ContentDigest;
  readonly episodes: readonly SessionEpisode[];
  readonly cursors: readonly CodexHistoryCursor[];
}

const digestOf = (bytes: Uint8Array): ContentDigest => createHash('sha256').update(bytes).digest('hex') as ContentDigest;

const parseRecord = (line: string, lineNumber: number): Result<{ readonly sessionId: string; readonly occurredAtMs: number; readonly text: string; readonly memoryHint?: 'project' | 'archive_only' }, ReturnType<typeof domainError>> => {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return err(domainError('INVALID_MEMORY', `history[${lineNumber}]`, 'Codex history record must be an object'));
    const record = value as Readonly<Record<string, unknown>>;
    if (typeof record.session_id !== 'string' || record.session_id.trim().length === 0) return err(domainError('INVALID_MEMORY', `history[${lineNumber}].session_id`, 'session_id is required'));
    if (typeof record.ts !== 'number' || !Number.isSafeInteger(record.ts) || record.ts < 0) return err(domainError('INVALID_MEMORY', `history[${lineNumber}].ts`, 'ts must be a non-negative Unix timestamp'));
    if (typeof record.text !== 'string' || record.text.trim().length === 0) return err(domainError('INVALID_MEMORY', `history[${lineNumber}].text`, 'text is required'));
    const memoryHint = record.ace_memory === 'project' || record.ace_memory === 'archive_only' ? record.ace_memory : undefined;
    return ok({ sessionId: record.session_id, occurredAtMs: record.ts * 1000, text: record.text, ...(memoryHint === undefined ? {} : { memoryHint }) });
  } catch {
    return err(domainError('INVALID_MEMORY', `history[${lineNumber}]`, 'Codex history line is not valid JSON'));
  }
};

export const exportCodexHistory = async (
  sourcePath: string,
  workspaceId: WorkspaceId,
  importedAtMs: number,
): Promise<Result<CodexHistoryExport, ReturnType<typeof domainError>>> => {
  if (sourcePath.trim().length === 0) return err(domainError('INVALID_MEMORY', 'source_path', 'history source path is required'));
  if (!Number.isSafeInteger(importedAtMs) || importedAtMs < 0) return err(domainError('INVALID_MEMORY', 'imported_at_ms', 'import timestamp must be non-negative'));
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(sourcePath));
  } catch {
    return err(domainError('FILE_NOT_FOUND', 'source_path', 'Codex history source could not be read'));
  }
  const sourceDigest = digestOf(bytes);
  const text = Buffer.from(bytes).toString('utf8');
  const lines = text.split('\n');
  const episodes: SessionEpisode[] = [];
  const cursors: CodexHistoryCursor[] = [];
  let byteStart = 0;
  for (const [index, line] of lines.entries()) {
    const hasNewline = index < lines.length - 1;
    const byteEnd = byteStart + Buffer.byteLength(line, 'utf8') + (hasNewline ? 1 : 0);
    if (line.trim().length > 0) {
      const parsed = parseRecord(line, index + 1);
      if (parsed._tag === 'Err') return parsed;
      const raw = bytes.slice(byteStart, byteEnd);
      const episodeId = makeEpisodeId(createHash('sha256').update(`${workspaceId}:${sourcePath}:${byteStart}:${digestOf(raw)}`).digest('hex'));
      if (episodeId._tag === 'Err') return episodeId;
      const episode = makeEpisode({
        episodeId: episodeId.value,
        workspaceId,
        sessionId: parsed.value.sessionId,
        sourcePointer: `codex-history://${sourcePath}#${index + 1}:${byteStart}-${byteEnd}`,
        occurredAtMs: parsed.value.occurredAtMs,
        importedAtMs,
        contentDigest: digestOf(raw),
        content: raw,
        searchText: parsed.value.text,
        ...(parsed.value.memoryHint === undefined ? {} : { memoryHint: parsed.value.memoryHint }),
        tombstoned: false,
      });
      if (episode._tag === 'Err') return episode;
      episodes.push(episode.value);
      cursors.push({ sourceDigest, lineNumber: index + 1, byteStart, byteEnd });
    }
    byteStart = byteEnd;
  }
  return ok({ sourcePath, sourceDigest, episodes, cursors });
};
