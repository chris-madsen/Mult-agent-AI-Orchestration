# ADR-000 — Реестр согласованных архитектурных решений

**Статус:** Recorded  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

## Матрица ответов владельца проекта

> **2026-10-24 precedence:** MCP-first rows and the Hermes MCP injection text below are dated historical decisions. ADR-017 now governs planned Bifrost model-bound delivery, ADR-016 documents native Hermes, and MCP remains explicit tools only. LangGraph orchestration is external to ACE.

| № вопроса | Решение пользователя | Где зафиксировано |
|---|---|---|
| 1 | C — независимое ядро; сначала Codex | ADR-001 |
| 2 | B — гибридно: code intelligence локально, документы в облаке | ADR-001, ADR-003 |
| 3 | B — один Unified MCP; сохранить возможность изучить более глубокую интеграцию C | ADR-001 |
| 4 | Jev как кандидат Strategy Selector; сравнить с правилами, решение пока открыто | ADR-002 |
| 5 | A — Vertex AI RAG Engine для документов | ADR-003 |
| 6 | A — Qdrant для локального RAG по исходникам | ADR-003 |
| 7 | C — сравнить локальные и облачные embeddings | ADR-003 |
| 8 | B — Tree-sitter / ast-grep для AST | ADR-004 |
| 9 | D — benchmark Serena vs TypeScript Language Service | ADR-004 |
| 10 | C — AST/LSP сначала; дополнительный граф при подтверждённой пользе | ADR-004 |
| 11 | B — incremental indexing + working-tree overlay | ADR-004 |
| 12 | D — ступенчатый AST/LSP → data-flow/CFG → runtime/tests при необходимости | ADR-004 |
| 13 | D, уточнение — immutable archive + **Graphiti** (не Mem0 как обязательный компонент) | ADR-005 |
| 14 | C — архив автоматически, извлечённые факты; критические решения подтверждаются | ADR-005 |
| 15 | C — расширяемый импорт, первый Codex | ADR-005 |
| 16 | B — структурированный Context Bundle + progressive disclosure | ADR-006 |
| 17 | D — relevance-first, **без фиксированного token cap**; длинный созданный агентом код не обрезать | ADR-006 |
| 18 | B — fallback к стандартным инструментам Codex при технических сбоях; auth/security fail-closed и журналирование | ADR-007 |
| 19 | B — код локально по умолчанию; облачные embeddings строго opt-in | ADR-007 |
| 20 | E — уже установленный локальный Kubernetes; модульный монолит; без искусственных микросервисов | ADR-008 |
| 21 | Пока только учёт токенов и обязательные security/failure logs; остальная observability отдельно | ADR-009, ADR-010 |
| 22 | D — baseline + Serena на раннем этапе, Augment и графовые системы в итоговом сравнении | ADR-009 |
| 23 | **Harbor** как выбранный framework; token usage из Codex, benchmarks с качественным gating | ADR-009 |\n| 24 | Cursor-like **hybrid context architecture principles**, но собственные maintained компоненты; универсальная MCP-граница; Qdrant остаётся local code store | ADR-014 |
| 25 | Для текущего Harbor feedback loop primary agent меняется с Codex на **Hermes**; GPT остаётся через ChatGPT/Codex OAuth (`openai-codex`), ACE подключается как native Hermes MCP; Codex остаётся comparison client | ADR-015 |

## Открытые исследования (не путать с несогласованными требованиями)

- **Jev**: выигрывает ли у rule-based routing по end-to-end метрикам?
- **LSP**: Serena или прямой TypeScript Language Service, с учётом latency/полноты/лицензии?
- **Embeddings**: какой локальный/облачный вариант даёт лучший retrieval и полную стоимость?
- **Code Graph**: когда дополнительный движок окупает свои расходы?
- **Context optimisation**: достаточно ли relevance-first или адаптивная стратегия даёт дополнительный выигрыш без потери фактов?
- **Harbor**: конкретные dataset adapters, совместимость версий Codex и сбор полных затрат требуют технического spike.

## Отложено

Полная observability (OTel, Prometheus/Grafana, Langfuse и т. п.), широкая multi-agent поддержка, enterprise AIOps и подробный Kubernetes topology design. Отложено **не означает запрещено**.

## Owner clarification — 2026-10-19 (after PR #2)

- **Ollama rejected as required/selected ACE dependency**. Embedding model and inference backend remain evidence-gated; Codex may compare real local candidates, e.g. Qdrant FastEmbed/ONNX, before production approval. Proposed experiment ADR-013.
- **LSP selection is still open by design**: Codex performs the Serena versus direct TypeScript Language Service comparison required by ADR-004. No new ADR predetermines the outcome.
- **Graphiti + FalkorDB local-first** confirmed; no automatic cloud processing of raw dialogue or extraction payloads. Concrete local inference remains to be verified under ADR-005/007.
- **Vertex RAG** continues as selected docs engine; use already-signed-in host `gcloud CLI` for REST/IAM/corpus read-only probes. No automatic private document import or billable corpus creation. Sign-in is not the same as approved data policy.
- **ADR-012 still Proposed** pending express owner approval of six acceptance rules. Spikes/E2E/Harbor may proceed immediately; 5× remains a target to test rather than a precondition to running tests.


## Owner clarification — 2026-10-21: Hybrid Context Engine

- **ADR-014 Accepted.** ACE строится как agent-neutral многоуровневый Context Engine через MCP: structural chunks + dense semantic + sparse lexical + optional reranking + LSP enrichment + working-state priors + docs + temporal memory + progressive/delta delivery.
- Мы **не копируем private implementation Cursor**. Берём архитектурные принципы, а maintained компоненты выбираем свои.
- **Qdrant retained.** Turbopuffer не выбран для текущего local-first developer runtime; пересмотр только при измеренном cloud/multi-tenant scale bottleneck.
- После PR #94 de-bespoke migration structural/Qdrant/LSP в основном выполнена; следующий retrieval gap — hybrid sparse/BM25 + fusion, reranking, working-state context и repeated-context suppression.


## Owner clarification — 2026-10-23: Hermes primary feedback agent

- **ADR-015 Accepted.** Для текущих парных Harbor-прогонов primary agent — Hermes, а не Codex.
- Модель/подписка не меняются автоматически вместе с harness: GPT подключается через Hermes provider `openai-codex` с Hermes-owned OAuth store `~/.hermes/auth.json` (либо явно заданным `HERMES_HOME` / `HERMES_AUTH_JSON_PATH`); `~/.codex/auth.json` не переиспользуется, отдельный OpenAI/OpenRouter API key не является требованием этого маршрута.
- ACE остаётся agent-neutral MCP-сервисом. В ACE-optional arm Hermes получает `ace_context`/`ace_expand` через native MCP registration; baseline arm не получает ACE.
- Исторические Codex benchmark artifacts остаются историческими Codex artifacts и не используются как доказательство Hermes E2E.


## Owner clarification — 2026-10-24: Bifrost and MCP roles

- Bifrost is the accepted **planned** LLM model-request gateway for configurable-endpoint agents; thin Go ACE Connector, ACE Gateway Projection API and final provider-wire proof remain unimplemented/unapproved (ADR-017).
- Native Hermes ContextEngine/JSONL bridge already exists (ADR-016), and must not double-project a Bifrost-transformed request.
- MCP is the existing **explicit tools plane** (`ace_expand`, status, diagnostics, optional search), not a required route for automatic model-context injection. Previous MCP-first statements are retained only as dated historical records.
- Multi-agent scheduling using LangGraph stays outside ACE.
