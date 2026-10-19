import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

export interface MemoryUsageObservation {
  /** Provider-reported values only. Character counts must not be substituted. */
  readonly ingestionInputTokens?: number;
  readonly ingestionOutputTokens?: number;
  readonly savedAgentTokensPerReuse?: number;
  readonly reuseCount: number;
}

export type MemoryEconomicsStatus = 'unknown' | 'not_recovered' | 'recovered';

export interface MemoryEconomics {
  readonly status: MemoryEconomicsStatus;
  readonly ingestionTokens?: number;
  readonly breakEvenReuseCount?: number;
  readonly reuseCount: number;
  readonly netTokensSaved?: number;
}

const validOptionalTokens = (value: number | undefined): boolean => value === undefined || (Number.isSafeInteger(value) && value >= 0);

/**
 * Computes whether measured memory reuse has paid back measured ingestion.
 * Missing Graphiti token telemetry stays `unknown`; it is never inferred from
 * characters, requests, latency, or an estimate.
 */
export const evaluateMemoryEconomics = (input: MemoryUsageObservation): Result<MemoryEconomics, DomainError> => {
  if (!Number.isSafeInteger(input.reuseCount) || input.reuseCount < 0) return err(domainError('INVALID_MEMORY', 'reuse_count', 'reuse count must be a non-negative safe integer'));
  if (!validOptionalTokens(input.ingestionInputTokens) || !validOptionalTokens(input.ingestionOutputTokens) || !validOptionalTokens(input.savedAgentTokensPerReuse)) {
    return err(domainError('INVALID_MEMORY', 'token_usage', 'token usage must be a non-negative safe integer when present'));
  }
  const ingestionKnown = input.ingestionInputTokens !== undefined && input.ingestionOutputTokens !== undefined;
  const reuseSavingsKnown = input.savedAgentTokensPerReuse !== undefined;
  if (!ingestionKnown || !reuseSavingsKnown) return ok({ status: 'unknown', reuseCount: input.reuseCount });
  const ingestionTokens = input.ingestionInputTokens + input.ingestionOutputTokens;
  if (input.savedAgentTokensPerReuse === 0) return ok({ status: ingestionTokens === 0 ? 'recovered' : 'not_recovered', ingestionTokens, reuseCount: input.reuseCount, netTokensSaved: -ingestionTokens });
  const breakEvenReuseCount = Math.ceil(ingestionTokens / input.savedAgentTokensPerReuse);
  const netTokensSaved = input.reuseCount * input.savedAgentTokensPerReuse - ingestionTokens;
  return ok({
    status: netTokensSaved >= 0 ? 'recovered' : 'not_recovered',
    ingestionTokens,
    breakEvenReuseCount,
    reuseCount: input.reuseCount,
    netTokensSaved,
  });
};
