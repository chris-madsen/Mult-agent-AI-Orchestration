import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderTraceEvent } from '../domain/provider-trace.js';
import type { ProviderTraceSink } from '../application/ports.js';

export const noopProviderTrace: ProviderTraceSink = {
  record: () => undefined,
};

/**
 * JSONL is used so a killed Harbor trial still retains the records emitted
 * before the failure.  The path is explicitly configured by the caller; no
 * provider trace is written by default.
 */
export const makeFileProviderTrace = (path: string | undefined): ProviderTraceSink => {
  if (path === undefined || path.trim() === '') return noopProviderTrace;
  const filePath = path.trim();
  mkdirSync(dirname(filePath), { recursive: true });
  return {
    record: (event: ProviderTraceEvent): void => {
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    },
  };
};

export const providerTraceEvent = (
  trace: ProviderTraceSink,
  input: Omit<ProviderTraceEvent, 'timestampMs'>,
): void => {
  trace.record({ timestampMs: Date.now(), ...input });
};
