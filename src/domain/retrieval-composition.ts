import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { CodeRetrievalStrategy } from './retrieval.js';

export type RetrievalComposition = 'legacy-hybrid' | 'repo-map-qdrant-lsp-v2';

export interface RetrievalProviderRequirements {
  readonly dense: boolean;
  readonly sparse: boolean;
}

export const parseRetrievalComposition = (
  value: string | undefined,
): Result<RetrievalComposition, DomainError> => {
  const composition = value?.trim() || 'legacy-hybrid';
  if (composition !== 'legacy-hybrid' && composition !== 'repo-map-qdrant-lsp-v2') {
    return err(domainError(
      'INVALID_INPUT',
      'retrieval_composition',
      'retrieval composition must be legacy-hybrid or repo-map-qdrant-lsp-v2',
    ));
  }
  return ok(composition);
};

export const defaultStrategyForComposition = (
  composition: RetrievalComposition,
): CodeRetrievalStrategy => composition === 'repo-map-qdrant-lsp-v2' ? 'dense' : 'hybrid_rrf';

export const parseRetrievalStrategy = (
  value: string | undefined,
): Result<CodeRetrievalStrategy, DomainError> => {
  const strategy = value?.trim() || 'hybrid_rrf';
  if (strategy !== 'dense' && strategy !== 'sparse' && strategy !== 'hybrid_rrf') {
    return err(domainError(
      'INVALID_INPUT',
      'retrieval_strategy',
      'retrieval strategy must be dense, sparse, or hybrid_rrf',
    ));
  }
  return ok(strategy);
};

export const parseRetrievalStrategyForComposition = (
  composition: RetrievalComposition,
  value: string | undefined,
): Result<CodeRetrievalStrategy, DomainError> => {
  const parsed = parseRetrievalStrategy(value ?? defaultStrategyForComposition(composition));
  if (parsed._tag === 'Err') return parsed;
  if (composition === 'repo-map-qdrant-lsp-v2' && parsed.value !== 'dense') {
    return err(domainError(
      'INVALID_INPUT',
      'retrieval_strategy',
      'repo-map-qdrant-lsp-v2 supports dense retrieval only',
    ));
  }
  return parsed;
};

export const retrievalProviderRequirements = (
  strategy: CodeRetrievalStrategy,
): RetrievalProviderRequirements => ({
  dense: strategy !== 'sparse',
  sparse: strategy !== 'dense',
});

export const retrievalCompositionProviderIdentity = (
  strategy: CodeRetrievalStrategy,
  denseIdentity: string,
  sparseIdentity: string | undefined,
): Readonly<Record<string, string>> => ({
  dense: strategy === 'sparse' ? 'not-required' : denseIdentity,
  sparse: strategy === 'dense' ? 'not-required' : sparseIdentity ?? 'unavailable',
});
