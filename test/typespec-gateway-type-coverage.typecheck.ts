import type {
  ProjectionRequest as GatewayWireRequest,
  ProjectionReceipt as GatewayWireReceipt,
  ProjectionDecision as GatewayWireDecision,
  HostCompactionAttestation as GatewayWireAttestation,
} from '../typespec/generated/sdk/types.gen.js';
import type {
  GatewayProjectionRequest,
  GatewayProjectionReceipt,
  GatewayProjectionDecision,
  HostCompactionAttestation,
} from '../src/domain/gateway-projection.js';

// TSP-04: a new TypeSpec field or a removed field must fail this gate. No
// unsafe casts or omitted properties conceal protocol drift.
type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never]
  ? true : false;
const sameRequestFields: SameKeys<GatewayWireRequest, GatewayProjectionRequest> = true;
const sameReceiptFields: SameKeys<GatewayWireReceipt, GatewayProjectionReceipt> = true;
const sameAttestationFields: SameKeys<GatewayWireAttestation, HostCompactionAttestation> = true;
type DomainDecisionWireShape = {
  kind: GatewayProjectionDecision['kind'];
  bodyBase64?: string;
  receipt: GatewayProjectionReceipt;
};
const sameDecisionFields: SameKeys<GatewayWireDecision, DomainDecisionWireShape> = true;
void [sameRequestFields, sameReceiptFields, sameAttestationFields, sameDecisionFields];

// The adapter does mechanical DTO field mapping only. The existing domain
// validator remains authoritative for SHA-256, base64, session and trust.
export const mapGatewayWireRequest = (dto: GatewayWireRequest): GatewayProjectionRequest => ({
  schemaVersion: dto.schemaVersion,
  requestId: dto.requestId,
  attemptGroupId: dto.attemptGroupId,
  agentSessionId: dto.agentSessionId,
  workspaceId: dto.workspaceId,
  dataClass: dto.dataClass,
  protocol: dto.protocol,
  provider: dto.provider,
  model: dto.model,
  bodyBase64: dto.bodyBase64,
  bodySha256: dto.bodySha256,
  query: dto.query,
  projectionMode: dto.projectionMode,
  deadlineEpochMs: dto.deadlineEpochMs,
  attestation: {
    hostBuildDigest: dto.attestation.hostBuildDigest,
    sessionId: dto.attestation.sessionId,
    ...(dto.attestation.parentSessionId === undefined ? {} : { parentSessionId: dto.attestation.parentSessionId }),
    activeEngineId: dto.attestation.activeEngineId,
    effectiveCompressionControlsDigest: dto.attestation.effectiveCompressionControlsDigest,
    durableActiveTranscriptRevision: dto.attestation.durableActiveTranscriptRevision,
    durableActiveTranscriptDigest: dto.attestation.durableActiveTranscriptDigest,
    hostCompactionEpoch: dto.attestation.hostCompactionEpoch,
    attestorId: dto.attestation.attestorId,
    providerManagedHistoryCapability: dto.attestation.providerManagedHistoryCapability,
    hostTranscriptAttested: dto.attestation.hostTranscriptAttested,
    compactionEnabled: dto.attestation.compactionEnabled,
  },
  ...(dto.nativeProjectionActive === undefined ? {} : { nativeProjectionActive: dto.nativeProjectionActive }),
  ...(dto.requestedEvidenceIds === undefined ? {} : { requestedEvidenceIds: dto.requestedEvidenceIds }),
});

export const mapGatewayDomainReceipt = (receipt: GatewayProjectionReceipt): GatewayWireReceipt => ({
  schemaVersion: receipt.schemaVersion,
  requestId: receipt.requestId,
  attemptGroupId: receipt.attemptGroupId,
  attemptIndex: receipt.attemptIndex,
  ...(receipt.projectionId === undefined ? {} : { projectionId: receipt.projectionId }),
  receiptId: receipt.receiptId,
  decision: receipt.decision,
  ...(receipt.reasonCode === undefined ? {} : { reasonCode: receipt.reasonCode }),
  baseBodySha256: receipt.baseBodySha256,
  ...(receipt.projectedBodySha256 === undefined ? {} : { projectedBodySha256: receipt.projectedBodySha256 }),
  hostCompactionEpoch: receipt.hostCompactionEpoch,
  activeEngineId: receipt.activeEngineId,
  permittedWireRewrites: [...receipt.permittedWireRewrites],
});

export const mapGatewayDomainDecision = (decision: GatewayProjectionDecision): GatewayWireDecision => {
  switch (decision.kind) {
    case 'APPLY':
      return { kind: decision.kind, bodyBase64: decision.bodyBase64, receipt: mapGatewayDomainReceipt(decision.receipt) };
    case 'UNCHANGED_AUTHORIZED':
      return { kind: decision.kind, receipt: mapGatewayDomainReceipt(decision.receipt) };
    case 'DEGRADED_AUTHORIZED':
      return {
        kind: decision.kind,
        ...(decision.bodyBase64 === undefined ? {} : { bodyBase64: decision.bodyBase64 }),
        receipt: mapGatewayDomainReceipt(decision.receipt),
      };
    case 'BLOCK':
      return { kind: decision.kind, receipt: mapGatewayDomainReceipt(decision.receipt) };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
};
