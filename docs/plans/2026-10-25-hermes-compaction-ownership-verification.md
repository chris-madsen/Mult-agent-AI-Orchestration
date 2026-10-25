# Hermes compaction ownership gate for ACE × Bifrost

**Date:** 2026-10-25  
**Status:** PROPOSED implementation and verification plan; NOT implemented, wire-certified, real-agent-tested or production-approved.  
**Role:** This is a mandatory focused execution gate of the [canonical Bifrost Gateway plan](2026-10-24-bifrost-unified-llm-gateway-plan.md), not a competing gateway plan or a change to accepted ADR-017. Move approved normative contracts into OpenSpec before coding.  
**Sources examined:** ACE main; Hermes v0.22.3 (pinned tag); candidate Bifrost source as linked by ADR-017. Re-pin exact SHAs, image digests and configuration before any runtime trial.

## 1. Why this matters

Hermes can compress, prune or summarize **its own transcript before the model request reaches Bifrost**. ACE cannot reverse a loss of historical information that happened upstream merely by rewriting JSON at the gateway. If Hermes compacts while ACE also compacts, a successful ACE receipt does not prove ACE controlled the context, and apparent savings/quality cannot be attributed to ACE alone.

Distinguish three authorities:
- **Transcript authority:** Hermes stores original turns and tool results; ordinary new rows may append. In strict ACE trials it must NOT autonomously rewrite or retire earlier active rows. Source-preserving archive/retention is an independent future decision.
- **Projection authority:** ACE owns retrieval, selection, deduplication, relevance, budgets and provider-request-local shrinking; ACE does not write Hermes history.
- **Delivery authority:** Bifrost receives the agent's provider-native request and transmits an ACE-approved projection to each allowed provider attempt. Bifrost controls routing/TLS/retries, not historical truth.

**One-owner invariant:** For any strict ACE provider request, exactly one authoritative context projector is active: native Hermes ACE **or** Bifrost ACE. Compaction of the agent transcript must be demonstrably disabled or explicitly attributed and authorized. Never run both native and gateway ACE blindly; MCP is a tool plane, not a second hidden context projector.

**Non-obvious limit:** Bifrost can prove the inbound request and final upstream bytes, but cannot know whether Hermes already compacted its local session. Strict claims therefore need an authenticated host-side effective configuration and transcript-state attestor, not just a gateway plugin log or claimed HTTP header.

## 2. Static audit: actual Hermes v0.22.3 surfaces

| Source | Observed behavior | Consequence |
|---|---|---|
| agent/agent_init.py, _select_context_engine | context.engine selects a plugin; plugin lookup/clone failure may silently substitute built-in ContextCompressor | Verify **actual effective engine** at startup, child spawn, resume and model switch. Fail closed if fallback/drift. |
| ACE integrations/hermes/ace_context_engine/engine.py | should_compress returns False and compress returns original messages | Good defense when ACE plugin actually loaded; not proof that other compaction entrypoints never ran. |
| agent/turn_context_compaction.py | Idle/preflight and engine-preflight maintenance may run before API | Test all paths, including engine requested preflight maintenance and low artificial context thresholds. |
| agent/turn_preflight.py | Pre-API, post-tool compression and proactive pruning can alter working history | Set compression.enabled=false; test at long-context boundaries and after large tool results. |
| agent/agent_init.py | Parses compression.micro_compact, proactive_prune_tokens, idle_compact_after_seconds, codex_responses_native, codex_app_server_auto independently | Explicitly disable every relevant switch and verify parsed values in live process. |
| agent/native_compaction.py | Provider-side Responses context_management with compaction threshold; compression.enabled=false is a gate | Reject active native/server-side compaction and hidden continuation in strict G3. |
| agent/conversation_compression_codex.py | Codex app-server may own a separate compaction lifecycle | Set codex_app_server_auto=off; certify only requests with fully visible history. |
| agent/context_engine.py | compress(force, focus_topic) supports manual compaction; select_context is request-only | Manual /compress must be denied or provably no-op. No assumed exemption from compression.enabled=false. |
| agent/conversation_loop.py | select_context exceptions return original messages (fail-open by default) | Native ACE trials require actual provider-bound receipt and deny/bypass proof; startup configuration alone is insufficient. |

Source pointers:
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/agent_init.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/turn_context_compaction.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/turn_preflight.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/native_compaction.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/conversation_compression_codex.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/context_engine.py
- https://github.com/NousResearch/hermes-agent/blob/v0.22.3/agent/conversation_loop.py
- https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/main/integrations/hermes/ace_context_engine/engine.py

This is a source audit, not a claim that the configuration has been exercised end-to-end. Re-audit when Hermes is upgraded.

## 3. Trial arms (never silently combine them)

| Arm | Host compaction and context engine | Gateway ACE | Purpose |
|---|---|---|---|
| H0: Hermes direct | Stock Hermes behavior, effective config observed | No Bifrost | Original agent baseline; not ACE-controlled |
| H1: inert Hermes + Bifrost | Host compaction disabled and attested; built-in compressor present but inactive | Disabled | Measure gateway-only overhead |
| **H2: ACE Gateway** | As H1, no native ACE engine | **Enabled: exclusive ACE projection** | Primary universal adapter acceptance arm |
| **H3: native Hermes ACE** | Host compaction disabled and attested; active AceContextEngine identity | Disabled (Bifrost can observe/route) | Independent comparison against H2 |
| H4: Hermes compaction baseline | Stock compaction enabled and measured | Disabled | Quantify original Hermes savings/recall |
| H5: forced interference | Host compression deliberately triggered | Enabled, test only | Negative control: show loss of exclusive ACE attribution |

Pin identical agent source/task/workspace revision/model/provider/reasoning/tools/temperature where meaningful. Distinguish provider cost, host summarization calls, ACE retrieval and Bifrost retry costs; benchmark only accepted task solutions.

### Candidate strict Hermes configuration, subject to verification

~~~yaml
# H2: use Hermes only to maintain durable session and tools.
context:
  engine: compressor
compression:
  enabled: false
  micro_compact: false
  proactive_prune_tokens: 0
  idle_compact_after_seconds: 0
  codex_responses_native: false
  codex_app_server_auto: off
~~~

For H3 change context.engine to ace_context_engine and assert the effective class/name and initialized session binding. Retain the kill switches. Never claim this YAML itself proves safety: manual commands, plugin fallback, process reconfiguration, subagents, provider-held state and live tool-result handling must be tested. If config field semantics differ in later Hermes releases, fail pin validation.

H2 and H3 must explicitly reject hidden provider-held conversation/compaction, including previous_response_id or provider thread where the full prior state is not reconstructible. Raw passthrough does not by itself prove state visibility.

## 4. Proposed unified API extensions (to specify in OpenSpec)

The gateway plan already proposes a versioned ACE Projection API with /internal/ace-gateway/v1/project and delivery receipts. Add the following **trusted host ownership state**; do not accept these from ordinary prompt text or unsigned client headers.

**Host attestation:** hostBuildDigest; sessionId and parent/subagent identity; actual activeEngineId; normalized effectiveCompressionControlsDigest; durableActiveTranscriptRevision/rolling row digest; hostCompactionEpoch (unknown is not zero); timestamp/nonce; attestor identity bound to authenticated tenant/workspace; providerManagedHistoryCapability; no credentials or raw private prompt in logs.

**Projection admission:** requestId/attemptGroupId; projectionMode = gateway/native/assist/observe/off; desired and attested owner; hostTranscriptAttested flag; exact original request SHA-256, protocol, route, provider/model and data class; deadline. Conflicting owners or stale/untrusted attestation produce typed BLOCK.

**ACE result:** decision APPLY / UNCHANGED_AUTHORIZED / DEGRADED_AUTHORIZED / BLOCK; original/projected payload digests, projectionId, receiptId, protected fields/tool graph validator result, actual selected source revisions. Unexpected missing ACE is not UNCHANGED_AUTHORIZED.

**Attempt egress evidence:** attemptId and group, effective provider/model/route, projection digest, actual final wire digest, bound policy/identity, retry/fallback lineage; BLOCK if no verifiable application, unexpected changed context, destination leak or attempt without guard.

**Host compaction event ledger:** eventId, phase (idle, preflight, pre-api, post-tool, manual, micro, provider-native, forced, unknown), attempted/committed/aborted, before/after active-row revision and source archive reference. Record summaries only by digest and lengths, never raw sensitive content. Event absence alone is not proof if the detector could be bypassed.

**Proposed errors:** HOST_CONTEXT_UNATTESTED, HOST_COMPACTION_ACTIVE, HOST_CONTEXT_REVISION_CHANGED, DUAL_PROJECTION_OWNER, ENGINE_FALLBACK, PROVIDER_MANAGED_STATE_UNKNOWN, PROJECTION_MISSING, OUTBOUND_DIGEST_MISMATCH, MANUAL_COMPACTION_FORBIDDEN. Strict deny must mean zero provider network calls, not merely a logged warning.

Durable transcript checks must allow new assistant/tool turns to append normally; compare **old active rows at corresponding pre-existing IDs and their bytes/digests**, not an unchanged whole-database SHA (which would fail every normal turn). ACE projection remains request-local and does not mutate tool resources or the worktree.

## 5. Conformance and negative tests

Use (a) an instrumented Hermes host/session DB, (b) ACE receipts, and (c) a mock upstream provider recording **actual received HTTP bytes**. Only this combination can prove host state + context projection + egress. Pure mocks alone cannot prove real provider/agent behavior.

| ID | Input/fault injection | Required observable outcome |
|---|---|---|
| HC-01 | Start, restart, resume, model change and subagent spawn in H2/H3 | Exact actual engine and config recognized; fallback or identity drift blocks |
| HC-02 | Force tiny test context limit and very long tool results; trigger idle/turn-start/pre-API/post-tool | Zero *committed* host compaction or prune in H2/H3; old transcript rows preserved |
| HC-03 | Invoke manual /compress and direct force=True compressor call | Denied or provable no-op without mutation/rotation; no silent summarizer call |
| HC-04 | Enable micro_compact mid-session or simulate unavailable/uncopyable ACE plugin | Not certified; strict admission blocks; no fallback to built-in compressor without alarm |
| HC-05 | Set Responses context_management=compaction / opaque provider thread / Codex native mode | No false full-history claim; strict unsupported/blocked, lower capability explicit |
| HC-06 | Retry same request, switch fallback model/provider and simulate malformed projection | No double injection; one logical ACE decision, every effective provider attempt revalidated |
| HC-07 | Snapshot active persisted row IDs/digests, allow tool and assistant responses, restart | Previously active rows unchanged; legitimate new rows append; no unexpected compression epoch |
| HC-08 | Kill ACE, timeout, bad response, missing attestation, forged session header, direct provider bypass | Exactly zero unauthorized upstream sends, typed BLOCK with correlation |
| HC-09 | Tool call/result pairs, parallel tool IDs, reasoning/signatures, images, cache metadata | All protected protocol relations valid at **actual provider wire** |
| HC-10 | Place needed fact in early history; ACE retrieves it after large sequence of turns | Selected exact source present in upstream payload; independent recall/task score |
| HC-11 | Deliberately enable host compression in H5 while ACE gateway is active | Classified as interference/invalid ACE-only evidence, never counted as H2 success |
| HC-12 | Buffered/streaming responses, chunked/oversized requests, cancellation | No missing ingress body silently classified as full-context; ordered streaming and per-attempt evidence |
| HC-13 | Attempt cross-workspace session replay, stale digest, forged host compaction attestation | Trust-bound attestor validation fails closed |
| HC-14 | Matched H1, H2, H3, H4 real agent tasks/Harbor | Report task pass, token input/output/cache, host summary calls, ACE calls, embeddings, retries, total cost and latency separately |

**Strict exclusive-owner gate:** HC-01–09 and HC-13 must pass before any H2/H3 “ACE controls context” claim. HC-10/12/14 plus real agent/provider E2E needed for benchmark/production claims. Report STATIC-REVIEWED, MOCK-PASS, REAL-E2E-PASS, FAIL, BLOCKED or NOT_RUN per pinned runtime; never promote mock-only to real.

**Special attention:** H2 is *not* certified by a matching ingress/egress digest alone. Its host attestor must prove no earlier transcript rewrite, and no other engine must inject the same evidence. No claim of “fivefold savings” until quality-gated paired real task measurement.

## 6. Implementation queue, dependency order and estimated effort

All unchecked work is future implementation. Use current ACE test owners/fixtures where possible, not another duplicate suite.

| Stage | PR-sized deliverable | Predecessor | Exit evidence | Estimate |
|---|---|---|---|---|
| HC0 | Hermes v0.22.3 full compaction call-site map + effective config/engine inventory; Bifrost hook coverage | Gateway G0 source/wire spike can proceed in parallel | Runtime and static evidence map, all bypass candidates identified | 1–2 engineering days |
| HC1 | OpenSpec contracts and JSON fixtures for host attestation, owner arbitration, ledger, strict failure | HC0 | Schema + positive/negative contract approval | 2–3 days |
| HC2 | Minimal Hermes launcher/attestor, manual-compaction guard, child/resume guard | HC1 | HC-01/03/04/13 deterministic tests | 2–4 days |
| HC3 | Force threshold/idle/post-tool/native cases; session DB old-row vs append invariants | HC2 | HC-02/05/07 mock tests | 2–4 days |
| HC4 | Bind host state to ACE project response + Bifrost per-attempt final-send evidence; enforce no bypass | HC1–3 and gateway G2–G5 | HC-06/08/09 mock upstream wire tests | 2–4 days |
| HC5 | Run H1–H5 controlled real Hermes/provider fixtures and longer retrieval-heavy Harbor tasks | HC4 plus provider/runner availability | HC-10/11/12/14, honest quality/token/cost report | 2–5 days + infrastructure |

**Gate ordering:** HC0/HC1 precede strict runtime integration; HC2/HC3 block any exclusive-owner assertion; HC4 blocks egress certification; HC5 blocks benchmark attribution. The base Gateway G0–G8 plan remains canonical. Each slice uses a reviewable PR to main with exact source/runtime pins and rerunnable evidence.

## 7. Decision and non-goals

**Recommended first certified arrangement:** Hermes stores append-only conversation, tools and user interactions; **ACE alone** compiles context for each model request; Bifrost delivers, verifies and routes it. Test this as H2. Keep H3 native ACE as a separate arm. Compare against stock Hermes compaction H4, with H5 deliberately breaking isolation to identify misleading attributions.

Do NOT claim that turning off Hermes compression solves infinite transcript growth or storage cost. Durable archiving/replay is a future policy decision, and must preserve source traceability. Do NOT build a new TypeScript proxy or move ACE logic to Go because of this issue. Do NOT conflate ACE's safe request-local shrinking with destructive Hermes history compaction. No tests have yet run as part of this documentation change.
