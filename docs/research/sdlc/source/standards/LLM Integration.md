# LLM Integration — operational and security rules for agentic infrastructure

## Scope
Any LLM gateway, model provider, RAG component, MCP tool, agent context projection, evaluation or memory integration. This is an operational standard, not model-training theory.

## 1. Provider fidelity
1. Record exact provider, model, reasoning mode, endpoint and runtime version.
2. Validate request/response schemas at adapter boundaries.
3. Do not assume tool-calling, streaming, caching and usage semantics are interchangeable across providers.
4. Retain original provider error taxonomy where necessary, then map to stable typed application failures.
5. Make provider capability probing explicit; no silent production selection.
6. Preserve request/response correlation and the correct source/version identity.
7. Test streaming, cancellation and partial failures where supported.
8. Never claim a gateway mock-wire PASS proves final provider egress.

## 2. Reliability patterns
9. Bound retries per call *and per workflow*; use backoff with jitter for transient failures.
10. Do not retry policy denial, invalid prompt/tool schema or known permanent error.
11. Respect Retry-After, quota and rate limits.
12. Circuit-break unhealthy dependencies with explicit recovery probes where necessary.
13. Use backpressure/concurrency limits and bounded queues; avoid runaway agent loops.
14. Distinguish model inference retry from side-effecting tool replay.
15. Use idempotency keys or durable receipts for external mutations when retries possible.
16. Define timeout and cancellation propagation from user request through provider call.
17. Classify graceful degradation as partial/unavailable with provenance and quality impact.
18. Fail closed for privacy, authorization and secret leakage; NEVER reroute to an unapproved provider.
19. Persist safe checkpoints for long tasks; resume from confirmed durable state.
20. Design bulkheads for expensive tools, providers and tenants where applicable.

## 3. Security and policy
21. Treat code snippets, retrieved docs, MCP results and prior conversations as untrusted data.
22. Prevent retrieved instruction text from overriding system/project/owner rules.
23. Validate tool name, arguments, path and user identity at action boundary.
24. Enforce permission at time of data transfer, not just at prompt construction.
25. Apply source/data-class policy separately for local code, authorized docs and memory.
26. Do not leak API tokens, credentials, PII or proprietary code in traces/artifacts.
27. Use least privilege provider keys and scoped service account permissions.
28. Restrict unsafe shell/filesystem/network tool actions and provide explicit denied status.
29. Audit external side effects and human approvals where required.
30. Test prompt injection and tool-output spoofing with negative fixtures.

## 4. Retrieval and context
31. Record selected source path/digest/range and retrieval mechanism.
32. Verify source freshness against worktree before authoritative citation.
33. Dense/sparse retrieval candidate does not equal validated semantic symbol reference.
34. LSP semantic claims need actual language-server evidence.
35. Budget context by task and quality without silent truncation of required originals.
36. Preserve source expansion when authorization permits.
37. Distinguish required sources not searched from searched empty and provider outage.
38. Never call token savings achieved from a trivial forced-use case.
39. Keep agent transcript ownership separate from external context engine.
40. Validate correctness of provider-bound projection, not just MCP tool success.

## 5. Cost, telemetry and evaluation
41. Track request/correlation ID and per-provider latency.
42. Count input, output and cached tokens separately without double counting.
43. Include embedding/reranking, indexing and external infrastructure costs.
44. Unknown measurements remain UNKNOWN, never zero.
45. Compare accepted task quality first, then cost, latency and failures.
46. Use matched model/provider/reasoning identity for A/B claims.
47. Keep immutable holdouts separate from development fixtures.
48. Preserve raw trials and source-linked evidence.
49. Evaluate retrieval quality independently from final agent task quality.
50. Apply quality gates to model-router changes; cheaper model isn't a win if task success regresses.

## 6. Testing
51. Contract tests validate DTO schemas and typed error mapping.
52. SDK conformance tests exercise a real client and known provider.
53. Agent E2E proves context actually reached the chosen model/provider path.
54. Failure injection covers timeout, quota, restart, partial response and cancellation.
55. Idempotency/replay tests cover side-effect duplication and crash windows.
56. Security tests cover unauthorized cloud egress and prompt injection.
57. Benchmark claims require paired task results and trusted usage telemetry.
58. Mock-only coverage is labeled as such.
59. CI runs deterministic checks cheaply; expensive provider suites are capability-scoped.
60. Exact SHA, runtime identities and retained artifacts bind every acceptance report.

## ACE-specific checks
- ACE core remains TypeScript + Effect.
- MCP is explicit tool plane; Bifrost projection distinct.
- Hermes request-time context flow is a separate existing entry point.
- Qdrant returns local code candidates, not ground truth.
- Vertex is authorized documentation, not implicit private-code egress.
- Graphiti derived facts cannot silently supersede immutable original dialogue archive.
- Harbor benchmarks must preserve a strong baseline and quality gate.

## Reviewer output
| Rule ID | Applicable? | Evidence | Pass/Fail/Unknown | Required remedy |
If even one policy-denial case leaks data, mark security gate FAIL regardless of green generic unit tests.
