// Canonical internal ACE context RPC. Bifröst is the sole agent-facing LLM Gateway.
// No previous projection contract or generated compatibility surface is retained.
import "@typespec/http";
import "@typespec/json-schema";
import "@typespec/openapi";
using Http;
using JsonSchema;

@service(#{ title: "ACE Context Extension for Bifröst" })
@TypeSpec.OpenAPI.info(#{ version: "3.0.0" })
namespace ACE.ContextV3 {
  model HostCompactionAttestation {
    @pattern("^[a-f0-9]{64}$") hostBuildDigest: string;
    @minLength(1) sessionId: string;
    @minLength(1) parentSessionId?: string;
    @minLength(1) activeEngineId: string;
    @pattern("^[a-f0-9]{64}$") effectiveCompressionControlsDigest: string;
    @minLength(1) durableActiveTranscriptRevision: string;
    @pattern("^[a-f0-9]{64}$") durableActiveTranscriptDigest: string;
    hostCompactionEpoch: int64 | "unknown";
    @minLength(1) attestorId: string;
    providerManagedHistoryCapability: "visible" | "hidden" | "unknown";
    hostTranscriptAttested: boolean;
    compactionEnabled: boolean;
  }

  @jsonSchema
  model ProjectionRequest {
    schemaVersion: "ace.context.v3";
    protocol: "openai.responses";
    @minLength(1) requestId: string;
    @minLength(1) attemptGroupId: string;
    @minLength(1) agentSessionId: string;
    @minLength(1) workspaceId: string;
    dataClass: "private" | "project_document" | "public";
    @minLength(1) provider: string;
    @minLength(1) `model`: string;
    @pattern("^[A-Za-z0-9+/]+={0,2}$")
    @maxLength(5592408)
    bodyBase64: string;
    @pattern("^[a-f0-9]{64}$") bodySha256: string;
    @minLength(1) query: string;
    projectionMode: "bifrost_hook";
    @minValue(1) deadlineEpochMs: int64;
    attestation: HostCompactionAttestation;
  }

  @jsonSchema
  @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
  union ProjectionDecision {
    PREPARED: PreparedProjection;
    BLOCK: BlockedProjection;
  }

  @jsonSchema
  model PreparedProjection {
    kind: "PREPARED";
    @pattern("^[a-f0-9]{64}$") baseBodySha256: string;
    @pattern("^[a-f0-9]{64}$") projectedBodySha256: string;
    @pattern("^[A-Za-z0-9+/]+={0,2}$") bodyBase64: string;
    @minLength(1)
    @maxLength(16384)
    projectionReceipt: string;
    reasonCode: "VERIFIED_CONTEXT_ADDED" | "VERIFIED_NO_CONTEXT_NEEDED";
  }

  @jsonSchema
  model BlockedProjection {
    kind: "BLOCK";
    @pattern("^[a-f0-9]{64}$") baseBodySha256: string;
    reasonCode: string;
  }

  @jsonSchema
  model ContextHealth {
    schemaVersion: "ace.context.v3";
    liveness: "ready";
    readiness: "adapter_implemented";
    providerWire: "not_certified";
  }

  model ContextRouteCapability {
    protocol: "openai.responses";
    mode: "structured";
    capability: "NATIVE_RESPONSES_NOT_CERTIFIED";
  }

  @jsonSchema
  model ContextCapabilities {
    schemaVersion: "ace.context.v3";
    routes: ContextRouteCapability[];
    @minValue(0) maxBodyBytes: int64;
    projectionModes: "bifrost_hook"[];
    providerWireCertification: "not_certified";
  }

  @jsonSchema
  model PhysicalSendAttemptRequest {
    schemaVersion: "ace.context.v3";
    @minLength(1) requestId: string;
    @minLength(1) attemptGroupId: string;
    @minLength(1) agentSessionId: string;
    @minLength(1) workspaceId: string;
    dataClass: "private" | "project_document" | "public";
    @minLength(1) provider: string;
    @minLength(1) `model`: string;
    @minLength(1) attemptId: string;
    @minLength(1) method: string;
    @minLength(1) destination: string;
    @pattern("^[A-Za-z0-9+/]+={0,2}$")
    @maxLength(5592408)
    bodyBase64: string;
    @pattern("^[a-f0-9]{64}$") bodySha256: string;
    @pattern("^[a-f0-9]{64}$") preparedBodySha256: string;
    @minLength(1)
    @maxLength(16384)
    projectionReceipt: string;
    @minValue(1) deadlineEpochMs: int64;
  }

  @jsonSchema
  @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
  union PhysicalSendAttemptDecision {
    ALLOW: PhysicalSendAttemptAllowed;
    BLOCK: PhysicalSendAttemptBlocked;
  }

  @jsonSchema
  model PhysicalSendAttemptAllowed {
    kind: "ALLOW";
    @minLength(1) attemptId: string;
    @pattern("^[a-f0-9]{64}$") bodySha256: string;
    @minLength(1) provider: string;
    @minLength(1) `model`: string;
    @minLength(1) destination: string;
    reasonCode: "AUTHORIZED";
  }

  @jsonSchema
  model PhysicalSendAttemptBlocked {
    kind: "BLOCK";
    @minLength(1) attemptId: string;
    @pattern("^[a-f0-9]{64}$") bodySha256: string;
    reasonCode: string;
  }

  model ContextError {
    @statusCode status: 400 | 401 | 404 | 405 | 409 | 413 | 503;
    error: { code: string; message: string };
  }

  @get
  @route("/internal/ace-context/v3/health")
  op health(): ContextHealth;

  @get
  @route("/internal/ace-context/v3/capabilities")
  op capabilities(): ContextCapabilities;

  @post
  @route("/internal/ace-context/v3/project")
  op project(@body request: ProjectionRequest): ProjectionDecision | ContextError;

  @post
  @route("/internal/ace-context/v3/authorize-attempt")
  op authorizePhysicalSend(@body request: PhysicalSendAttemptRequest): PhysicalSendAttemptDecision | ContextError;
}
