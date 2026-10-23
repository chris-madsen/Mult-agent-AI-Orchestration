# ADR-009 — Harbor как evaluation harness; точный учёт токенов и доказательство 5×

**Статус:** **Accepted (Harbor и принципы оценки)**; точный dataset adapter / сбор usage — предмет реализации  
**Вопросы:** 21 (минимальные метрики), 22D, 23 (Harbor принят)  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

> **Superseded agent-specific clauses (2026-10-23):** выбор Harbor, quality-first benchmarking и правила учёта остаются Accepted, но Codex-специфичный primary baseline/auth path для текущего feedback loop заменён решением ADR-015: Hermes + native MCP + `openai-codex` ChatGPT OAuth. Исторические Codex evidence/result artifacts не переименовываются и сохраняют исходный смысл.

## Контекст

Для CV и для отбора решений нужен честный измеримый эффект, а не оценка по размеру одного MCP-ответа. Codex уже сообщает токены; требуется готовый фреймворк для повторяемых задач, изоляции и сравнения конфигураций.

## Решение

1. **Harbor** — выбранный основной framework для воспроизводимых agent benchmarks. Запускать в нём Codex baseline и конфигурации с готовыми/собственными инструментами, используя собственные TypeScript/DevOps задачи и совместимые публичные datasets.
2. **Codex SDK / `codex exec --json`** — источники usage при подтверждении точного event contract установленной версии. Не конструировать usage из приблизительного `tiktoken` подсчёта, если доступны provider-reported метрики.
3. На раннем этапе сравнить **обычный Codex**, **Codex+Serena**, **Codex+Unified Harness**. В итоговый сильный comparative report включить **Augment Code**, **GitNexus / CodeGraphContext** (при наличии доступа/разрешений), и другие подходящие решения по одинаковым задачам.
4. Отдельные ablation tests для RAG, AST/LSP, routing, persistent memory; memory-сценарии — через новую сессию и сохранённую предысторию.
5. Дополнительные траты на **Jev, Vertex, embeddings, Graphiti/extraction и indexing** учитывать отдельно от токенов Codex, чтобы не «экономить» за счёт скрытых внешних вызовов.
6. Полноценные dashboards/tracing не входят в этот ADR (ADR-010).

## Формулы и предотвращение двойного учёта

Для одной завершённой задачи по данным Codex при сопоставимом контракте:

```
raw_total_tokens = input_tokens + output_tokens
uncached_input_tokens = input_tokens - cached_input_tokens
speedup_tokens = baseline_raw_total_tokens / harness_raw_total_tokens
```

- `cached_input_tokens` **входит** в `input_tokens` и **не добавляется** вторично.
- `reasoning_output_tokens` — подмножество `output_tokens` и не добавляется вторично.
- `cache_write_input_tokens` учитывать отдельно согласно фактической схеме провайдера (без автоматического сложения в total).
- При несовместимых или недоступных usage fields фиксировать `measurement_unavailable`, не подменять достоверные данные догадками.
- **Денежная стоимость** рассчитывается отдельно с тарифами для cached/uncached input, output и внешних модельных сервисов. Расходы на инфраструктуру и время индексирования — отдельно в cost report.

## Главное условие честности 5×

- 5× — **целевой результат, не факт**. Не объявлять его до итогового frozen holdout.
- Использовать одинаковую модель, версию, reasoning effort, исходный commit, задачу, environment, политику timeout и лимиты прав; документировать исходные конфигурации.
- **Baseline должен иметь обычные сильные нативные инструменты Codex** — не запрещать shell/rg/read/git/test, не отключать prompt caching/compaction для создания искусственного преимущества.
- Сравнивать энд-ту-энд **весь agent run**, включая неудачные, частичные и досрочно остановленные попытки. Не выбрасывать failures из статистики.
- Успешность/тесты/регрессии — качественный gate. Дополнительно показывать matched-success анализ на задачах, выполненных обеими конфигурациями, но не маскировать падение pass rate.
- Проверять повторы и распределения (медиана, разброс, p90, по классу задачи), не выводить общее преимущество из одной лучшей трассы.
- Одинаковое time budget и policy не должно обрезать код/артефакты по токенам ради искусственного успеха (ADR-006).
- Exploratory задачи используются для настройки; **отдельный неизменяемый holdout** — для финальных результатов.

## Минимальный result manifest (логическое требование, не готовая JSON Schema)

`run_id`, `task_id`, `suite_version`, `agent_version`, `model`, `reasoning_effort`, `repo_commit`, `config_id`, `toolset`, `success`, `test_result`, `input_tokens`, `cached_input_tokens`, `output_tokens`, `other_provider_tokens/cost`, `elapsed_ms`, `failure_reason`, `artifact_refs`, `environment_fingerprint`.

Сохранять raw events и итоговый JSONL/CSV с контрольными хэшами артефактов, без секретов/частного кода в открытом отчёте.

## Benchmark roadmap (без жёстких обещаний сроков)

1. Проверить на установленной версии Codex/Harbor запуск 1–2 smoke tasks и схему токенов.
2. Составить небольшой exploratory набор задач TypeScript/DevOps и sanity checks.
3. Провести paired comparisons baseline/Serena/harness, затем ablations.
4. Подготовить независимый holdout с повторениями и качественными проверками.
5. Добавить сильных готовых конкурентов в итоговое сравнение, если условия лицензирования/доступа допускают.
6. Опубликовать воспроизводимые цифры, run artifacts и ограничения интерпретации.

## Принятое разделение deployment

Харнесс размещается на существующем локальном Kubernetes (ADR-008); Harbor **не обязан** использовать этот Kubernetes и может запускать изолированные environments локально через Docker либо поддерживаемого провайдера. Это два разных контура.

## Пересмотр

Если Harbor перестанет поддерживать нужную версию Codex или не сможет корректно выдавать usage и требуемый coverage задач, решение о замене принимается отдельным ADR на базе результатов.

## Ссылки

- Harbor: https://github.com/harbor-framework/harbor
- Codex SDK usage types: https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts
- SWE-bench: https://github.com/SWE-bench/SWE-bench
- Terminal-Bench 2.0: https://github.com/harbor-framework/terminal-bench-2
- ADR-006, ADR-008, ADR-010
