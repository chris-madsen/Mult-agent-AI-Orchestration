# Design — Hermes ContextEngine request projection

## Runtime path

```text
Hermes turn
  |
  v
ContextEngine.select_context(request_messages, conversation_messages,
                              incoming_message, budget_tokens)
  |
  | direct local JSONL bridge
  v
ACE context-transform service
  |
  +-- workspace observation / source obligations
  +-- hybrid retrieval and source verification
  +-- delivery projection / evidence receipts
  v
AceTransformResult
  |
  v
Hermes request-only message list
  |
  v
provider request
```

The plugin MUST NOT mutate `conversation_messages` or durable session rows. The returned list is request-local. Hermes remains responsible for provider-specific serialization and tool-call/result validity.

## Cross-language contract

```ts
interface AceTransformRequest {
  schemaVersion: 1;
  requestId: string;
  sessionId: string;
  workspaceId: string;
  query: string;
  budgetTokens: number;
  intent?: string;
  workingContext?: {
    focusedPath?: string;
    openPaths?: string[];
    focusedRange?: { startLine: number; endLine: number };
  };
  knownBundleId?: string;
  knownEvidenceIds?: string[];
  sourceObligations?: {
    required?: string[];
    optional?: string[];
  };
}

interface AceTransformResult {
  schemaVersion: 1;
  requestId: string;
  workspaceId: string;
  status: 'ready' | 'partial' | 'not_ready' | 'blocked';
  contextText: string;
  evidence: Record<string, unknown>[];
  selectedEvidenceIds: string[];
  omittedEvidenceIds: string[];
  estimatedTokens: number;
  sourceCommit?: string;
  sourceManifestSha256?: string;
  providerIdentities: Record<string, string>;
  receiptId: string;
  limitations: string[];
}
```

## Message projection rules

- Preserve the system message and the current user message.
- Select or omit complete logical groups only.
- A tool call and its matching tool result are one group.
- Provider-specific reasoning/signature carriers stay with their owning assistant message.
- ACE context is a bounded request-only block with evidence IDs and exact-expansion handles.
- If the result cannot fit the budget without violating lossless evidence semantics, return a partial/blocked result instead of silently truncating.
- A bridge failure leaves the original request unchanged only when the policy explicitly allows degraded no-ACE execution; the receipt must say `not_ready`/`blocked`, and the benchmark must not count the run as ACE-used.

## Direct bridge

The TypeScript bridge is a long-lived JSONL subprocess. It uses the same ACE runtime/provider composition as the MCP executable but a separate transport. Each line carries one request and one response keyed by `requestId`. stderr contains diagnostics and identities only; raw context/source/credential values are forbidden.

## Evidence

The Python plugin writes sanitized transformation receipts containing request/session/turn IDs, receipt ID, selected/omitted evidence IDs, source/runtime/provider identity, estimated tokens, and status. The Harbor collector binds those receipts to the generated job manifest, experiment manifest, raw trial directory, and ACE provider trace.

## Compatibility

The pinned Hermes version must be probed before implementation. If it lacks the required `ContextEngine.select_context` signature, the implementation must stop and use the owner-approved fallback decision rather than targeting the unpinned host Hermes.
