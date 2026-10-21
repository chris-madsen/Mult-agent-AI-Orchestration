import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  retrievalBenchmarkStages,
  type RetrievalBenchmarkStage,
  type RetrievalBenchmarkStageStatus,
  type RetrievalBenchmarkTerminalReceipt,
  type RetrievalBenchmarkTraceEvent,
  type RetrievalBenchmarkTraceSink,
  type RetrievalBenchmarkTraceStatus,
} from '../domain/retrieval-benchmark.js';

const safeTraceFailure = (): Error => new Error('benchmark trace persistence failed');

export interface FileRetrievalBenchmarkTraceOptions {
  readonly sourceCommit?: string;
  readonly runnerVersion?: string;
}

export interface FileRetrievalBenchmarkTrace extends RetrievalBenchmarkTraceSink {
  readonly tracePath: string;
  readonly terminalReceiptPath: string;
}

const stagesFor = (
  requests: ReadonlyMap<string, ReadonlyMap<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>>,
) => [...requests.entries()].map(([requestId, stages]) => ({
  requestId,
  stages: Object.fromEntries(retrievalBenchmarkStages.map((stage) => [
    stage,
    stages.get(stage) ?? 'unavailable',
  ])) as Readonly<Record<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>>,
  complete: retrievalBenchmarkStages.every((stage) => stages.has(stage)),
}));

/**
 * Durable benchmark sink. A failed append is retained as terminal state and
 * surfaced by flush/close; it is never converted into a successful request.
 */
export const makeFileRetrievalBenchmarkTrace = async (
  tracePath: string,
  options: FileRetrievalBenchmarkTraceOptions = {},
): Promise<FileRetrievalBenchmarkTrace> => {
  const terminalReceiptPath = `${tracePath}.receipt.json`;
  await mkdir(dirname(tracePath), { recursive: true });
  await writeFile(tracePath, '', 'utf8');

  let state: RetrievalBenchmarkTraceStatus['state'] = 'open';
  let recordedEvents = 0;
  let persistedEvents = 0;
  let failureCode: RetrievalBenchmarkTraceStatus['failureCode'];
  let traceDigest = createHash('sha256');
  let terminalDigest: string | undefined;
  let queue: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | undefined;
  const requests = new Map<string, Map<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>>();

  const markFailed = (): void => {
    state = 'failed';
    failureCode = 'trace_persistence_failed';
  };

  const status = (): RetrievalBenchmarkTraceStatus => ({
    state,
    recordedEvents,
    persistedEvents,
    ...(failureCode === undefined ? {} : { failureCode }),
  });

  const flush = async (): Promise<void> => {
    await queue;
    if (failureCode !== undefined) throw safeTraceFailure();
  };

  const writeTerminalReceipt = async (flushStatus: 'ok' | 'failed', closeStatus: 'ok' | 'failed'): Promise<void> => {
    terminalDigest ??= traceDigest.digest('hex');
    const receipt: RetrievalBenchmarkTerminalReceipt = {
      schemaVersion: 1,
      eventCount: recordedEvents,
      persistedEventCount: persistedEvents,
      requests: stagesFor(requests),
      traceDigest: terminalDigest,
      flushStatus,
      closeStatus,
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(options.sourceCommit === undefined ? {} : { sourceCommit: options.sourceCommit }),
      ...(options.runnerVersion === undefined ? {} : { runnerVersion: options.runnerVersion }),
    };
    await writeFile(terminalReceiptPath, JSON.stringify(receipt) + '\n', 'utf8');
  };

  const close = async (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closePromise = (async () => {
      let flushStatus: 'ok' | 'failed' = 'ok';
      try {
        await flush();
      } catch {
        flushStatus = 'failed';
      }
      state = state === 'failed' ? 'failed' : 'closed';
      let closeStatus: 'ok' | 'failed' = 'ok';
      try {
        await writeTerminalReceipt(flushStatus, closeStatus);
      } catch {
        markFailed();
        closeStatus = 'failed';
        try {
          await writeTerminalReceipt(flushStatus, closeStatus);
        } catch {
          // The terminal error remains observable through close() and status.
        }
      }
      if (flushStatus === 'failed' || closeStatus === 'failed') throw safeTraceFailure();
    })();
    return closePromise;
  };

  const sink: FileRetrievalBenchmarkTrace = {
    tracePath,
    terminalReceiptPath,
    record: (event: RetrievalBenchmarkTraceEvent): void => {
      if (state !== 'open' || failureCode !== undefined) throw safeTraceFailure();
      let line: string;
      try {
        const normalized: RetrievalBenchmarkTraceEvent = {
          ...event,
          status: event.status ?? 'executed',
          ...(options.sourceCommit === undefined ? {} : { sourceCommit: options.sourceCommit }),
          ...(options.runnerVersion === undefined ? {} : { runnerVersion: options.runnerVersion }),
        };
        line = JSON.stringify(normalized) + '\n';
      } catch {
        markFailed();
        throw safeTraceFailure();
      }
      recordedEvents += 1;
      const stages = requests.get(event.requestId) ?? new Map<RetrievalBenchmarkStage, RetrievalBenchmarkStageStatus>();
      stages.set(event.stage, event.status ?? 'executed');
      requests.set(event.requestId, stages);
      const write = queue.then(async () => {
        if (failureCode !== undefined) throw safeTraceFailure();
        await appendFile(tracePath, line, 'utf8');
        persistedEvents += 1;
        traceDigest.update(line, 'utf8');
      });
      queue = write.catch(() => {
        markFailed();
      });
    },
    flush,
    close,
    get status() {
      return status();
    },
  };
  return sink;
};
