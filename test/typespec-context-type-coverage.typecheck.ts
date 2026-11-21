import type {
  ProjectionRequest as GeneratedProjectionRequest,
  ProjectionDecision as GeneratedProjectionDecision,
  HostCompactionAttestation as GeneratedHostAttestation,
  PhysicalSendAttemptRequest as GeneratedPhysicalSendAttemptRequest,
  PhysicalSendAttemptDecision as GeneratedPhysicalSendAttemptDecision,
} from '../typespec/generated/sdk/types.gen.js';
import type {
  ResponsesProjectionRequest,
  ResponsesProjectionDecision,
} from '../src/domain/responses-projection.js';
import type { HostCompactionAttestation } from '../src/domain/gateway-request-binding.js';
import type {
  PhysicalSendAttemptRequest,
  PhysicalSendAttemptDecision,
} from '../src/domain/gateway-attempt-authorization.js';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type RequestVersionMatches = Expect<Equal<GeneratedProjectionRequest['schemaVersion'], ResponsesProjectionRequest['schemaVersion']>>;
type RequestProtocolMatches = Expect<Equal<GeneratedProjectionRequest['protocol'], ResponsesProjectionRequest['protocol']>>;
type RequestFieldsMatch = Expect<Equal<
GeneratedProjectionRequest['bodySha256' | 'bodyBase64' | 'query' | 'deadlineEpochMs'],
ResponsesProjectionRequest['bodySha256' | 'bodyBase64' | 'query' | 'deadlineEpochMs']
>>;
type AttestationSessionMatches = Expect<Equal<GeneratedHostAttestation['sessionId'], HostCompactionAttestation['sessionId']>>;
type AttestationHistoryMatches = Expect<Equal<GeneratedHostAttestation['providerManagedHistoryCapability'], HostCompactionAttestation['providerManagedHistoryCapability']>>;
type DecisionKindsMatch = Expect<Equal<GeneratedProjectionDecision['kind'], ResponsesProjectionDecision['kind']>>;
type GeneratedRequestCoversDomain = Expect<GeneratedProjectionRequest extends ResponsesProjectionRequest ? true : false>;
type DomainRequestCoversGenerated = Expect<ResponsesProjectionRequest extends GeneratedProjectionRequest ? true : false>;
type GeneratedDecisionCoversDomain = Expect<GeneratedProjectionDecision extends ResponsesProjectionDecision ? true : false>;
type DomainDecisionCoversGenerated = Expect<ResponsesProjectionDecision extends GeneratedProjectionDecision ? true : false>;
type GeneratedSendRequestCoversDomain = Expect<GeneratedPhysicalSendAttemptRequest extends PhysicalSendAttemptRequest ? true : false>;
type DomainSendRequestCoversGenerated = Expect<PhysicalSendAttemptRequest extends GeneratedPhysicalSendAttemptRequest ? true : false>;
type GeneratedSendDecisionCoversDomain = Expect<GeneratedPhysicalSendAttemptDecision extends PhysicalSendAttemptDecision ? true : false>;
type DomainSendDecisionCoversGenerated = Expect<PhysicalSendAttemptDecision extends GeneratedPhysicalSendAttemptDecision ? true : false>;

const request: GeneratedProjectionRequest = {
  schemaVersion: 'ace.context.v3', protocol: 'openai.responses', requestId: 'r1', attemptGroupId: 'a1',
  agentSessionId: 's1', workspaceId: 'ws1', dataClass: 'private', provider: 'openai', model: 'openai/model',
  bodyBase64: 'e30=', bodySha256: 'a'.repeat(64), query: 'query', projectionMode: 'bifrost_hook',
  deadlineEpochMs: 1, attestation: {
    hostBuildDigest: 'a'.repeat(64), sessionId: 's1', activeEngineId: 'bifrost-visible-request-only',
    effectiveCompressionControlsDigest: 'b'.repeat(64), durableActiveTranscriptRevision: 'unattested',
    durableActiveTranscriptDigest: 'c'.repeat(64), hostCompactionEpoch: 'unknown', attestorId: 'test',
    providerManagedHistoryCapability: 'visible', hostTranscriptAttested: false, compactionEnabled: false,
  },
};
const prepared: GeneratedProjectionDecision = {
  kind: 'PREPARED', baseBodySha256: 'a'.repeat(64), projectedBodySha256: 'b'.repeat(64),
  bodyBase64: 'e30=', projectionReceipt: 'receipt', reasonCode: 'VERIFIED_CONTEXT_ADDED',
};
const blocked: GeneratedProjectionDecision = { kind: 'BLOCK', baseBodySha256: 'a'.repeat(64), reasonCode: 'NOT_READY' };
const samples: readonly [GeneratedProjectionRequest, GeneratedProjectionDecision, GeneratedProjectionDecision] = [request, prepared, blocked];
const attempt: GeneratedPhysicalSendAttemptRequest = {
  schemaVersion: 'ace.context.v3', requestId: 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  attemptGroupId: 'ace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', agentSessionId: 's1', workspaceId: 'ws1',
  dataClass: 'private', provider: 'openai', model: 'gpt-test',
  attemptId: 'bf-attempt-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', method: 'POST',
  destination: 'https://api.openai.com/v1/responses', bodyBase64: 'e30=',
  bodySha256: 'a'.repeat(64), preparedBodySha256: 'b'.repeat(64),
  projectionReceipt: 'receipt', deadlineEpochMs: 1,
};
const allow: GeneratedPhysicalSendAttemptDecision = {
  kind: 'ALLOW', attemptId: attempt.attemptId, bodySha256: attempt.bodySha256,
  provider: attempt.provider, model: attempt.model, destination: attempt.destination, reasonCode: 'AUTHORIZED',
};
const sendSamples: readonly [GeneratedPhysicalSendAttemptRequest, GeneratedPhysicalSendAttemptDecision] = [attempt, allow];
type ContractChecks = readonly [
  RequestVersionMatches, RequestProtocolMatches, RequestFieldsMatch,
  AttestationSessionMatches, AttestationHistoryMatches, DecisionKindsMatch,
  GeneratedRequestCoversDomain, DomainRequestCoversGenerated,
  GeneratedDecisionCoversDomain, DomainDecisionCoversGenerated,
  GeneratedSendRequestCoversDomain, DomainSendRequestCoversGenerated,
  GeneratedSendDecisionCoversDomain, DomainSendDecisionCoversGenerated,
];
void [samples, sendSamples, null as unknown as ContractChecks];
