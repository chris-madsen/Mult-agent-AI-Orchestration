import { Effect } from 'effect';
import { domainError, type DomainError } from '../domain/errors.js';
import { assembleContext, type ContextAssemblyInput, type ContextAssemblyResult } from '../domain/context-assembly.js';
import { err, ok, type Result } from '../domain/result.js';

export interface ContextAssembler {
  readonly assemble: (
    input: ContextAssemblyInput,
  ) => Effect.Effect<Result<ContextAssemblyResult, DomainError>>;
}

export const makeContextAssembler = (): ContextAssembler => ({
  assemble: (input) => Effect.sync(() => {
    if (!Number.isSafeInteger(input.budgetTokens) || input.budgetTokens <= 0) {
      return err(domainError('INVALID_INPUT', 'budgetTokens', 'context budget must be a positive safe integer'));
    }
    for (const [section, budget] of Object.entries(input.sectionBudgets ?? {})) {
      if (!['code', 'repo_map', 'lsp', 'other'].includes(section)
        || !Number.isSafeInteger(budget) || (budget as number) < 0) {
        return err(domainError(
          'INVALID_INPUT',
          'sectionBudgets',
          'context section budgets must be non-negative safe integers for known sections',
        ));
      }
    }
    return ok(assembleContext(input));
  }),
});
