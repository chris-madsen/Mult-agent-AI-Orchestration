# Tasks — Production retrieval vertical slice

**State: NOT IMPLEMENTED. All checkboxes intentionally unchecked.** Prior port-level `[x]` markers do not satisfy these end-to-end acceptance criteria.

## Architecture/approval
- [ ] Owner reviews ADR-012, real embedding provider, exact LSP choice, data policy and provider licenses/versions.
- [ ] Establish valid Codex/official MCP SDK integration and conformance contract; remove homemade transport from production bootstrap after migration.
- [ ] Pin real Qdrant, semantic embedding, Tree-sitter grammar and selected LSP; no SHA256 vector as semantic provider.

## Vertical slice
- [ ] Wire production `ace_context` through actual configured Qdrant retrieval and source digest verification.
- [ ] Materialize AST-exact symbol ranges (not whole file per regex name); LSP same-name refs/types validated with real language service.
- [ ] Return relevant ContextBundle with complete/partial based on required route coverage; preserve full exact expansion bytes and source-worktree frame conditions.
- [ ] Keep outages, denied policy and stale source distinct; instrument safe provider invocation evidence without logging secrets.
- [ ] Ensure documentation/temporal providers are conditional, explicitly unavailable until approved, and never fabricate ready status.

## Bertrand Meyer contracts (real integration or agent E2E)
- [ ] DBC-01 production composition, no fallback-only passing.
- [ ] DBC-02 2000-line/25-line exact AST span and exact expand.
- [ ] DBC-03 behavior-driven semantic retrieval vs lexical distractor and real embeddings.
- [ ] DBC-04 same-name symbols and correct definition/write semantics.
- [ ] DBC-05 mid-request edit D1→D2, no false-current.
- [ ] DBC-06 source failure completeness / degraded truthful response.
- [ ] DBC-07 policy denial outbound count zero and safe audit.
- [ ] DBC-08 byte-identical original and generated 2000+ line content.
- [ ] DBC-09 official MCP SDK conformance with Codex, cancellation/error paths.
- [ ] DBC-10 stable Codex historical episode IDs after append and replay.
- [ ] DBC-11 shared digest archive delete and derived purge correctness.
- [ ] DBC-12 realistic Harbor attribution and quality gate.
- [ ] DBC-13 restart with stale index and dirty worktree.
- [ ] DBC-14 docs-vs-code conflict disambiguation.

## Performance and exit
- [ ] Run paired Harbor retrieval-demanding tests (at least more than one fixture task), count ACE calls and external provider costs, include failed trials; never claim 5× from trivial/zero-call smoke.
- [ ] Run OpenSpec CLI strict validation, typecheck, lint, unit, real-provider integration and Codex agent E2E; attach outputs or label unknown.
- [ ] Owner reviews actual provider trace, benchmark and all mandatory contracts before declaring `production-ready`; no `controlled exception` can close a failed mandatory gate.
