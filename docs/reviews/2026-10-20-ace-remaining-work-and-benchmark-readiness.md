# ACE remaining work and benchmark-readiness audit

**Date:** 2026-10-20  
**Reviewed main:** `024987da4f4c7be4641d5faf897f58dc18ce5610`  
**Prior gap review:** [2026-10-20-unified-ace-production-gap-review.md](../plans/2026-10-20-unified-ace-production-gap-review.md)  
**Purpose:** separate work required to measure ACE efficacy from work required for a full-unified production release, remove accidental critical-path items, and prefer supported upstream solutions over new in-repository infrastructure.

## Executive conclusion

The project is much closer to an **honest token-efficiency experiment** than to a full production release, and those two milestones must no longer be treated as the same finish line.

A natural-use code-retrieval benchmark does **not** need Graphiti, Vertex, k3s production containment, SBOM/signing, final provider owner approval, or Amplifier. The existing Harbor suite already contains a native arm, an optional-natural ACE arm with no forced-use instruction, and a forced-use diagnostic arm. The natural arm has simply not yet produced retained acceptance evidence.

Before trusting an automated natural-use benchmark verdict, fix the remaining Harbor acceptance/cost oracle weakness from F-05. Authentication should use Harbor's existing Codex `auth.json` support; adding Amplifier only for OAuth/device login or model discovery would add an unnecessary provider/runtime to the benchmark.

Therefore there are now **two explicit finish lines**:

1. **Benchmark-ready:** fix F-05, use native Codex authentication, run native vs optional-natural ACE on the pinned configuration, then run a frozen multi-repository holdout before making a general savings claim.
2. **Full-unified production-ready:** finish the memory correctness/provider work, real Vertex and k3s evidence, provider selections, release-integrity issues, exact-release DBC evidence, supply-chain/resource gates and final owner sign-off.

The historical forced-use Harbor result remains negative and honest: native used 891,950 raw tokens versus 1,571,768 for forced ACE, i.e. native/ACE = 0.567482x. It does **not** answer whether an unprompted Codex agent will naturally use ACE and save tokens.

## What changed since the prior production-gap review

The prior review was based on `560c49b043ef73b6ee08ceaf55b170ff780e4718`. Current main is 18 commits ahead, but the compare contains only documentation/test-execution changes: AGENTS/test policy, affected-test selection, CI/test scripts, and the gap review itself. There are **no `src/` product-code changes in that delta**.

Consequently the product-code findings F-01…F-11 below have not been silently fixed after that review. F-12 remains applicable because several old plans still describe superseded runtime state.

## 1. Disposition of the seven newly reported “remaining” items

| Reported item | Needed for token benchmark? | Needed for full production? | Disposition |
| --- | --- | --- | --- |
| owner approval for embedding + semantic provider | **No** for exploratory/natural efficacy benchmark | **Yes** | Keep as release/provider-selection gate, after evidence. Do not block the first natural-use run. |
| Amplifier OAuth device login + live model catalog | **No** | **No**, absent a separate product decision to support Amplifier | Remove from ACE critical path. Harbor already supports native Codex auth; benchmark models should be pinned, not discovered dynamically. |
| supported upstream local Graphiti embedder/reranker | No for code-only token benchmark | **Yes** for full local-first memory | Use upstream Graphiti facilities/configuration. Do not build an ACE-specific embedding/reranking stack for Graphiti. |
| Vertex synthetic import/citation authorization | No for code-only token benchmark | **Yes** for docs/DBC-14 | The narrow synthetic/public scope and Europe corpus are already authorized in the accepted execution plan; remaining work is the real import/retrieval evidence under actual IAM/GCS, not a new architecture project. |
| k3s network containment | No for Docker Harbor efficacy benchmark | **Yes** for the accepted production deployment | Mostly already implemented with standard Kubernetes NetworkPolicy; remaining work is environment-specific allow rules plus real K3S-01…10 evidence. Do not build a custom network-policy system. |
| natural-use Harbor OAuth run | **Yes: this is the key missing efficacy experiment** | DBC-12 also needs it | Keep the natural-use run, remove “Amplifier OAuth” from it. Use native Codex auth.json support. |
| resource budgets, image provenance/license review, owner sign-off | No for efficacy benchmark | **Yes** for release | Keep as release gates, but use standard BuildKit/Syft/Cosign/SBOM tooling and the existing ACE validators rather than building scanners/signers. |

### 1.1 Embedding and semantic owner approval

This is a real production requirement under the current ADR/OpenSpec governance, but it is **not a prerequisite to measure efficacy**.

Embedding already has a genuine maintained-library comparison: FastEmbed/ONNX vs Sentence-Transformers/PyTorch on the same multilingual model. FastEmbed currently wins the deterministic experimental selection while matching recall. What remains before production approval is the larger frozen multi-repository holdout, selected-host/resource evidence, license/model-artifact review and owner decision.

Semantic evidence is further along for direct TypeScript Language Service: the retained follow-up reports 9/9 oracle cases, a real same-name gate, cold/warm latency and RSS. However the accepted plan/ADR still requires a matched Serena-vs-direct comparison before production selection. Either run that comparison, or explicitly revise the accepted decision; do not silently skip it and call TypeScript LS approved.

For the next Harbor efficacy run, use the **current pinned experimental FastEmbed + direct TS-LS configuration** and label it as an experimental benchmark configuration. No owner production approval is required to learn whether that configuration saves tokens.

### 1.2 Amplifier OAuth device login and live model catalog — remove from critical path

No accepted ACE ADR, OpenSpec task, current source path or release-preflight requirement names Amplifier. It appears to be a newly introduced suggestion, not a repository requirement.

Harbor's current Codex agent directly resolves `CODEX_AUTH_JSON_PATH` / `CODEX_FORCE_AUTH_JSON` and defaults to `~/.codex/auth.json`. The benchmark can therefore use the ordinary Codex login/auth file without adding another agent framework/provider.

Amplifier's ChatGPT provider does implement device-code OAuth and a dynamic live model catalog. Those are useful **inside Amplifier**, but ACE's benchmark does not need Amplifier merely to obtain those features.

A live model catalog is also undesirable for a reproducible benchmark. ADR-009 requires the same pinned model/reasoning/configuration across arms. The existing Harbor jobs already pin `gpt-5.6-luna` with `reasoning_effort=high`. If that model is unavailable in the authenticated Codex account, select another currently available exact model and pin the **same ID** in every arm; do not dynamically switch models between trials.

Upstream references:
- Harbor Codex auth handling: https://github.com/harbor-framework/harbor/blob/main/src/harbor/agents/installed/codex.py
- Amplifier ChatGPT provider: https://github.com/microsoft/amplifier-module-provider-openai-chatgpt

**Decision:** do not add Amplifier to ACE or to the Harbor critical path unless there is a separate owner-approved goal to benchmark/support Amplifier itself.

### 1.3 Graphiti local inference — integrate upstream, do not recreate it

Full local-first memory does require a real LLM + embedding + reranking path, but ACE should configure Graphiti rather than implement Graphiti's inference stack.

Current upstream Graphiti already provides:
- `OpenAIGenericClient` / OpenAI-compatible local LLM endpoint support;
- configurable OpenAI-compatible embeddings through the upstream `OpenAIEmbedder`;
- a local `BGERerankerClient` fallback through `CrossEncoderFactory`;
- FalkorDB;
- the MCP tools ACE already consumes.

There is one upstream caveat worth preserving rather than “fixing” locally: the current Graphiti MCP README advertises `sentence_transformers` as a local embedder, while the current `EmbedderFactory` fetched from upstream main does not contain a `sentence_transformers` case. Upstream issue #1556 also calls out that local example inconsistency. Therefore do **not** copy a custom SentenceTransformers factory into ACE just to make that README example work.

Preferred integration:
1. pin a known Graphiti upstream revision/release;
2. use its `OpenAIGenericClient` against a loopback OpenAI-compatible local LLM;
3. use its upstream OpenAI-compatible embedder against a supported local embedding endpoint;
4. use Graphiti's upstream local BGE reranker;
5. retain exact model/revision/runtime identities in the Graphiti lifecycle evidence.

If a future upstream release fixes the advertised SentenceTransformers provider, switch by configuration. Until then, keep the workaround outside ACE domain logic.

Upstream references:
- https://github.com/getzep/graphiti/blob/main/mcp_server/src/services/factories.py
- https://github.com/getzep/graphiti/blob/main/mcp_server/README.md
- https://github.com/getzep/graphiti/issues/1556

### 1.4 Vertex synthetic import/citation

This remains required for the full documentation capability and DBC-14, but much of the work is already implemented.

The repository already contains:
- a hard-scoped synthetic fixture importer;
- explicit import/retrieval ACK variables;
- reuse of the authorized Europe corpus;
- long-running import polling;
- retained hashes;
- real retrieval/citation conflict gate against exact current-code bytes.

The accepted execution plan already authorizes the Europe test corpus and permits synthetic/public fixture work within the stated test scope. Do not invent a new generic upload service or request broad authorization for private data.

Remaining work is operational:
- provide the actual permitted GCS synthetic prefix and IAM;
- run `npm run vertex:import-synthetic`;
- run `npm run test:real-vertex-conflict`;
- retain citation/request/provider-trace evidence;
- record quota/cost/limitations.

Private code and sessions remain out of scope.

### 1.5 k3s network containment

The project has **already used the ready solution**: standard Kubernetes `NetworkPolicy`.

`infra/k8s/ace-local/ace-mcp.yaml` currently isolates the ACE pod for ingress/egress and permits only DNS plus Qdrant/FalkorDB ports in the `ace` namespace. K3s includes its own network-policy controller, so no custom firewall controller, service mesh or policy engine is needed for this requirement.

Remaining work:
- add an environment-specific allow rule for the actual host worktree helper IP/CIDR + TLS port;
- when Vertex/full Graphiti topology is enabled, add narrowly scoped required egress rather than generic `0.0.0.0/0:443`;
- execute K3S-01…10 and retain the negative-reachability evidence;
- verify the cluster has not been started with network policy disabled.

This is an evidence/environment closure item, not a new networking subsystem.

### 1.6 Natural-use Harbor run

This is the item that should now move to the front.

The repository already has three separate job definitions:
- native Codex baseline;
- ACE **optional natural** with `extra_instructions: []`;
- forced ACE diagnostic.

The natural arm is correctly distinct from the forced arm. It should use the ordinary Harbor Codex auth-file path, not Amplifier.

However, F-05 below must be fixed before the automated Harbor acceptance result is treated as authoritative. Raw trial/token data can still be collected earlier, but a malformed/partial cost record must not be allowed to pass “complete cost telemetry”.

For a first useful smoke measurement, the existing 3×3 set can answer: **does Codex naturally call ACE, does quality regress, and what happens to raw token usage?** A general/publishable savings claim still needs the independent frozen multi-repository holdout required by ADR-009.

### 1.7 Resource budgets, provenance, licenses and owner sign-off

These are full-release requirements, not efficacy-experiment prerequisites.

The current ACE code is not reinventing SBOM/signing: `release:supply-chain` is a **validator/binder**. It expects an SPDX/CycloneDX SBOM, image/base digests, signature verification and license review; it does not pretend to generate or sign them.

Use standard tooling for the actual artifacts:
- Docker BuildKit/buildx SBOM + provenance attestations, or Syft for SPDX/CycloneDX;
- Cosign/Sigstore for image signature/verification;
- the existing ACE `release:supply-chain` command only to bind the resulting artifacts to the exact release commit.

One gap to keep explicit: the FastEmbed model is staged into a model cache/PVC rather than necessarily baked into the OCI image. An image SBOM alone therefore does not prove the downloaded model artifact's license/provenance. The final license review should separately record the selected embedding model/artifact identity and license source.

Resource budgets are product-specific and the existing `evidence:resource-budget` validator is appropriate. Do not build a new profiler/observability platform: collect the required RSS/startup/index/query samples with standard OS/k8s measurement tools and feed them into the existing gate.

## 2. Status of prior gap-review findings F-01…F-12

Because current main contains no product-code changes since the prior review base, the following source findings remain materially current.

| Finding | Current status | What remains |
| --- | --- | --- |
| **F-01 Graphiti MCP error semantics** | **OPEN / P1** | `replyJsonObject()` still consumes structured/text JSON before checking `isError`. Make `isError` fail first; add RED cases for error+empty facts/episodes. |
| **F-02 delete/reconcile resurrection race** | **OPEN / P1** | Current delete still purge → verify absent → archive delete, with no durable delete intent/version fence/CAS against a concurrent reconciler. |
| **F-03 archive → projection-intent crash gap** | **OPEN / P1** | `memory-import.ts` still archives all originals before creating outbox intent. A crash in that window leaves an admitted original that reconciliation cannot discover. |
| **F-04 Qdrant lease acquire vs cleanup race** | **OPEN, narrowed / P1** | State-owner isolation and conservative PID handling improved scope, but `readdir(...).catch(()=>[])` + recursive directory removal can still race a new lease and can misclassify EACCES/EIO as empty. |
| **F-05 Harbor complete-cost/acceptance oracle** | **OPEN / P1 — benchmark blocker** | `costTelemetryComplete` still derives truth from a free-form `costScope` regex and can accept arbitrary strings while numeric cost is null. Add runtime schema and structured measured/estimated/unknown components. |
| **F-06 release-validation depth** | **PARTIALLY IMPROVED, still open / P1** | External/runtime evidence validation improved, but embedding/semantic/retrieval/Harbor nested verdicts remain more trusted than independently re-evaluated. Bind primary reports/artifacts/config identity. |
| **F-07 DBC artifacts forced through JSON parser** | **OPEN / P2** | Release CLI still JSON-parses DBC artifact files before hashing. Hash raw bytes and parse only artifacts whose contract is structured JSON; JSONL/text evidence must remain valid. |
| **F-08 Graphiti MCP temporal decision truth** | **OPEN / P1** | Pure domain decision history improved, but Graphiti-backed MCP search still returns empty `decisionStates`/`conflicts`, uses a fixed `max_facts: 50`, and performs local as-of filtering after top-N retrieval. |
| **F-09 deterministic routing is English-centric** | **OPEN / P1** | Russian/mixed queries can still miss docs/memory because keyword rules remain English. Add RU/EN/mixed/paraphrase routing fixtures and measure misses/overfetch. |
| **F-10 readiness docs vs startup behavior** | **OPEN / P1** | Readiness matrix says embedding preflight failure is fatal; runtime and test explicitly keep MCP alive and report `not_ready`. Define separate policy for identity mismatch vs temporary provider outage and align code/docs/tests. |
| **F-11 owner-approval trust root** | **OPEN governance / P2** | Full preflight validates approval fields but not who authored the approval. Define protected PR/commit/signed attestation as the trust root. This does not block efficacy benchmarking. |
| **F-12 stale plans** | **OPEN / P2** | Older unified/execution plans still contain statements superseded by current Graphiti wiring, deterministic routing and worktree-helper implementation. Update status/delta docs without rewriting historical evidence. |

### F-04 detail

The current lease implementation is safer than the earliest version: it has persistent state-owner identity, conservative cross-namespace PID handling and explicit local-process reaping. That does **not** close the specific race:

1. cleaner sees an empty lease directory;
2. a concurrent reader writes a new lease;
3. cleaner recursively removes the directory from its stale observation.

The same code still converts any `readdir(directory)` failure to `[]` in some paths. Fix the exact race/fail-closed semantics rather than replacing the whole Qdrant snapshot subsystem.

## 3. Remaining work, compressed into a finite critical path

### A. Benchmark-ready — do this first

These items are sufficient to obtain a meaningful first answer about ACE token economics for the current code-retrieval configuration.

1. **Fix F-05 Harbor report validation.**
   - runtime-validate input report shape;
   - replace free-form “cost complete” string inference with structured per-component status;
   - require matched model/reasoning/task/config identities;
   - keep `unknown` honest rather than converting it to zero/pass.

2. **Use native Codex authentication directly in Harbor.**
   - authenticate Codex normally;
   - pass/mount `CODEX_AUTH_JSON_PATH` as supported by Harbor;
   - pin one exact Codex model + reasoning effort in native/natural/forced jobs;
   - do not add Amplifier or a dynamic model catalog.

3. **Run existing native vs optional-natural ACE 3×3 as a smoke benchmark.**
   - same task text, model, reasoning, commits, time budget;
   - no ACE-forcing prompt in the natural arm;
   - retain raw Harbor/Codex events and ACE/provider correlation;
   - report how many natural trials called ACE at all;
   - quality gate first, then token/cost ratio.

4. **Freeze and run the larger multi-repository holdout before a general savings claim.**
   - behavior-not-name;
   - same-name symbols;
   - cross-file changes;
   - dirty tree/warm index;
   - RU/EN if multilingual behavior is claimed;
   - no tuning after holdout inspection.

**Important:** embedding/semantic owner approval, Graphiti, Vertex, k3s and supply-chain signing do not belong before step 3. They are production gates, not prerequisites to learn whether ACE helps Codex.

### B. Production code correctness

Finish these before full production promotion:

1. F-01 Graphiti error-first parsing.
2. F-02 durable delete intent/fencing against reconcile resurrection.
3. F-03 archive/projection-intent crash recovery.
4. F-04 lease-acquire/cleanup synchronization and fail-closed filesystem errors.
5. F-08 bind Graphiti facts to real decision timelines/conflicts/as-of semantics.
6. F-09 multilingual/obligation-aware routing if RU/mixed-language input remains in supported scope.
7. F-10 settle startup/readiness policy and align tests/docs.

These are bounded defects. They should not expand into new provider frameworks.

### C. Real provider/deployment evidence

1. **Embedding selection:** larger frozen multi-repo comparison + model/license/target-host evidence → owner approval.
2. **Semantic selection:** matched Serena vs direct TypeScript LS on the same fixture/oracle → owner approval or explicit ADR revision.
3. **Retrieval quality:** frozen lexical/dense/hybrid ablation and patch-quality behavior.
4. **Graphiti:** run upstream local inference + FalkorDB lifecycle, real crash/reconcile/purge, backup/restore and local-egress proof. Configure upstream components; do not create an ACE inference stack.
5. **Vertex:** execute the already-implemented synthetic import/citation conflict run.
6. **k3s:** add site-specific helper/optional cloud egress rules and execute K3S-01…10.
7. **W12:** mixed-provider security/failure/race matrix using the selected real providers.

### D. Release-integrity and operations

1. F-06 bind/re-evaluate provider-selection/retrieval/Harbor evidence rather than trusting loose nested booleans.
2. F-07 raw-byte DBC artifact hashing.
3. F-11 define an approval trust root.
4. F-12 refresh stale plan status.
5. Generate exact-release resource-budget evidence.
6. Generate standard SBOM/provenance/signature evidence and model-license review; validate it with the existing ACE gate.
7. Run exact-release DBC-01…14 and full release preflight.
8. One final owner sign-off should reference the exact release commit and retained provider/resource/license evidence.

## 4. DBC view

Current OpenSpec still has seven checked and seven open DBCs:

- checked: DBC-02, 05, 06, 07, 08, 09, 10;
- open: DBC-01, 03, 04, 11, 12, 13, 14.

The open set maps cleanly to the finite work above:

- **DBC-01:** approved embedding + semantic composition;
- **DBC-03:** larger retrieval behavior holdout;
- **DBC-04:** matched semantic-provider selection;
- **DBC-11:** real safe Graphiti delete/crash consistency;
- **DBC-12:** natural-use Harbor attribution/cost;
- **DBC-13:** target-provider persistence/concurrency/performance evidence;
- **DBC-14:** real Vertex cited conflict with current source.

Do not require all seven open DBCs merely to run the DBC-12 experiment. DBC-12 can be measured while other production gates remain open; it simply cannot be called a full release.

## 5. Recommended “stop fixing forever” rule

From this point, every new proposed task should be classified before implementation:

- **B — benchmark blocker:** can make native-vs-natural ACE token/quality measurement invalid.
- **P — production blocker:** required by an accepted ADR/OpenSpec/release contract, but does not invalidate the efficacy experiment.
- **D — deferred/non-blocker:** nice-to-have, alternative framework, future scope, or tooling replacement.

No new item enters the benchmark critical path unless it can explain **how it would invalidate the measured native-vs-natural result**.

Using that rule:
- F-05 and actual natural Harbor execution are B.
- Amplifier is D.
- Graphiti/Vertex/k3s/supply-chain are P.
- final owner sign-off is P.
- 5× is a result to measure, not a prerequisite.

This prevents the project from recursively making “production completeness” a prerequisite for discovering whether the product idea is economically worthwhile.

## 6. When can we finally test token savings?

**Preliminary honest answer:** essentially now, after direct Harbor/Codex auth is available. The existing optional-natural job is already shaped correctly. Raw natural-use token data can be collected even before F-05 is fixed, as long as we do not trust the current automated “complete cost” verdict.

**Benchmark result worth relying on:** after F-05 is fixed, run the existing native + optional-natural smoke, then freeze/run the larger multi-repository holdout. That is the point at which we can say whether the current ACE code-retrieval configuration actually saves agent tokens without degrading task quality.

**Full-unified production release:** later and separately, after the P-class memory/docs/k3s/provider/release gates above.

The key change is therefore not another technical subsystem. It is to **stop waiting for production closure before running the product-efficacy experiment**.

## External upstream notes used for the no-bicycle audit

- Harbor Codex auth-file support: https://github.com/harbor-framework/harbor/blob/main/src/harbor/agents/installed/codex.py
- Amplifier ChatGPT provider (device OAuth + live catalog): https://github.com/microsoft/amplifier-module-provider-openai-chatgpt
- Graphiti MCP factories: https://github.com/getzep/graphiti/blob/main/mcp_server/src/services/factories.py
- Graphiti MCP docs: https://github.com/getzep/graphiti/blob/main/mcp_server/README.md
- Graphiti local embedder-doc mismatch issue: https://github.com/getzep/graphiti/issues/1556
- K3s network policy controller: https://docs.k3s.io/networking/networking-services
- Kubernetes NetworkPolicy: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- Docker BuildKit SBOM attestations: https://docs.docker.com/build/metadata/attestations/sbom/
- Syft: https://github.com/anchore/syft
- Cosign/Sigstore: https://docs.sigstore.dev/quickstart/quickstart-cosign/
