import "@typespec/json-schema";
using JsonSchema;

// TS-04: candidate schema metadata for official MCP SDK tools and native Hermes.
// No framing, SDK registration, or runtime boundary is replaced by these models.
namespace AceMcpToolV1 {
  @minLength(1)
  scalar NonEmpty extends string;
  @minValue(1)
  scalar PositiveLine extends int32;

  enum SourceKind { code, structural, lsp, documentation, memory, history }

  model FocusedRange {
    start_line: PositiveLine;
    end_line: PositiveLine;
  }
  model WorkingContext {
    focused_path?: NonEmpty;
    @maxItems(100)
    open_paths?: NonEmpty[];
    focused_range?: FocusedRange;
  }
  model SourceObligations {
    required?: SourceKind[];
    optional?: SourceKind[];
  }

  /** Official MCP SDK tool input, not a competing SDK/transport. */
  @jsonSchema
  model AceContextInput {
    workspace_id: NonEmpty;
    query: string;
    intent?: string;
    include_code?: boolean;
    include_docs?: boolean;
    include_memory?: boolean;
    include_history?: boolean;
    known_bundle_id?: NonEmpty;
    @maxItems(1000)
    known_evidence_ids?: NonEmpty[];
    working_context?: WorkingContext;
    source_obligations?: SourceObligations;
  }
  @jsonSchema
  model AceExpandInput {
    handle: NonEmpty;
    cursor?: string;
    @minValue(1)
    max_bytes?: int32;
    format?: "base64" | "utf8";
  }
  @jsonSchema
  model AceWorkspaceStatusInput {
    workspace_id: NonEmpty;
  }
  @jsonSchema
  model AceMemorySearchInput {
    workspace_id: NonEmpty;
    query: string;
    as_of?: string;
    include_original?: boolean;
  }
}

namespace AceHermesNativeV1 {
  model WorkingRange {
    @minValue(1)
    startLine: int64;
    @minValue(1)
    endLine: int64;
  }
  model WorkingContext {
    focusedPath?: string;
    @maxItems(100)
    openPaths?: string[];
    focusedRange?: WorkingRange;
  }
  /** The bridge_ready JSONL record sent before any provider request. */
  @jsonSchema
  model BridgeReady {
    type: "bridge_ready";
    schemaVersion: 1;
    runtimeId: "ace-harbor-runtime-v1";
    @minLength(1)
    node: string;
    providerIdentities: Record<string>;
  }
  /** Request fields accepted by the current native transform entrypoint. */
  @jsonSchema
  model TransformRequest {
    type: "transform";
    schemaVersion: 1;
    @minLength(1)
    requestId: string;
    @minLength(1)
    sessionId: string;
    @minLength(1)
    turnId: string;
    @minLength(1)
    workspaceId: string;
    @minLength(1)
    query: string;
    @minValue(1)
    budgetTokens: int64;
    sourceObligations: { required: ["code"]; };
    intent?: string;
    workingContext?: WorkingContext;
    knownBundleId?: string;
    knownEvidenceIds?: string[];
  }
}
