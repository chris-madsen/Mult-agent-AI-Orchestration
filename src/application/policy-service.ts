import { Effect } from 'effect';
import { authorizeOutbound, type PolicyAction, type ProjectDataPolicy, type SafeAuditRecord } from '../domain/policy.js';
import { err, isErr, ok, type Result } from '../domain/result.js';
import { domainError, type DomainError } from '../domain/errors.js';
import type { AuditSink, ClockPort } from './ports.js';

export interface AuthorizationResult {
  readonly decision: ReturnType<typeof authorizeOutbound> extends Result<infer Value, DomainError> ? Value : never;
  readonly audit: SafeAuditRecord;
}

export const authorizeAndAudit = (
  policy: ProjectDataPolicy,
  action: PolicyAction,
  correlationId: string,
  ports: { readonly clock: ClockPort; readonly audit: AuditSink },
): Effect.Effect<Result<AuthorizationResult, DomainError>> =>
  Effect.gen(function* () {
    const decision = authorizeOutbound(action, policy);
    if (isErr(decision)) return decision;
    const audit: SafeAuditRecord = {
      occurredAtMs: ports.clock.nowMs(),
      correlationId,
      component: 'trust-policy',
      category: 'policy',
      policyVersion: policy.policyVersion,
      outcome: decision.value.outcome,
      reasonCode: decision.value.reasonCode,
    };
    const written = yield* ports.audit.append(audit);
    if (isErr(written)) {
      return err(domainError('AUDIT_FAILED', 'audit', 'policy decision could not be safely recorded'));
    }
    return ok({ decision: decision.value, audit });
  });
