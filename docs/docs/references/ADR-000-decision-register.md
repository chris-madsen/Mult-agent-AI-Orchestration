# ADR-000 — Реестр согласованных архитектурных решений

**Статус:** Recorded  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

## Матрица ответов владельца проекта

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
| 23 | **Harbor** как выбранный framework; token usage из Codex, benchmarks с качественным gating | ADR-009 |

## Открытые исследования (не путать с несогласованными требованиями)

- **Jev**: выигрывает ли у rule-based routing по end-to-end метрикам?
- **LSP**: Serena или прямой TypeScript Language Service, с учётом latency/полноты/лицензии?
- **Embeddings**: какой локальный/облачный вариант даёт лучший retrieval и полную стоимость?
- **Code Graph**: когда дополнительный движок окупает свои расходы?
- **Context optimisation**: достаточно ли relevance-first или адаптивная стратегия даёт дополнительный выигрыш без потери фактов?
- **Harbor**: конкретные dataset adapters, совместимость версий Codex и сбор полных затрат требуют технического spike.

## Отложено

Полная observability (OTel, Prometheus/Grafana, Langfuse и т. п.), широкая multi-agent поддержка, enterprise AIOps и подробный Kubernetes topology design. Отложено **не означает запрещено**.
