# ADR-004 — AST, LSP, анализ зависимостей и актуальность индекса

**Статус:** **Accepted** для принципов; конкретный LSP-адаптер — pending benchmark  
**Вопросы:** 8B, 9D, 10C, 11B, 12D  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

## Контекст

RAG отвечает за discovery, но не доказывает, что конкретный символ или отношение существует. AST различает синтаксические конструкции; LSP и language service дают semantic definitions/references/types в пределах своих возможностей. Ни один из них сам не даёт гарантированно полный динамический call graph.

## Решение

1. **AST:** Tree-sitter / ast-grep как выбранное семейство готовых инструментов. Не писать собственный парсер.
2. **LSP:** сравнить **Serena** и прямую интеграцию **TypeScript Language Service / tsserver** по полноте и цене запроса. Финальный выбор пока отсутствует; кроме качества учитывать licence compliance (Serena application GPL-3.0-or-later, SolidLSP MIT).
3. **Code graph:** начинать с фактов, доступных AST/LSP и точного symbol resolution. Отдельный индекс графа вводить при подтверждённой пользе, не принимать GitNexus/CodeGraphContext как уже выбранную зависимость.
4. **Incremental indexing + working-tree overlay** как обязательное требование. Источник свежей информации имеет приоритет над persisted RAG; необходимо отслеживать незакоммиченные правки. При неизвестной свежести маркировать ответ как `stale/uncertain`.
5. **Impact analysis по необходимости:** сначала refs/types, далее адресный CFG/data-flow/CodeQL/CPG, затем проверка тестами/runtime traces при доступности; не выполнять дорогую цепочку на каждый запрос.
6. **Неполнота**: динамический DI, reflection, runtime registrations, вызовы между сервисами и непокрытые тестами пути нельзя считать отсутствующими из-за нулевых статических references.

## Альтернативы

- Только regex/grep — быстрый baseline, без разрешения символов.
- Один TypeScript Compiler API без Tree-sitter — технически реалистично, но не выбран для первого структурного слоя.
- Постоянно активный полный Code Property Graph — большой overhead без доказанной пользы.
- Полная переиндексация при каждом изменении — простая, но неэкономная и потенциально медленная.

## Источники фактов и маркировка

В Context Bundle указывать `source_kind`, `file`, `symbol`, `line_range`, `revision/hash`, `evidence_method` (e.g., `ast`, `lsp`, `runtime_test`) и флаг `completeness/uncertainty`. Набор полей приведён как логическое требование, не зафиксированная JSON Schema.

## Acceptance / проверки

- После изменения функции анализ показывает новый символ и не цитирует старый source как свежий.
- `find references` различает одноимённые символы (при поддержке server).
- Анализ unknown dynamic call не приводит к утверждению «точно не используется».
- Измерить влияние AST/LSP против Codex baseline и отдельных MCP инструментов; число tool calls, токены, ошибки статического анализа.
- Сравнить Serena и native language service на одинаковых задачах с лицензиями и runtime overhead.

## Пересмотр

При смене основного языка, неудовлетворительном качестве LSP или доказанной пользе сохранённого semantic index (например, SCIP) либо отдельного code graph.

## Ссылки

- https://github.com/tree-sitter/tree-sitter
- https://github.com/ast-grep/ast-grep
- https://github.com/oraios/serena
- https://github.com/sourcegraph/scip-typescript
- ADR-003, ADR-006

## Owner instruction — 2026-10-19

**Do not preselect an LSP or write a new ADR simply to choose one.** Codex must execute the existing ADR-004 experimental comparison: **Serena versus direct TypeScript Language Service**. Install both on comparable TS/JS fixtures; verify same-name definitions/references, writes vs definitions, types, diagnostics, source freshness, unsupported/dynamic cases, version/licensing and runtime overhead. Compare full agent task success, tool calls, latency and total token/cost. Retain failing cases and submit a reasoned selection to the owner; neither candidate becomes production-approved solely by being implemented. Experiments themselves are approved before final provider selection.


## Implementation clarification — 2026-10-21

PR #94 materially completed the de-bespoke direction:

- production structural discovery now uses pinned **ast-grep** rather than an ACE-maintained Tree-sitter node table;
- production semantic verification uses a generic JSON-RPC **LSP** adapter with an external maintained language server;
- request-time workspace reconciliation prevents stale indexed state from being called complete.

Therefore future work SHALL NOT rebuild a custom AST extractor or language-server project lifecycle. New languages are added by registering maintained ast-grep language support and a maintained LSP server/configuration.

LSP remains an enrichment/verification layer. Hybrid retrieval candidate discovery is defined by ADR-014/OpenSpec 007 and is not replaced by LSP.
