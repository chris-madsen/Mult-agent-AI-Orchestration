import { domainError, type DomainError } from '../domain/errors.js';
import { err, type Result } from '../domain/result.js';
import { normalizeUsageSample, type UsageEventInput, type UsageSample } from '../domain/evaluation.js';

export interface CodexUsageAdapterOptions {
  readonly codexVersion: string;
  readonly counterKind: 'delta' | 'cumulative';
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeCodexJsonEvent = (
  rawEvent: unknown,
  sequence: number,
  options: CodexUsageAdapterOptions,
): Result<UsageSample, DomainError> => {
  if (!record(rawEvent)) return err(domainError('INVALID_USAGE', 'raw_event', 'Codex JSON event must be an object'));
  if (options.codexVersion.trim().length === 0) {
    return err(domainError('INVALID_USAGE', 'codex_version', 'verified Codex version is required'));
  }
  const eventId = rawEvent.event_id ?? rawEvent.id;
  if (typeof eventId !== 'string' || eventId.trim().length === 0) {
    return err(domainError('USAGE_UNAVAILABLE', 'event_id', 'Codex event has no stable event identity'));
  }
  const input: UsageEventInput = {
    eventId,
    provider: 'codex',
    eventSource: `codex.exec.json:${options.codexVersion.trim()}`,
    counterKind: options.counterKind,
    sequence,
    rawEvent,
  };
  return normalizeUsageSample(input);
};
