import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { recoverResult } from '../application/effect-result.js';
import type { GitHistoryPort, ProviderTraceSink } from '../application/ports.js';
import { domainError, type DomainError } from '../domain/errors.js';
import { makeEvidenceId, type RetrievalEvidence } from '../domain/retrieval.js';
import { err, ok, type Result } from '../domain/result.js';
import { noopProviderTrace, providerTraceEvent } from './provider-trace.js';

const execFileAsync = promisify(execFile);
const HISTORY_SCAN_LIMIT = 200;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

interface CommitSummary {
  readonly revision: string;
  readonly timestampMs: number;
  readonly subject: string;
  readonly paths: readonly string[];
  readonly ordinal: number;
}

const genericHistoryTerms = new Set([
  'why', 'history', 'historical', 'commit', 'commits', 'change', 'changed',
  'почему', 'история', 'истории', 'коммит', 'коммиты', 'изменение', 'изменили', 'меняли',
]);

const queryTerms = (query: string): readonly string[] => {
  const terms = query.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_$./-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !genericHistoryTerms.has(term));
  return [...new Set(terms)];
};

const parseLog = (stdout: string): readonly CommitSummary[] => stdout
  .split('\x1e')
  .map((record) => record.trim())
  .filter((record) => record.length > 0)
  .flatMap((record, ordinal) => {
    const lines = record.split('\n');
    const metadata = lines.shift()?.trim() ?? '';
    const [revision, epochRaw, subject = ''] = metadata.split('\x1f');
    const epoch = Number(epochRaw);
    if (revision === undefined || !/^[a-f0-9]{40,64}$/iu.test(revision)
      || !Number.isSafeInteger(epoch) || epoch < 0) return [];
    const paths = lines.map((line) => line.trim()).filter((line) => line.length > 0);
    return [{ revision, timestampMs: epoch * 1000, subject, paths, ordinal }];
  });

const rankSummary = (summary: CommitSummary, query: string, terms: readonly string[]): number => {
  const subject = summary.subject.toLocaleLowerCase();
  const paths = summary.paths.join(' ').toLocaleLowerCase();
  const exact = query.trim().toLocaleLowerCase();
  let score = exact.length > 1 && subject.includes(exact) ? 12 : 0;
  for (const term of terms) {
    if (subject.includes(term)) score += 4;
    if (paths.includes(term)) score += 3;
  }
  if (terms.length === 0) score += Math.max(0, 1 - summary.ordinal / HISTORY_SCAN_LIMIT);
  return score;
};

const gitFailure = (message: string): DomainError =>
  domainError('EXTERNAL_UNAVAILABLE', 'git_history', message);

export interface GitHistoryOptions {
  readonly trace?: ProviderTraceSink;
  readonly providerVersion?: string;
}

export const makeGitHistoryPort = (options: GitHistoryOptions = {}): GitHistoryPort => ({
  search: (input) => {
    const startedAtMs = Date.now();
    const operation = recoverResult(
      Effect.tryPromise<Result<readonly RetrievalEvidence[], DomainError>, DomainError>({
        try: async () => {
          if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) {
            return err(domainError(
              'INVALID_INPUT',
              'history.limit',
              'history limit must be between 1 and 20',
            ));
          }

          let logOutput: string;
          try {
            const result = await execFileAsync('git', [
              'log',
              '--all',
              '--no-merges',
              '--date-order',
              `--max-count=${HISTORY_SCAN_LIMIT}`,
              '--pretty=format:%x1e%H%x1f%ct%x1f%s',
              '--name-only',
            ], {
              cwd: input.rootPath,
              encoding: 'utf8',
              maxBuffer: MAX_BUFFER_BYTES,
            });
            logOutput = result.stdout;
          } catch {
            return err(gitFailure('Git history is unavailable for this workspace'));
          }

          const terms = queryTerms(input.query);
          const selected = parseLog(logOutput)
            .map((summary) => ({ summary, score: rankSummary(summary, input.query, terms) }))
            .filter((item) => terms.length === 0 || item.score > 0)
            .sort((left, right) => right.score - left.score
              || right.summary.timestampMs - left.summary.timestampMs)
            .slice(0, input.limit);

          const evidence: RetrievalEvidence[] = [];
          for (const item of selected) {
            let message: string;
            try {
              const shown = await execFileAsync(
                'git',
                ['show', '-s', '--format=%B', item.summary.revision],
                {
                  cwd: input.rootPath,
                  encoding: 'utf8',
                  maxBuffer: MAX_BUFFER_BYTES,
                },
              );
              message = shown.stdout.trim();
            } catch {
              return err(gitFailure(`Git commit ${item.summary.revision} could not be read`));
            }

            const content = [
              `commit ${item.summary.revision}`,
              `timestamp_ms: ${item.summary.timestampMs}`,
              'message:',
              message.length === 0 ? item.summary.subject : message,
              'paths:',
              ...(item.summary.paths.length === 0 ? ['(none)'] : item.summary.paths),
            ].join('\n');
            const evidenceId = makeEvidenceId('history-' + createHash('sha256')
              .update(item.summary.revision, 'utf8')
              .update('\0', 'utf8')
              .update(content, 'utf8')
              .digest('hex'));
            if (evidenceId._tag === 'Err') return evidenceId;
            evidence.push({
              evidenceId: evidenceId.value,
              source: 'history',
              citation: `git:${item.summary.revision}`,
              content,
              proofClass: 'direct',
              freshness: 'unknown',
              sourceRevision: item.summary.revision,
              sourceTimestampMs: item.summary.timestampMs,
            });
          }
          return ok(evidence);
        },
        catch: () => gitFailure('Git history lookup failed'),
      }),
    );

    return Effect.map(operation, (result) => {
      providerTraceEvent(options.trace ?? noopProviderTrace, {
        provider: 'git_history',
        providerVersion: options.providerVersion ?? 'git/cli',
        operation: 'log_show',
        status: result._tag === 'Ok' ? 'success' : 'failure',
        durationMs: Math.max(0, Date.now() - startedAtMs),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(result._tag === 'Err' ? { errorCode: result.error.code } : {}),
      });
      return result;
    });
  },
});
