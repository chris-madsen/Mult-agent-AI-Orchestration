# ACE remaining work, quality-safe reuse and benchmark readiness

**Date:** 2026-10-20  
**Product-code review baseline:** `5a033daaa44b5a4540c71e8c1be59d6f0d5a1283`  
**Plan revision:** quality-safe reuse update; preserves the owner decisions added in `c7223cc7ff82fc304fcbdfefc5aa51a864620738`. This is an execution plan, not a new full-code audit or a claim that the tasks below have passed.  
**Owner decision:** Qwen3:14b is the first experimental local-only Graphiti extraction model on the owner's 64 GB RAM machine. Do not assume a discrete GPU. The model is selected for the experiment, not production-approved and not tied to a mandatory serving runtime.  
**Sources:** [production gap review](../plans/2026-10-20-unified-ace-production-gap-review.md), [expanded review](./2026-10-20-unified-plan-progress-1227.md), [semantic findings](./2026-10-20-semantic-bugs-review.md), [canonical backlog](../plans/2026-10-19-unified-ace-correctness-and-production-plan.md).

## 1. Objective and claim boundaries

ACE should avoid repeated online search, rereading and reconstruction by reusing locally computed work. It must not save tokens by silently withholding task-relevant information or presenting historical results as current facts.

Distinguish:
- reusable deterministic artifacts: exact bytes, AST spans, embeddings and indexed candidates;
- dependency-sensitive semantic results: definitions, references, types and diagnostics;
- retrieved evidence bundles, which depend on query, source requirements, policy and source versions;
- derived memory claims, which have provenance and temporal validity, not automatic truth;
- agent conclusions, which must not be cached as verified facts merely because they were previously generated.

An index cache is not a cache of completed model reasoning. No generic answer/LLM-result memoization service is required by this plan. If proposed later, it needs its own correctness and economics evidence.

### Two finish lines remain separate

1. **Exploratory benchmark:** raw native/optional-natural/forced diagnostic trials may run now when native Codex auth works. Known failures and incomplete telemetry must be retained; no automatic acceptance claim follows.
2. **Quality-safe benchmark interpretation:** fix the applicable reuse hazards and F-05, pass the scoped correctness fixtures, then evaluate frozen task quality and economics. Full-unified production additionally requires memory/docs/k3s/operations/provider/license/owner gates.

Graphiti, Vertex, k3s, SBOM/signing and final production provider approval are not prerequisites for collecting a code-only exploratory benchmark. They must not be smuggled onto that critical path. Conversely, a known stale-code defect relevant to a dirty-tree benchmark cannot be dismissed as production-only.

Historical forced-use evidence is unchanged: native 891,950 versus forced ACE 1,571,768 raw tokens; native/ACE = 0.567482x. This does not measure natural tool choice. A 5x target is a hypothesis, not an entry gate.

## 2. Quality-safe reuse contract

Reuse is authorized only for its declared scope. Every delivered item must distinguish:
- byte integrity and exact original pointer;
- source/snapshot identity and time of verification;
- semantic dependency/configuration identity where applicable;
- required-source coverage and any unresolved changes;
- claim valid time, approval state and uncertainty for memory;
- whether the result was freshly computed, reused unchanged, revalidated or invalidated.

Do not overload `freshness=current`: archive bytes being intact does not establish that a historical decision remains effective. Likewise, `complete` means the declared authorized retrieval plan was fulfilled, not that every fact relevant to any possible interpretation of the user's task has been found.

State verification as of a named observation/snapshot boundary. A final read cannot guarantee that the worktree will never change after the response. If an edit occurs during assembly, retry under a bounded policy or return explicit partial/stale status. Never claim an atomic whole-project snapshot from unrelated sequential reads without an appropriate consistency mechanism.

New observable behavior belongs in applicable OpenSpec deltas; this plan does not silently amend Accepted ADRs or close DBC checkboxes.

## 3. Finite safety work packages

### S0 — Reuse boundary and build-versus-buy decision

- [ ] Inventory actual cache keys, read sets, invalidation triggers, validity labels and callers. Record which gaps are reproduced versus static risks; do not assume old review findings remain unfixed.
- [ ] Prefer existing maintained provider lifecycle/cache facilities. Compare Serena's actual live-project behavior with the direct TS-LS path on the same fixtures, not just one definition response.
- [ ] A direct TS Language Service host is responsible for input versions and project updates; frozen snapshots are valid only when explicitly treated as frozen. Do not implement a second home-grown language-server lifecycle if an existing provider/client satisfies the contract.
- [ ] Keep ACE-specific code narrow: policy, source verification, evidence composition and approved archive semantics. Any extra watcher/coordinator/store must have a concrete unmet requirement, not be added by default.

**Exit:** a small implementation decision and test matrix, not a new framework. Serena is a candidate, not silently selected as production-approved. If accepted provider decisions change, use owner review/ADR as required.

### S1 — Worktree membership, index and byte freshness

- [ ] Track content changes AND added/deleted/renamed/untracked files, extension/policy scope and relevant generated/config files. Verifying only returned hits cannot establish that the current index covers newly added code.
- [ ] Use a maintained filesystem/provider notification mechanism with a defined synchronization barrier before query execution. Notifications are hints, not proof of completeness: handle startup catch-up, watcher overflow/disconnect and missed-event recovery using bounded reconciliation.
- [ ] Reuse AST/candidates/embeddings for unchanged source+provider identities; update affected entries and manifest membership. Do not reparse/re-embed the entire repository per request as the default fix.
- [ ] Bind query execution to a published index/coverage observation. Pending relevant updates or unknown watcher state must trigger catch-up or truthful partial/not-ready behavior, not a silently complete old index.
- [ ] Preserve final exact selected-source digest/range verification and lossless authorized expansion. Excluded secret files must remain excluded after edits and recovery.

**RED fixtures:** start ACE, then add the sole correct implementation; delete/rename a previous hit; edit during query; lose an event; recover after watcher failure; change policy scope. Assert the new candidate becomes reachable or the response explicitly identifies incomplete coverage. Fresh old hits must not conceal missing new files.

**Exit:** real long-lived MCP queries before/after changes, with exact source and membership identities. A restart-only test is not proof of live invalidation.

### S2 — Semantic dependency validity

- [ ] Maintain a provider-managed live project, or explicitly invalidate/rebuild the affected semantic snapshot. Do not retain script versions forever as `1` while claiming live semantics.
- [ ] Include dependencies and relevant tsconfig/project references/module-resolution settings, package manifests/lockfiles, declaration files and provider versions in the semantic validity policy. A selected file's digest alone is insufficient.
- [ ] Establish one consistent source view for AST, index and semantic provider; reject mixed generations. Semantic cache entries require an appropriate dependency/project version, not just symbol name/path.
- [ ] When dependency identity cannot be verified, keep exact code bytes usable but downgrade semantic certainty; never promote an uncertain relationship to verified semantic evidence.

**RED fixtures:** unchanged A imports modified B; changed re-export/alias/type; changed tsconfig resolution; dependency removed; same-name symbols, overloads, CRLF/BOM/astral Unicode. Compare warmed and fresh-provider results against the same oracle.

**Exit:** warm reuse produces the same valid semantic result as a fresh supported provider for these cases, or explicitly refuses current-semantic confirmation. Reuse is not required when its validity cannot be established.

### S3 — Explicit source obligations instead of hidden keyword routing

- [ ] Make required/optional/not-requested sources explicit in the request contract and expose the executed plan. Preserve compatibility of existing flags, but remove the hidden assumption that English keyword matching proves task intent.
- [ ] Prefer agent-selected code/docs/memory requests or explicit source sets. Existing routing may remain a transparent opt-in suggestion; do not fix quality by endlessly growing a multilingual substring list.
- [ ] Distinguish disabled-by-caller, policy-denied, no-match, unavailable, stale and uncovered. Missing required sources cannot become complete because optional hits exist.
- [ ] Provide a straightforward request/expansion path for omitted sources and originals. Native agent tools remain available; do not require ACE-only exploration or silently send forbidden data to a fallback destination.
- [ ] Do not add another routing LLM merely to replace a few keyword tests. Add complexity only if measured quality/usage justifies it.

**RED fixtures:** RU/EN/mixed/paraphrased requests for historical choices; architectural bug requiring code+docs; keyword distractors; explicit opt-outs; required provider outage. Assert actual provider call sets and structured coverage, not only planner labels.

**Exit:** caller can state obligations unambiguously, and `complete` refers to those obligations. Claims of autonomous intent coverage require separate held-out routing evidence.

### S4 — Memory: provenance is not current truth

- [ ] Preserve original bytes/digest/time/pointer separately from derived fact validity and owner approval. Add explicit evidence labels rather than using archive integrity as `current` claim validity.
- [ ] For ordinary current-state queries, validate facts at the effective query time; for historical queries, use explicit valid-time `as_of`. Preserve invalidation/supersession and uncertainty in returned hits/bundles.
- [ ] Use supported upstream temporal filtering/pagination where available. Post-filtering only the current top 50 cannot establish historical recall completeness; report limits or use a supported retrieval path that satisfies the declared historical scope.
- [ ] Join validated decision history into the actual Graphiti-backed MCP path. Empty decision/conflict annotations must not masquerade as proof that no decisions/conflicts exist.
- [ ] Fix F-01 error-first MCP parsing: an error-bearing empty result is not successful search or proof of deletion.
- [ ] Fix F-02/F-03: durable projection/deletion intent, discover archived admitted episodes without receipt, fencing/CAS against concurrent projector, and terminal tombstone protection. Prefer supported storage/transaction primitives; atomic rename of one receipt is not a distributed transaction.

**RED fixtures:** current query returns a superseded fact; historical pre/post-confirmation state; multiple decisions per episode; later imports; error+empty facts/episodes; kill after archive persist but before outbox.begin; concurrent reconcile after purge; stale writer attempts to overwrite tombstoned. Verify originals survive unverified deletion and derived facts do not resurrect.

**Scope:** P for full memory, B only if memory is enabled in the measured workload. Do not enable unverified memory silently in a code-only experiment.

### S5 — Snapshot ownership and evidence validity

- [ ] Close F-04: synchronize acquire/close/GC; no recursive removal based on stale emptiness; fail closed on filesystem uncertainty. Preserve state-owner isolation and conservative PID behavior.
- [ ] Test new lease between inspection/deletion, same-snapshot writers, crash mid-upsert and before publication. Existing two-root crash evidence with shared GC disabled proves a narrower scenario, not active-GC safety.
- [ ] Fix F-05: runtime schemas, structured measured/estimated/unknown cost components, finite valid counters, source verdict and matched execution model/task/config identities. Free-form costScope text cannot establish complete telemetry.
- [ ] Retain F-06/F-07/F-11 release work: semantic evidence validation, raw-byte hashing for text/JSONL/binary DBC artifacts, exact scope/config binding and a protected approval trust root.

**Exit:** negative input cannot yield false acceptance, failed required work cannot yield complete, and concurrent reuse cannot lose its protection. No new generic evidence platform is required.

## 4. Execution order and benchmark matrix

1. Freeze a baseline commit and add deterministic S1/S2/S3 safety fixtures; choose the smallest upstream-backed integration in S0. Reconfirm defects before modifying source.
2. Fix F-05 before trusting automated acceptance. Raw diagnostic trials can run earlier with explicit limitations.
3. For a trustworthy code-only dirty-tree/reuse result, pass applicable S1/S2/S3/S5 scenarios first. Exclude memory/docs explicitly; do not wait for Graphiti/Vertex/k3s/full release.
4. Run native vs ACE optional-natural on the existing 3x3 smoke; forced ACE remains diagnostic. Use native Harbor Codex auth.json support, not Amplifier. Pin identical model/reasoning/task commits/instructions/budgets across matched arms; preserve failures.
5. Freeze a multi-repository holdout and predeclare quality acceptance before inspecting results. Include fresh sessions, persistent warm sessions, dependency edits, file membership changes, same-name/behavior queries and recovery.
6. Benchmark the relevant ready-made alternative (Codex+Serena) on matched fixtures; compare read-only retrieval separately from extra editing/refactoring capabilities. This comparison informs architecture/provider selection; it does not block the first native-vs-ACE smoke.
7. In parallel finish S4 with the selected Qwen3:14b local Graphiti path, then full-unified provider/deployment/recovery evidence.
8. Freeze a release candidate and run exact-commit DBC/runtime/resources/supply-chain gates and scoped owner review.

### What to measure

Primary: accepted task outcome, hidden functional/regression checks, critical constraint retention and final patch correctness. Predeclare a justified non-inferiority policy and repeat stochastic trials; a tiny all-green smoke is not a universal quality guarantee. Quality is checked before claiming economic improvement; a regression is reported even when tokens fall.

Economics: total/cached/uncached input and output, online model calls, repeated native reads, reused/recomputed local operations, useful evidence consumed, expansion frequency, startup versus steady-state latency, RSS and measured or explicitly unknown local infrastructure cost. Do not count reduced AST/embedding compute as automatically reduced cloud input tokens.

For local reuse, compare cold and warm behavior against a fresh-result oracle. Log safe full snapshot/provider/config identities and selected source digests, without query/source/secrets in trace metadata. The existing `snapshot_identity` log field is a provider fingerprint; do not treat its stability across edits as proof of a stale index. Use distinct provider identity and content index_key fields.

Deliverable per change: failing fixture/oracle, implementation or upstream config change, compatibility notes, relevant OpenSpec delta, exact tested commit, deterministic/real-provider results and blockers. Reuse existing runners; do not build another benchmark orchestrator.

## 5. Preserve the existing upstream and owner decisions

### Graphiti

Qwen3:14b remains the selected first experimental local-only extractor on 64 GB RAM. Use a mature Graphiti-supported OpenAI-compatible local serving runtime; no discrete-GPU assumption. Ollama is permitted experimentally but is not a required/default ACE dependency. Configure upstream OpenAIGenericClient, supported local embedding endpoint and upstream local BGE reranker; do not implement an ACE-specific inference stack or copy a custom SentenceTransformers factory to work around upstream documentation drift.

Pin Graphiti and all model/artifact/runtime/quantization/structured-output identities. Verify the selected revision's actual factories: upstream README support and implementation have previously disagreed (issue #1556). Run frozen extraction/recall/structured-output/temporal tests on RU/EN/mixed episodes; record false facts, schema failures, latency and peak RSS. If accurate but slow, use asynchronous background projection rather than weakening quality. Only if this selected candidate fails the correctness gate should alternatives be considered. Amplifier/cloud-memory Plan B requires the owner's explicit reopening and data authorization.

### Vertex and k3s

Retain the owner-authorized Europe corpus and narrow synthetic/public scope. Supply permitted GCS prefix/IAM, execute existing synthetic import and citation-conflict runners, retain provider evidence; private code/dialogue upload is not implicitly authorized.

Use existing Kubernetes NetworkPolicy, mTLS helper and deployment. Add site-specific necessary egress, verify policy enforcement and execute K3S-01…10. Do not invent a firewall controller/service mesh or require k3s production containment for a Docker efficacy experiment.

### Release and authentication

Harbor uses native Codex authentication (`CODEX_AUTH_JSON_PATH` / supported auth-file mechanism). Confirm flags against the pinned Harbor version; never log/commit credentials. If the currently pinned model is unavailable, choose one available exact ID for every matched arm, not a dynamic catalog per trial. Amplifier is not on the normal benchmark path.

Production embedding/semantic approval remains separate from experimental use. Run matched Serena/direct-provider comparison or explicitly revise the accepted decision; do not silently approve an already-implemented provider.

Use standard BuildKit/buildx or Syft SBOM/provenance, Cosign/Sigstore signatures, standard OS/k8s resource measurement and existing ACE validators. Review embedding artifacts staged outside the OCI image separately: image SBOM does not establish model license/provenance. Final approval references exact release commit, capabilities and retained evidence.

## 6. Existing findings and scope mapping

Historical F-01…F-12 are retained as review findings, not declared newly reproduced or fixed by this document:

| Finding | Work package / scope |
|---|---|
| F-01 MCP error handling | S4; full memory correctness |
| F-02 delete/reconcile resurrection | S4; full memory correctness |
| F-03 archive/intent crash gap | S4; full memory recovery |
| F-04 lease/cleanup races | S5; code reuse where concurrency/GC is exercised |
| F-05 Harbor cost/acceptance oracle | S5; B for automated benchmark acceptance |
| F-06 release evidence depth | S5/release; P |
| F-07 JSON-only DBC artifact loader | S5/release; P |
| F-08 temporal runtime truth | S4; P or B if memory is measured |
| F-09 English-centric routing | S3; explicit obligations preferred over more keyword rules |
| F-10 startup/readiness drift | align implementation/runbook/tests; distinguish identity failure from transient outage |
| F-11 approval trust root | release governance; P |
| F-12 stale plans | reconcile current status and historical evidence; no retroactive invention of PASS |

S1/S2 additionally address live membership and semantic dependency invalidation; these are not satisfied merely by checking selected source digests. Do not inflate this list into a new framework or infer production incidents from static review alone.

## 7. Stop-fixing-forever rule and Definition of Done

Classify work by scope:
- **B:** invalidates the measured native-vs-ACE comparison or quality/reuse claim in the selected workload.
- **P:** blocks the accepted production capability/deployment, not raw exploratory experiments.
- **D:** optional frameworks, broader languages/HA/observability or unmeasured convenience.

The update does not move full memory/docs/k3s/signing into B for a code-only benchmark. It does move applicable stale-index/dependency/source-obligation hazards into the quality gate for a benchmark that claims safe warm/dirty reuse. A frozen read-only smoke may run while those hazards are explicitly excluded and reported as limitations.

Safe-reuse acceptance requires: declared scope/version, verified applicable identities, observable invalidation/recovery, lossless authorized expansion, honest uncertainty/coverage, and regression fixtures demonstrating no wrong-current reuse in the tested cases. This is evidence within a scope, not a universal no-bugs guarantee.

Full production still needs the applicable DBC-01…14, provider selections, Graphiti/Vertex/k3s/recovery, resource/license evidence and owner sign-off. Existing historical DBC checkboxes are not modified by this plan. No new DBC IDs and no 5x prerequisite are introduced.

## Upstream references retained for implementation verification

- https://github.com/harbor-framework/harbor/blob/main/src/harbor/agents/installed/codex.py
- https://github.com/microsoft/amplifier-module-provider-openai-chatgpt
- https://github.com/getzep/graphiti/blob/main/mcp_server/src/services/factories.py
- https://github.com/getzep/graphiti/blob/main/mcp_server/README.md
- https://github.com/getzep/graphiti/issues/1556
- https://docs.k3s.io/networking/networking-services
- https://kubernetes.io/docs/concepts/services-networking/network-policies/
- https://docs.docker.com/build/metadata/attestations/sbom/
- https://github.com/anchore/syft
- https://docs.sigstore.dev/quickstart/quickstart-cosign/
- https://github.com/oraios/serena
- https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API
- https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
