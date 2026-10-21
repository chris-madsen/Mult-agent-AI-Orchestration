# ADR-014 — Агентонезависимый многоуровневый Hybrid Context Engine через MCP

**Статус:** **Accepted**  
**Дата:** 2026-10-21  
**Проект:** Adaptive Context Engine (ACE)  
**Источник решения:** прямое решение владельца от 21.10.2026: брать архитектурные принципы Cursor-подобного многоуровневого code-aware retrieval, но выбирать собственные maintained компоненты и сохранять универсальное MCP-подключение.

## Контекст

Цель ACE — не просто выполнять vector search по коду. Агент не должен многократно заново читать одни и те же файлы, искать те же символы и повторно получать тот же контекст, если проектное состояние не изменилось.

При этом экономия токенов не может достигаться ухудшением инженерного качества. Retrieval должен объединять несколько независимых сигналов: семантический смысл, точные лексические совпадения, синтаксическую структуру, semantic relations из LSP, текущее рабочее состояние, документацию и temporal memory.

Cursor используется как архитектурная аналогия, а не как набор обязательных внутренних технологий.

## Решение

1. **ACE остаётся agent-neutral MCP Context Engine.** Codex — первый основной клиент, но ядро не зависит от конкретного агента/IDE.
2. **Structural code units:** maintained ast-grep/Tree-sitter tooling определяет структурные границы и compact outlines. Собственные parser/node tables запрещены без отдельного доказанного gap.
3. **Hybrid code retrieval:** Qdrant остаётся выбранным локальным store и должен поддерживать минимум две независимые retrieval ветви:
   - dense semantic retrieval;
   - sparse/lexical BM25 retrieval;
   с native fusion (первый кандидат — RRF).
4. **Reranking:** fused shortlist MAY проходить через локальный maintained cross-encoder/reranker. Конкретная модель выбирается только по quality/latency/license benchmark.
5. **Semantic enrichment:** definitions/references/types/diagnostics получают через maintained LSP servers behind generic LSP adapter. LSP не заменяет fuzzy retrieval.
6. **Working Context:** Git/working-tree state является first-class retrieval prior. IDE/agent MAY передать focus/open-file/range hints через MCP; hints не являются source truth.
7. **Docs and memory stay separate sources:** Vertex — authorized docs; Graphiti/FalkorDB — temporal derived memory; current source bytes — truth for current implementation.
8. **Progressive disclosure:** initial ContextBundle отдаёт минимально достаточный verified context; exact original доступен losslessly через `ace_expand`.
9. **Delta delivery:** стабильные evidence/bundle identities должны позволять клиенту указать уже известный контекст и не получать неизменившиеся большие body повторно.
10. **Content-addressed reuse:** embedding reuse привязан к chunk content + provider identity; publication remains provider-native through immutable Qdrant collections + atomic aliases.
11. **Quality first:** token reduction публикуется только при сохранённом/улучшенном task quality. 5× остаётся измеряемой гипотезой.
12. **Buy before build:** Merkle tree, отдельный lexical DB, code graph, custom router или другой subsystem вводятся только после измеренного gap в maintained primitives.

## Выбор Qdrant против Turbopuffer

Qdrant остаётся текущим решением ACE.

Turbopuffer — сильная cloud/object-storage search platform и разумный кандидат для будущего многопользовательского SaaS-масштаба. Но текущая ACE boundary требует local-first private-code retrieval, локальной разработки без cloud dependency и уже имеет работающий Qdrant lifecycle.

Поэтому migration на Turbopuffer сейчас не даёт достаточной выгоды относительно стоимости/риска миграции.

Пересмотреть решение, если:
- ACE становится cloud multi-tenant service;
- корпус достигает масштаба, где object-storage economics materially выигрывает;
- Qdrant operational burden/latency измеренно становится bottleneck;
- data policy разрешает соответствующий deployment.

## Maintained component map

| Capability | Selected/default direction |
| --- | --- |
| Structural parsing/outlining | ast-grep / Tree-sitter |
| Dense retrieval | Qdrant + approved FastEmbed/ONNX embedding |
| Sparse lexical retrieval | Qdrant sparse BM25 |
| Fusion | Qdrant Query API / RRF |
| Reranking | FastEmbed cross-encoder candidate, evidence-gated |
| Semantic relations | real LSP servers through generic adapter |
| Working state | Git/worktree + optional MCP host hints |
| Documentation | Vertex RAG under policy |
| Temporal memory | Graphiti + FalkorDB + immutable ACE source archive |
| Agent boundary | MCP |
| Exact expansion | ACE artifact handle / ace_expand |

## Acceptance

- Behavior-without-name, exact-symbol and config-key fixtures all reach the fused shortlist.
- Hybrid retrieval is compared against dense-only and sparse-only.
- Reranking stays only if it improves quality or compactness sufficiently.
- Dirty-tree changes are visible before `complete=true`.
- Optional focused/open files affect ranking but cannot make irrelevant or stale evidence current.
- Repeated unchanged evidence can be represented as a compact known reference rather than full retransmission.
- Exact code is re-read/verified before delivery.
- Natural-use agent benchmark reports quality, total tokens, duplicate context avoided, tool calls and failures.
- No agent-specific dependency is required inside ACE core.

## Ссылки

- ADR-001, ADR-003, ADR-004, ADR-005, ADR-006, ADR-009, ADR-012, ADR-013
- https://cursor.com/blog/secure-codebase-indexing
- https://qdrant.tech/documentation/search/text-search/hybrid-search/
- https://qdrant.tech/documentation/fastembed/fastembed-rerankers/
- https://turbopuffer.com/docs/architecture
