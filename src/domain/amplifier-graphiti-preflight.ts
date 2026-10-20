export type PreflightCheckStatus = 'pass' | 'blocked' | 'not_ready' | 'policy_denied' | 'unavailable';

export type PreflightStatus = 'ready' | 'not_ready' | 'policy_denied' | 'unavailable';

export interface AmplifierGraphitiCheck {
  readonly name: string;
  readonly status: PreflightCheckStatus;
  readonly detail: string;
}

export interface AmplifierGraphitiPreflightInput {
  readonly faceUrlIsLoopback: boolean;
  readonly faceTokenPresent: boolean;
  readonly faceModelsReachable: boolean;
  readonly faceModelAliasPresent: boolean;
  readonly liveCatalogReachable: boolean;
  readonly requestedModelPresent: boolean;
  readonly graphitiCommandConfigured: boolean;
  readonly graphitiSourceRefPinned: boolean;
  readonly graphitiConfigPresent: boolean;
  readonly graphitiConfigIsSecretFree: boolean;
  readonly structuredOutputJsonObject: boolean;
  readonly falkorDbIsLoopback: boolean;
  readonly localEmbedderSupportedByPinnedMcp: boolean;
  readonly localRerankerSupportedByPinnedMcp: boolean;
  readonly syntheticOnlyPolicy: boolean;
  readonly privateCloudApprovalComplete: boolean;
}

export interface AmplifierGraphitiPreflightResult {
  readonly status: PreflightStatus;
  readonly checks: readonly AmplifierGraphitiCheck[];
  readonly productionClaims: {
    readonly tokenSavings5x: false;
    readonly graphitiLocalOnly: false;
  };
}

const check = (
  name: string,
  status: PreflightCheckStatus,
  detail: string,
): AmplifierGraphitiCheck => ({ name, status, detail });

export const evaluateAmplifierGraphitiPreflight = (
  input: AmplifierGraphitiPreflightInput,
): AmplifierGraphitiPreflightResult => {
  const checks: AmplifierGraphitiCheck[] = [
    check(
      'face-loopback',
      input.faceUrlIsLoopback ? 'pass' : 'policy_denied',
      input.faceUrlIsLoopback
        ? 'Amplifier face URL is loopback-only'
        : 'Amplifier face must bind to localhost, 127.0.0.1, or ::1',
    ),
    check(
      'face-token',
      input.faceTokenPresent ? 'pass' : 'not_ready' as PreflightCheckStatus,
      input.faceTokenPresent
        ? 'bearer token is present in the process environment; its value is not retained'
        : 'AMPLIFIER_AGENT_FACE_TOKEN is missing',
    ),
    check(
      'face-models',
      input.faceModelsReachable ? 'pass' : 'unavailable',
      input.faceModelsReachable
        ? 'Amplifier face /v1/models responded'
        : 'Amplifier face /v1/models was not reachable',
    ),
    check(
      'face-model-alias',
      input.faceModelAliasPresent ? 'pass' : 'blocked',
      input.faceModelAliasPresent
        ? 'configured face model alias is advertised'
        : 'configured face model alias is not advertised by /v1/models',
    ),
    check(
      'live-model-catalog',
      input.liveCatalogReachable ? 'pass' : 'unavailable',
      input.liveCatalogReachable
        ? 'openai-chatgpt live catalog responded'
        : 'openai-chatgpt live catalog was not reachable',
    ),
    check(
      'requested-model-entitlement',
      input.requestedModelPresent ? 'pass' : 'blocked',
      input.requestedModelPresent
        ? 'requested model is present in the live account catalog'
        : 'requested model is absent from the live account catalog; no request may use it',
    ),
    check(
      'graphiti-command',
      input.graphitiCommandConfigured ? 'pass' : 'not_ready' as PreflightCheckStatus,
      input.graphitiCommandConfigured
        ? 'official Graphiti MCP command and argv are configured'
        : 'ACE_GRAPHITI_COMMAND and ACE_GRAPHITI_ARGS_JSON are required',
    ),
    check(
      'graphiti-source-ref',
      input.graphitiSourceRefPinned ? 'pass' : 'blocked',
      input.graphitiSourceRefPinned
        ? 'Graphiti MCP checkout matches the pinned commit'
        : 'Graphiti MCP checkout does not match the pinned commit',
    ),
    check(
      'graphiti-config',
      input.graphitiConfigPresent ? 'pass' : 'not_ready' as PreflightCheckStatus,
      input.graphitiConfigPresent
        ? 'Graphiti config file is present'
        : 'Graphiti config file is missing',
    ),
    check(
      'secret-free-config',
      input.graphitiConfigIsSecretFree ? 'pass' : 'policy_denied',
      input.graphitiConfigIsSecretFree
        ? 'config contains no literal credential or access token'
        : 'config contains a literal secret; remove it and use process environment injection',
    ),
    check(
      'structured-output',
      input.structuredOutputJsonObject ? 'pass' : 'blocked',
      input.structuredOutputJsonObject
        ? 'Graphiti is configured for json_object prompt/schema fallback'
        : 'Graphiti must use structured_output_mode=json_object with the Amplifier face',
    ),
    check(
      'falkordb-loopback',
      input.falkorDbIsLoopback ? 'pass' : 'policy_denied',
      input.falkorDbIsLoopback
        ? 'FalkorDB URI is loopback-only'
        : 'FalkorDB must remain local for this profile',
    ),
    check(
      'local-embedder',
      input.localEmbedderSupportedByPinnedMcp ? 'pass' : 'blocked',
      input.localEmbedderSupportedByPinnedMcp
        ? 'pinned Graphiti MCP exposes the requested local embedder'
        : 'pinned Graphiti MCP does not expose the requested local embedder; no fallback or shim is allowed',
    ),
    check(
      'local-reranker',
      input.localRerankerSupportedByPinnedMcp ? 'pass' : 'blocked',
      input.localRerankerSupportedByPinnedMcp
        ? 'pinned Graphiti MCP can select the local BGE/Sentence-Transformers reranker'
        : 'pinned Graphiti MCP cannot prove local reranker selection; provider-backed reranking is not accepted',
    ),
    check(
      'synthetic-policy',
      input.syntheticOnlyPolicy ? 'pass' : 'policy_denied',
      input.syntheticOnlyPolicy
        ? 'only the committed synthetic fixture is authorized for this preflight'
        : 'private Codex sessions require a separate approved policy profile',
    ),
    check(
      'private-cloud-approval',
      input.privateCloudApprovalComplete ? 'pass' : 'not_ready' as PreflightCheckStatus,
      input.privateCloudApprovalComplete
        ? 'private-cloud policy profile has an explicit owner approval reference'
        : 'private-cloud inference is not approved; this does not block synthetic-only work',
    ),
  ];

  const hasPolicyDenial = checks.some(({ status }) => status === 'policy_denied');
  const hasUnavailable = checks.some(({ status }) => status === 'unavailable');
  const hasBlocker = checks.some(({ status }) => status === 'blocked' || status === 'not_ready');
  const status: PreflightStatus = hasPolicyDenial
    ? 'policy_denied'
    : hasUnavailable
      ? 'unavailable'
      : hasBlocker
        ? 'not_ready'
        : 'ready';

  return {
    status,
    checks,
    productionClaims: {
      tokenSavings5x: false,
      graphitiLocalOnly: false,
    },
  };
};
