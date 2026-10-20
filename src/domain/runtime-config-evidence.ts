import { domainError, type DomainError } from './errors.js';
import type { DataClass, Destination } from './policy.js';
import { err, ok, type Result } from './result.js';

export type RuntimeReleaseScope = 'code-only' | 'full-unified';
export type RuntimeDeployment = 'host' | 'k3s';

export interface RuntimeCloudPermission {
  readonly provider: Exclude<Destination, 'local'>;
  readonly dataClasses: readonly Exclude<DataClass, 'secret'>[];
}

export interface RuntimeConfigEvidenceInput {
  readonly schemaVersion: 1;
  readonly scope: RuntimeReleaseScope;
  readonly deployment: RuntimeDeployment;
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly captureReference: string;
  readonly workspaceIdHash: string;
  readonly codeRetrieval: {
    readonly enabled: boolean;
    readonly qdrantEnabled: boolean;
    readonly pinnedEmbeddingRequired: boolean;
    readonly localFallbackAllowed: boolean;
    readonly embeddingProvider: string;
    readonly semanticProvider: string;
  };
  readonly documentation: {
    readonly enabled: boolean;
    readonly cloudDocsOptIn: boolean;
  };
  readonly memory: {
    readonly enabled: boolean;
    readonly localOnly: boolean;
  };
  readonly worktree: {
    readonly hostHelperEnabled: boolean;
    readonly mtlsRequired: boolean;
  };
  readonly cloudPermissions: readonly RuntimeCloudPermission[];
}

export interface RuntimeConfigEvidenceVerdict {
  readonly evidence: 'runtime-config-accepted' | 'runtime-config-incomplete';
  readonly scope: RuntimeReleaseScope;
  readonly deployment: RuntimeDeployment;
  readonly sourceCommit: string;
  readonly embeddingProvider: string;
  readonly semanticProvider: string;
  readonly failures: readonly string[];
}

const externalProviders: readonly Exclude<Destination, 'local'>[] = [
  'vertex',
  'jev',
  'embedding_provider',
  'other_external',
];

const dataClasses: readonly Exclude<DataClass, 'secret'>[] = [
  'public',
  'project_document',
  'private_source',
  'private_conversation',
];

const commitSha = (value: string): boolean => /^[a-f0-9]{40,64}$/u.test(value);
const sha256 = (value: string): boolean => /^[a-f0-9]{64}$/u.test(value);
const safeText = (value: string): boolean =>
  value.trim().length > 0
  && value.length <= 240
  && !/(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key)\s*[:=]\s*\S+/iu.test(value)
  && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value);

const validatePermissions = (
  permissions: readonly RuntimeCloudPermission[],
): Result<Map<Exclude<Destination, 'local'>, ReadonlySet<Exclude<DataClass, 'secret'>>>, DomainError> => {
  const mapped = new Map<Exclude<Destination, 'local'>, ReadonlySet<Exclude<DataClass, 'secret'>>>();
  for (const permission of permissions) {
    if (!externalProviders.includes(permission.provider)
      || mapped.has(permission.provider)
      || !Array.isArray(permission.dataClasses)
      || permission.dataClasses.length === 0
      || new Set(permission.dataClasses).size !== permission.dataClasses.length
      || permission.dataClasses.some((dataClass) => !dataClasses.includes(dataClass))) {
      return err(domainError(
        'INVALID_BENCHMARK',
        'runtime_config.cloud_permissions',
        'runtime cloud permissions must contain unique known providers and explicit non-secret data classes',
      ));
    }
    mapped.set(permission.provider, new Set(permission.dataClasses));
  }
  return ok(mapped);
};

export const evaluateRuntimeConfigEvidence = (
  input: RuntimeConfigEvidenceInput,
  currentCommit: string,
): Result<RuntimeConfigEvidenceVerdict, DomainError> => {
  if (input.schemaVersion !== 1
    || !commitSha(input.sourceCommit)
    || !commitSha(currentCommit)
    || Number.isNaN(Date.parse(input.generatedAt))
    || !safeText(input.captureReference)
    || !sha256(input.workspaceIdHash)
    || !safeText(input.codeRetrieval.embeddingProvider)
    || !safeText(input.codeRetrieval.semanticProvider)) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'runtime_config',
      'runtime configuration identity/capture metadata is invalid',
    ));
  }
  const booleanFlags = [
    input.codeRetrieval.enabled,
    input.codeRetrieval.qdrantEnabled,
    input.codeRetrieval.pinnedEmbeddingRequired,
    input.codeRetrieval.localFallbackAllowed,
    input.documentation.enabled,
    input.documentation.cloudDocsOptIn,
    input.memory.enabled,
    input.memory.localOnly,
    input.worktree.hostHelperEnabled,
    input.worktree.mtlsRequired,
  ];
  if (!booleanFlags.every((value) => typeof value === 'boolean')) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'runtime_config.flags',
      'runtime configuration capability/security flags must be booleans',
    ));
  }
  if (input.scope !== 'code-only' && input.scope !== 'full-unified') {
    return err(domainError('INVALID_BENCHMARK', 'runtime_config.scope', 'runtime configuration scope is invalid'));
  }
  if (input.deployment !== 'host' && input.deployment !== 'k3s') {
    return err(domainError('INVALID_BENCHMARK', 'runtime_config.deployment', 'runtime deployment is invalid'));
  }

  const permissions = validatePermissions(input.cloudPermissions);
  if (permissions._tag === 'Err') return permissions;

  const failures: string[] = [];
  if (input.sourceCommit !== currentCommit) failures.push('source_commit_mismatch');
  if (!input.codeRetrieval.enabled) failures.push('code_retrieval_disabled');
  if (!input.codeRetrieval.qdrantEnabled) failures.push('qdrant_disabled');
  if (!input.codeRetrieval.pinnedEmbeddingRequired) failures.push('embedding_not_pinned');
  if (input.codeRetrieval.localFallbackAllowed) failures.push('local_fallback_enabled');

  if (input.deployment === 'k3s') {
    if (!input.worktree.hostHelperEnabled) failures.push('k3s_host_helper_disabled');
    if (!input.worktree.mtlsRequired) failures.push('k3s_host_helper_mtls_not_required');
  }

  if (input.scope === 'code-only') {
    if (input.documentation.enabled) failures.push('documentation_enabled_outside_scope');
    if (input.documentation.cloudDocsOptIn) failures.push('cloud_docs_opt_in_outside_scope');
    if (input.memory.enabled) failures.push('memory_enabled_outside_scope');
    if (!input.memory.localOnly) failures.push('memory_local_only_not_enforced');
    if (permissions.value.size !== 0) failures.push('cloud_permissions_present_outside_scope');
  } else {
    if (input.deployment !== 'k3s') failures.push('full_unified_requires_k3s_profile');
    if (!input.documentation.enabled) failures.push('documentation_disabled');
    if (!input.documentation.cloudDocsOptIn) failures.push('cloud_docs_opt_in_missing');
    if (!input.memory.enabled) failures.push('memory_disabled');
    if (!input.memory.localOnly) failures.push('memory_not_local_only');

    const vertex = permissions.value.get('vertex');
    if (vertex === undefined
      || vertex.size !== 1
      || !vertex.has('project_document')) {
      failures.push('vertex_data_scope_not_project_document_only');
    }
    if (permissions.value.has('jev')
      || permissions.value.has('embedding_provider')
      || permissions.value.has('other_external')) {
      failures.push('unapproved_extra_cloud_provider_scope');
    }
    if ([...permissions.value.values()].some((classes) =>
      classes.has('private_source') || classes.has('private_conversation'))) {
      failures.push('private_data_cloud_egress_enabled');
    }
  }

  return ok({
    evidence: failures.length === 0 ? 'runtime-config-accepted' : 'runtime-config-incomplete',
    scope: input.scope,
    deployment: input.deployment,
    sourceCommit: input.sourceCommit,
    embeddingProvider: input.codeRetrieval.embeddingProvider,
    semanticProvider: input.codeRetrieval.semanticProvider,
    failures: [...new Set(failures)],
  });
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const validateRuntimeConfigEvidenceDocument = (
  document: unknown,
  currentCommit: string,
  expectedScope: RuntimeReleaseScope,
  expectedDeployment?: RuntimeDeployment,
): Result<RuntimeConfigEvidenceVerdict, DomainError> => {
  const root = record(document);
  const verdict = record(root?.verdict);
  const code = record(root?.codeRetrieval);
  const documentation = record(root?.documentation);
  const memory = record(root?.memory);
  const worktree = record(root?.worktree);
  if (root === undefined
    || root.schemaVersion !== 1
    || root.evidence !== 'runtime-config-accepted'
    || root.scope !== expectedScope
    || root.sourceCommit !== currentCommit
    || root.currentCommit !== currentCommit
    || verdict === undefined
    || verdict.evidence !== 'runtime-config-accepted'
    || verdict.scope !== expectedScope
    || verdict.sourceCommit !== currentCommit
    || !Array.isArray(verdict.failures)
    || verdict.failures.length !== 0
    || code === undefined
    || documentation === undefined
    || memory === undefined
    || worktree === undefined
    || !Array.isArray(root.cloudPermissions)
    || typeof root.generatedAt !== 'string'
    || typeof root.captureReference !== 'string'
    || typeof root.workspaceIdHash !== 'string'
    || typeof root.deployment !== 'string') {
    return err(domainError(
      'INVALID_BENCHMARK',
      'runtime_config.document',
      'finalized runtime configuration evidence is incomplete or does not match the release',
    ));
  }
  if (expectedDeployment !== undefined && root.deployment !== expectedDeployment) {
    return err(domainError(
      'INVALID_BENCHMARK',
      'runtime_config.document',
      'runtime configuration deployment does not match the release profile',
    ));
  }

  const rechecked = evaluateRuntimeConfigEvidence({
    schemaVersion: 1,
    scope: expectedScope,
    deployment: root.deployment as RuntimeDeployment,
    sourceCommit: currentCommit,
    generatedAt: root.generatedAt,
    captureReference: root.captureReference,
    workspaceIdHash: root.workspaceIdHash,
    codeRetrieval: code as unknown as RuntimeConfigEvidenceInput['codeRetrieval'],
    documentation: documentation as unknown as RuntimeConfigEvidenceInput['documentation'],
    memory: memory as unknown as RuntimeConfigEvidenceInput['memory'],
    worktree: worktree as unknown as RuntimeConfigEvidenceInput['worktree'],
    cloudPermissions: root.cloudPermissions as RuntimeCloudPermission[],
  }, currentCommit);
  if (rechecked._tag === 'Err'
    || rechecked.value.evidence !== 'runtime-config-accepted'
    || rechecked.value.embeddingProvider !== verdict.embeddingProvider
    || rechecked.value.semanticProvider !== verdict.semanticProvider) {
    return rechecked._tag === 'Err'
      ? rechecked
      : err(domainError(
        'INVALID_BENCHMARK',
        'runtime_config.document',
        'runtime configuration internal verdict does not match re-evaluation',
      ));
  }
  return rechecked;
};
