# ADR-005 — Неизменяемый архив сессий и temporal memory на Graphiti

**Статус:** **Accepted**  
**Вопросы:** 13D (Graphiti), 14C, 15C  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

## Контекст

Prompt caching и compaction не гарантируют сохранения причин старых решений, отвергнутых альтернатив и дословных диалогов между сессиями. Нужно восстанавливать инженерные обсуждения через дни и недели; память должна уметь отличать старое решение от нового.

## Решение

1. Сохранять **оригинальные Codex-диалоги как неизменяемый источник истины** с идентификатором сессии, временем, проектом и ссылками на исходный контент. «Immutable» означает неизменяемость сохранённого события, не отказ от безопасного удаления по явному требованию владельца.
2. Использовать **Graphiti** как выбранный temporal knowledge-graph слой для извлечённых событий, решений, отношений и истории изменений. **Не делать Mem0 обязательным элементом.**
3. Автоматически архивировать новые сессии; извлекать потенциально полезные знания. **Критически важные ADR/инженерные решения требуют отдельного подтверждения**, а не превращаются в истину только из LLM-summary.
4. Адаптерная модель импорта позволяет в будущем добавлять ChatGPT, Gemini и другие источники; первый реализуемый источник — **Codex**.
5. Ответ памяти обязан ссылаться на первоисточник и указывать статус знания (предложено / принято / отменено / противоречие / неизвестно).
6. Ошибки ingest/extraction не должны повреждать неизменяемый архив. Инкрементальное повторное извлечение допустимо и должно быть идемпотентным.

## Альтернативы

- Только compacted summaries — могут терять детали.
- Только векторный поиск по истории — находит эпизоды, но хуже выражает temporal transitions.
- Mem0 — готовый продукт памяти, но владелец выбрал архив + Graphiti.
- Graphiti как единственное хранилище без originals — риск необратимой потери формулировок и provenance.

## Последствия и безопасность

Graphiti может требовать графовый backend и модельные вызовы для extraction, поэтому нужно отдельно оценить лицензию, способы развёртывания, стоимость ingest и маршруты передачи приватных диалогов. По умолчанию сырьевые разговоры/секреты остаются локальными; облачные операции требуют разрешения. Будут нужны retention, redaction и механизм удаления.

## Acceptance

- В новой сессии Codex находит обсуждение «две недели назад», правильные альтернативы, аргументы и ссылки на оригинальные сообщения.
- При смене решения сохраняется исторический факт предыдущего выбора; не происходит беззвучной перезаписи прошлого.
- Статус `proposed` не маскируется под `accepted`; конфликтные свидетельства представлены явно.
- Дополнительные токены/стоимость записи, extraction и retrieval входят в итоговую оценку.

## Пересмотр

При проблемах с точностью temporal retrieval, ограничениях Graphiti/его backend, избыточных расходах или невозможности выполнить требования локальности.

## Ссылки

- https://github.com/getzep/graphiti
- ADR-007, ADR-009

## Owner confirmation — 2026-10-19

**Graphiti + FalkorDB local-first is the accepted storage/privacy direction.** Raw Codex sessions and extracted facts stay local unless explicitly authorized for a particular cloud project and data class. Graphiti may need extraction-LLM, embedding and reranker backends: do not infer that a local FalkorDB alone proves extraction is local. Codex must probe actual processing/inference endpoints and enforce outbound policy; select/test a real local extraction backend using existing components and pin its model/version. No mandatory Ollama service. Preserve source pointers and pending/processed distinctions; test projection acknowledgements, restart reconciliation, temporal search and derived deletion. Missing extraction backend means honest `not_ready`, not synthetic success.
