import { Effect } from 'effect';
import type { DomainError } from '../domain/errors.js';
import { err, type Result } from '../domain/result.js';

export const recoverResult = <Value>(
  effect: Effect.Effect<Result<Value, DomainError>, DomainError>,
): Effect.Effect<Result<Value, DomainError>> =>
    effect.pipe(Effect.catchAll((error) => Effect.succeed<Result<Value, DomainError>>(err(error))));
