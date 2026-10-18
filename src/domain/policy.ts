import { domainError, type DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';
import type { WorkspaceId } from './workspace.js';

export type DataClass = 'public' | 'project_document' | 'private_source' | 'private_conversation' | 'secret';
export type Destination = 'local' | 'vertex' | 'jev' | 'embedding_provider' | 'other_external';

export interface ProjectDataPolicy {
  readonly policyId: string;
  readonly workspaceId: WorkspaceId;
  readonly policyVersion: number;
  readonly cloudOptIn: boolean;
  readonly allowedCloudProviders: readonly Exclude<Destination, 'local'>[];
  readonly deniedPathPrefixes: readonly string[];
}

export interface PolicyAction {
  readonly workspaceId: WorkspaceId;
  readonly operation: string;
  readonly destination: Destination;
  readonly dataClasses: readonly DataClass[];
  readonly paths: readonly string[];
  readonly secretDetected: boolean;
}

export interface AccessDecision {
  readonly outcome: 'allowed' | 'denied';
  readonly reasonCode: 'ALLOWED' | 'POLICY_DENIED' | 'AUTH_REQUIRED' | 'SECRET_DETECTED' | 'PATH_DENIED';
  readonly policyVersion: number;
  readonly destination: Destination;
}

export interface SafeAuditRecord {
  readonly occurredAtMs: number;
  readonly correlationId: string;
  readonly component: string;
  readonly category: 'policy' | 'technical';
  readonly policyVersion: number;
  readonly outcome: 'allowed' | 'denied' | 'degraded';
  readonly reasonCode: string;
}

export const defaultLocalPolicy = (workspaceId: WorkspaceId): ProjectDataPolicy => ({
  policyId: `local-${workspaceId}`,
  workspaceId,
  policyVersion: 1,
  cloudOptIn: false,
  allowedCloudProviders: [],
  deniedPathPrefixes: ['.env', '.git/', 'secrets/'],
});

const hasDeniedPath = (action: PolicyAction, policy: ProjectDataPolicy): boolean =>
  action.paths.some((candidate) =>
    policy.deniedPathPrefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`)),
  );

export const authorizeOutbound = (
  action: PolicyAction,
  policy: ProjectDataPolicy,
): Result<AccessDecision, DomainError> => {
  if (action.workspaceId !== policy.workspaceId) {
    return err(domainError('POLICY_DENIED', 'workspace_id', 'policy belongs to another workspace'));
  }
  if (hasDeniedPath(action, policy)) {
    return ok({
      outcome: 'denied',
      reasonCode: 'PATH_DENIED',
      policyVersion: policy.policyVersion,
      destination: action.destination,
    });
  }
  if (action.secretDetected || action.dataClasses.includes('secret')) {
    return ok({
      outcome: 'denied',
      reasonCode: 'SECRET_DETECTED',
      policyVersion: policy.policyVersion,
      destination: action.destination,
    });
  }
  if (action.destination !== 'local' && !policy.cloudOptIn) {
    return ok({
      outcome: 'denied',
      reasonCode: 'AUTH_REQUIRED',
      policyVersion: policy.policyVersion,
      destination: action.destination,
    });
  }
  if (action.destination !== 'local' && !policy.allowedCloudProviders.includes(action.destination)) {
    return ok({
      outcome: 'denied',
      reasonCode: 'POLICY_DENIED',
      policyVersion: policy.policyVersion,
      destination: action.destination,
    });
  }
  return ok({
    outcome: 'allowed',
    reasonCode: 'ALLOWED',
    policyVersion: policy.policyVersion,
    destination: action.destination,
  });
};
