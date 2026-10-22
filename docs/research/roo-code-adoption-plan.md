# Что ACE может перенять из Roo Code: исследование и план экспериментов

> **Статус:** исследование кода и план, **не утверждение о выигрышах ACE и не согласование новой реализации**.  
> **Дата:** 2026-10-22.  
> **Зафиксированный Roo Code:** [RooCodeInc/Roo-Code@`b867ec9`](https://github.com/RooCodeInc/Roo-Code/tree/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16).  
> **Зафиксированный ACE:** [chris-madsen/Mult-agent-AI-Orchestration@`66410b2`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/tree/66410b246de11af0e559abec70bf5dd96fa8be77).  
> **Цель:** определить конкретные механизмы Roo Code, которые стоит проверить/адаптировать в ACE ради **лучшего поиска нужного контекста, меньшего объёма переданного контекста, более быстрых обновлений и удобного feedback loop** — без копирования уже реализованных подсистем, без выдуманной экономии токенов и без ослабления гарантий provenance.
>
> **Источник выводов:** статическое чтение указанных двух исходных деревьев и документации Roo Code. В этом исследовании **не запускались** ни Roo Code, ни ACE, ни Harbor. Всё, что касается ожидаемого выигрыша, явно обозначено как *гипотеза*.

## 0. Главный вывод

У Roo Code есть **реальная Tree-sitter-aware система индексации исходников**, Qdrant, embeddings, инкрементальный сканер, watcher, кэш, ограничения параллелизма, настройки top-K/score, понятная выдача `codebase_search` и интерфейс состояния индекса. Это ценная практическая реализация, но не повод заменять ею ACE.

В проверенной встроенной цепочке Roo Code:

`Tree-sitter/фрагменты → embeddings → один dense Qdrant query → codebase_search → Roo agent`.

В текущем ACE:

`ast-grep/структурные кандидаты → dense + sparse(BM25)/RRF → [опционально reranker] → точная повторная проверка исходника + LSP → компактная доставка/expand/receipts → MCP agent`.

**Это сравнение реализаций, а не доказательство превосходства одной системы.** Roo Code **не показал в изученном `codebase_search`** слияния sparse + dense по RRF или проверки LSP-определений; это *не* утверждение, что в Roo вообще нет других поисковых инструментов. У Roo отдельно есть `search_files` через ripgrep; он не интегрирован в указанную ветку векторного поиска как RRF.

**Практический приоритет:** взять у Roo Code подход к *эргономике, адаптивному чанкингу и ресурсно-ограниченной индексации* в качестве **экспериментальных альтернатив**, а не тащить заново его vector store или писать второй RAG. При этом первым делом завершить [существующий план реального feedback loop](../plans/ace-real-feedback-loop.md), чтобы идеи оценивались по фактическим задачам.

## 1. Карта существующего кода: «у Roo есть / у ACE есть / чего нет»

| Область | Roo Code: проверенный механизм | ACE: существующий механизм | Вывод |
|---|---|---|---|
| CST / Tree-sitter | `CodeParser` и `languageParser` извлекают query captures и вложенные узлы | `ast-grep outline` + `local-code-index` | **Не переписывать парсер**; сравнить правила выбора чанков |
| Большие AST-узлы | Узел крупнее допуска разворачивается в дочерние; leaf делится по строкам | Структурный кандидат по диапазону символа, затем проекция при доставке | **Проверить** bounded hierarchical chunking |
| Малые символы и файлы без captures | Минимальный размер узла, fallback text chunking в отдельных ветках | Строгое coverage/fail-closed, без parser fallback | **Не копировать напрямую**: нужен отдельный уровень доверия |
| Классы/методы, имена | Извлекается `childForFieldName("name")` или дочерний identifier | AST имя + `semanticAnchor` для LSP (после фикса CST→LSP) | **Изучить точный name-node extraction**, не заменять LSP эвристикой |
| Dense поиск | 1 embedding запроса, Qdrant cosine similarity и score threshold | Dense уже есть | Повторная реализация **не нужна** |
| Sparse / fusion | В просмотренном `searchIndex` и Qdrant `query` нет BM25/RRF | Sparse BM25, hybrid RRF и ablations | **Сохранить** наши стратегии; мерить, помогает ли усложнение |
| Фильтр по директории | `directoryPrefix` → индексированные `pathSegments` | Есть hints `focused_path/open_paths` с boost; отдельный префикс-фильтр не подтверждён | **Кандидат** для точного optional scoping |
| Порог релевантности и top-K | Конфигурируемые `minScore` и `maxResults` | Предел кандидатов и стратегии; similarity threshold требует проверки по веткам | **Калибровать**, не копировать raw threshold в RRF |
| Инкрементальные изменения | VS Code watcher + debounce + SHA256 file cache | Snapshot reconciliation, content digests, reused vectors, safe publish | **Изучить UX/event batching**, сохранить atomic snapshots |
| Большие репозитории | `p-limit`, Mutex, ограниченное число pending batches и retries | Есть реальные 1k/10k index-scale runner и частичная переиндексация | **Сравнить cold/change-only время и RSS**, оптимизировать при реальной нужде |
| Статус индекса | Indexed/Indexing/Error/Standby, прогресс в UI, per-folder состояние | `ace_workspace_status`, readiness/coverage; нет Roo VS Code UI | **Перенять observability**, но сначала на MCP/CLI |
| Выдача агенту | Путь, score, строки и `codeChunk` | `ContextBundle`, source proof, expand, delivery metrics, reusable receipts | **Не упрощать контракт**; улучшить human-readable диагностику |
| Поставщики embedding | Несколько cloud/local providers через единый интерфейс | Process embedding port, разные worker/provider конфигурации | **Не дублировать** абстракцию; только измерять модели |

Важное различие: **Roo Code — VS Code agent + RAG**, а **ACE — отдельный context engine с MCP API**. UI Roo можно использовать как ориентир для будущего клиента ACE, но интерфейс VS Code не должен проникнуть в ядро ACE.

### Точные места в исходниках Roo Code

- [`src/services/code-index/processors/parser.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/processors/parser.ts#L135-L213): Tree-sitter captures, переход к children и text fallback, имена через `childForFieldName("name")`.
- [`src/services/code-index/constants/index.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/constants/index.ts#L1-L23): параметры *именно этой версии*: `MAX_BLOCK_CHARS=1000`, `MIN_BLOCK_CHARS=50`, tolerance 1.15; это **не** целевые числа для ACE.
- [`src/services/code-index/processors/scanner.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/processors/scanner.ts#L78-L215): ignore rules, file SHA, ограниченный batch queue/concurrency.
- [`src/services/code-index/processors/file-watcher.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/processors/file-watcher.ts#L32-L185): create/change/delete coalescing с debounce 500 ms и progress events.
- [`src/services/code-index/cache-manager.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/cache-manager.ts): persisted per-workspace file hash cache.
- [`src/services/code-index/orchestrator.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/orchestrator.ts): состояния, initial/incremental, watcher lifecycle.
- [`src/services/code-index/search-service.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/search-service.ts#L27-L63): **один** `embedder.createEmbeddings([query])` и `vectorStore.search(...)`.
- [`src/services/code-index/vector-store/qdrant-client.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/vector-store/qdrant-client.ts#L399-L467): single-vector `client.query`, score threshold, limit, `pathSegments` filter, payload. [Схема коллекции](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/services/code-index/vector-store/qdrant-client.ts#L149-L167): dense cosine, без sparse-секции в данной конфигурации.
- [`src/core/tools/CodebaseSearchTool.ts`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/CodebaseSearchTool.ts#L70-L129): результат агенту — путь, score, диапазон, код.
- [`apps/docs/docs/features/codebase-indexing.mdx`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/apps/docs/docs/features/codebase-indexing.mdx): официальные настройки и описания состояний/провайдеров.
- [`LICENSE`](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/LICENSE): Apache License 2.0. В этом плане **нет копирования Roo-кода**. При будущем буквальном переносе потребуется выполнить условия лицензии/NOTICE и проверить third-party assets.

### Точные места в текущем ACE

- [`src/adapters/local-code-index.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/adapters/local-code-index.ts): структурные кандидаты, coverage, reused files, source digests.
- [`src/adapters/ast-grep-structural.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/adapters/ast-grep-structural.ts): `ast-grep outline`, byte-exact ranges, conservative name anchors.
- [`src/adapters/qdrant-context-provider.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/adapters/qdrant-context-provider.ts): retrieval stages, embedding, reranker, source reread, LSP, provenance.
- [`src/domain/context-delivery.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/domain/context-delivery.ts): locate/inspect projection, expand handles, duplicate suppression, delivery metrics.
- [`src/domain/retrieval-quality-evaluation.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/domain/retrieval-quality-evaluation.ts): Recall@k, MRR, nDCG и unknown-safe экономика.
- [`src/bin/ace-mcp.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/66410b246de11af0e559abec70bf5dd96fa8be77/src/bin/ace-mcp.ts): композиция Qdrant/embeddings/LSP/MCP.

## 2. Кандидаты к заимствованию — по приоритетам

### R1 — Adaptive structural chunking: иерархия вместо «один node = один chunk» [P0, эксперимент]

**Факт Roo:** `CodeParser` сначала берёт Tree-sitter captures. Если узел слишком крупный — пробует потомков; если большой leaf — режет по строкам. У нас уже есть структурные диапазоны, но нет эквивалентного проверенного **иерархического ограничения размера до embed/index**.

**Гипотеза:** большие функции и классы дают слишком громоздкие embeddings и заставляют ACE отдавать лишнее; сохранение дерева `declaration → child symbol → bounded leaf` улучшит Recall@k/компактность на конкретных запросах.

**Предлагаемая реализация:** **не** копировать Roo `1000` chars и его regexp/text fallback. В отдельной ветке добавить *опциональную* стратегию `structural_hierarchical` поверх ACE structural spans:
- parent/child и `sourceDigest` + exact byte offsets, kind/language/name; устойчивые ID по manifest;
- сначала method/function, при слишком крупном узле — verified AST children; для leaf — помеченный nonsemantic window **только в экспериментальном индексе**;
- не терять docstrings, annotations, imports, class signature/context; структурный parent остаётся expansion target;
- `semanticAnchor` только у настоящих проверенных именованных деклараций; LSP proof не наследуется текстовым окном автоматически;
- для nested/overload/re-export и Unicode измерять отсутствие ложных привязок;
- `segment_kind = structural_verified | window_unverified`, источник и coverage доступны в telemetry; production `direct` только после exact reread и отдельной LSP-проверки.

**Где менять в ACE (после baseline):** `src/adapters/local-code-index.ts`, `src/domain/retrieval.ts`; возможно новый `src/domain/structural-segmentation.ts`; `test/...` для реального ast-grep. Кандидаты с новым chunk identity потребуют отдельного Qdrant namespace / index-key, не мутации pinned freeze.

**Измерить:** распределение чанков (байты/токены p50/p95/max), coverage символов, anchor rate, Recall@1/3/5, MRR, контекстные bytes, дополнительное время индексации. **Принимать только если** retrieval на заранее зафиксированных задачах не деградирует, а компактность/полезность улучшается; иначе оставить текущий indexer.

**Ключевой риск:** Roo отбрасывает узлы меньше `MIN_BLOCK_CHARS`; ACE не должен молча терять короткие getter/security checks. Это отдельные gold-кейсы.

### R2 — Явный scope фильтр: directory/package + focused files [P0/P1, измерять]

**Факт Roo:** `CodeIndexSearchService.searchIndex(query, directoryPrefix)` передаёт prefix в Qdrant, где `pathSegments.N` фильтруют директорию. Отдельный `search_files` использует ripgrep.

**Текущее ACE:** `working_context.focused_path/open_paths` повышает рейтинг, но это **не то же самое**, что обязательное ограничение `path_prefix`. Проверять недоступность точного server-side фильтра прежде изменения порта.

**Гипотеза:** запросы, явно привязанные к конкретному пакету, будут давать меньше ложных одноимённых совпадений.

**Предлагаемая реализация:** в исследовательской ablation добавить optional **разрешённый** `path_prefix`/workspace scope; нормализовать repo-relative POSIX путь, запретить traversal, не допускать wildcard шире policy. В Qdrant push down только с тестами корректности; в иных стратегиях — один и тот же логический фильтр. Указывать в ответе, что поиск был *ограниченным*, не притворяться общерепозиторным `complete`.

**Ограничение:** автоматический hard filter по `focused_path` способен пропустить настоящего caller в другом пакете. Поэтому **не вводить по умолчанию**, сравнить scoped vs working-context boost на запросах с внешними зависимостями.

**Проверки:** path traversal, каталог с похожим префиксом, монорепо, symlinks, open/dirty paths, moved/deleted files, cross-package callsites. Метрики — Recall@k + false-positive rate и payload/token bytes.

### R3 — Управление confidence, max results и инструментальная видимость [P0, маленький PR]

**Факт Roo:** пользователь настраивает `Search Score Threshold` и `Maximum Search Results`, а `codebase_search` показывает `file path/score/lines/code`; статус индексатора виден рядом с чатом.

**Что перенять:** удобный **read-only диагностический** интерфейс поверх уже существующего `ace_workspace_status` и `ContextBundle`:
- ready/indexing/degraded/not_ready; indexed/failed/excluded counts, parser and embedding identity; last successful source snapshot;
- ответ top-K как компактная таблица `path:symbol:lines | strategy | raw rank | freshness | AST/LSP proof | estimated body bytes | returned bytes`;
- `why_this_result` только из **реальной** trace-метадаты, а не из LLM-объяснения; `unknown` при отсутствии данных;
- optional per-request `candidate_limit` только в безопасных пределах и после проверки текущего API-контракта.

**Чего не делать:** не применять одну косинусную отсечку к RRF/reranker scores. Их численные шкалы несовместимы. Порог допустим **только после калибровки отдельно для каждого retrieval stage** по реальным positives/negatives.

**Измерить:** сколько реально полезных кандидатов теряется при thresholds/top-K, как меняется agent body-read rate, recall и доставка. Приоритет этого пункта высок: это именно то, что даст человеку понятный feedback раньше сложных архитектурных изменений.

### R4 — Event coalescing и bounded indexing pipeline [P1; только если измерен bottleneck]

**Факт Roo:** VS Code `FileWatcher` coalesce `create/change/delete` с debounce 500 ms; scanner использует ограниченную concurrency/queue, `Mutex`, abort handling и retry, file SHA cache.

**Текущее ACE:** имеет snapshot+digest-based reuse/reconciliation и atomic publication, проверку изменений в реальном запросе, real-provider 1k/10k scale tests. **Не нужно заменять** это на Roo hash cache или destructive overwrite Qdrant.

**Гипотеза:** при интенсивном редактировании одного файла мы тратим лишний CPU на повторные структурные сборки/embedding или получаем высокую latency первого запроса.

**Предлагаемая реализация:** optional *event scheduler* перед уже существующим `buildLocalCodeIndex/reconcile`:
- bounded queue, per-path coalescing, cancellation/supersession, explicit backpressure;
- обработка изменений только на immutable workspace snapshot, а не голым VS Code event;
- `dirty/renamed/deleted/untracked` корректны, результаты публикуются только после полного provider success;
- failed batch не маркирует snapshot ready, не уничтожает ранее опубликованную версию;
- counter telemetry `events_received/events_coalesced/index_jobs_started/jobs_cancelled/embeddings_reused/snapshots_published`.

**Где:** слой наблюдения за FS/инкрементального расписания — отдельный адаптер, **не** код domain/provenance. Не тащить `vscode` dependency в ACE core.

**Bench:** существующие `npm run test:real-index-scale` 1k/10k, cold/warm/1-file edit/rename/delete/untracked; отдельно storm из частых edit/save. Метрики cold/warm/change-only p50/p95, vector reuse, RSS, CPU, число commit->ready transitions, падения/окна неполного покрытия. Только наблюдаемый выигрыш оправдывает реализацию.

### R5 — Language-aware fallback и Markdown segmentation [P1/P2, только как отдельная политика]

**Факт Roo:** `supported-extensions.ts` явно перечисляет fallback языки (`.vb`, `.scala`, `.swift`), а `parser.ts` обрабатывает Markdown headings/sections. Если Tree-sitter captures пусты, возможна нарезка по строкам. Это расширяет поисковое покрытие ценой меньших гарантий.

**Текущее ACE:** parser coverage считает отсутствие структурных доказательств настоящей проблемой; документацию/историю ACE планирует искать через отдельные source ports, а не переименовывать arbitrary text в `code`.

**Гипотеза:** явно помеченные `unverified_text_window` кандидаты помогут находить полезные сообщения в скриптах, конфигурациях и Markdown, не портя structural evidence.

**Условия эксперимента:** держать отдельный `candidate_type` и источник (docs/config/text), отдельный индекс/namespace или namespace-scoped filtering; no LSP proof, no false `complete`, preserve provenance bytes; никогда не индексировать секретные/запрещённые файлы и не смешивать такой текст с verified code. Не включать fallback глобально ради искусственного повышения coverage.

**Что проверить:** короткие файлы, Markdown fenced code, большие конфиги, неизвестные расширения, null bytes/invalid UTF-8, policy denial, security leakage, шум на кодовых запросах.

### R6 — Видимость прогресса и нескольких workspace [P1 UX, после первой метрики]

**Факт Roo:** per-folder instances/status и progress notifications; пользователь видит `Indexed`, `Indexing`, `Error`, `Standby` и может менять поиск из UI.

**Что перенять:** стабильные поля статуса ACE для CLI/MCP, затем (по необходимости) тонкий VS Code client/extension panel. **Не пытаться одновременно писать IDE-расширение и проверять retrieval.** Сначала нужен HTML/JSON report и ясное `NOT_READY` с причиной.

**Приёмка:** в монорепо и multi-root workspace status не смешивается; нет false-green при частичном индексе; source identities и policy isolation сохранены.

### R7 — Embedding provider ergonomics и WASM parser loading [P2, не блокирует feedback]

**Факт Roo:** несколько providers (локальные и облачные), конфигурация моделей и размеров в UI; `web-tree-sitter` и lazy WASM parser loading снижает привязку к native Electron addons.

**ACE уже абстрагирует embeddings и имеет выбор provider/worker.** Не переносить список облачных API как массовую feature. Допустимы:
- отдельный исследовательский comparison по зафиксированным моделям, локальный/offline по умолчанию;
- production cloud inference **только** после approval, data-class policies, cost/egress measurement;
- benchmark lazy WASM vs ast-grep process overhead только если профилирование покажет, что parser startup/RSS — существенный bottleneck.

## 3. Что **не** копировать из Roo Code

| Изученное поведение | Почему нельзя переносить «как есть» |
|---|---|
| Фиксированные `1000`/ `50` символов и выбрасывание мелких узлов | Произвольная граница может потерять короткие критичные символы, распилить declaration или исказить token economics |
| Линейный fallback как равноценный CST | Нарушает semantic proof/coverage, особенно в LSP |
| Один dense Qdrant query вместо существующего ACE hybrid | Это ухудшило бы функциональное покрытие; dense можно **выбрать как ablation**, но не заменять все режимы без измерения |
| Слепое `score_threshold` на hybrid/RRF | Одинаковые численные пороги не сравнимы между score scales |
| Удаление Qdrant collection при смене dimension / удаление старых chunks перед успешной публикацией новых | У ACE есть snapshot/alias/lease/provenance invariants; нельзя ухудшать crash consistency |
| Поиск в состоянии `Indexing` с подразумеваемым полным охватом | Частичное покрытие должно отражаться в `sourceCoverage`, warning и `complete=false` при required evidence |
| Автоматический облачный embedding без политики | Возможен egress приватного кода; запрет по умолчанию |
| Прямая зависимость ACE domain на `vscode` | Разрушит MCP/CLI/Harbor/headless portability |
| Raw source или credential в диагностических отчётах Git | Секреты/приватный код не должны попадать в публичные artifacts; хэшированная redacted telemetry по умолчанию |

Это инженерные рекомендации по **нашей** политике ACE; они не утверждают, что Roo Code «небезопасен». В частности, недопустимость destructive index changes связана с более строгими гарантиями нашего проекта.

## 4. Общий экспериментальный протокол: измерять пользу до оптимизации

### 4.1 Первая измеримая точка — существующий ACE feedback plan

Сначала выполнить [`docs/plans/ace-real-feedback-loop.md`](../plans/ace-real-feedback-loop.md):
1. реальный Qdrant + FastEmbed + ast-grep + LSP + `ace_context` на неизменном checkout; trace CST → LSP;
2. один **настоящий** Harbor paired smoke **Codex native / Codex + ACE optional**, одинаковые task/model/runtime и raw usage;
3. расширить до 10 реальных фиксированных QnA/кодовых задач (например SWE-Atlas QnA при доступной и проверенной версии);
4. отдельно retrieval rank evaluation на RepoBench-R или другом готовом dataset, но **не** выдумывать 20 ручных gold questions;
5. отделять *delivery payload tokens* от *provider-reported agent total tokens*. `ACE_NOT_USED`, `UNKNOWN`, `BLOCKED` — допустимые результаты.

**Не блокировать первый feedback ради внедрения всех идей Roo.**

### 4.2 Справедливый выбор улучшения

- **Baseline A:** текущий ACE dense; **Baseline B:** ACE sparse; **Baseline C:** ACE hybrid RRF; дополнительные ветки могут быть отложены.
- **Candidate D:** ровно *одна* идея Roo за раз (`adaptive segmentation`, `path_scope`, `index_scheduler`), при идентичном source revision/model/context budget.
- **Опциональный конкурент:** Roo native `codebase_search` на том же pinned репозитории/embeddings, но его output/agent tooling существенно отличается. Чтобы сравнить *retrieval*, надо выровнять embedding model, source snapshot, top-K/byte budget и gold; чтобы сравнить *агента*, отделять различие Roo-vs-Codex runtime от влияния retrieval.
- Raw logs и immutable manifests хранят отдельно от PR; только hash/reconciled summary — в Git. Никаких новых «PASS» из одного только CI.

### 4.3 Метрики и как их честно считать

**Слой index:** index coverage по файловым типам; число structural verified / unverified; доля совпавших LSP anchors; snapshot completeness; cold/warm/change-only wall clock, RSS, количество пересчитанных/повторно использованных embeddings.

**Слой retrieval:** Recall@1/3/5, MRR, nDCG@5, correct file+exact span, latency p50/p95, ошибочные scopes, duplicate sources, failures/partial, payload `structuredContentBytes`, `newContextBytes`, `projectionBytesAvoided`; model-tokenized body count как отдельная **оценка**, а не счёт модели.

**Слой agent:** успешность задачи, quality/grader, actual `ace_context`/expand calls, native file reads, *real provider-reported* input/cached/output tokens, total cost, elapsed time. Токены MCP-пейлоада нельзя молча добавлять к provider totals повторно или считать их синонимом.

**Минимальный per-query record:** `dataset/task_id | source_sha | strategy | candidate_type | path+range | rank | LSP/AST proof | freshness | response_bytes | retrieval_ms | gold_match | errors`. Для agent record добавить model/runtime, tool call correlation, actual usage и quality.

**Критерий принятия идеи:** predeclared **non-inferior quality** на untouched subset и улучшение выбранной метрики при корректной статистике/повторах. Установить численный порог **до** финального holdout; не подгонять его после результатов. Если проигрыш/нулевой эффект — **REJECT**, оставить экспериментальную ветку, не менять default.

## 5. Порядок отдельных PR: маленькие обратимые шаги

| PR / этап | Что доставить | Зависимость | Проверка «готово» |
|---|---|---|---|
| **R0 — docs-only (этот PR)** | Source-linked сравнение и гипотезы | нет | GitHub plan, никакие runtime claims |
| **F0 — first actual feedback (уже запланирован)** | Qdrant/ACE real E2E + Harbor native/ACE optional paired, raw usage | окружение + Codex auth | ≥1 настоящая парная задача, raw receipts; отрицательный результат допустим |
| **R1 — diagnostics** | Компактный сравнительный retrieval report/top-K и source coverage с LSP | F0 либо независимый real-provider query | Debugging одного failure без чтения огромных логов |
| **R2 — hierarchical AST ablation** | Адаптивные bounded structural nodes и несемантические fallback segments только в эксперименте | конкретные R1 failures | Holdout Recall не ухудшен, measured context bytes выиграли — иначе отказ |
| **R3 — explicit path scope ablation** | Произвольный user-provided safe prefix filter vs current working-context boost | pinned repo + tests | Нет false negatives на cross-package gold |
| **R4 — index scheduler** | Debounce/queue/cancellation над safe reconcile | perf bottleneck доказан | 1k/10k + edit-storm лучше при прежнем snapshot safety |
| **R5 — editor UX/other languages** | Status/progress client, optional parser model comparison | R1–R4 as needed | Никакого VS Code в ядре; unknown-safe coverage |

**Правило scope:** один механизм на PR; не редактировать старые frozen manifests/holdouts, не совмещать с PR на Graphiti/Vertex/Harbor gate; тестировать только реально затронутые контракты плюс нужный E2E. Не создавать вторую реализацию Qdrant service или AST-парсера.

## 6. План реализации по задачам (краткий технический backlog)

### P0 — чтобы получить пользу сейчас
- [ ] Проверить raw state на текущем `main` и закончить **первый** Codex+Harbor feedback loop из уже существующего плана (это главный блокер любых ROI-выводов).
- [ ] Собрать один report для просмотра actual `ace_context`: top-K, exact path/span, AST/LSP verdict, delivered bytes, warnings, known sources, latency.
- [ ] Посчитать распределение размеров `CodeCandidate.text` и найти конкретные большие/мелкие узлы с ошибками retrieval.
- [ ] Сформулировать измеримую, фиксируемую **до** запуска гипотезу для R1 или R2; выбрать **одну**, а не делать всё сразу.

### P1 — только после baseline
- [ ] Внести `structural_hierarchical` как opt-in индексную стратегию; отдельные IDs/collection/index-key, preserve exact source/range/provenance.
- [ ] Добавить explicit path scope и провести scoped/non-scoped retrieval paired eval.
- [ ] Сравнить `index_scheduler` c нынешним ACE на 1k/10k и edit-storm; оставить только если delta объяснима.
- [ ] При диагностированном недостаточном coverage провести language-aware fallback в *отдельном несемантическом источнике*.
- [ ] Улучшить status/progress MCP/CLI, без обязательного UI.

### P2 — исследование без блокирования продукта
- [ ] Сопоставить Roo embedded vector retrieval как один внешний baseline, при одинаковых источниках и эмбеддингах.
- [ ] Профилировать WASM lazy parser против ast-grep process только при заметных расходах на парсинг.
- [ ] Проверить UX нескольких workspace и opt-in cloud embedding с audit/egress policy.

## 7. Риски, контроль изменений и определение «успеха»

1. **Смешение причин.** Roo agent + Roo RAG vs Codex + ACE не изолирует качество индекса. Держать агента/model/tool budget одинаковыми в основной паре; Roo-native — только отдельное исследование.
2. **Gold mismatch.** RepoBench snippet relevance не равно AST candidate ID. Нужен auditable exact-span mapping; `unmappable` не считать ни TP, ни FN.
3. **Caching false win.** Разделять cold/warm и прогретые модели; фиксировать source/model/runtime versions.
4. **Строгий индекс.** Не допускать копирования Roo «сначала удалить старые points, потом upsert» поверх ACE atomic publish.
5. **Достоверность.** Нет raw Codex usage/provider trace → `NOT_MEASURED`, не «экономия».
6. **Лицензии.** Apache-2.0 позволяет адаптацию на условиях лицензии; если переносим буквальный код или assets — сохранить license/copyright/NOTICE, зафиксировать источник и выполнить отдельный legal/SBOM review.
7. **Исторические данные.** Старые mock/forced synthetic Harbor отчёты не становятся proof лишь потому, что PR содержит новую таблицу.

**Definition of Done для этого документа:** проверяемые ссылки на pinned Roo/ACE исходники; матрица «в наличии / кандидат / не переносить»; обратимый PR backlog; конкретные измеримые условия; приоритет первого реального feedback. **Не** считается выполнением: PR без real benchmark, passing tests, неточное обещание `5×`, или переписанный indexer.

**Первое решение после прочтения:** *не внедрять Roo-паттерны пачкой*. Довести первый F0 trial до raw results. По его реальным ошибкам выбирать между R1 (чанки), R2 (scope) и R4 (индексация), затем делать один контролируемый эксперимент.
