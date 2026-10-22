# Roo Code adoption: one-pass execution slices

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers `subagent-driven-development` (recommended) or `executing-plans` task-by-task.
>
> **Source spec:** [roo-code-adoption-plan.md](./roo-code-adoption-plan.md)

**Goal:** use real ACE feedback to select at most one Roo-inspired retrieval/indexing improvement at a time.

**Architecture:** current AST/LSP/Qdrant pipeline remains the baseline. Roo ideas are opt-in experiments; no second retrieval engine or unsafe publication path is introduced.

**Tech stack:** TypeScript/Node.js, Effect, ast-grep, TS-LSP, Qdrant, existing retrieval benchmark/Harbor tooling.

## Global constraints

- Inspect current `main` and current feedback evidence before assuming the research doc's historical status.
- Do not combine R2 hierarchical chunking, R3 path scope and R4 index scheduling in one PR.
- Preserve exact source/range/digest provenance and Qdrant atomic publication.
- Any “win” must come from a pinned paired comparison; missing billing/provider telemetry is `UNKNOWN`.
- One execution slice = one reviewable PR unless the slice is evidence-only and creates no code.

## Review focus

1. Chunk strategy must not leak holdout/gold knowledge into runtime.
2. Path scope must not create silent false negatives outside the prefix.
3. Scheduler optimization must preserve snapshot publication and cancellation semantics.
4. Fallback segmentation must remain nonsemantic unless semantic proof exists.
5. UI/progress changes must not become a new service or editor-specific core dependency.

---

### Slice ROO-01: Reconcile current feedback-loop status

**Files:**
- Read: `docs/plans/ace-real-feedback-loop.md`
- Read current feedback/Harbor scripts and retained evidence.
- Create only a dated review/evidence artifact if repository policy requires it; no runtime code.

- [ ] Identify which F0 prerequisites are currently real, blocked or superseded.
- [ ] Pin current source commit and relevant provider/runtime identities.
- [ ] List one concrete retrieval failure class worth diagnosing next.
- [ ] Do not reopen already-fixed PR work.

**Done when:** there is a current, source-linked starting point for Roo experiments.

---

### Slice ROO-02: One real paired feedback smoke

**Depends on:** ROO-01 and required external environment.

**Files:** existing feedback scripts only unless a deterministic bug blocks the smoke.

- [ ] Run one native task and the same ACE-optional task serially.
- [ ] Verify task/source SHA, real ACE tool correlation, provider token usage and quality result.
- [ ] Retain raw artifact digests.
- [ ] If blocked, stop with the exact environment/provider reason.

**Done when:** one paired real task exists; no claim of general ROI.

---

### Slice ROO-03: Retrieval diagnostic record

**Depends on:** ROO-02 or one independently reproducible real-provider query.

**Files:**
- Create: `src/domain/retrieval-diagnostics.ts`
- Modify: `src/adapters/retrieval-benchmark-trace.ts`
- Test: `test/retrieval-benchmark-trace.contracts.test.ts`

**Produces:** compact record of top-K candidate path/span, structural kind/name, LSP proof, delivered bytes, source coverage, warnings and latency.

- [ ] Write failing serialization/validation tests.
- [ ] Add fields using existing trace evidence; do not duplicate source bodies.
- [ ] Verify unavailable metrics remain unknown.
- [ ] Commit.

---

### Slice ROO-04: Human-readable diagnostic renderer

**Depends on:** ROO-03.

**Files:**
- Create: `scripts/render-retrieval-diagnostic.ts`
- Test: `test/retrieval-diagnostic-renderer.contracts.test.ts`

- [ ] Render one query/failure in compact text.
- [ ] Include exact path/span, proof class, bytes, warnings and provider stage status.
- [ ] Redact/omit raw source bodies and secrets.
- [ ] Commit.

**Done when:** one bad retrieval can be inspected without opening huge logs.

---

### Slice ROO-05: Candidate-size distribution report

**Depends on:** current structural index.

**Files:**
- Create: `scripts/report-candidate-size-distribution.ts`
- Test: `test/candidate-size-distribution.contracts.test.ts`

- [ ] Compute UTF-8 byte/line distributions from actual indexed candidates.
- [ ] Report outliers with path/kind/range, not source text.
- [ ] Separate languages/kinds.
- [ ] Run on one pinned repository and retain summary.

**Done when:** chunking hypotheses are grounded in measured candidate sizes.

---

### Slice ROO-06: Freeze exactly one Roo-inspired hypothesis

**Depends on:** ROO-03..05 evidence.

**Files:** create one small benchmark hypothesis artifact under `benchmarks/` or `docs/reviews/` per repository conventions.

- [ ] Choose exactly one: hierarchical chunking, path scope, or scheduler.
- [ ] Predeclare expected metric movement and failure condition.
- [ ] Pin task/holdout/source/runtime.
- [ ] Explicitly state what will **not** change in the experiment.

**Done when:** the next implementation cannot move the goalposts.

---

### Slice ROO-07: Hierarchical chunk model contract

**Gate:** ROO-06 selected hierarchical chunking.

**Files:**
- Create: `src/domain/structural-chunking.ts`
- Test: `test/structural-chunking.contracts.test.ts`

**Produces:** deterministic policy describing parent/child chunk selection, maximum byte/line bounds and fallback status; no indexing change yet.

- [ ] RED-test very large declaration, tiny nested nodes, Unicode ranges and unsupported language.
- [ ] Implement pure policy only.
- [ ] Commit.

---

### Slice ROO-08: Opt-in hierarchical index strategy

**Depends on:** ROO-07.

**Files:**
- Modify: `src/adapters/local-code-index.ts`
- Modify strategy/index identity only as needed in `src/domain/retrieval.ts`
- Test: extend local structural index tests or add `test/hierarchical-code-index.contracts.test.ts`

- [ ] Keep current default strategy unchanged.
- [ ] Create distinct candidate/index identity for hierarchical output.
- [ ] Preserve exact source ranges/digests and structural anchors.
- [ ] No semantic fallback masquerading as structural fact.
- [ ] Commit.

---

### Slice ROO-09: Hierarchical retrieval ablation

**Depends on:** ROO-08.

**Files:** benchmark scripts/artifacts only.

- [ ] Run default structural vs hierarchical on frozen holdout.
- [ ] Report Recall/MRR, delivered bytes, candidate count, latency and mapping failures.
- [ ] Decide keep/reject/inconclusive.
- [ ] Do not combine with path scope.

**Done when:** R2 has an isolated answer.

---

### Slice ROO-10: Explicit path-scope contract

**Gate:** ROO-06 selected path scope or later evidence justifies it.

**Files:**
- Extend working-context/request schema in the narrowest applicable domain file.
- Test: `test/working-context.contracts.test.ts`
- Transport schema only after domain contract is fixed.

- [ ] RED-test safe relative prefix, traversal/absolute path rejection and empty scope.
- [ ] Define scope as boost/filter semantics explicitly; research recommends testing an explicit safe prefix.
- [ ] Preserve an unscoped mode.
- [ ] Commit.

---

### Slice ROO-11: Path-scope provider wiring

**Depends on:** ROO-10.

**Files:**
- Modify: `src/adapters/qdrant-context-provider.ts`
- Modify gateway/transport schema only if required.
- Add provider contract test.

- [ ] Apply scope only to the experimental/requested path.
- [ ] Return explicit metadata that scope was applied.
- [ ] Ensure cross-package candidates remain visible in unscoped baseline.
- [ ] Commit.

---

### Slice ROO-12: Scoped-vs-unscoped ablation

**Depends on:** ROO-11.

- [ ] Use pinned tasks with at least one cross-package relevant result.
- [ ] Measure false negatives, bytes, latency and native follow-up reads.
- [ ] Reject hard filtering if it loses required context.
- [ ] Retain exact per-query traces.

---

### Slice ROO-13: Index-scheduler baseline

**Gate:** ROO-06 selected scheduler and current indexing is measured as bottleneck.

**Files:**
- Extend existing scale/index runner rather than production scheduler.
- Tests: `test/index-scale-runner.contracts.test.ts`

- [ ] Measure current 1k/10k and edit-storm wall time, queueing/rebuild count and publication correctness.
- [ ] Pin machine/runtime/source identity.
- [ ] No production code yet.

---

### Slice ROO-14: Coalescing scheduler prototype

**Depends on:** ROO-13 shows material redundant work.

**Files:**
- Create: `src/application/index-reconcile-scheduler.ts`
- Test: `test/index-reconcile-scheduler.contracts.test.ts`

- [ ] RED-test debounce/coalescing, cancellation, newest-generation wins and shutdown.
- [ ] Implement orchestration only; reuse existing safe reconcile/publication.
- [ ] Commit.

---

### Slice ROO-15: Scheduler stress ablation

**Depends on:** ROO-14.

- [ ] Re-run exactly ROO-13 fixtures.
- [ ] Compare work count, wall time/RSS and source-snapshot correctness.
- [ ] Keep only if improvement is material and no stale publication appears.

---

### Slice ROO-16: Language-aware nonsemantic fallback

**Gate:** diagnostics show unsupported-language/coverage failures that dominate useful tasks.

**Files:**
- Create a separate fallback source/adapter; do not overload structural proof.
- Add language-specific fixtures and explicit provenance.

- [ ] Pick one language/format from real failures.
- [ ] Segment deterministically.
- [ ] Label fallback evidence distinctly from structural/LSP evidence.
- [ ] Run coverage/retrieval comparison.

---

### Slice ROO-17: Status/progress visibility

**Gate:** operational pain remains after core retrieval feedback.

**Files:**
- Extend `ace_workspace_status` domain/application data or a CLI report.
- Modify `src/transport/mcp-sdk-stdio.ts` only if contract requires.
- Add transport/status tests.

- [ ] Expose indexing stage/progress/provider readiness without source contents.
- [ ] Keep editor-specific UI outside core.
- [ ] Commit.

---

### Slice ROO-18: P2 baseline experiments

Run each as a **separate** evidence-only slice, never bundled:
- embedded vector retrieval external baseline;
- WASM parser startup/throughput baseline;
- multi-workspace UX probe;
- cloud embedding policy/egress probe.

Each must end in `ADOPT`, `REJECT`, `INCONCLUSIVE` or `BLOCKED`, with no production code unless a later plan is approved.

## Dependency DAG

```text
ROO-01 -> ROO-02 -> ROO-03 -> ROO-04
                      |
                      +-> ROO-05 -> ROO-06
                                   |-- hierarchical -> ROO-07 -> ROO-08 -> ROO-09
                                   |-- path scope   -> ROO-10 -> ROO-11 -> ROO-12
                                   '-- scheduler    -> ROO-13 -> ROO-14 -> ROO-15

ROO-16/17 are evidence-gated side branches after diagnostics.
ROO-18 experiments are independent P2 probes.
```

## Self-review

- The three causal mechanisms R2/R3/R4 are isolated.
- Diagnostics and measurement precede optimization.
- Current atomic Qdrant/source-integrity rules are preserved.
- No slice requires “implement Roo Code”; all are ACE-native, reversible experiments.
