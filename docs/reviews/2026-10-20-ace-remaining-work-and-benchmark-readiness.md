# ACE remaining work and benchmark readiness — current-main refresh

**Date:** 2026-10-20  
**Audited main:** `bdb54950fe889cdee5f8fe936e773c9c5fb61aa8`  
**Major synchronization:** merged PR #88 (`feat(ace): consolidate unified-plan correctness and evidence`) plus PR #89.  
**Not counted:** open PR #90 is not in `main` and is intentionally excluded from this status.  
**Prior review baseline:** the previous revision still reasoned from `5a033daaa44b5a4540c71e8c1be59d6f0d5a1283`, so several “remaining” code findings had become stale.  
**Owner decision retained:** **Qwen3:14b** is the first experimental local-only Graphiti extraction model on the owner's 64 GB RAM machine. No high-end discrete GPU is assumed. Amplifier is not on the normal Graphiti or Harbor path.

This document answers one question only: **what still remains after the synchronized current `main`?** It is not a new claim of production readiness.

## 1. Current conclusion

The remaining work is now materially smaller than in the previous revision.

PR #88 closed several concrete correctness defects at the implementation + deterministic-test level:

- Graphiti MCP errors can no longer be parsed as successful empty results;
- memory deletion now has a durable deletion fence against stale projectors;
- reconciliation can rebuild a missing projection intent from immutable archive truth;
- Qdrant lease inspection/pruning is fenced against concurrent acquire and fails closed on non-ENOENT filesystem errors;
- Harbor cost completeness is now structured rather than inferred from free-form text;
- raw DBC artifacts are hashed as bytes instead of being forced through JSON parsing.

The project therefore has **three separate finish lines** and they must not be mixed again:

1. **First honest code-only token smoke:** can run as soon as Harbor has a working real Codex subscription/OAuth route. Use a frozen/read-only exact commit. Graphiti, Vertex, k3s production containment, SBOM/signing and final provider approval do **not** block this first measurement.
2. **Quality-safe warm/dirty-tree benchmark:** additionally requires the still-open live-worktree membership and semantic dependency invalidation work below. This is necessary before claiming that persistent ACE reuse remains correct while the repository changes.
3. **Full-unified production release:** additionally requires provider selections, Graphiti, Vertex, k3s, operations, resource/supply-chain evidence, the remaining DBCs and exact-release owner approval.

The historical forced-use result remains only a diagnostic: native used 891,950 raw tokens versus 1,571,768 for forced ACE (native/ACE ≈ 0.567x). It does not answer whether Codex will naturally use ACE or save tokens.

## 2. Historical gap findings — current status

| Finding | Current status on audited `main` | Remaining work |
|---|---|---|
| **F-01 Graphiti `isError` parsing** | **DONE — code/test level** | `replyJsonObject()` now rejects MCP `isError` before parsing structured/text JSON. Real Graphiti lifecycle evidence remains separate. |
| **F-02 delete/reconcile resurrection** | **DONE — code/test level** | Durable `beginDeletion/finalizeDeletion` fence blocks stale projection receipts and survives restart. Real multi-process Graphiti delete/reconcile acceptance still belongs to W06/W07. |
| **F-03 archive → projection-intent crash gap** | **DONE — code/test level** | `reconcileProjectionIntents` scans immutable archived episodes and recreates missing intents for admitted episodes. Real crash/restart provider evidence still remains. |
| **F-04 Qdrant lease acquire vs cleanup race** | **DONE — code/test level; bounded real concurrency evidence exists** | Workspace lease mutation fence + non-recursive `rmdir` + fail-closed EACCES/EIO handling are implemented. Production DBC-13 still needs selected-stack/target-storage evidence. |
| **F-05 Harbor cost/acceptance oracle** | **DONE — code/test level** | Structured `complete/partial/unknown` telemetry, required numeric components, non-null counters and execution identity checks are implemented. What is missing is an actual natural-use Harbor run, not another oracle rewrite. |
| **F-06 release-validation depth** | **PARTIAL** | Release validation now checks current commit, evidence identities, report/config hashes and consistency. It still does not independently replay every primary measurement from raw artifacts; retain exact source reports and strengthen binding where a forged standalone verdict could still be authored. |
| **F-07 JSON-only DBC artifact loader** | **DONE — code/test level** | Release CLI hashes DBC artifacts as raw bytes and parses JSON only where the contract requires structured JSON. |
| **F-08 temporal decision truth in Graphiti path** | **PARTIAL** | Decision history is now wired into the real Graphiti adapter; `decisionStates` and `conflicts` are populated. Historical recall is still provider-bounded top-K (currently max 1000) with local time filtering, so complete as-of recall is not yet proven. |
| **F-09 English-centric routing** | **OPEN** | Deterministic routing still uses English substring intent checks. Explicit source obligations should replace hidden intent inference for correctness-sensitive mixed-source requests. |
| **F-10 startup/readiness drift** | **OPEN** | Current docs say embedding preflight failure is fatal, while current runtime/tests intentionally keep MCP alive and expose `not_ready`. Choose one policy and align code, tests and operations docs. |
| **F-11 owner-approval trust root** | **OPEN — release governance** | Define what makes owner approval authoritative: protected PR/commit, signed attestation, or another explicit trust root. |
| **F-12 stale execution/status docs** | **OPEN — documentation** | Some OpenSpec/execution-plan text still describes already-completed comparisons or pre-Qwen Graphiti selection. Refresh status without rewriting historical evidence. |

### Important correction

The old semantic-bugs review and old remaining-work plan must no longer be read as a live backlog. F-01 through F-05 and F-07 above have concrete current-main fixes. Do not reimplement them merely because an older review says “fix”.

## 3. What current evidence has already established

### Code retrieval / Qdrant

Already retained:

- real Qdrant + FastEmbed + Tree-sitter + TypeScript LS composition;
- 1k and 10k cold/warm/change-only scale evidence;
- changed/add/delete/rename/untracked delta handling across restarted runs;
- interrupted snapshot publication/crash evidence;
- same-snapshot concurrent writers converging on one published snapshot;
- stale-count recovery against real Qdrant;
- embedding startup timeout produces truthful `not_ready`;
- deterministic lease-fence and fail-closed filesystem regressions.

These are meaningful sub-gates, but they do **not** prove live long-running worktree invalidation or final target PVC/k3s persistence semantics.

### Semantic provider comparison

The matched comparison is now real and complete enough to make the technical difference explicit:

- direct TypeScript Language Service: **9/9** frozen oracle cases;
- Serena 2.0.0: **7/9**, failing the retained alias-source-reference and write-reference cases;
- direct TS-LS also measured materially lower warm p95 on the retained comparison.

The repository policy currently names `typescript-language-service` as the selected candidate, but owner approval is still `pending`. The old task text saying the Serena comparison still needs to be performed is stale.

### k3s worktree

K3S-01 through K3S-09 passed in real evidence. **Only K3S-10 remains failed**: an unrelated workload can reach the helper TLS boundary. mTLS rejects it, but the accepted containment requirement also forbids reachability.

### Vertex

The real provider was reached and policy enforcement passed, but the committed synthetic fixture was not present in the authorized corpus. Citation/version conflict evidence therefore remains blocked on the synthetic fixture import.

### Operations / supply chain

- local archive backup/restore: OPS-01 and OPS-06 pass;
- Graphiti/FalkorDB/Qdrant/reconcile restore scenarios remain blocked;
- production npm audit is clean at the retained run;
- npm SBOM exists;
- immutable image digest/provenance/signature and independent license review are still missing.

## 4. Remaining work for the first token-savings answer

This is the shortest path and should be executed before expanding the production backlog again.

### B0 — Run a real natural-use Harbor smoke

- [ ] Use Harbor's native Codex auth-file support with the owner's existing Codex/ChatGPT subscription. **Do not add Amplifier for Harbor.**
- [ ] Confirm one exact model ID available to that subscription and pin the same model + reasoning effort in native, optional-natural ACE and forced-diagnostic arms. Do not use a dynamic “latest” catalog.
- [ ] Run the existing three-arm 3×3 job on one exact, frozen/read-only source commit.
- [ ] Retain raw Codex/Harbor JSONL, task outcomes, token counters, ACE call counts and provider correlation.
- [ ] Report separately: native quality/tokens; natural ACE quality/tokens; how often natural Codex invoked ACE; forced arm only as a diagnostic.

**This is enough to obtain the first honest answer to “does the current ACE reduce Codex raw tokens on these tasks?”**

Complete local-infrastructure dollar telemetry is required for formal end-to-end economic acceptance, but it is **not** required to truthfully report provider-reported raw token counts as token counts.

Current blocker evidence is `harbor-natural-use-blocked-7bb3e02.json`: the previous attempt had no valid real OAuth Codex route. F-05 itself is no longer the blocker.

### B1 — Then freeze a real holdout before any general savings claim

After the smoke:

- [ ] freeze a larger unseen multi-repository TypeScript/JavaScript task holdout;
- [ ] predeclare quality/non-inferiority acceptance before inspecting final results;
- [ ] preserve failures and repeated trials;
- [ ] include behavior-not-name, same-name symbols, cross-file dependency work and at least the repository-state modes actually claimed.

If the claim is only **frozen read-only code retrieval**, S1/S2 below may be explicitly outside the first smoke scope. If the claim includes **persistent warm sessions or repository edits**, S1/S2 must pass first.

## 5. Remaining code work before a quality-safe warm/dirty-tree benchmark

These are the main product-code items still open.

### S1 — Live worktree membership reconciliation

Current ACE observes/builds a source snapshot during startup. Exact returned snippets are re-read, but a long-lived process does not yet prove that a newly added sole implementation, deletion, rename or scope change has entered/leaved the candidate universe before a later query.

Use the simplest correctness mechanism first:

- [ ] before a query that claims current complete code coverage, reconcile a lightweight authoritative workspace manifest (path/scope + content identity) against the published `index_key`;
- [ ] if membership/content changed, catch up before claiming `complete`, reusing the existing per-file structural/candidate/vector caches for unchanged files;
- [ ] if catch-up cannot complete, return explicit partial/`not_ready` rather than an old complete index;
- [ ] treat filesystem watchers only as a performance hint/optimization, **not** as the source of truth. Do not build a new watcher framework unless measurement shows manifest reconciliation is too expensive.

Required regressions:

- add the only correct implementation after MCP startup;
- delete/rename the previous hit;
- change an excluded/included path;
- edit during context assembly;
- simulate missed watcher notification if a watcher optimization is later used.

This replaces the previous plan's stronger “must build a notification mechanism” wording with a smaller, correctness-first solution.

### S2 — Semantic dependency/snapshot invalidation

The direct TS-LS adapter currently creates one immutable language-service snapshot whose in-snapshot script versions are all `"1"`. That is valid for a frozen source snapshot, but not a claim that semantic relationships remain live after dependency/config changes.

- [ ] rebuild/invalidate the semantic snapshot when the code `index_key` or semantic dependency fingerprint changes;
- [ ] include relevant `tsconfig`/project references, module-resolution settings, declarations and package/lockfile inputs in that semantic dependency identity;
- [ ] bind AST/index/TS-LS evidence to one compatible source generation;
- [ ] if dependency identity is uncertain, keep exact bytes usable but do not label stale semantic relationships as verified-current.

Required regressions:

- unchanged A imports modified B;
- changed alias/re-export/type;
- changed tsconfig resolution;
- dependency removed;
- same-name symbols/overloads;
- warmed result must match a fresh-provider oracle or truthfully refuse semantic confirmation.

A full custom live-language-server lifecycle is not required if rebuilding the supported TS-LS snapshot on dependency identity change is sufficient.

### S3 — Explicit source obligations

This is **not required for the first code-only frozen smoke**, but remains required before claiming robust unified code+docs+memory intent handling.

Current source coverage types distinguish required/optional/not-requested, but MCP requirements are still derived from deterministic English keyword routing plus boolean include flags.

- [ ] add an explicit request-level source obligation contract (for example required/optional source sets) while keeping existing booleans backward-compatible;
- [ ] expose the executed source plan/coverage;
- [ ] let routing be a transparent suggestion, not the hidden authority for whether docs/memory were required;
- [ ] keep denied, unavailable, no-match, stale and not-requested distinct;
- [ ] add RU/EN/mixed/paraphrase fixtures without solving the problem by endlessly adding substring synonyms.

Do not introduce a routing LLM unless measured evidence later justifies one.

### S4 — Resolve F-10 readiness semantics

- [ ] decide whether a pinned embedding **identity mismatch** is fatal while a transient provider startup outage is `not_ready`, or whether both should be one policy;
- [ ] align `ace-mcp.ts`, `mcp-runtime-readiness.test.ts`, real timeout evidence and `ace-configuration-and-readiness-matrix.md`;
- [ ] retain the distinction between “process can report status” and “provider is production-ready”.

The current code/tests demonstrate non-fatal `not_ready` for embedding preflight failure, while the operations document still calls that class fatal.

## 6. Remaining provider-selection and retrieval-quality work

### W01 — Embeddings

FastEmbed/ONNX is the measured current candidate, but production selection remains open.

- [ ] build the required unseen multi-repository holdout rather than reusing the nine-case development/frozen comparison as the final production corpus;
- [ ] predeclare selection thresholds/policy **before** seeing final holdout outcomes;
- [ ] retain authoritative model/runtime license evidence and target-host resource measurements;
- [ ] run the existing selection gate;
- [ ] obtain owner approval for the exact selected provider/artifact.

### W02 — Semantic provider

The matched Serena-vs-TS-LS comparison itself is **done**.

Remaining:

- [ ] finish S2 live dependency/snapshot correctness;
- [ ] owner reviews the retained 9/9 TS-LS vs 7/9 Serena evidence and explicitly approves the production semantic provider (or rejects/reopens the choice).

Do not rerun a broad provider search merely because old task text still says “compare Serena”.

### W03 — Retrieval quality

- [ ] freeze an unseen multi-repository retrieval holdout;
- [ ] run lexical/vector/current strategy ablations on exactly that holdout;
- [ ] predeclare quality/compactness thresholds before the final selected-strategy verdict;
- [ ] retain recall/MRR/nDCG, payload size, duplicate hits, expansion calls, repeated native reads and latency;
- [ ] introduce hybrid/reranking complexity only if this measured ablation justifies it.

## 7. Remaining Graphiti / memory work

The next step is **not** Amplifier and not another open-ended model search.

### Selected path

- **Qwen3:14b**, local-only, 64 GB RAM target host;
- serve through a maintained Graphiti-compatible OpenAI-compatible local endpoint;
- pin an upstream Graphiti revision whose actual factories support the chosen local LLM/embedder/reranker composition;
- use upstream/local embedding and BGE reranking facilities rather than an ACE-specific inference framework.

The PR #88 Amplifier/Graphiti preflight remains useful historical negative evidence, but its unavailable OAuth/live-catalog path is **superseded as the current next step** by the owner's Qwen3:14b local-first decision.

### Still required

- [ ] stand up Qwen3:14b locally and retain exact model/quantization/runtime identity;
- [ ] prove structured extraction quality on frozen RU/EN/mixed memory fixtures: decisions, proposed-vs-accepted, supersession, constraints, unresolved questions, contradictions and irrelevant chatter;
- [ ] measure schema failures, false facts, latency and peak RSS on the 64 GB RAM host;
- [ ] run real Graphiti + FalkorDB add/search/provenance/purge lifecycle;
- [ ] run crash/reconcile/deletion concurrency with the now-implemented durable fences/intents;
- [ ] close DBC-11 with real provider evidence;
- [ ] finish F-08 historical/as-of completeness: use supported pagination/filtering where possible, or explicitly bound the claim instead of treating provider top-K as exhaustive;
- [ ] complete Graphiti/FalkorDB backup/restore and post-restore reconciliation/retention scenarios (OPS-02/04/05).

If Qwen3:14b is accurate but slow, prefer asynchronous/background projection. Only if it fails the correctness gate should another LLM/backend be considered. Subscription-backed Amplifier remains an owner-authorized Plan B, not current architecture.

## 8. Remaining Vertex work

The corpus already exists and the real retrieval endpoint has been reached.

Remaining:

- [ ] provide/approve the dedicated synthetic `gs://ace-vertex-synthetic...` prefix and necessary IAM for the committed public/synthetic fixture only;
- [ ] run the existing synthetic import command;
- [ ] rerun the real conflict retrieval;
- [ ] retain citation, version/server identity and request/provider evidence;
- [ ] close DBC-14.

Do not broaden this into private source/dialogue upload authorization.

## 9. Remaining k3s / operations work

### k3s

K3S-01…09 are already PASS.

Only current live-worktree containment blocker:

- [ ] provide a site-specific host firewall / cluster egress rule so unrelated workloads cannot reach the helper TLS address/port;
- [ ] rerun K3S-10 and the finalizer.

Do not build a custom network-policy controller or service mesh.

### Persistence / backup

- [ ] target Qdrant/PVC restore evidence (OPS-03);
- [ ] Graphiti/FalkorDB restore (OPS-02);
- [ ] restart reconciliation after restored provider state (OPS-04);
- [ ] retention/deletion behavior after restore (OPS-05);
- [ ] finish DBC-13 on the selected deployment/storage stack, using the already-retained scale/concurrency/crash evidence rather than repeating it blindly.

## 10. Remaining release-integrity work

### F-06 evidence binding

- [ ] retain primary provider/retrieval/Harbor measurement artifacts alongside selection verdicts;
- [ ] ensure release preflight can verify that the referenced primary artifacts/config identities actually match the digests and exact release scope rather than trusting a hand-authored standalone verdict.

Do not rebuild a generic evidence platform; strengthen only the remaining trust boundary.

### F-11 approval trust root

- [ ] define the authoritative owner-signoff mechanism for the exact release commit/capability scope (for example protected PR approval, signed attestation, or another explicit governed record);
- [ ] make release preflight reference that mechanism instead of treating arbitrary well-shaped approval JSON as sufficient authority.

### F-12 stale documents

- [ ] refresh OpenSpec/task/execution-plan current-state text that still says the Serena comparison is pending or that the Graphiti model is unselected;
- [ ] preserve dated historical reviews as historical evidence; do not rewrite old failures into PASS.

### Resource and supply chain

- [ ] owner supplies real resource-budget thresholds/minimum sample policy;
- [ ] measure exact-release RSS/startup/index/query metrics on the selected target environment;
- [ ] build the immutable release image and retain its digest;
- [ ] generate standard provenance/SBOM evidence and verify image signature (BuildKit/Syft/Cosign are the intended ready-made tools);
- [ ] perform independent license review for runtime packages **and separately for downloaded model artifacts** such as the embedding model/Qwen artifact when outside the OCI image;
- [ ] bind all of the above to the exact release commit.

## 11. Remaining DBCs

The current normative task list still has these seven DBCs open:

- **DBC-01** — approved production embedding + semantic composition;
- **DBC-03** — frozen real semantic retrieval quality;
- **DBC-04** — semantic provider approval after matched comparison;
- **DBC-11** — real Graphiti purge/deletion correctness;
- **DBC-12** — natural-use Harbor attribution/economics;
- **DBC-13** — selected-stack restart/persistence/performance;
- **DBC-14** — real Vertex cited docs-vs-current-code conflict.

Checked DBC-02/05/06/07/08/09/10 do not need to be reimplemented. They need exact-release evidence only when the final release bundle is frozen.

## 12. Execution order from current main

### Now — learn whether ACE is worth it

1. **Fix Harbor access, not ACE:** use the real Codex subscription auth route and exact pinned model.
2. Run frozen/read-only **native vs optional-natural ACE 3×3** immediately.
3. Inspect natural ACE call rate, quality and raw token ratio. Preserve a bad result if it is bad.

### Next — make warm reuse trustworthy

4. Implement **S1 workspace-manifest reconciliation** using existing per-file caches; watcher only if later needed for performance.
5. Implement **S2 semantic dependency fingerprint/rebuild**.
6. Run live long-lived MCP regressions and then freeze the larger multi-repository benchmark holdout.
7. Add **S3 explicit source obligations** before unified/multilingual intent claims.

### In parallel — close full-unified providers

8. W01 embedding final holdout/policy/owner approval; W02 semantic owner approval; W03 retrieval-quality gate.
9. Qwen3:14b + Graphiti real lifecycle/recovery/backup.
10. Vertex synthetic import/citation.
11. K3S-10 containment and remaining provider/storage backup evidence.

### Release

12. Resolve F-10/F-06/F-11/F-12.
13. Generate exact-release DBC/resource/runtime/supply-chain evidence.
14. Final owner approval for the exact release commit and capability scope.

## 13. Stop-fixing-forever rule

Every new proposed task must be classified before implementation:

- **B0 — immediate token-smoke blocker:** prevents a truthful frozen/read-only native-vs-natural token measurement.
- **B1 — warm/dirty benchmark blocker:** can make persistent reuse return an incorrect/currently incomplete answer under repository changes.
- **P — production blocker:** required for accepted full-unified release, but not for the first code-only measurement.
- **D — deferred:** optional framework, future provider, convenience or unmeasured architecture expansion.

Current classification:

- working Harbor Codex auth/model route: **B0**;
- S1/S2: **B1**;
- S3: **B1 only for unified/multilingual intent claims**, otherwise P;
- Graphiti/Vertex/K3S-10/backup/supply-chain/final approvals: **P**;
- Amplifier: **D / Plan B only**;
- 5×: **measurement result**, never an entry condition.

No task enters B0 merely because it is required for eventual production. It must explain how its absence invalidates the frozen/read-only token measurement.

## 14. When can token savings finally be measured?

**First useful smoke:** as soon as the real Codex subscription authentication works in Harbor. The previous F-05 validation weakness is fixed in current code. No Graphiti/Vertex/k3s/SBOM work needs to happen first.

**Result worth generalizing to persistent ACE use:** after S1/S2 and a frozen multi-repository holdout with predeclared quality criteria.

**Full production:** only after the P-class provider/deployment/release gates above.

This separation is intentional. The project must learn whether ACE produces useful token economics **before** turning every production concern into a prerequisite for measuring the product idea.
