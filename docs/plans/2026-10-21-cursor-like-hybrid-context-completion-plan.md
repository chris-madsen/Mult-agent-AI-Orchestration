> **Current implementation and evidence — 2026-10-21:** reviewed `main@2fe96a88968fb393dd57cf3771d08efbcfa251fa` after merged PRs #123–#134. The earlier [review](../reviews/2026-10-21-hybrid-context-static-code-review.md) findings on byte metrics, changed-bundle receipts and trace durability have implementation/contract fixes in #124–#127. PRs #130–#133 provide H6 probe/runner/reranker/Harbor tooling, **not** a scored five-strategy acceptance or real four-arm Harbor result. The [new post-merge source review](../reviews/2026-10-21-h6-postmerge-source-review.md) identifies evidence-binding and unknown-as-zero risks. Private external evidence is pinned to the ledger's historical ACE/Chess revisions; current code tip is **not automatically evidence for those revisions**. Holdout v3 is frozen; the six evaluated rerankers remain rejected and Harbor execution remains blocked. Production/5× unapproved.

# ACE Cursor-like hybrid context completion plan

**Date:** 2026-10-21
**Baseline:** `main@d366f4a19a413cb934da9278ee8315bfbe73677a`
**Owner goal:** adopt the **architectural principles** of Cursor's multi-layer code context system while choosing ACE's own maintained components and keeping the product agent-neutral behind MCP.

## Single active H6 next-step queue — after merged PRs #123–#134

**Authority:** Accepted ADR-014, OpenSpec 007, [post-merge code review](../reviews/2026-10-21-h6-postmerge-source-review.md) and [H6 external-evidence ledger](../reviews/2026-10-21-h6-evidence-after-pr-133.md). Earlier PR A/B/C work is **implemented** (#124–#127); do not open a second reimplementation queue. H6 evidence and exact release approval remain separate from code existence. The steps below are small PRs targeting `main`, with no new subsystem or local-vs-cloud architecture reversal.

1. **PR E — runner source/runtime integrity (P1, H6-CR-01).** Add deterministic mismatch cases to `test/retrieval-benchmark-runner.contracts.test.ts` or one dedicated integration test: dirty pinned checkout, untracked relevant source, stale compiled `dist`, wrong runtime commit/build digest, plus clean positive control. Reject before `ace_context`. Pin effective executable digest, exact source manifests and provider identities in the run receipt. **Pass:** same HEAD with different effective code can never produce an acceptable scored run.
2. **PR F — reranker measurement truth (P1, H6-CR-02).** Add RED frozen-fixture cases in `test/reranker-evaluation.contracts.test.ts`: missing payload with tied quality, measured baseline vs missing candidate, and valid measured wins. Require actual like-for-like delivery bytes or record `unknown` and forbid compactness selection. Do not refreeze existing holdouts or approve previously rejected models. **Pass:** omitted payload is never interpreted as zero economic cost.
3. **PR G — Harbor task/config byte binding (P1, H6-CR-03).** Test wrong declared SHA vs actual task bytes, changed task files, swapped/missing TOML configs, differing repository checkout revisions, and changed container/model/runtime identities. Freeze hashes of effective task and Codex config bytes; validate again in actual run and gate inputs, verify observed quality/usage/trace artifacts (not report booleans alone). **Pass:** Harbor report cannot claim comparison from unverified task/config/runtime bytes.
4. **PR H — instrumentation and exact-range hygiene (P2, H6-CR-04/05).** Remove the unconditional fake-zero `nativeReadDuplicates`, add real source-read telemetry or `unknown` with a fail-closed quality gate. Replace JS-string index extraction in reranker fixture freezer with tested exact UTF-8 byte spans (Cyrillic/emoji/CRLF). **Pass:** missing metrics cannot satisfy thresholds; range source digests and extracted bytes match.
5. **H6 real-provider acceptance — only after applicable E/F/G/H gates.** Keep v3 external holdout and its labels immutable; verify *matching* runtime/source manifests, model IDs and trace terminal receipts. Run sparse, dense, hybrid RRF, hybrid+rerank and hybrid+rerank+working-context as frozen external ablations. Apply strict dense-only critical Recall@5/MRR/nDCG non-inferiority; separate rank quality, latency and measured byte/token economics. An `unavailable` stage is not a pass. If the evaluated rerankers still regress, keep reranking disabled.
6. **Harbor four-arm natural-use acceptance.** Provision Codex/OAuth, Docker and required WSL/Linux providers. Run native/dense/hybrid/hybrid+delta on the existing external tasks with real MCP call telemetry, re-used receipt identities, per-trial task-success, raw usage, latency, failure/timeout logs and full measured/unknown costs. Record all failures; no forced agent calls and no 5× assertion unless accepted task quality and **total** token economics pass.
7. **Independent release blockers.** Complete real local Graphiti lifecycle with Qwen3:14b if approved, Vertex synthetic docs citation/conflict DBC-14 with data-class opt-in, k3s host-worktree/PVC/backup/crash evidence, provider and license approvals, resource/supply-chain evidence, all required DBCs and owner-signed exact-commit release preflight.

**Workflow and evidence policy:** obtain deterministic RED evidence first (or label `static-unconfirmed`), run `npm run test:affected` for iteration and `npm run verify:pr` once for handoff; perform real-provider/MCP/Harbor suites when their changed acceptance contract requires it. Do not rewrite historical review/holdout artifacts; if a new frozen cohort is genuinely necessary, give it a new version with a separate independent holdout. `NOT_RUN`, `BLOCKED` and `unknown` must never be relabeled `PASS`.

## Codex OpenSpec OPSX Skills integration and use — dedicated tooling/docs PR

**Purpose:** install and actually use the [official Fission-AI/OpenSpec OPSX Codex skills](https://github.com/Fission-AI/OpenSpec) for the *existing* ACE spec-driven workflow, not invent a second spec framework or a new ACE agent orchestration layer. This is an **implementation task for Codex**, not evidence that skills are already installed. Run it as one narrow tooling/migration PR **before** using the workflow for the H6 follow-up PR E–H above. Do not mix an OpenSpec migration with retrieval/benchmark changes.

### Non-destructive safety gate — install first, audit each affected capability before apply

**Verified risk in ACE's existing specs (2026-10-21, static inspection):** the active tree contains changes 001–007, but its Markdown is **not a complete current as-built inventory**. In `007`, the short delta spec covers broad hybrid/receipt/quality behavior without the concrete H6 runtime provenance, external Harbor byte-binding, cross-process receipt and trace controls added by PRs #124–#134. Earlier `003` still describes legacy Tree-sitter/LSP selection scenarios, and `openspec/config.yaml` has stale provider/context statements. The OpenSpec README still calls these "five changes" while listing seven. Do **not** assume every accepted shipped behavior or regression test is in `spec.md`.

**Non-negotiable protections for Codex:**

- **No feature removal by omission.** A missing OpenSpec requirement is **not** authorization to delete/rewrite any existing production code, test, API/MCP tool, adapter, migration, generated artifact, data, evidence receipt, provider config or benchmark fixture. Do not use `git clean -fdx`, `rm -rf`, broad refactors or auto-generated cleanup to "match specs." Preserve functionality until an explicit approved removal requirement/ADR and dedicated PR with regression/provenance evidence exist.
- **Code ↔ requirement audit first for the affected capability, read-only:** on a pinned clean `main` snapshot inspect the existing source, relevant MCP contracts, tests and applicable ADRs/OpenSpec changes among 001–007. Include adjacent behavior likely to regress; expand to other areas only if dependencies justify it. Classify findings as `spec-covered`, `implemented-but-unspecified`, `specified-but-unimplemented`, `experimental`, `blocked` or `spec-contradicts-code` with source/test evidence. Do not assume an old spec overrides working code, or that an accidental implementation overrides approved requirements; escalate material disagreements for an owner/ADR decision.
- **First reconcile approved behavior in a docs-only PR:** add/clarify missing approved scenarios and acceptance rules (for example H4 cross-process per-evidence receipts, H5 verified exact-span dedupe, H6 trace and Harbor provenance, real-provider failure semantics) while retaining old historical spec text until explicit reviewed replacement. Update the stale `config.yaml` context to current accepted ADRs. Do **not** mark unfinished external E2E/Harbor gates complete or convert an experiment to a production decision. Have the owner review the coverage matrix and spec delta before a code-mutating skill runs.
- **Keep installation/migration independently reversible:** move the canonical OpenSpec directory only in a separate docs/tooling PR with tree/diff review and branch backup. `openspec init`/`update` can rewrite their **generated skill/prompt files** and may offer legacy managed cleanup (possibly including OpenSpec-generated AGENTS markers and legacy `openspec/AGENTS.md`), so inspect every proposed change and decline unexpected cleanup. Never install globally, overwrite, remove or alter pre-existing custom skills/prompts/global Codex files without explicit permission.
- **Execution policy:** `$openspec-verify-change` is a report-only inspection workflow and is safe as a first step once the project is recognized. `$openspec-propose` and `$openspec-update-change` edit planning artifacts (the latter requires confirmation); `$openspec-apply-change` **can edit any project code and tick tasks**; `$openspec-sync-specs` can apply `REMOVED/RENAMED` spec deltas, and `$openspec-archive-change` moves active change directories and can trigger sync. **Do not invoke apply, sync, archive or bulk-archive until the as-built matrix, spec delta and Git diff have been explicitly reviewed for this change**. Do not run bulk-archive on ACE 001–007.
- **Allowlist and change review for every apply:** specify the one approved task, precise allowed files (and expected additions), tests and invariants to preserve before invoking Codex; mark all non-task files read-only. Require prior owner approval for any deletion, rename, contract removal or test weakening. On completion inspect `git diff --name-status`, `git diff --check`, all changed code, unit/contract tests and `npm run verify:pr`. Any unexpected removed source/test/config/spec path means **STOP/REJECT the PR**, not an automatic correction. Do not run outside the branch/isolated worktree.
- **Protection must survive the migration:** retain historical changes and source files in Git history, keep canonical spec IDs and frozen holdouts, and never let `sync` or `archive` erase non-modeled as-built functionality. The intended result is to **bring approved specs up to date with shipped code**, not automatically roll back code to stale specs.

**Gate:** Root migration and skill initialization require a reversible Git snapshot, inventory of the seven existing changes, and review of anticipated filesystem changes. They do not require documenting every line of ACE. Before `apply`, `sync`, or `archive`, require the *affected capability's* reviewed source/test/spec matrix and approved delta. A generic "OpenSpec validate passed" is not proof that all implemented behavior is modeled.

### Incremental brownfield spec recovery from implemented ACE code

OpenSpec is brownfield-first, but its official skills do not automatically reverse-engineer a complete codebase into trusted requirements. Treat Codex code archaeology as a small, **docs-only task**, supported by `$openspec-explore` for source inspection, `$openspec-update-change` for existing artifacts, and `$openspec-verify-change` for consistency review. Do not ask `apply` to rewrite existing implementation during the recovery step.

For each affected capability, start with H4 receipts, H5 exact-span dedupe and H6 traces/benchmark/Harbor provenance; later cover MCP security and external providers as touched. Make a table: `observed behavior | source | test | existing requirement | confidence | discrepancy`. Draft focused SHALL requirements and WHEN/THEN scenarios only for verified, approved behavior. Classify separately **as-built**, **as-required** and **not-yet-proven**. An observed bug is not automatically a desired requirement, and an older spec is not automatically grounds to change code. Surface conflicts to the owner/ADR process.

Publish the resulting targeted spec revisions as a documentation-only PR with no runtime changes; require source/test links and a diff review. Continue incrementally rather than generating a giant speculative baseline. The optional community [spec-gen](https://github.com/clay-good/spec-gen) is third-party draft assistance, not an official trusted sync or authorization for automatic rewrites. Only then run an approved implementation PR against the affected specification.

**Tooling setup gate versus implementation gate:** a reversible Git tree inventory and inspection of anticipated OpenSpec-generated files suffice before relocating the spec root and installing Codex skills. Full all-code coverage is **not** a prerequisite to installation. Before `apply`, `sync` or `archive`, require the *affected capability's* audited code/spec/test map, approved deltas and an explicit review of file changes. Never remove code merely because it is absent from the specs.

### First choose one canonical OpenSpec root — no duplicate projects

**Pre-migration repo state on 2026-10-21:** ACE kept `config.yaml`, `README.md` and unarchived changes `001`–`007` under `docs/openspec/`, with no root `openspec/` or `.agents/skills/`. The setup migration in this PR makes the moved tree the only canonical root and generates Codex skills under `.agents/skills/openspec-*/SKILL.md`; the pre-migration state is retained here as historical context, not as the current repository state.

1. **Preflight / reversible snapshot:** use a clean, separate Git branch based on current `main`; inventory the existing `docs/openspec` tree, all seven changes, references in docs/scripts/CI and any local `.agents`, `.codex`, `~/.codex/prompts/opsx-*` or legacy OpenSpec-managed files. Check `node --version` (OpenSpec currently requires Node.js >= 20.19.0), `openspec --version`, `git status --short`, `openspec init --help`, and `openspec config --help`. Do not overwrite user files or use `--force`.
2. **Migration result in this setup PR:** after the exact tree audit, `git mv docs/openspec openspec` makes the existing specs the **only** authoritative root. All seven change identities, content, unchecked tasks, source/commit evidence, delta specs and `config.yaml` are preserved. Root/docs links, scripts and checksum paths are updated; no second `config.yaml` or `changes/` tree is created. Relative references and root-level CLI resolution are validated below.
3. **Reconcile current project context:** review the moved `openspec/config.yaml` against *current accepted* ADRs and runtime (TypeScript/Effect, official MCP SDK, local ast-grep + Qdrant dense/sparse/RRF, optional reranker/LSP, opt-in Vertex docs, Graphiti + immutable source archive, Harbor quality gates). Update only demonstrably stale context/path strings; never silently change ADR decisions, H6 benchmark verdicts, or checked task status.
4. **Verify official CLI and Codex integration** *from the repository root, after the canonical migration*. Use the installed CLI's current help before executing version-sensitive commands; retain the exact selected version in evidence and do not install globally as part of this PR:

   ```bash
   node --version
   openspec --version
   openspec --help
   # init/update were exercised in an isolated HOME and disposable clone.
   openspec update
   openspec list
   openspec status --change 007-hybrid-context-engine --json
   openspec validate --all --strict --no-interactive --report full
   ```

   The **default `core` profile does not include `verify`**: the migration evidence used an isolated custom profile containing core workflows plus `verify`, and generated skills only. The profile setting can affect other projects on a developer's machine, so do not change the user's global profile in this PR. If the installed CLI changes flags or needs interactive config, follow `--help` rather than guessing. The Codex integration is **skills-only**, not slash-command prompt files. Keep generated skills versioned/reviewable in the PR. Restart/reload Codex after generation so it discovers the skills.

5. **Verify actual integration before declaring done:** from the ACE repo root, confirm **one** `openspec/config.yaml`, one `openspec/changes/` with all seven historical IDs and intact source specs, no duplicate former active tree; the seven generated Codex skills, including `openspec-verify-change/SKILL.md`, exist; the installed `openspec list/status/validate` commands resolve `007`. Inspect Git diff for unexpected deletions, user/global file changes and broken paths. If a historical change fails strict validation, record the **pre-existing vs new** cause; do not rewrite or archive it just to make bootstrap green. Submit only the migration/generated skills/doc-link corrections in the tooling PR.

### How Codex should use the skills on every ACE change

The following **`$openspec-...` names are Codex chat skill invocations**, **not terminal commands**. Terminal commands are `openspec ...`. Use only the skills that setup actually generated.

1. **Before coding:** read root `AGENTS.md`, the applicable accepted ADRs and `openspec/changes/007-hybrid-context-engine/{proposal,design,tasks}.md` plus its delta specs and current code/tests. Keep the priority rule `owner decision > accepted ADR > spec contract > AGENTS.md > observed code/evidence > plans`. Use `$openspec-explore` for genuinely unclear requirements; `$openspec-update-change` for a scoped correction to the existing `007` specification. **Do not** automatically start `$openspec-propose` for PR E/F/G/H if it merely duplicates already-approved `007`; use `$openspec-propose` only for a genuinely new, separately bounded capability or newly approved architectural change.
2. **Implement one observable task per small PR:** in Codex chat use `$openspec-apply-change 007-hybrid-context-engine` with an explicit instruction to implement **only one named unchecked H6-CR task/PR slice**, not to complete all of 001–007. Derive RED/failure scenarios from the requirement, add the contract/integration test first, make the minimal TypeScript fix, keep adapter/provider boundaries, rerun `npm run test:affected` and `npm run verify:pr` locally where available, and run required real-provider/agent/Harbor checks only in a suitable environment. Preserve the frozen external v3 and reranker holdouts.
3. **Verify before claiming a task complete:** use `$openspec-verify-change 007-hybrid-context-engine` against the exact changed requirement and its tests. The skill's consistency review **does not replace** `openspec validate`, typecheck/lint/tests, exact-runtime evidence, coverage/quality gates or owner approval. Require traceable links `requirement + Scenario -> RED test -> implementation -> PASS evidence or explicit BLOCKED/NOT_RUN`. Run verification on the PR's effective revision and record unsupported steps. Missing provider/Harbor proof stays unchecked, not marked complete.
4. **Update evidence/status responsibly:** use `$openspec-update-change` when approved requirements or task text need to change and include why; mark only proven bounded tasks `[x]` with a PR/test/trace receipt. Never transform implemented into `agent-E2E-passed` or `owner-approved` without its corresponding evidence. Preserve authoritative original/source citations and opt-in data policies.
5. **Sync/archive only after complete gates:** `$openspec-sync-specs` may be used for approved delta specs when needed, with a reviewed diff. Use `$openspec-archive-change` **only** when that entire change (e.g. `007`, not just PR E) has fulfilled all required tasks, real-provider/agent/benchmark gates, and owner acceptance. Open partial milestones remain active and unarchived. Keep source-of-truth specs single and readable; do not archive unfinished H6 or auto-approve model choices.
6. **PR handoff:** report the exact spec/change ID, chosen skill invocations, files edited, acceptance scenarios, passing/blocked tests, provider/runtime hashes, benchmark evidence links, and residual unchecked work. If Codex cannot access local execution tools or the user's installed global CLI, state `NOT_RUN` instead of implying the skill was installed or checks executed.

**Acceptance for this setup PR:** an isolated checkout can run the installed OpenSpec CLI against **the migrated existing ACE 007**, Codex can load the seven configured skills including `verify`, no duplicate spec root or evidence rewrite exists, the OpenSpec usage contract above is documented, all 001–007 content survives the move, and the ordinary docs/path/CLI smoke checks are recorded. The migration itself does **not** close H6 correctness, external provider readiness or the 5× goal.

**Upstream references:** [installation](https://github.com/Fission-AI/OpenSpec/blob/main/docs/installation.md), [supported tools / Codex skill paths](https://github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md), [profile configuration](https://github.com/Fission-AI/OpenSpec/blob/main/docs-lab/customize/profiles.md), [workflow commands](https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md), [existing projects](https://github.com/Fission-AI/OpenSpec/blob/main/docs/existing-projects.md).

## 1. Product target

ACE is not "a vector search MCP". It is an **agent-neutral persistent hybrid context engine**.

The target behavior is:

```text
Codex / Claude Code / Gemini CLI / Cursor / another agent
                         |
                         | MCP
                         v
                +------------------+
                |       ACE        |
                | Context Engine   |
                +---------+--------+
                          |
        query + source obligations + working-set hints
                          |
        +-----------------+------------------+
        |                 |                  |
        v                 v                  v
  working state       code knowledge     project knowledge
  Git / dirty tree    hybrid retrieval   docs + memory
  focus/open files    structure + LSP    Vertex + Graphiti
        |                 |                  |
        +-----------------+------------------+
                          |
                          v
               evidence fusion / dedupe
                          |
                          v
                  relevance reranking
                          |
                          v
             compact verified ContextBundle
                          |
                 +--------+--------+
                 |                 |
                 v                 v
          inline minimum      ace_expand
          sufficient facts    exact bytes
```

The purpose is to **avoid making an agent rediscover and resend the same project context repeatedly**, while preserving or improving task quality.

Quality is a hard gate. Token reduction is useful only when task success/non-inferiority holds.

## 2. How far current main already is

PR #94 already completed most of the de-bespoke foundation:

- production structural discovery uses pinned **ast-grep** instead of the custom Python Tree-sitter node table;
- production semantics use a generic **LSP JSON-RPC adapter** with a maintained language server;
- Qdrant publication uses immutable collections + atomic `current` aliases;
- vectors are reusable by content identity rather than only snapshot identity;
- request-time workspace reconciliation prevents stale indexes from being called complete;
- explicit source obligations and source coverage exist;
- progressive delivery and exact `ace_expand` exist;
- provider identity/release binding was hardened further in PRs #98–#101.

Therefore this plan does **not** restart those migrations.

The original architectural gap was a dense-only path. That gap is now implemented at runtime; the target pipeline below is the current architecture and still requires final holdout/agent evidence:

```text
                         +-> dense semantic --------+
query -> query analysis -+-> BM25/sparse ----------+-> RRF fusion -> rerank -> source/LSP verify
                         +-> exact/structural hints -+
```

and the context layer must also become working-state-aware and delta-aware.

## 3. Component decisions

### Keep Qdrant, do not migrate to Turbopuffer now

Qdrant remains the selected local code retrieval store.

Reasons:

- ACE's code path is local-first/private by default;
- Qdrant runs locally and self-hosted without a cloud dependency;
- current main already has tested Qdrant publication/reconciliation;
- Qdrant supports dense + sparse/BM25 vectors and native fusion queries;
- changing databases now would spend risk on migration instead of improving retrieval quality.

Turbopuffer is a strong cloud/serverless search engine for huge multi-tenant corpora and object-storage economics. It is not selected for the local developer ACE runtime. Revisit only if ACE becomes a cloud-scale multi-tenant service where Qdrant operations/storage are a measured bottleneck.

### Structural layer

Keep:

- `@ast-grep/cli`;
- structural chunk boundaries and compact outlines;
- exact byte ranges verified against current source.

Do not reintroduce language-specific AST tables in ACE core.

### Dense retrieval

Keep the selected local embedding evaluation path through FastEmbed/ONNX and Qdrant.

Production model/runtime still follows the existing provider-selection gate.

### Sparse / lexical retrieval

Use **Qdrant sparse BM25** as the default second retriever.

Do **not** add Tantivy as a second production database unless benchmarks demonstrate a concrete need.

Initial design:

- dense vector: current semantic embedding;
- sparse vector: Qdrant/FastEmbed BM25 representation of a lexical text field;
- Qdrant Query API prefetches both;
- fuse with **RRF**;
- preserve per-branch ranks in evidence diagnostics.

For code-like exact literals that BM25 misses, test an optional maintained `ripgrep` exact branch before inventing another index.

### Reranking

Add a local **FastEmbed cross-encoder reranker** behind a small provider port.

Do not hard-code a production reranker model before evaluation. Benchmark a license-compatible CPU candidate on the frozen code-retrieval holdout, including RU/EN/mixed queries.

The reranker only sees a small fused shortlist (for example 20–50 candidates), never the whole corpus.

### Semantic enrichment

Keep real LSP servers for definitions/references/types/diagnostics.

LSP is an enrichment/verification layer, not the primary fuzzy retriever.

### Working state

Add a first-class Working Context layer:

Authoritative ACE-derived signals:
- current HEAD/branch;
- tracked/untracked/deleted paths;
- staged/unstaged changed paths;
- compact diff metadata;
- recent relevant commit metadata when explicitly requested.

Optional host/agent hints:
- focused file/range;
- open files;
- selected symbol/range;
- current task identifier.

Host hints are ranking priors, never source truth. The MCP contract remains usable by agents without an IDE.

### Documentation and memory

Keep:
- Vertex RAG for authorized project documentation;
- Graphiti/FalkorDB for temporal project memory;
- immutable original archive/provenance in ACE.

Do not merge all sources into one vector database.

## 4. H1 — make Qdrant retrieval truly hybrid

### Index schema

Every code chunk SHALL carry:

- source citation identity: workspace/path/source digest/range/symbol;
- dense vector;
- sparse BM25 vector;
- lexical text used for BM25;
- `embedding_key` for dense content reuse;
- provider/index identity;
- language/structural metadata useful for filters.

The lexical representation should include at least:
- symbol name;
- qualified/module path where available;
- signature/outline text;
- exact chunk text;
- selected structural metadata.

### Query

For each query:

1. create the dense query vector;
2. create BM25 sparse query representation;
3. request independent dense and sparse candidate pools;
4. fuse with native Qdrant RRF;
5. preserve branch ranks and fused rank;
6. pass the fused shortlist to reranking.

### Acceptance

Frozen fixtures must include:
- behavior description with no identifier;
- exact function/class names;
- config/env keys;
- UUID/hash-like literals;
- same-name symbols;
- RU/EN/mixed natural-language questions.

The hybrid path must beat or match both dense-only and sparse-only recall without unacceptable latency.

## 5. H2 — add evidence-gated reranking

Add `RerankerPort` with a local maintained implementation.

Candidate flow:

```text
dense top-K + sparse top-K
          |
          v
      RRF top-50
          |
          v
   cross-encoder
          |
          v
       top 5-10
```

Record:
- candidate count before/after;
- reranker identity/version/model artifact;
- reranker latency;
- pre/post rank;
- failures/fallback state.

A reranker outage may fall back to fused ranking only if the configured source plan marks reranking optional. Never claim reranker-backed quality when it was unavailable.

Do not add a reranker to production by intuition. Keep it only if retrieval/agent benchmarks show measurable quality or context-size improvement.

## 6. H3 — promote dynamic working state to first-class context

The current workspace snapshot correctly protects freshness but does not yet use working-state signals as retrieval priors.

Add a `WorkingContext` value object containing:

```text
head revision
branch
changed paths
staged paths
untracked paths
deleted paths
optional focused/open paths
optional focused range/symbol
```

Rules:

- current dirty-tree content always outranks persisted old content;
- focused/open files receive a ranking prior, not guaranteed inclusion;
- a changed-file prior must not suppress a much more relevant untouched file;
- raw large diffs are not automatically injected into the ContextBundle;
- when the query is explicitly historical, Git commit/diff evidence may be fetched as its own source with provenance.

MCP clients without editor state simply omit host hints.

## 7. H4 — stop retransmitting the same context repeatedly

Content-addressed embedding reuse saves indexing work, but it does **not** by itself save model-input tokens if the same snippets are returned by MCP repeatedly.

Add context receipts/delta delivery.

### Contract

Each ContextBundle gets:
- `bundle_id`;
- stable `evidence_id`/source digest for each item;
- optional `supersedes_bundle_id`.

`ace_context` accepts optional:
- `known_bundle_id`;
- and/or `known_evidence_ids`.

When an unchanged evidence item is already known, ACE SHOULD return a compact reference rather than resending its body. Changed/new evidence is sent normally.

Exact content remains retrievable with `ace_expand`.

This must be portable and not depend on hidden per-agent memory: evidence identities are content/provenance based and can be supplied by any MCP client.

### Metrics

Add:
- `initial_context_bytes`;
- `new_context_bytes`;
- `reused_context_bytes`;
- `duplicate_context_bytes_avoided`;
- `expanded_bytes`;
- `unique_evidence_count`.

This is the direct measurement for the owner's “do not send the same thing 100 times” goal.

## 8. H5 — compact code outlines as navigation context

Use ast-grep outlines not only to create chunks but also as a compact navigation representation.

For broad locate/orientation requests, ACE may return:
- file/module outline;
- signatures;
- symbol ranges;
- import/export relationships;
- expansion handles;

before returning full bodies.

Do not create a new MCP tool unless agent E2E shows a separate tool improves natural usage. Prefer `ace_context(intent="locate")` + `ace_expand`.

## 9. H6 — source-aware context assembly

Code, documentation and memory have different truth semantics.

Do not run one global score and pretend scores are comparable.

Instead:

1. satisfy explicit required sources;
2. retrieve/rank inside each source;
3. verify current source bytes;
4. apply source-aware policy:
   - current code is authoritative for “what implementation does now”;
   - docs are authoritative for documented intent/requirements, not current code behavior;
   - Graphiti is derived temporal memory with archive provenance;
   - working-state hints are priors, not facts;
5. deduplicate overlapping code snippets;
6. produce a compact ContextBundle with explicit conflicts.

## 10. H7 — benchmark the architecture by ablation

Do not benchmark only “ACE vs no ACE”. Measure which layer pays for itself.

Required retrieval ablations:

1. lexical/BM25 only;
2. dense only;
3. dense + BM25 + RRF;
4. hybrid + reranker;
5. hybrid + reranker + working-state priors.

Required agent arms:

1. native agent;
2. current dense-first ACE;
3. hybrid ACE;
4. hybrid ACE + context receipts/delta reuse.

Quality is evaluated first. Then report:
- task success/non-inferiority;
- retrieval recall/MRR/nDCG;
- total agent input/output tokens;
- MCP/tool calls;
- native file reads after ACE;
- unique context bytes;
- duplicate context bytes avoided;
- index/build latency;
- query p50/p95;
- reranker cost/latency;
- external dollar cost;
- failure rates.

The 5× token objective remains a measurement target, not a release precondition.

## 11. Execution order

### Phase 1 — hybrid retrieval

- [ ] Extend embedding worker/provider boundary with sparse BM25 generation.
- [ ] Add dense+sparse vector schema to new immutable Qdrant collections.
- [ ] Implement Qdrant prefetch + RRF fusion.
- [ ] Add dense-only/sparse-only/hybrid deterministic and real-provider fixtures.
- [ ] Preserve atomic alias publication and content-addressed dense reuse.

### Phase 2 — reranking

- [ ] Add `RerankerPort`.
- [ ] Benchmark supported CPU cross-encoder candidates on the frozen holdout.
- [ ] Approve one provider/model or leave reranking disabled if benefit is insufficient.
- [ ] Add truthful fallback/readiness semantics.

### Phase 3 — working context

- [ ] Extend workspace/Git observation with branch + staged/unstaged/untracked/deleted path sets.
- [ ] Add optional MCP working-set hints (focused/open paths/ranges).
- [ ] Add ranking priors without weakening source verification.
- [ ] Add historical Git retrieval only for explicit history/why queries.

### Phase 4 — delta context delivery

- [ ] Add `bundle_id` and stable evidence receipts.
- [ ] Accept known bundle/evidence state in `ace_context`.
- [ ] Suppress unchanged repeated bodies while preserving citations/handles.
- [ ] Add duplicate-context metrics.
- [ ] Verify stateless portability across MCP clients.

### Phase 5 — context assembly and outline

- [ ] Return compact ast-grep outlines for broad locate requests.
- [ ] Tune per-source dedupe and relevance ordering.
- [ ] Preserve all explicit source obligations and conflict reporting.

### Phase 6 — benchmark

- [ ] Freeze the multi-repository retrieval holdout before tuning final thresholds.
- [ ] Run retrieval ablations.
- [ ] Run natural-use Harbor native/current/hybrid/delta arms.
- [ ] Preserve bad results and zero-use cases.
- [ ] Decide whether each new layer stays based on measured quality/tokens/latency.

### Phase 7 — full production track

Continue independently:
- Qwen3:14b local Graphiti lifecycle/recovery;
- Vertex synthetic import/citation DBC-14;
- k3s/PVC/backup evidence;
- embedding/semantic/reranker owner approvals;
- resource/supply-chain/exact-release evidence.

These production gates do not block exploratory hybrid retrieval measurements.

## 12. PR slicing

Recommended implementation PRs:

- **PR H1:** Qdrant sparse BM25 + RRF, no reranker.
- **PR H2:** reranker provider + evaluation.
- **PR H3:** WorkingContext + MCP hints.
- **PR H4:** ContextBundle receipts/delta delivery.
- **PR H5:** outline delivery + source-aware assembly refinements.
- **PR H6:** frozen ablation + Harbor benchmark artifacts.

Each PR must state:
- maintained upstream primitive used;
- new production LOC and deleted LOC;
- observable contract changed;
- benchmark/evidence required;
- rollback path.

## 13. Explicit non-goals / anti-bicycle rules

Do not build now:
- our own Merkle tree;
- our own vector DB;
- a separate Tantivy service before Qdrant BM25 is measured;
- our own parser;
- our own language server;
- a custom reranker model;
- a semantic code graph/CPG without measured need;
- an LLM router merely to replace explicit source obligations;
- agent-specific core logic.

The architecture borrows **principles** from Cursor, not its private implementation.

## 14. Definition of Done for the Cursor-like ACE milestone

This milestone is complete when:

- code chunks are structural and polyglot through ast-grep;
- dense and sparse lexical candidates are fused in Qdrant;
- reranking is either evidence-approved or explicitly rejected by benchmark;
- current Git/worktree state influences retrieval without becoming false source truth;
- optional host focus/open-file hints work through generic MCP;
- LSP enriches/validates selected code;
- docs and temporal memory remain separately governed sources;
- repeated unchanged evidence can be referenced without retransmitting its full body;
- exact source expansion is lossless;
- current-code freshness is verified at delivery;
- natural agents actually use ACE;
- paired benchmarks show quality non-inferiority before any token-savings claim.

The intended outcome is not simply “fewer tokens”. It is **less repeated discovery work, less duplicated context, and equal-or-better engineering decisions per agent step**.
