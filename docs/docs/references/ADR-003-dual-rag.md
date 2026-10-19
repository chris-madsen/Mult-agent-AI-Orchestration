# ADR-003 — Разделение RAG: Google Vertex AI для документации, локальный Qdrant для кода

**Статус:** **Accepted** — движки выбраны; embedding-модели определим по результатам оценки  
**Вопросы:** 2B, 5A, 6A, 7C  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-17  
**Источник решения:** обсуждение PRD v1.0 и выборы владельца проекта от 17.10.2026.  
**Статусы:** `Accepted` — решение принято; `Proposed` — требуется spike/проверка; `Deferred` — сознательно отложено.  

> **Граница документа:** ADR фиксирует решение, альтернативы, мотивы и критерии пересмотра. Конкретные классы, схемы БД, API-контракты, Kubernetes manifests и топология будут определяться в последующем Architecture Design.

## Контекст

Документация отражает требования и архитектурные решения; кодовая база меняется внутри агентной сессии и требует локальных актуальных индексов. Универсальный облачный индекс для обоих типов данных не соответствует выбранной стратегии локальности кода.

## Решение

1. **Google Vertex AI RAG Engine** — основной retrieval engine для документации проекта: README, ADR, specs, runbooks, контракты, руководства (при условии разрешённой отправки материалов).
2. **Qdrant** — выбранный локальный движок RAG по исходному коду, с hybrid dense + lexical/sparse поиском по необходимости. Это **не** означает, что Qdrant выполняет AST/LSP-верификацию.
3. Для кода использовать symbol-aware единицы: файл/символ/диапазон, плюс `repo`, `revision`, `working_tree_hash`, язык, provenance. Конкретная схема индексирования — отдельный design.
4. **Embeddings:** оценить облачные и локальные модели. Для приватного кода cloud embeddings доступны **только по opt-in на конкретный проект** (ADR-007).
5. Перекрывать устаревшие индексные попадания текущим working-tree overlay (ADR-004). Не выдавать старый сниппет как точный текущий код.
6. Документация может противоречить реализации. Возвращать оба факта с источниками, не молча заменять один другим.

## Альтернативы

- Единый Vertex RAG для документации и исходников — проще cloud pipeline, хуже изоляция и контроль рабочего дерева.
- LanceDB, SQLite FTS/vector — разумные альтернативы, но **первоначальное решение владельца уже Qdrant**. Пересмотр при явной эксплуатационной/качественной проблеме.
- Только grep/lexical индекс — нужен как baseline и fallback, но семантический retrieval по неизвестному поведению не покрывает.

## Последствия

**Плюсы:** независимость code retrieval от внешнего облака, раздельные политики данных, быстрый поиск по локальным изменениям через overlay.  
**Минусы:** две инфраструктуры retrieval, embedding pipeline, синхронизация версий и стоимость Vertex; повышенная интеграционная сложность.

## Критерии проверки

- Запрос «найди функциональность без имени символа» работает на коде; запрос «почему решили так» — на документации.
- Не возникает скрытой отправки приватного кода в Vertex или embedding API без разрешения.
- Все найденные code entries привязаны к точному source/hash/revision; stale не объявляется current.
- Benchmark code retrieval: lexical baseline vs Qdrant (для разных embedding-моделей), relevance, latency, индексирование, конечные токены/успех.
- Полная стоимость включает embeddings, indexing, cloud requests, не только токены Codex.

## Пересмотр

Если Qdrant проигрывает специализированному движку на наших задачах с заметной эксплуатационной нагрузкой или Vertex RAG не удовлетворяет требованиям к доступу, версии либо стоимости.

## Ссылки

- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/rag-quickstart
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/generativeaionvertexai-rag-import-files
- https://qdrant.tech/documentation/search/hybrid-queries/
- ADR-004, ADR-007, ADR-009

## Owner clarification — 2026-10-19: Ollama is not required

The selected code retrieval engine is **Qdrant**, not a model-serving wrapper. **Ollama is explicitly not selected or required.** Genuine code embeddings can be produced by a ready-made *local* inference library such as **Qdrant FastEmbed / ONNX Runtime**, with model and inference backend evaluated separately. These are candidates, not a silently approved production model. Codex may run real local candidate E2E and benchmark now; decide production model after measured recall, latency, multi-language behavior, throughput, resource usage, licensing and full agent quality/cost. Keep a distinct Qdrant collection/generation when models, dimensions or preprocessing change. See proposed ADR-013 and ADR-007.
