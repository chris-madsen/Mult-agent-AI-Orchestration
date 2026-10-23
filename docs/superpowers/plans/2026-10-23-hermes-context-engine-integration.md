# Hermes ContextEngine integration for ACE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Hermes-facing ACE MCP-tool path with a direct Hermes `ContextEngine.select_context()` integration that transforms the outgoing model request without mutating the durable Hermes transcript.

**Architecture:** Hermes owns the agent loop, provider call, durable session history, tool execution, and provider-specific message invariants. ACE becomes a request-time context transformation service: it receives the current workspace/query/budget, retrieves and verifies evidence, and returns a request-only context projection. A small local JSONL bridge separates the Python Hermes plugin from the TypeScript ACE runtime; MCP remains optional for explicit diagnostics and exact expansion, not the primary context injection path.

**Tech Stack:** TypeScript + Effect ACE runtime, Node JSONL bridge, Python Hermes plugin implementing `ContextEngine`, Harbor 0.24.0, Hermes pinned runtime, Qdrant/FastEmbed/ast-grep/LSP providers, JSONL evidence receipts, TypeScript contract tests, Python plugin tests.

**Spec:** `docs/docs/reports/agents-compartion.html` sections 122-140, 204-320; Accepted ADR-015; proposed follow-up ADR-016; new OpenSpec change `008-hermes-context-integration`.

## Global Constraints

- Hermes context transformation MUST use `ContextEngine.select_context()` for the primary path; `pre_llm_call` is a compatibility fallback only if the pinned Hermes runtime lacks `select_context`.
- The transformation is request-only. Durable Hermes session history MUST remain unchanged except for the existing exact request-sidecar mechanism required for replay/cache stability.
- ACE MUST NOT depend on Hermes calling an MCP tool to obtain mandatory context.
- Preserve complete logical message groups: user turn, assistant reasoning/content, tool-call plus matching tool-result messages, and provider-specific reasoning/signature carriers.
- Current verified workspace bytes outrank stale index data and derived memory; changed/untracked/removed paths remain visible in workspace identity and evidence receipts.
- Missing, failed, stale, malformed, or uncorrelated ACE transformation evidence is `UNKNOWN`/`BLOCKED`, never an empty successful context or zero savings.
- The Hermes runtime, model, provider, reasoning effort, task image, source revision, ACE bridge, and plugin must be pinned in experiment evidence.
- Native and ACE-enabled Harbor arms use the same task, source checkout, model, Hermes runtime, reasoning effort, timeout, image, and one attempt; only the request-time ACE transformation differs.
- Credentials remain in the Hermes-owned auth store; no token bytes enter bridge messages, plugin logs, receipts, manifests, or benchmark artifacts.
- Do not install mutable provider dependencies during a trial. Container-side Python/Node dependencies must be built or supplied from pinned, reproducible artifacts.
- ACE remains read-only with respect to the user worktree and durable Hermes transcript.
- Every completed repository change is delivered through a reviewable PR targeting `main`; do not push directly to `main`.

## Review Focus

- Tool-call/result integrity: selecting context must never leave an unmatched call, result, or provider-specific reasoning block.
- Retry determinism: repeated provider requests for one turn must receive the same transformed request and receipt identity unless the workspace changed.
- Empty/failed bridge: a crashed, timed-out, malformed, or empty bridge response must fail closed and must not become `ACE_NOT_USED`.
- Budget boundary: the returned projection must respect the Hermes-provided `budget_tokens` without silently truncating exact evidence; use compact evidence references plus lossless expansion handles.
- Durable history: request-only transformations must not rewrite the transcript or cause duplicate ACE context on resume.
- Provider identity: the bridge must bind source commit, runtime provenance, workspace identity, request ID, and ACE provider fingerprints to the transformation receipt.
- No-ACE baseline: the native arm must run without the ACE plugin/bridge and must not receive ACE context through a hidden fallback.
- Pinned runtime compatibility: verify that the selected Hermes version actually exposes the required `ContextEngine` contract before writing the plugin.

---

## Task 0: Freeze the Hermes request-transformation contract

**Files:**
- Create: `docs/docs/references/ADR-016-hermes-context-engine-integration.md`
- Create: `openspec/changes/008-hermes-context-integration/proposal.md`
- Create: `openspec/changes/008-hermes-context-integration/design.md`
- Create: `openspec/changes/008-hermes-context-integration/specs/hermes-context-integration/spec.md`
- Create: `openspec/changes/008-hermes-context-integration/tasks.md`
- Modify: `docs/docs/references/ADR-015-hermes-primary-feedback-agent.md` only if the owner approves an amendment to the MCP-only wording

**Interfaces:**
- `AceTransformRequest` and `AceTransformResult` names defined in the OpenSpec/design documents become the cross-language contract used by Tasks 1-4.
- The primary Hermes seam is `ContextEngine.select_context(request_messages, conversation_messages, incoming_message, budget_tokens) -> list[dict] | None`.
- The fallback seam, only for an older pinned runtime, is `pre_llm_call` returning `str | {"context": str} | None`.

- [ ] **Step 1: Write the failing contract scenarios**

Define scenarios for:

- ACE transforms the next request while durable history remains byte-stable.
- A provider/tool-call group is retained or omitted as a complete group.
- A bridge timeout or malformed response returns `UNKNOWN`/`BLOCKED` and never `ACE_NOT_USED`.
- A workspace mutation changes the transformation receipt and prevents stale evidence from being marked current.
- Native and ACE arms have identical task/runtime identity and differ only by enabled transformation.

- [ ] **Step 2: Verify the pinned Hermes API before implementation**

Run the pinned Hermes runtime inside the Harbor environment and verify:

```bash
hermes --version
python -c 'from agent.context_engine import ContextEngine; import inspect; print(inspect.signature(ContextEngine.select_context))'
```

If `select_context` is absent or incompatible with `v0.22.3`, stop and record whether to pin a newer Hermes version or use the `pre_llm_call` fallback. Do not silently implement against the host Hermes version.

- [ ] **Step 3: Record the accepted decision**

State explicitly that MCP is not the mandatory context-injection path. MCP remains optional for explicit `ace_expand`, diagnostics, and operator tools. Record the request-only transformation, transcript immutability, evidence identity, and quality-first benchmark rules.

- [ ] **Step 4: Validate the OpenSpec change**

Run the repository's pinned OpenSpec validation for the new change and keep the change active until the implementation and smoke evidence are complete.

- [ ] **Step 5: Commit**

```bash
git add docs/docs/references/ADR-016-hermes-context-engine-integration.md \
  openspec/changes/008-hermes-context-integration
git commit -m "docs: define Hermes request-time ACE context integration"
```

---

## Task 1: Extract a direct ACE context-transformation service

**Files:**
- Create: `src/domain/context-transform.ts`
- Create: `src/application/context-transform-service.ts`
- Modify: `src/gateway/mcp-gateway.ts` to reuse the same provider orchestration where practical
- Modify: `src/index.ts` to export the new types/service boundary
- Test: `test/context-transform.contracts.test.ts`

**Interfaces:**

```ts
export interface AceTransformRequest {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly query: string;
  readonly budgetTokens: number;
  readonly intent?: string;
  readonly workingContext?: {
    readonly focusedPath?: string;
    readonly openPaths?: readonly string[];
    readonly focusedRange?: { readonly startLine: number; readonly endLine: number };
  };
  readonly knownBundleId?: string;
  readonly knownEvidenceIds?: readonly string[];
  readonly sourceObligations?: {
    readonly required?: readonly ('code' | 'structural' | 'lsp' | 'documentation' | 'memory' | 'history')[];
    readonly optional?: readonly ('code' | 'structural' | 'lsp' | 'documentation' | 'memory' | 'history')[];
  };
}

export interface AceTransformResult {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly status: 'ready' | 'partial' | 'not_ready' | 'blocked';
  readonly contextText: string;
  readonly evidence: readonly Record<string, unknown>[];
  readonly selectedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly estimatedTokens: number;
  readonly sourceCommit?: string;
  readonly sourceManifestSha256?: string;
  readonly providerIdentities: Readonly<Record<string, string>>;
  readonly receiptId: string;
  readonly limitations: readonly string[];
}

export interface ContextTransformService {
  readonly transform: (request: AceTransformRequest) => Effect.Effect<Result<AceTransformResult, DomainError>>;
}
```

- [ ] **Step 1: Write failing domain/service tests**

Test that:

- a valid request produces a compact context projection with evidence IDs and a receipt ID;
- the request budget is enforced before delivery;
- current source/workspace digest is included in the result identity;
- required provider failure returns `not_ready`/`blocked` rather than an empty success;
- known bundle/evidence IDs produce delta delivery;
- secrets, invalid workspace IDs, invalid paths, and invalid budgets fail before provider calls.

- [ ] **Step 2: Implement the pure contract and provider orchestration**

Reuse the existing source routing, Qdrant/ast-grep/LSP verification, delivery projection, receipt/delta logic, and exact artifact handles. Do not duplicate retrieval policy inside the Hermes plugin. The service must return a model-ready text projection plus machine-readable receipt metadata; exact expansion remains an ACE service operation, not a mandatory Hermes tool call.

- [ ] **Step 3: Add group-safe message projection helpers**

Keep the ACE service independent of Hermes message types. Return context as a bounded, source-attributed block containing compact evidence references and exact expansion handles. Do not return arbitrary provider message fragments from ACE; Hermes owns provider-specific message integrity.

- [ ] **Step 4: Run focused tests**

```bash
node_modules/.bin/tsx --test test/context-transform.contracts.test.ts
npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/domain/context-transform.ts src/application/context-transform-service.ts \
  src/gateway/mcp-gateway.ts src/index.ts test/context-transform.contracts.test.ts
git commit -m "feat: add direct ACE context transformation service"
```

---

## Task 2: Add a non-MCP local JSONL bridge for the Hermes plugin

**Files:**
- Create: `src/bin/ace-context-bridge.ts`
- Create: `src/transport/context-bridge-stdio.ts`
- Create: `test/context-bridge.contracts.test.ts`
- Modify: `package.json` to add `context:stdio` or equivalent build/runtime entrypoint
- Modify: `scripts/generate-runtime-provenance.mjs` if the new executable must be included in provenance

**Interfaces:**

```text
stdin:  one JSON object per line containing AceTransformRequest
stdout: one JSON object per line containing AceTransformResult or a typed error
stderr: diagnostics only; never source payloads or credentials
```

The bridge must support a request ID, one response per request, bounded line size, cancellation/EOF cleanup, and a typed `not_ready` response when providers are unavailable.

- [ ] **Step 1: Write failing bridge protocol tests**

Test:

- valid request/response round-trip;
- malformed JSON returns a typed error without killing the bridge;
- unknown request ID or duplicate response is rejected by the test harness;
- bridge timeout and provider failure are represented as `blocked`/`not_ready`;
- source content and auth-like values do not appear in stderr or receipt output;
- two sequential requests preserve request identity and do not leak prior context.

- [ ] **Step 2: Extract shared runtime construction**

Refactor only the runtime construction needed by `ace-mcp.ts` and `ace-context-bridge.ts` into a shared application factory. Keep the MCP transport and direct bridge transport separate. Do not make the bridge call MCP or duplicate Qdrant/embedding/LSP setup.

- [ ] **Step 3: Implement the JSONL bridge**

Bind the bridge to explicit environment variables for workspace root, state/artifact directories, provider configuration, and workspace ID. Use the existing compiled-runtime provenance check. Return sanitized receipt metadata and context text; write provider traces through the existing trace sink.

- [ ] **Step 4: Run bridge tests and runtime checks**

```bash
node_modules/.bin/tsx --test test/context-bridge.contracts.test.ts
npm run check
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/bin/ace-context-bridge.ts src/transport/context-bridge-stdio.ts \
  test/context-bridge.contracts.test.ts package.json scripts/generate-runtime-provenance.mjs
 git commit -m "feat: expose direct ACE context bridge for Hermes"
```

---

## Task 3: Implement the Hermes `ContextEngine` plugin

**Files:**
- Create: `integrations/hermes/ace_context_engine/plugin.yaml`
- Create: `integrations/hermes/ace_context_engine/__init__.py`
- Create: `integrations/hermes/ace_context_engine/engine.py`
- Create: `integrations/hermes/ace_context_engine/bridge.py`
- Create: `integrations/hermes/ace_context_engine/receipt.py`
- Test: `integrations/hermes/ace_context_engine/test_engine.py`
- Test: `integrations/hermes/ace_context_engine/test_bridge.py`

**Interfaces:**

```python
class AceContextEngine(ContextEngine):
    @property
    def name(self) -> str: ...

    def select_context(
        self,
        request_messages: list[dict[str, Any]],
        *,
        conversation_messages: list[dict[str, Any]] | None = None,
        incoming_message: dict[str, Any] | None = None,
        budget_tokens: int = 0,
    ) -> list[dict[str, Any]] | None: ...
```

`AceContextEngine` consumes a `BridgeClient` and returns a request-only message projection. It must not mutate `conversation_messages` or the original `request_messages` list in place.

- [ ] **Step 1: Write failing plugin tests**

Test:

- current user message is used as the ACE query;
- ACE context is added to the request projection while durable history is unchanged;
- whole tool-call/result groups are retained or dropped together;
- assistant reasoning/signature fields are preserved when their group is retained;
- the selected projection stays within `budget_tokens`;
- bridge `not_ready`, timeout, malformed response, and empty response fail closed according to the configured policy;
- retries for the same request reuse the same receipt and projection;
- no MCP tool is registered or required by the plugin;
- the plugin can operate with an explicit no-op mode for the native baseline.

- [ ] **Step 2: Implement the bridge client**

Start one long-lived `ace-context-bridge` subprocess per Hermes agent/plugin instance. Use JSONL request IDs, bounded writes/reads, deadline cancellation, stderr redaction, and deterministic shutdown. Do not start one subprocess per provider retry.

- [ ] **Step 3: Implement group-safe projection**

Partition the assembled request into logical groups using Hermes message IDs and role/tool-call relationships. Never split a tool call from its result or delete provider-required reasoning/signature carriers. Preserve the current user message and prepend/append the ACE projection in a clearly delimited request-only block.

- [ ] **Step 4: Implement receipts**

Write one sanitized per-request receipt containing request ID, session/turn IDs, selected/omitted evidence IDs, estimated tokens, bridge/runtime identity, and status. Do not write context bodies or credentials to the receipt.

- [ ] **Step 5: Run Python plugin tests against the installed Hermes base classes**

```bash
HERMES_PYTHON=/path/to/pinned/hermes/python
PYTHONPATH="$PWD/integrations/hermes" "$HERMES_PYTHON" -m pytest integrations/hermes/ace_context_engine -q
```

- [ ] **Step 6: Commit**

```bash
git add integrations/hermes/ace_context_engine
 git commit -m "feat: add Hermes ACE ContextEngine plugin"
```

---

## Task 4: Wire the plugin into Harbor without MCP context injection

**Files:**
- Modify: `scripts/harbor_hermes_codex_oauth.py`
- Modify: `scripts/prepare-harbor-feedback-jobs.ts`
- Modify: `src/domain/feedback-harbor-config.ts`
- Modify: `scripts/harbor-ace-mcp.sh` only for diagnostics/`ace_expand`, not mandatory context retrieval
- Create: `scripts/harbor-hermes-context-plugin.sh` or equivalent pinned plugin bootstrap
- Test: `test/feedback-loop-experiment.contracts.test.ts`
- Test: `test/feedback-preflight.contracts.test.ts`

**Interfaces:**

- Native job: Hermes without ACE plugin or ACE bridge.
- ACE job: Hermes with the pinned `AceContextEngine` plugin, direct bridge command, ACE runtime mount, and explicit `context.engine: ace_context_engine` configuration.
- Both jobs: same Hermes version, provider/model, reasoning, task image, source revision, timeout, task list, attempts, and concurrency.

- [ ] **Step 1: Write failing generated-job tests**

Assert that:

- ACE-optional job has no mandatory `mcp_servers` entry for context retrieval;
- ACE-optional job pins plugin source/digest, bridge executable/digest, ACE runtime/source commit, and plugin configuration;
- native job contains none of those ACE injection components;
- job identity validation rejects plugin/version/bridge/model/source/image drift;
- `ace_expand` MCP is optional diagnostics only and cannot be counted as the context injection mechanism.

- [ ] **Step 2: Stage the plugin and bridge into the task container**

Use a read-only `/ace` mount plus a pinned plugin/bridge location. Remove live `pip install` from the context path. If the task image cannot provide the pinned Hermes plugin runtime, block job preparation rather than installing mutable dependencies during the trial.

- [ ] **Step 3: Extend the custom Hermes adapter**

Generate Hermes config with the plugin enabled and `context.engine` set to the pinned engine name. Pass the bridge environment explicitly. Keep the existing Hermes auth staging/sync separate from context transformation.

- [ ] **Step 4: Fix the workspace boundary**

Choose one canonical task workspace path and bind it consistently across the task image, plugin environment, bridge, and ACE runtime. Do not leave `/app` and `/workspace` as implicit alternatives.

- [ ] **Step 5: Run generation and validation tests**

```bash
npm run check
node_modules/.bin/tsx --test test/feedback-loop-experiment.contracts.test.ts test/feedback-preflight.contracts.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add scripts/harbor_hermes_codex_oauth.py scripts/prepare-harbor-feedback-jobs.ts \
  src/domain/feedback-harbor-config.ts scripts/harbor-hermes-context-plugin.sh \
  test/feedback-loop-experiment.contracts.test.ts test/feedback-preflight.contracts.test.ts
 git commit -m "feat: run ACE through Hermes ContextEngine in Harbor"
```

---

## Task 5: Bind telemetry and evidence to request-time transformation

**Files:**
- Modify: `scripts/collect-feedback-loop.ts`
- Modify: `src/adapters/harbor-four-arm-trial-evidence.ts`
- Modify: `src/domain/feedback-loop-experiment.ts`
- Create: `src/domain/hermes-context-evidence.ts`
- Test: `test/hermes-context-evidence.contracts.test.ts`
- Test: `test/harbor-four-arm-trial-evidence-adapter.contracts.test.ts`

**Interfaces:**

```ts
export interface HermesContextEvidence {
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly bridgeStatus: 'ready' | 'partial' | 'not_ready' | 'blocked';
  readonly receiptId: string;
  readonly selectedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly sourceCommit?: string;
  readonly sourceManifestSha256?: string;
  readonly bridgeDigest: string;
  readonly pluginDigest: string;
  readonly estimatedContextTokens?: number;
}
```

- [ ] **Step 1: Write failing evidence tests**

Test that:

- raw trial results are bound to generated native/ACE job manifests;
- actual Hermes runtime/plugin/bridge identity matches the experiment manifest;
- a missing, empty, or failed context receipt is `UNKNOWN`/`BLOCKED`, never `ACE_NOT_USED`;
- `ACE_NOT_USED` requires proven zero transformation attempts, not missing session export;
- token/cost claims remain `UNKNOWN` when required Hermes usage fields are absent;
- request receipts correlate with ACE provider traces and task/source digests.

- [ ] **Step 2: Parse Hermes session and plugin receipts separately**

Keep session parsing for tool/turn observations, but use plugin receipts as the source of truth for request-time context transformation. Do not infer transformation from MCP tool calls.

- [ ] **Step 3: Bind collector inputs**

Require `job-manifest.json`, generated job digests, experiment manifest, raw trial artifacts, plugin receipts, ACE bridge receipts, and provider trace IDs. Reject a result that cannot prove which job/runtime produced it.

- [ ] **Step 4: Update status rules**

A paired result can be `PASS` only when task quality passes, required transformations are correlated, usage fields required by the report are present, and source/runtime identity matches. Missing telemetry stays `UNKNOWN`.

- [ ] **Step 5: Run evidence tests**

```bash
node_modules/.bin/tsx --test \
  test/hermes-context-evidence.contracts.test.ts \
  test/harbor-four-arm-trial-evidence-adapter.contracts.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add scripts/collect-feedback-loop.ts src/adapters/harbor-four-arm-trial-evidence.ts \
  src/domain/feedback-loop-experiment.ts src/domain/hermes-context-evidence.ts \
  test/hermes-context-evidence.contracts.test.ts \
  test/harbor-four-arm-trial-evidence-adapter.contracts.test.ts
 git commit -m "feat: bind Hermes context transformation evidence"
```

---

## Task 6: Make exact preflight reflect the new path

**Files:**
- Modify: `scripts/feedback-loop-preflight.ts`
- Modify: `scripts/fastembed-sparse-worker.sh` only if the relative-path/library behavior remains required
- Modify: `src/domain/feedback-preflight.ts`
- Modify: `scripts/harbor_hermes_codex_oauth.py`
- Test: `test/feedback-preflight.contracts.test.ts`
- Test: `test/feedback-loop-preflight.integration.test.ts`

**Interfaces:**

The exact preflight must verify:

- current Hermes auth schema and atomic sync contract;
- pinned Hermes runtime exposes `ContextEngine.select_context`;
- plugin/bridge import and digest;
- direct bridge startup and one request/response without a model call;
- sparse/dense workers using the exact environment map used in the container;
- canonical workspace path;
- Qdrant endpoint from inside the task container, not only host localhost;
- generated job/plugin/bridge/source/image identities.

- [ ] **Step 1: Add a redacted real Hermes auth fixture**

Model the current `credential_pool.openai-codex` shape without token values. Test both valid current shape and intentionally unsupported legacy shape. The adapter must not print or persist credential bytes.

- [ ] **Step 2: Reproduce preflight with the exact container environment**

Use the same working directory, absolute/relative executable paths, `LD_LIBRARY_PATH`, cache paths, and environment allowlist as the generated Harbor command. Add a regression test for the current relative sparse-worker failure.

- [ ] **Step 3: Add direct bridge probe**

Preflight one direct transformation request against a disposable workspace/fixture. This proves the path without billable model execution.

- [ ] **Step 4: Run exact preflight**

```bash
npm run check
npm run lint -- --no-cache
npm run build
node_modules/.bin/tsx --test test/feedback-preflight.contracts.test.ts test/feedback-loop-preflight.integration.test.ts
node_modules/.bin/tsx scripts/feedback-loop-preflight.ts \
  --output <external-preflight-dir> \
  --native-job <generated-native-job> \
  --ace-job <generated-ace-job> \
  --experiment-manifest <generated-experiment-manifest>
```

Expected: no required check is `not_ready` or `unknown` before smoke authorization.

- [ ] **Step 5: Commit**

```bash
git add scripts/feedback-loop-preflight.ts scripts/fastembed-sparse-worker.sh \
  src/domain/feedback-preflight.ts scripts/harbor_hermes_codex_oauth.py \
  test/feedback-preflight.contracts.test.ts test/feedback-loop-preflight.integration.test.ts
 git commit -m "fix: make Hermes context-engine preflight exact"
```

---

## Task 7: Retire the MCP-only path from the primary feedback loop

**Files:**
- Modify: `docs/docs/references/ADR-015-hermes-primary-feedback-agent.md`
- Modify: `docs/plans/ace-real-feedback-loop.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `openspec/config.yaml`
- Modify: `scripts/harbor-retrieval-gate.ts` and `scripts/render-harbor-paired-report.ts` only to label Codex paths explicitly as comparison/historical
- Test: `test/architecture-regressions.test.ts`

- [ ] **Step 1: Mark old Codex paths clearly**

Keep Codex adapters/jobs for comparison compatibility, but label them historical/comparison-only. Do not let legacy `gate:harbor` or report commands appear to be the current Hermes primary feedback path.

- [ ] **Step 2: Document the Hermes path**

Document:

- `ContextEngine.select_context` as the primary ACE integration;
- direct bridge and plugin identity;
- native vs ACE-enabled arms;
- request-only transformation and transcript immutability;
- MCP as optional diagnostics/expansion only;
- preflight/smoke/evidence gates.

- [ ] **Step 3: Add stale-contract regression checks**

Fail if the current primary Hermes job generator adds ACE only as `mcp_servers` or if the primary feedback plan still describes MCP as the context-injection mechanism.

- [ ] **Step 4: Commit**

```bash
git add docs/docs/references/ADR-015-hermes-primary-feedback-agent.md \
  docs/plans/ace-real-feedback-loop.md README.md docs/README.md openspec/config.yaml \
  scripts/harbor-retrieval-gate.ts scripts/render-harbor-paired-report.ts \
  test/architecture-regressions.test.ts
 git commit -m "docs: make Hermes ContextEngine the primary ACE integration"
```

---

## Task 8: Run the fresh one-task Hermes smoke

**Files:**
- External generated artifacts only: frozen task manifest, job manifest, experiment manifest, raw trial directories, plugin receipts, bridge receipts, provider traces, metrics report
- Do not commit private source, auth files, or raw private session payloads

- [ ] **Step 1: Prepare a clean source/runtime checkout**

Use a clean worktree with the exact ACE commit, compiled runtime provenance, pinned Hermes runtime, pinned task image digest, plugin digest, bridge digest, and task/source manifests.

- [ ] **Step 2: Run native Hermes arm**

Run one task, one attempt, serially, with no ACE plugin/bridge. Retain raw result, verifier outcome, Hermes session evidence, usage, runtime identity, and artifact hashes.

- [ ] **Step 3: Run Hermes + ACE ContextEngine arm**

Run the same task and identity with the plugin enabled. Verify at least one successful request-time ACE transformation, correlated receipt, current source digest, budgeted projection, and no transcript mutation.

- [ ] **Step 4: Reconcile without forced ACE calls**

Run the collector. If Hermes never requests a transformed context, report `ACE_NOT_USED`; if the plugin/bridge fails or evidence is missing, report `UNKNOWN`/`BLOCKED`.

- [ ] **Step 5: Review raw artifacts**

Verify the report against raw per-trial artifacts, not aggregate Harbor counters. Do not claim quality or token savings from one smoke; use it only to close the new-agent E2E gate and expose integration failures.

- [ ] **Step 6: Commit only sanitized evidence metadata**

```bash
git add docs/reviews/<new-hermes-smoke-review>.md
 git commit -m "docs: record Hermes ACE context-engine smoke evidence"
```

---

## Task 9: Main/repeat/holdout benchmark gate

- [ ] Freeze the source/task/plugin/bridge/runtime/image identities for the selected 10-task main and 10-task holdout sets.
- [ ] Run matched native Hermes and Hermes+ACE ContextEngine arms with one attempt and serial execution.
- [ ] Preserve raw per-trial sessions, verifier outputs, usage, context receipts, provider traces, and failures.
- [ ] Require task-quality non-regression before interpreting context/token economics.
- [ ] Keep unknown usage, unknown costs, missing transformation receipts, and ACE-not-used trials explicit.
- [ ] Publish duplicate context avoided, selected/omitted evidence, latency, tool calls, and total token/cost metrics separately.
- [ ] Do not mark production-approved or claim 5× until the independent release gates and owner approval pass for the exact commit.

---

## Verification checklist

Before calling the migration complete:

```bash
npm run check
npm run lint -- --no-cache
npm run build
npm run test:fast
# exact preflight with generated pinned jobs/manifests
# fresh one-task native vs Hermes+ACE smoke
# main/repeat/holdout reconciliation when authorized
```

Acceptance requires all of the following:

- ACE context is transformed at Hermes request time through `ContextEngine.select_context` or a documented pinned-runtime fallback, not through a mandatory MCP tool call.
- Durable Hermes history is unchanged by request-time selection.
- Direct bridge/runtime/plugin identities are pinned and correlated.
- Current source/workspace verification and evidence receipts survive the transformation.
- Tool-call/result and provider-specific reasoning groups remain valid.
- A failed or missing transformation never becomes a successful no-use result.
- Native and ACE-enabled arms differ only by the approved request-time integration.
- A fresh Hermes smoke exists; historical Codex evidence is not reused as Hermes proof.
