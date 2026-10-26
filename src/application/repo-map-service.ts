import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { err, ok, type Result } from '../domain/result.js';
import {
  applyRepoMapDelta,
  emptyRepoMapGraph,
  renderRepoMapFor,
  type RepoMapDelta,
  type RepoMapGraph,
  type RepoMapRenderInput,
  type RepoMapResult,
} from '../domain/repo-map.js';

export interface RepoMapService {
  readonly update: (delta: RepoMapDelta) => Effect.Effect<Result<void, DomainError>>;
  readonly render: (input: RepoMapRenderInput) => Effect.Effect<Result<RepoMapResult, DomainError>>;
}

export const makeRepoMapService = (initial: RepoMapGraph = emptyRepoMapGraph()): RepoMapService => {
  let graph = initial;
  return {
    update: (delta) => Effect.sync(() => {
      graph = applyRepoMapDelta(graph, delta);
      return ok(undefined);
    }),
    render: (input) => Effect.sync(() => {
      if (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0) {
        return err(domainError('INVALID_INPUT', 'token_budget', 'RepoMap token budget must be a positive safe integer'));
      }
      return ok(renderRepoMapFor(graph, input));
    }),
  };
};
