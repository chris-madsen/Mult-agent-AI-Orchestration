# Что ACE может позаимствовать из ast-index: подробный research/adoption plan

> **Статус:** research + план контролируемых экспериментов; **не утверждение, что перечисленные механизмы уже улучшают ACE**.
> **Дата:** 2026-10-22.
> **Зафиксированный ast-index:** [defendend/Claude-ast-index-search@`6ca99bde`](https://github.com/defendend/Claude-ast-index-search/tree/6ca99bde97627224f9217c7962e3dff9944c7a87), README v3.56.0.
> **Зафиксированный ACE:** [chris-madsen/Mult-agent-AI-Orchestration@`3180bd09`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/tree/3180bd09f07a055552aae98f3aa30633772b61bc).
> **Основа исследования:** статическое чтение pinned-исходников ast-index и ACE. В рамках этого документа **не запускался** сравнительный benchmark ast-index vs ACE и не подтверждалась заявленная ast-index экономия токенов.
>
> ast-index распространяется под MIT License. Этот документ описывает идеи и эксперименты; **код ast-index здесь не копируется**. При буквальном переносе кода необходимо сохранить copyright/license notice согласно MIT.

## 0. Executive summary

ast-index — **не альтернатива Tree-sitter**. Он использует Tree-sitter как parser layer, а сверху строит развитый relationship/graph layer:

```text
Tree-sitter
  ↓
symbols / refs / imports / inheritance / modules
  ↓
SQLite + FTS5
  ↓
symbol dependency graph
  ↓
dependents / dependencies / impact / paths / cycles
  ↓
PageRank / personalized PageRank (RWR)
  ↓
Git-history signals
  ↓
compact agent context
```

Текущий ACE силён в другой части:

```text
ast-grep / Tree-sitter structural candidates
  ↓
dense embeddings + sparse/BM25
  ↓
Qdrant hybrid RRF
  ↓
optional reranker
  ↓
working-context boost
  ↓
LSP semantic verification
  ↓
exact source reread + provenance
  ↓
compact delivery / ace_expand / receipts
```

**Главная идея:** не заменять ACE ast-index и не заменять hybrid retrieval на FTS. Наиболее перспективное объединение:

```text
natural-language query
      │
      ├── dense
      └── sparse/BM25
             │
            RRF
             │
      verified structural seeds
             │
       symbol/reference graph
     callers/callees/inheritance
             │
       bounded PPR / RWR
             │
       LSP + exact reread
             │
     token-budgeted delivery
```

То есть ast-index потенциально даёт ACE недостающий **Graph / Relationship Layer**, а ACE сохраняет semantic discovery, freshness/provenance, LSP verification и controlled context delivery.

**Приоритет:** сначала получить текущий real feedback по [ACE real feedback loop](../plans/ace-real-feedback-loop.md). Затем проверять идеи ast-index **по одной**, начиная с external baseline и one-hop graph expansion.

---

## 1. Что реально реализовано в ast-index

### 1.1 Tree-sitter parser layer

ast-index напрямую зависит от `tree-sitter` и большого набора language grammars. Parser layer извлекает symbols, references, language-specific references и structural ranges.

Источники:
- [`Cargo.toml`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/Cargo.toml#L42-L90)
- [`src/parsers/treesitter/mod.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/parsers/treesitter/mod.rs)

### 1.2 Persistent structural index

SQLite хранит:
- files;
- symbols, qualified names, kinds, ranges и signatures;
- references;
- imports;
- inheritance;
- modules и module dependencies;
- platform-specific relations.

FTS5 индексирует symbol names/signatures.

Источники:
- [`src/db.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/db.rs#L4307-L4547)
- [`src/indexer.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/indexer.rs)

### 1.3 Двухстадийный explore

`explore` сначала получает lexical/FTS/fuzzy seeds. Опционально Stage B строит graph around seeds и применяет RWR / personalized PageRank.

Источник:
- [`src/commands/explore.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/explore.rs)

### 1.4 Symbol dependency graph

`graph build` связывает references с definitions. В реализации есть confidence classes: local, scoped, import, unique, ambiguous.

Graph queries:
- dependents;
- dependencies;
- impact;
- path;
- cycles;
- top/metrics.

Graph имеет fingerprint и определяется как stale после изменения основного index.

Источник:
- [`src/commands/graph/mod.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/graph/mod.rs)

### 1.5 PageRank / graph-aware ranking

ast-index хранит graph metrics, включая PageRank, и имеет ranking presets: `proven`, `hotspots`, `risky`, `central`.

Источник:
- [`src/commands/rank.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/rank.rs)

### 1.6 Git-history signals

`hotspots --collect` собирает commit count, churn, bugfix share, authors, age и derived percentile signals. History collection отделена от обычного rebuild/update.

Источники:
- [README](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/README.md)
- [`src/commands/git_signals.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/git_signals.rs)

### 1.7 Incremental update / watcher / cache lifecycle

ast-index имеет `rebuild`, incremental `update`, `watch`, debounce coordination, cache leases/generation publication и parallel parsing changed files.

Важно: documented change detection опирается на path/mtime/size, а не content hash. Это слабее strict ACE source identity и не должно копироваться как trust boundary.

### 1.8 MCP ergonomics

Отдельный `ast-index-mcp` превращает CLI commands в MCP tools. Tool descriptions рекомендуют:
- `explore` для "how does X work";
- `search` для broad discovery;
- graph dependents перед изменением symbol;
- compact text output по умолчанию;
- JSON только когда он реально нужен.

Источник:
- [`crates/ast-index-mcp/src/main.rs`](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/crates/ast-index-mcp/src/main.rs)

---

## 2. Сравнение с текущим ACE

| Область | ast-index | Текущий ACE | Вывод |
|---|---|---|---|
| Parser | Tree-sitter напрямую | ast-grep поверх Tree-sitter | Не менять parser ради ast-index |
| Structural symbols | Да | Да | Уже есть |
| Exact current-source reread | Selected source читается свежим | Строгий exact reread перед evidence | Сохранить ACE semantics |
| Lexical retrieval | SQLite FTS5/BM25/fuzzy | Sparse BM25/Qdrant | Не дублировать без baseline |
| Dense semantic retrieval | Не основной mechanism | FastEmbed + Qdrant | Сохранить |
| Hybrid dense+sparse | Не основной explore path | RRF | Сохранить |
| Symbol refs/imports/inheritance | Сильный persistent index | Частично structural/LSP | **Кандидат** |
| Persistent symbol graph | Да | Нет полноценного | **Главный gap** |
| Dependents/dependencies/impact/path | Да | Нет полноценного | **P0/P1** |
| PPR/RWR | Да | Нет | **P1 experiment** |
| PageRank centrality | Да | Нет | **P1/P2** |
| Git-history ranking | Да | Нет | **P1/P2** |
| Branch changed-files signal | Да | Worktree status есть, но другая semantics | Изучить как separate signal |
| LSP definition proof | Не основной trust boundary | Да | **Сохранить** |
| Snapshot provenance | Проще | Строгий digest/snapshot/provenance | **Не ослаблять** |
| Context delivery/expand | Compact CLI/MCP slices | ContextBundle + exact expand + receipts | Сохранить |
| Token savings | README заявляет ~40–50% | Мы строим measured loop | Не принимать claim без paired run |

ACE sources:
- [`src/adapters/local-code-index.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/local-code-index.ts)
- [`src/adapters/qdrant-context-provider.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/qdrant-context-provider.ts)
- [`src/adapters/lsp-semantic.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/lsp-semantic.ts)
- [`src/domain/context-delivery.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/domain/context-delivery.ts)
- [`src/domain/retrieval-quality-evaluation.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/domain/retrieval-quality-evaluation.ts)

---

# 3. Что стоит позаимствовать

## A0 — ast-index как внешний baseline/sidecar прежде переписывания ACE [P0]

Самый дешёвый способ проверить ценность graph-layer — сначала **не писать его самим**.

На одном pinned repository/task set сравнить:

```text
Arm A: Codex native
Arm B: Codex + ACE
Arm C: Codex + ast-index MCP
Arm D: Codex + ACE + ast-index graph tools
```

Arm D — только после A/B/C и с tool-call correlation.

Обязательные условия:
- одинаковая модель/reasoning effort;
- одинаковый task/repository SHA;
- одинаковый time/cost budget;
- optional use, не forced use;
- raw provider usage;
- фиксировать actual ACE/ast-index/native reads.

Измерять:
- task success/grader;
- provider input/cached/output tokens;
- tool output bytes;
- native file reads;
- latency;
- cases, где graph нашёл полезный context, а ACE нет;
- cases, где ACE semantic retrieval нашёл useful seed, а ast-index lexical path нет.

**Decision rule:** если ast-index не даёт независимого выигрыша, не строить большой graph subsystem только ради архитектурной красоты.

---

## A1 — Persistent Symbol/Reference Graph [P0]

Это самая сильная идея ast-index для ACE.

Предлагаемый layer:

```text
StructuralCandidate
  ↓
SymbolNode
  ├── CALLS
  ├── IMPORTS
  ├── INHERITS
  ├── IMPLEMENTS
  ├── REFERENCES
  ├── CONTAINS
  └── TESTS
```

### Stable node identity

Не использовать DB row IDs.

```text
nodeId = hash(
  repositoryId,
  repoPath,
  sourceDigest,
  exact structural range,
  symbol kind,
  symbol name
)
```

### Edge schema

- sourceNodeId;
- targetNodeId;
- edgeType;
- evidenceRepoPath/range;
- sourceSnapshotDigest;
- resolutionMethod;
- confidence;
- candidateCount;
- providerIdentity.

### Confidence model

Идею ast-index confidence стоит адаптировать:

- `exact_local`;
- `qualified_scope`;
- `import_resolved`;
- `lsp_confirmed`;
- `unique_name_only`;
- `ambiguous`;
- `unresolved`.

**Правило ACE:** graph resolution не равна `direct` evidence. `direct` остаётся только после current exact reread и требуемой LSP-проверки.

### Предлагаемые boundaries

- `src/domain/symbol-graph.ts`;
- `src/application/symbol-graph-builder.ts`;
- отдельный graph storage adapter;
- Qdrant остаётся vector/sparse retrieval store.

Сначала in-memory prototype, затем SQLite adapter только если benchmark оправдает persistence.

---

## A2 — Graph expansion после hybrid retrieval, а не вместо него [P0]

ACE уже умеет находить seed по смыслу. Graph должен отвечать: **что связано с найденным seed?**

```text
query
 ↓
dense top-N + sparse top-N
 ↓
RRF
 ↓
seed symbols
 ↓
bounded graph expansion
 ↓
working-context boost
 ↓
optional graph rerank
 ↓
LSP verify + exact reread
 ↓
delivery budget
```

Guardrails:
- depth default 1;
- hard node budget;
- per-edge-type caps;
- high-degree hubs capped;
- ambiguous edges excluded by default;
- tests — отдельный budget;
- каждый graph-added candidate получает trace reason.

Главное измерение: graph должен не только поднять Recall, но и **уменьшать downstream search/read loop**, не взрывая context bytes.

---

## A3 — Personalized PageRank / Random Walk with Restart [P1]

ast-index использует RWR/PPR поверх lexical seeds. Для ACE restart distribution логичнее задавать hybrid RRF scores.

Edges:
- CALLS;
- IMPORTS;
- INHERITS;
- IMPLEMENTS;
- CONTAINS.

Weights должны учитывать confidence.

Не делать PPR default сразу. Ablation:
1. hybrid only;
2. hybrid + one-hop graph;
3. hybrid + graph + PPR;
4. hybrid + graph + PPR + reranker.

Если one-hop даёт почти тот же результат — PPR не нужен.

---

## A4 — Dependents / Dependencies / Impact / Path [P0/P1]

Добавить domain API:
- `symbol_dependents(symbol, depth)`;
- `symbol_dependencies(symbol, members)`;
- `symbol_impact(symbol, depth)`;
- `symbol_paths(from, to, maxPaths)`.

Потом решить MCP surface:
- отдельные tools;
- единый `ace_graph`;
- или `ace_context(intent="impact")`.

Почему полезно: перед изменением API агенту чаще нужен **blast radius**, чем ещё пять semantic-near snippets.

Compact output:

```text
PaymentGateway.charge
  ← CheckoutService.pay      lsp_confirmed
  ← RetryWorker.retry        import_resolved
  ← BillingSpec              test
transitive files: 7
```

Bodies — только по expand/request.

---

## A5 — Graph freshness fingerprint / fail-closed stale graph [P0]

Взять принцип ast-index "graph can be stale", но сделать ACE version строже.

Graph artifact bind к:
- workspaceId;
- sourceSnapshotDigest;
- structuralProviderIdentity;
- graphBuilderVersion;
- resolutionProviderIdentity;
- nodeManifestDigest;
- edgeManifestDigest.

Statuses:
- `current`;
- `partial`;
- `stale`;
- `unavailable`.

Никакого silent use stale graph для current evidence.

---

## A6 — PageRank centrality как secondary signal [P1]

Полезен для:
- onboarding;
- architecture survey;
- "core abstractions";
- choosing representative implementations.

Не складывать PageRank напрямую с RRF score. Использовать rank feature/percentile или optional re-ranking stage.

Ablation:
- broad architecture queries;
- exact symbol;
- bug-fix tasks.

Если central utility code начинает вытеснять exact relevant symbols — feature weight неправильный.

---

## A7 — Git-history signals: hotspots / risky / proven [P1/P2]

Per-file signals:
- commit percentile;
- churn percentile;
- bugfix ratio;
- authors;
- age;
- last-change recency.

Derived candidates:
- hotspot_score;
- risk_score;
- stability_score.

Применение:
1. risk-aware change planning;
2. choice among multiple relevant implementations;
3. regression/debug prioritization.

Не применять как correctness proof и не позволять history победить semantic relevance.

History — отдельный evidence class, а не code truth.

---

## A8 — Branch changed-files signal [P1]

ast-index `changed` даёт merge-base branch delta. ACE уже знает staged/unstaged/untracked, но branch delta отвечает на другую задачу.

Добавить contextual signals:
- branch_delta_paths;
- branch_base_revision;
- branch_head_revision.

Использовать как boost, не hard-filter.

Особенно полезно для:
- PR review;
- "что сломал этот change";
- regression hunting;
- graph expansion вокруг changed symbols.

---

## A9 — Test discovery relation [P1]

ast-index `explore` добавляет tests по path convention.

ACE version должна давать confidence:
- same-module path convention;
- test imports source;
- LSP/reference relation;
- framework naming;
- build metadata.

Relation `TESTS` может заметно сократить отдельные "найди существующие тесты" search/read calls.

Path heuristic не должен считаться direct proof.

---

## A10 — Module/build dependency graph [P1/P2]

Для monorepo graph пакетов может быть так же важен, как symbol graph.

Модель:

```text
ModuleNode
  DEPENDS_ON
  EXPORTS
  OWNS_SYMBOL
  OWNS_FILE
```

Adapters по ecosystem добавлять только по реальному demand:
- npm/workspaces;
- Cargo;
- Gradle;
- Maven;
- Go modules;
- Python metadata.

Первым брать ecosystem benchmark repository, а не "поддержать всё".

---

## A11 — Explicit completeness / pagination / truncation semantics [P0]

У ast-index limited searches явно сообщают completeness/truncation. ACE уже имеет `complete`, source coverage и expand, но agent-facing semantics можно усилить.

Показывать:
- candidate pool total known/unknown;
- returned;
- truncated;
- graph neighbours considered;
- graph neighbours dropped by budget;
- ambiguous edges omitted;
- partial source reasons;
- expansion available.

Agent не должен интерпретировать "5 результатов" как "существует только 5".

---

## A12 — Compact text rendering как token feature [P0/P1]

ast-index MCP специально делает compact text default.

ACE structuredContent нужен для machine parsing, но human/agent text можно оптимизировать:

```text
1. src/payments/retry.ts:44-71 RetryPolicy.apply [LSP✓]
   reason: hybrid#1 → caller expansion
   exact body: ace_expand(h:abc)
2. src/payments/service.ts:90-106 PaymentService.retry [LSP✓]
   edge: CALLS RetryPolicy.apply
```

Перед оптимизацией проверить, как конкретный MCP client биллит text + structuredContent, чтобы случайно не считать одно содержимое дважды.

---

## A13 — Incremental updater: concurrency/coalescing, но не identity model [P1]

Стоит изучить:
- parallel parsing changed files;
- bounded work queues;
- watcher debounce;
- update coalescing;
- generation publication;
- cache leases.

**Не копировать mtime+size как trust identity.**

ACE должен оставить content-digest/snapshot boundary. Metadata допустима как cheap prefilter только если reuse в итоге подтверждается digest.

---

## A14 — Multiple roots / attached subtrees [P2]

Полезно для:
- monorepo + sibling shared lib;
- app + generated client;
- application + internal SDK.

Каждый root:
- отдельный repository/source identity;
- policy boundary;
- allowed-root enforcement;
- graph cross-root edge только с resolution proof.

---

## A15 — External dependency symbol stubs [P2]

ast-index индексирует некоторые declaration sources, например TypeScript `.d.ts`.

ACE может хранить:
- public dependency symbols;
- signatures only;
- package/version provenance;
- no dependency implementation body by default.

Это позволяет понять external API без megabytes dependency source.

---

## A16 — Inspectability / graph debug ergonomics [P2]

Если graph store будет SQLite, полезны developer-only commands:
- explain node;
- explain edge;
- dump neighbours;
- graph stats;
- stale reason;
- source snapshot digest.

Это ускоряет наш feedback loop и расследование bad retrieval.

---

# 4. Что НЕ копировать как есть

1. **Не заменять hybrid retrieval на FTS5.** Dense остаётся важен для unknown-name behavioral queries.
2. **Не считать name-resolved graph semantic proof.** Graph = navigation evidence; LSP + exact source = trust evidence.
3. **Не считать text callers authoritative.** Same-name/comments/string matches полезны только как fallback.
4. **Не ослаблять source freshness.** Exact reread/source digest/snapshot binding остаются.
5. **Не принимать заявленные ~40–50% token savings как наш результат.** Нужен свой paired benchmark.
6. **Не плодить 20+ MCP tools без необходимости.** Сначала domain API, затем минимальный tool surface.
7. **Не делать manual graph build обязательным production workflow.** Исследовать derived/incremental/lazy graph с fail-closed freshness.
8. **Не переносить Android/iOS/Rails-specific logic пакетом.** Это примеры relation providers, а не обязательный ACE core.
9. **Не делать PageRank универсальным relevance score.** Centrality и query relevance — разные признаки.
10. **Не смешивать Git history с correctness/provenance.**

---

# 5. Целевая архитектура ACE + Graph Layer

```text
                         ┌────────────────────┐
user query ─────────────▶│ Query normalization │
                         └──────────┬─────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │                                   │
            Dense retrieval                     Sparse retrieval
                  │                                   │
                  └────────────── RRF ────────────────┘
                                    │
                              seed candidates
                                    │
                         ┌──────────┴──────────┐
                         │ Symbol Graph Layer │
                         └──────────┬──────────┘
                                    │
                  callers / callees / imports /
                  inheritance / tests / modules
                                    │
                         bounded graph expansion
                                    │
                         optional PPR / PageRank
                                    │
                         working-context signals
                                    │
                         optional cross-encoder
                                    │
               exact source reread + LSP verification
                                    │
                         provenance classification
                                    │
                  locate / inspect / exact expand
                                    │
                               agent
```

Graph не bypass:
- source coverage;
- snapshot validation;
- LSP;
- exact reread;
- cloud/data policy;
- context delivery budget.

---

# 6. Предлагаемая graph data model

## 6.1 SymbolNode

```ts
interface SymbolNode {
  nodeId: string
  repositoryId: string
  repoPath: string
  sourceDigest: string
  range: SourceRange
  name: string
  qualifiedName?: string
  kind: StructuralKind
  language: string
  exported?: boolean
  semanticAnchor?: SemanticAnchor
}
```

## 6.2 SymbolEdge

```ts
type SymbolEdgeType =
  | "calls"
  | "references"
  | "imports"
  | "inherits"
  | "implements"
  | "contains"
  | "tests"

interface SymbolEdge {
  sourceNodeId: string
  targetNodeId: string
  type: SymbolEdgeType
  confidence:
    | "lsp_confirmed"
    | "import_resolved"
    | "qualified_scope"
    | "unique_name"
    | "ambiguous"
  evidencePath: string
  evidenceRange: SourceRange
  snapshotDigest: string
  resolverIdentity: string
}
```

## 6.3 SymbolGraphSnapshot

```ts
interface SymbolGraphSnapshot {
  workspaceId: string
  sourceSnapshotDigest: string
  structuralProviderIdentity: string
  resolverIdentity: string
  graphBuilderVersion: string
  nodeManifestDigest: string
  edgeManifestDigest: string
}
```

---

# 7. Resolution strategy: использовать LSP сильнее, чем ast-index

1. AST выделяет references/calls.
2. Если LSP доступен — definition/references → exact target node.
3. Иначе import scope.
4. Иначе qualified scope.
5. Иначе unique-name fallback.
6. Ambiguous остаётся ambiguous.

Graph metrics могут учитывать ambiguous отдельно, но default retrieval expansion их не должен использовать как high-confidence.

Чтобы не платить LSP latency на каждый query:
- build-time batched resolution;
- lazy resolution;
- resolve high-value edges first;
- cache по snapshot + semantic anchor.

---

# 8. Retrieval experiments

## G0 — External ast-index baseline

Без runtime changes ACE.

## G1 — ACE hybrid + one-hop graph

Без PPR.

Пример budget:
- top 5 seeds;
- max 3 callers per seed;
- max 3 dependencies;
- max 2 tests.

Числа — initial experiment settings, не product defaults.

## G2 — Relation/confidence weighting

Добавить edge-type и confidence weights.

## G3 — PPR/RWR

Только если G1 улучшает recall, но ordering слабый.

## G4 — PageRank centrality

Только architecture/onboarding queries.

## G5 — History-aware ranking

Только change planning / example selection.

## G6 — Module graph

Только при доказанном cross-package blind spot.

**Один фактор на experiment.**

---

# 9. Benchmark plan

Связать с [real feedback loop](../plans/ace-real-feedback-loop.md).

## 9.1 Retrieval metrics

- Recall@1/3/5;
- MRR;
- nDCG@5;
- exact file/span;
- graph-rescued gold;
- graph distractors;
- candidate count;
- delivered bytes;
- latency p50/p95.

Graph-specific:
- seed hit;
- graph rescued miss;
- wrong-target edge;
- confidence distribution;
- expansion depth;
- nodes explored;
- nodes delivered;
- stale/ambiguous exclusions.

## 9.2 Harbor agent arms

```text
A native
B ACE hybrid
C ACE hybrid + graph one-hop
D ACE hybrid + graph + PPR   (только если C оправдан)
```

Predeclare:
- per-task non-inferiority;
- model/runtime;
- source/task SHA;
- max cost/time;
- optional use.

Metrics:
- grader/task success;
- provider-reported tokens;
- cost;
- duration;
- ACE calls;
- expand calls;
- native file reads;
- graph expansions;
- context bytes.

## 9.3 Analytical task classes

Не создавать новый ручной gold dataset, но разрезать готовые tasks:
- unknown-name behavioral;
- exact symbol;
- implementation choice;
- change impact;
- cross-package dependency;
- tests;
- same-name distractor;
- architecture survey.

Graph обязан прежде всего доказать пользу на impact/cross-reference классах.

---

# 10. Feedback artifact

Каждый graph experiment должен позволять восстановить:

```text
task/query
source snapshot
hybrid seeds
graph neighbours considered
edges + confidence
PPR/PageRank contribution
LSP confirmations
final delivered context
delivered bytes
agent tool path
quality
provider tokens
failure reason
```

Failure taxonomy:
- `seed_miss`;
- `graph_missing_edge`;
- `graph_wrong_target`;
- `ambiguous_edge_pollution`;
- `centrality_overboost`;
- `history_overboost`;
- `context_budget_overflow`;
- `stale_graph`;
- `lsp_resolution_failed`;
- `agent_did_not_use_graph_context`.

---

# 11. Пошаговый PR roadmap

| PR | Deliverable | Не делать | Gate |
|---|---|---|---|
| **AI0 — этот docs PR** | pinned research + plan | runtime changes | docs only |
| **AI1 — external baseline** | ast-index MCP/CLI comparison harness | не встраивать graph | ≥1 honest paired comparison |
| **AI2 — graph domain model** | node/edge/snapshot + in-memory builder | default retrieval unchanged | provenance/stale tests |
| **AI3 — AST/LSP resolver** | confidence-aware edges | без PageRank | false-resolution suite |
| **AI4 — one-hop ablation** | opt-in `hybrid_graph` | default off, без PPR | frozen retrieval comparison |
| **AI5 — graph diagnostics** | explain seeds/edges/drops/stale | без history | debug one failure E2E |
| **AI6 — PPR/RWR** | opt-in graph rerank | не default | measurable gain over one-hop |
| **AI7 — impact/path API** | dependents/dependencies/impact/path | no unrelated tools | real task benefit |
| **AI8 — Git history** | optional rank features | no correctness proof | change-task evidence |
| **AI9 — module graph** | one ecosystem adapter | не все ecosystems | justified by failures |
| **AI10 — incremental graph** | reuse unchanged nodes/edges | no weaker identity | perf + correctness |

---

# 12. Implementation backlog

## P0 — после первого real feedback

- [ ] Запустить ast-index external baseline на том же pinned repository/task set.
- [ ] Сохранить exact ast-index commit/config/raw outputs.
- [ ] Выделить реальные ACE failures, где relationship graph мог бы помочь.
- [ ] Ввести `SymbolNode`, `SymbolEdge`, `SymbolGraphSnapshot`.
- [ ] Сделать in-memory TypeScript graph builder.
- [ ] Получать edges из AST refs + LSP resolution.
- [ ] Bind graph к ACE `sourceSnapshotDigest`.
- [ ] One-hop expansion за feature flag.
- [ ] Trace каждый graph-added candidate.
- [ ] Сравнить hybrid vs hybrid+graph.
- [ ] Harbor paired tasks только если retrieval effect реален.

## P1 — если P0 подтвердил пользу

- [ ] Persistent graph adapter.
- [ ] Incremental reuse unchanged nodes/edges.
- [ ] Dependents/dependencies/impact/path API.
- [ ] PPR/RWR ablation.
- [ ] PageRank feature.
- [ ] Related-test relation.
- [ ] Branch-delta boost.
- [ ] Graph-aware context budget.
- [ ] Compact graph rendering.
- [ ] Explain/debug report.

## P2 — только по evidence

- [ ] Git hotspot/history collector.
- [ ] Risk/proven ranking.
- [ ] Module dependency graph.
- [ ] Multi-root cross-repo relations.
- [ ] External dependency stubs.
- [ ] Framework relation providers.
- [ ] Optional graph UI.

---

# 13. Performance / scaling requirements

Измерять:
- graph build wall time;
- incremental graph update;
- node/edge counts;
- storage bytes;
- RSS;
- expansion p50/p95;
- LSP resolutions/build;
- cache reuse;
- stale detection latency.

High-degree guardrails:
- degree cap;
- edge-type quotas;
- hub suppression;
- no unlimited transitive traversal.

---

# 14. Security / privacy / provenance

- source bytes не логировать в versioned artifacts;
- raw traces external + hashes;
- edge связан с source range/digest;
- sensitive-path policy до graph ingestion;
- external dependency source не индексировать автоматически;
- cloud policy не меняется;
- Git history author metadata не отправлять наружу без policy;
- graph cache не допускает cross-workspace leakage;
- old graph snapshot не подтверждает current worktree.

---

# 15. Связь с Roo Code research

[roo-code-adoption-plan.md](./roo-code-adoption-plan.md) и этот документ дополняют друг друга.

**Roo Code полезнее как источник идей про:**
- adaptive chunking;
- indexer ergonomics;
- watcher/concurrency;
- IDE integration;
- search UX.

**ast-index полезнее как источник идей про:**
- symbol/reference graph;
- impact analysis;
- graph re-ranking;
- PageRank/PPR;
- Git-history ranking;
- compact structural context.

Не внедрять Roo hierarchical chunking и ast-index graph одновременно: feedback не покажет, что именно дало эффект.

---

# 16. Definition of success

Не "мы реализовали graph".

Успех, если на untouched/pinned tasks:
1. качество не хуже baseline;
2. graph rescue возвращает missing useful context;
3. агент делает меньше бесполезных file reads/search loops;
4. реальные provider tokens/cost уменьшаются либо success растёт при сопоставимом budget;
5. latency приемлема;
6. результат воспроизводим;
7. graph freshness/provenance не ослабляют ACE.

Если этого нет — feature остаётся experimental или удаляется.

---

# 17. Самый короткий путь

**Не начинать с PageRank, history или полноценного persistent graph.**

```text
1. Current ACE real feedback
2. External ast-index baseline
3. In-memory AST+LSP symbol graph
4. One-hop graph expansion
5. Retrieval ablation
6. Harbor paired run
7. Только затем PPR/PageRank/history
```

Это минимизирует риск снова несколько дней строить архитектуру без feedback.

---

## Source index

### ast-index
- [README](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/README.md)
- [USER_GUIDE](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/USER_GUIDE.md)
- [Cargo.toml](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/Cargo.toml)
- [Tree-sitter parsers](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/parsers/treesitter/mod.rs)
- [Indexer](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/indexer.rs)
- [SQLite/FTS/cache](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/db.rs)
- [Explore + RWR](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/explore.rs)
- [Symbol graph](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/graph/mod.rs)
- [Rank/PageRank/history](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/src/commands/rank.rs)
- [MCP server](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/crates/ast-index-mcp/src/main.rs)
- [MIT License](https://github.com/defendend/Claude-ast-index-search/blob/6ca99bde97627224f9217c7962e3dff9944c7a87/LICENSE)

### ACE
- [Local structural index](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/local-code-index.ts)
- [Qdrant hybrid provider](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/qdrant-context-provider.ts)
- [LSP adapter](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/adapters/lsp-semantic.ts)
- [Context delivery](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/domain/context-delivery.ts)
- [Retrieval evaluation](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/3180bd09f07a055552aae98f3aa30633772b61bc/src/domain/retrieval-quality-evaluation.ts)
- [Real feedback loop plan](../plans/ace-real-feedback-loop.md)
- [Roo Code research](./roo-code-adoption-plan.md)
