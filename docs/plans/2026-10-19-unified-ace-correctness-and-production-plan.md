# ACE — единый план исправления корректности и доведения до production

**Дата ревизии:** 2026-10-19  
**База объединения:** `main` @ `f935ded2159b88859204e03a44033969a5f2c468`, 2026-10-19, с перепроверкой критичных мест исходного кода и OpenSpec. Содержит существенные задачи из **обоих** планов: [Claude post-merge correctness](./2026-10-19-post-merge-correctness-plan.md) и [ACE production completion roadmap](./2026-10-19-ace-production-completion-roadmap.md).  
**Статус:** **единый канонический execution backlog, предложен к ревью**; это не отчёт о прохождении E2E и не заявление о готовности. Предыдущие два плана сохраняются как источники и исторические записи, но **не должны независимо запускаться как конкурирующие очереди задач**.  
**Цель:** завершить Adaptive Context Engine (ACE) как agent-neutral, read-only MCP context engine, сочетающий доказуемо актуальный код, разрешённую проектную документацию и локальную temporal memory, и измерить влияние на Codex в Harbor.

> **Текущий implementation/evidence status:** см. [ACE implementation / evidence ledger — 2026-10-20](../reviews/2026-10-20-implementation-evidence-ledger.md). Ledger отделяет уже слитую реализацию от ещё не выполненных real-provider/Harbor/owner gates; открытые чекбоксы ниже не означают, что код отсутствует.

> **Место в иерархии документов.** Этот файл — сводный координационный backlog с очередностью, зависимостями и Definition of Done. Он **не меняет** Accepted ADR, PRD и OpenSpec и не «закрывает» их чекбоксы. Авторитетный текущий подробный план исполнения: [OpenSpec 006 CODEX-EXECUTION-PLAN](../openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md). Normative acceptance: [DBC-01…14](../docs/architecture/07-architecture-fitness-contracts.md), [OpenSpec 006 tasks](../openspec/changes/006-production-retrieval-vertical-slice/tasks.md), [AGENTS.md](../../AGENTS.md). При конфликте актуальные прямые решения владельца и Accepted ADR имеют приоритет.

## 1. Что уже есть — **не переделывать ради галочки**

| Подсистема | Подтверждённый уровень на 2026-10-19 | Чего это **не** доказывает |
|---|---|---|
| Official MCP SDK | `ace_context`, `ace_expand`, `ace_workspace_status`, `ace_memory_search` через официальный TS SDK; client/Codex E2E, ошибки/отмена | Полноту всех провайдеров и production deployment |
| Code retrieval | Настоящая экспериментальная цепочка **FastEmbed/ONNX → local Qdrant → Tree-sitter → direct TS Language Service → exact worktree digest/range → ContextBundle**; 2000-строчный/25-строчный E2E, exact expansion, race/outage | Утверждённую embedding/LSP конфигурацию, большой semantic holdout, 5× |
| Index persistence | Контентный `index_key`, warm Qdrant reuse без повторного embedding при идентичном snapshot, rebuild после dirty edit, restart E2E | Инкрементальную индексацию изменённых файлов / overlay и масштабируемый cold start |
| Embedding comparison | FastEmbed/ONNX vs Sentence-Transformers/PyTorch CPU, pinned модель/артефакты, девять синтетических запросов; FastEmbed выиграл текущий эксперимент по скорости | Production approval или переносимость качества на реальные многоязычные репозитории |
| Semantic analysis | Direct TS LS уже включён; Serena 2.0.0 установлена и смогла пройти same-name smoke | Решение Serena-vs-TS LS на одинаковых больших fixtures, ресурсах и агентных задачах |
| Vertex | Рабочий `retrieveContexts` адаптер и IAM/API smoke. Создан и **одобрен владельцем** corpus `ace-europe-stage2` в `europe-west4`; ответ пустого corpus честно пуст | Retrieval реальных разрешённых документов, валидные версии/цитаты, DBC-14 |
| Memory | Immutable archive, стабильные episode ID при append, idempotent replay, shared-blob retention, cross-process tests; локальный FalkorDB healthy; Graphiti MCP boundary умеет enqueue `add_memory` и `delete_episode` | Реальные extraction/recall, подтверждение асинхронного завершения, derived purge, восстановление после crash, runtime `ace_memory_search` |
| Routing | Детерминированная policy и Jev-кандидат со spike/tests | Автоматический required-source routing в реальном `ace_context` и обоснованный Jev production use |
| Harbor | Native vs forced ACE 3 задачи × 3 повтора: обе группы **9/9 quality**; у forced ACE **1 571 768** vs native **891 950** total raw tokens; ratio **0.567482×** (ACE хуже); исторические артефакты сохранены | Преимущество ACE; forced-use не проверяет natural agent tool choice, не измеряет локальные compute/index costs |
| Local k3s | Qdrant и FalkorDB как dev-инфраструктура; проверена возможность disposable pod restart | Безопасный live worktree access из pod и production ACE workload |
| CI | Typecheck, contract/regression tests, lint, build пройдены для PR #8 | Реальные сервисные и natural Harbor acceptance gates |

Источники: [real-provider E2E](../reviews/2026-10-19-real-provider-e2e.md), [benchmark audit](../reviews/2026-10-19-ace-efficiency-benchmark-audit.md), [embedding comparison](../../benchmarks/reports/embedding-provider-comparison.md), [Serena comparison](../reviews/serena-vs-ts-language-service.md), [Graphiti recovery](../reviews/graphiti-archive-recovery.md), [Vertex corpus](../reviews/2026-10-19-vertex-gcloud-corpus-validation.md).

**Правило учёта:** «порт написан», «тест с mock прошёл», «настоящий provider E2E прошёл», «Codex agent E2E прошёл», «Harbor оценил пользу», «владелец одобрил» — **разные** состояния. Пометки `[ ]` ниже остаются открытыми до приложенного реального evidence. Сроки не зафиксированы: последовательность зависит от лицензий, локальных ресурсов и качества экспериментов; отсутствие финального provider selection **не блокирует** разрешённое исследование.

**Как читать единый backlog.** Треки **C-A…C-E** ниже — детализированные correctness-подзадачи существующих **W01…W16**, а не дополнительные самостоятельные требования к продукту и не новые DBC-ID. Их конкретные acceptance tests обязательны **до** нормативного закрытия соответствующих W; не ставить дублирующие галочки за одну работу. Для каждой гипотезы разделять `static-risk` → `reproduced` → `fixed` → `real-provider verified`. Пока не воспроизведено, нельзя утверждать, что баг уже проявился в production. P0 здесь означает приоритет проверки потенциально ложного source truth, а не доказанную эксплуатацию.

## 1A. Немедленные correctness-гейты после PR #8: пять треков Клода

**Источник:** [post-merge correctness review/plan](./2026-10-19-post-merge-correctness-plan.md). Основания перепроверены статически в \`main\` на указанном SHA; актуальные файлы: \`src/adapters/http-provider-boundaries.ts\`, \`src/adapters/qdrant-context-provider.ts\`, \`src/adapters/typescript-language-service.ts\`, \`src/adapters/local-code-index.ts\`, \`src/adapters/process-embedding.ts\`, \`src/bin/ace-mcp.ts\`, \`src/domain/memory.ts\`.

**Первая задача инженера — получить RED fixture** на зафиксированном commit, а не менять код вслепую. Воспроизводимость допускает controlled synthetic fixture; итоговая приёмка требует real Qdrant/worker/official MCP/Graphiti там, где это указано. Для публичного статуса фиксировать отдельно evidence static review и реальные результаты.

| Трек | Приоритет проверки | Инвариант и риск | Часть стратегического W |
|---|---|---|---|
| **C-A — Qdrant snapshot** | **P0** корректность/потенциальная гонка | Старый активный читатель никогда не теряет свой полностью опубликованный snapshot из-за upsert/GC нового | **W04**, W11, W12 |
| **C-B — LSP identity** | **P0** семантическая достоверность | Совпадение файла и приблизительных строк не считается доказательством точного символа | **W02–W03**, W12 |
| **C-C — Coverage truth** | **P0** ложная полнота | Неиндексированные *обязательные* исходники не скрываются за \`complete=true\` | **W04**, W08, W10, W12 |
| **C-D — Worker receipt** | **P0** кэш и провайдерная идентичность | Фактически загруженная embedding-модель, cache key и trace labels совпадают по верифицированной конфигурации | **W01**, W04, W12 |
| **C-E — Temporal as-of** | **P1 для memory release**, P2 для code-only | Исторический запрос не выдаёт текущее mutable состояние решения за прошлое | **W06–W09** |

### C-A — Snapshot isolation, atomic publication и безопасный GC Qdrant

**Статическое основание:** \`qdrantPointId(candidateId)\` в \`http-provider-boundaries.ts\` не зависит от \`index_key\`; \`reuseOrPopulateQdrantSnapshot\` переиспользует snapshot по filtered count; \`pruneQdrant...\` удаляет чужие ключи. Если при индексации S2 остаётся неизменившийся candidateId из S1, одинаковая точка потенциально перезаписывается ещё до завершения S2. Одни unit mocks не доказывают продакшн-гонку.

- [ ] **RED reproduction:** две независимые ACE MCP-процесса и реальный Qdrant, общий workspace/collection. A читает опубликованный S1, B меняет **только один** файл и собирает S2; проверить доступ к неизменённым символам S1 до/во время/после B.
- [ ] Зафиксировать формальный scope идентичности: \`workspace + immutable snapshot/index_key + candidate_id + embedding/schema identity\`. Сделать deterministic collision-resistant Qdrant point IDs; не превращать произвольные идентификаторы в UUID отбрасыванием не-hex знаков.
- [ ] Спроектировать состояния \`building → validated → published → retired\`, persisted manifest точного состава: candidate IDs/digests, provider/model+preprocessing, coverage, schema/parser revisions. Публикация — только **после** доказанного целостного upsert/verify; count-only check не удовлетворяет membership.
- [ ] Считать uncommitted reader S1 валидным до завершения его lease/snapshot transaction. Заменить unconditional prune на coordinated reader lifecycle (lease/refcount/equivalent), с process death и recovery; age/grace alone не доказывает отсутствие читателя.
- [ ] Конкурирующие same-snapshot writers, отмена/timeout посередине batches, несовпадение count/membership, рестарт reader/builder: ни одна ошибка S2 не портит S1; orphan cleanup fail-safe и bounded retention.
- [ ] Схема миграции старых Qdrant point IDs: новую версию namespace/collection либо controlled rebuild; **не** warm-reuse старых несопоставимых векторов.
- [ ] Точно задокументировать GC lease protocol, freeze/in-flight queries, хранение и operator-visible cleanup; избегать глобальной блокировки на все запросы, если можно изолировать snapshot.
- [ ] Real integration: A=S1, B=S2 и неизменённые символы; kill during upsert, kill during publish, stale count equal, invalid IDs, warm unchanged restart, changed restart, eventual cleanup.

**Definition of Done C-A:** S1 полностью доступен до окончания активного чтения; S2 невидим до atomic publish; ни один partially built snapshot не выдаётся как current; подтверждённая безопасная миграция/GC; реальный cross-process evidence с request IDs. **Важная зависимость:** от C-D (эффективный fingerprint модели) и C-C (точная coverage), прежде чем принимать reuse как проверенный.

### C-B — Точная семантическая идентичность LSP/AST

**Статическое основание:** \`makeQdrantContextProvider\` считает подтверждением любое LSP definition в том же файле, целиком укладывающееся по строкам в structural node. Это недостаточно для same-line declarations/nested scopes/aliases, даже если имя совпадает.

- [ ] RED fixtures: две декларации в одной строке; вложенное shadowing; одинаковые имена в разных классах/файлах; имя в комментарии/строке; перегрузки и re-export alias. Проверить не только provider output, но и consumer predicate.
- [ ] AST/Tree-sitter возвращает verified **identifier start/end byte span**, не только начало. Проверять, что anchor находится внутри declared identifier правильного parsed node.
- [ ] Явно нормировать coords: Tree-sitter **UTF-8 bytes** ↔ TypeScript **UTF-16 units**, one-based API и exclusive end; тесты CRLF, BOM, русские буквы и astral Unicode перед identifier.
- [ ] Сопоставлять declaration path+**exact identifier range/identity**, а не только \`startLine >= node.startLine\` / \`endLine <= node.endLine\`. Name alone — не доказательство; multi-definition/overloads/alias cases требуют явного validated mapping либо uncertainty.
- [ ] Убедиться, что LSP анализирует **ту же source/dep snapshot**, что verify. Если зависимые файлы изменились/semantic project snapshot уже несогласован, пометить LSP provenance неизвестным, не \`direct\`.
- [ ] При LSP disagreement/unavailable исходная byte-exact code evidence остаётся доступной с uncertain semantics/partialSource, без подмены верности текста верностью связи.
- [ ] Сопоставить direct TypeScript LS vs Serena на **одних** fixture и тех же identity oracles (детальный W02); согласовать конкретный production provider по ADR-004.

**DoD C-B:** неверный same-line/nested definition не может подтвердить символ; Unicode, overload и alias behavior воспроизводимы; stale dependencies не считаются current semantics; \`ace_expand\` продолжает восстанавливать полные байты.

### C-C — Индексная coverage как часть честного ContextBundle

**Статическое основание:** \`buildLocalCodeIndex\` возвращает warnings/indexedPaths; unreadable source/structural failures могут исключить файлы, а bootstrap пишет warning в stderr, не в \`ContextBundle\`. Значит, «есть хорошие hits» не доказывает полноту покрытия требуемой области.

- [ ] Coverage manifest: \`attempted / indexed / policy_excluded / out_of_scope / unsupported_language / parser_partial / read_failed / digest_raced\` + причины, parser version и source snapshot. Не записывать запрещённый путь/его содержимое в публичный/агентский лог.
- [ ] Отделить **намеренно запрещённые** и **неотносящиеся к запросу** файлы от недоступных файлов *required source scope*. Policy exclusions не должны превращаться в ложную жалобу на весь индекс.
- [ ] Увязать coverage с snapshot key/manifest и проверить при warm reuse; изменение статуса файла/права/парсера требует invalidation и recovery.
- [ ] Пронести coverage через runtime/bootstrap → workspace status → retrieval planner → \`ContextBundle.partialSources/complete\`, а не ограничиваться stderr.
- [ ] Правило: \`complete=true\` только если authorised **required** files/sources проверены и route fulfilled; если relevance failed required path нельзя доказуемо исключить — coverage degraded/partial. **Zero hits в здоровом индексе** — нормальный пустой результат, не автоматическая ошибка.
- [ ] Отрицательные тесты: 1 доступный файл + 1 required unreadable, parser crash, syntax-error partial, секретный policy-excluded файл, unsupported irrelevant extension, empty healthy result, all-failed, then path recovered и new warm reuse.
- [ ] Real provider E2E: mismatch из невыполненной части не становится верным из-за rank high другого символа.

**DoD C-C:** качественно разные сценарии \`no_match\`, \`not_indexed\`, \`denied\`, \`partial_parser\`, \`backend_unavailable\` наблюдаемы структурированно; не ломается политика приватности; completed evidence only for covered authorised route.

### C-D — Один resolved embedding config + фактический receipt worker

**Статическое основание:** \`ace-mcp.ts\` вычисляет defaults/revisions для имён/trace, тогда как \`makeProcessEmbeddingPort\` запускает \`spawn(...)\` без явного controlled resolved env. Рабочий Python runtime может увидеть иные настройки; совпадение vector dimension это не исключает.

- [ ] Единый типизированный \`ResolvedEmbeddingConfig\`: provider, upstream model/revision, **actual** artifact model/revision/digest, dimension, preprocessing, runtime build/version, effective execution mode/pinning flag.
- [ ] При spawn передавать ровно этот config через allowlisted env/protocol с безопасным наследованием нужного PATH/runtime; никакой credential leakage.
- [ ] Worker на startup обязан дать **verified handshake/receipt** фактически загруженного artifact+config до первого embed/index/query. Запрошенный SHA и self-reported SHA недостаточны без локальной верификации pinned artifact где поддерживается.
- [ ] Сравнить effective receipt с ожиданием; collection/index key, labels, cache reuse, trace берутся от verified effective config. Unsupported/mismatched provider или другой revision/digest → typed NOT_READY/fail closed.
- [ ] Проверить defaults **без экспортированных переменных**; explicit overrides и пробелы, разные модели одинаковой dimension, несовпадение artifact/model revision, чужой cache, missing model cache, worker timeout/exit/cancellation.
- [ ] Настоящие FastEmbed и Sentence-Transformers, без обязательного Ollama и без внешнего inference для приватного кода. Unpinned experimental mode маркируется как таковой, не production-verified.
- [ ] Вернуть reproducible model artifact/corpus fingerprint в benchmark manifest и W01 provider selection.

**DoD C-D:** parent / worker / Qdrant namespace / trace имеют один проверяемый effective identity, включая default-only cold startup; producer mismatch не может породить ложный warm reuse. Protocol mock ≠ proof of actual model load.

### C-E — Temporal as-of queries и event-sourced decision states

**Статическое основание:** в \`src/domain/memory.ts\` \`searchMemory(..., asOfMs)\` фильтрует \`episode.occurredAtMs\`, но вставляет **текущее** \`decision.state\` и сравнивает конфликты среди сегодняшних \`Accepted\`. Это не историческое состояние решения.

- [ ] Зафиксировать semantics \`as_of\`: valid/reference time vs imported/knowledge time; нужен один или два времени? Определить включительность границ, late-import и tombstone visibility.
- [ ] Persist **immutable decision transition events** \`propose / confirm / reject / supersede\` с \`atMs\`, original episode evidence, approval identity; не изменять исторические исходные bytes.
- [ ] Строить state-at-time проекцией событий (или доказанно эквивалентной event history). \`validFromMs\` + сегодняшнее \`state\` **не** восстанавливают дату принятия/отмены.
- [ ] Конфликты считать только между contemporaneously effective decisions одного workspace+subject; не смешивать workspace и решения с неперекрывающимися интервалами.
- [ ] Проверить \`successorId\`: запрет self-link, отсутствие/cycle detection, валидность timeline и scope на service/transaction boundary.
- [ ] Migration legacy records без transition history: нельзя придумывать past accepted time; вернуть explicit \`historical_uncertainty\`/unknown.
- [ ] RED fixtures: proposed→accepted→superseded в t1/t2/t3, rejected, future decisions, overlapping/non-overlapping conflicts, other workspace, late import, tombstone/replay, legacy missing history.
- [ ] Привязать C-E к **W06/W07/W08**: реальный Graphiti search должен подтверждать timestamp и original source, а не заменять domain historical truth derived graph facts.

**DoD C-E:** \`as_of=t1\` выдаёт состояние, доказуемое на t1, а не сегодняшнее; невозможное восстановление прошлого честно unknown; текущая память не регрессирует. Для code-only scope P2; для full temporal-memory release обязательный gate.

### Межтрековая приёмка C-A…C-E

- [ ] Ввести общий **RED → GREEN → real-provider E2E** пакет с exact fixture hashes, code commit, provider versions, request IDs, failure traces и memory decision timestamps. Предварительно сохранить failing assertions, прежде чем менять производственный код.
- [ ] Cross-track matrix: **C-D model mismatch × C-A warm cache**, **C-C missing files × C-A membership**, **C-B stale dependency × C-A concurrent index publication**, **C-E as-of × W06 Graphiti delayed projection**, плюс Qdrant/worker/Graphiti outages.
- [ ] Standard CI: \`npm ci\`, \`npm run check\`, \`npm test\`, \`npm run lint\`, \`npm run build\` и существующая Python artifact-integrity suite; выполнить OpenSpec strict validation по реально установленной версии CLI.
- [ ] Separate **real**: два независимых ACE MCP процесса + Qdrant, worker FastEmbed/ONNX & Sentence-Transformers, Tree-sitter/Serena-TS LS, Graphiti/FalkorDB с локальным inference и actual Codex client там, где применимо. Mock-only тесты оставить локальной контрактной ступенью, а не финальным gate.
- [ ] Любая правка observable contract требует OpenSpec delta, negative recovery oracle и compatibility/migration notes до production acceptance; не менять Accepted ADR без owner decision.
- [ ] После C-A/C-C/C-D измерить *настоящий* cold start / validated warm reuse / dirty delta; только затем запускать итоговый Harbor natural/forced comparison и принимать DBC-12.
- [ ] В PR описывать *что доказано*, *что остаётся static risk*, *что не удалось проверить в этом environment*; не закрывать DBC и не продвигать experimental provider по одному зелёному CI.

**Инженерный порядок:** (1) baseline/RED tests → (2) **C-A + C-D** (общая модель snapshot identity) и **C-B** параллельно → (3) **C-C** как вход в atomic publish/completeness → (4) real cross-track concurrency/restart → (5) **C-E** параллельно memory project → (6) W01–W15. Если C-D/C-C явно меняет manifest schema, зафиксировать это до реализации C-A миграции.

---

## 2. Сводка всех открытых направлений

| ID | Приоритет | Что осталось | Связанные контракты | Блокирует production? |
|---|---|---|---|---|
| W00 | P0 | Актуализировать baseline и разграничить исторические/нынешние статусы документации | ADR-012, DBC-01…14 | Да, для прозрачного gate |
| W01 | P0 | **C-D worker effective identity** → замерить и одобрить production embedding model/runtime | DBC-01, 03, 12 | Да |
| W02 | P0 | **C-B exact LSP identity** → Serena vs direct TS LS comparison и approval | DBC-01, 04 | Да |
| W03 | P0 | Повысить retrieval precision на реальных запросах, оценить hybrid/lexical/rerank/context payload | DBC-02, 03, 04, 12 | Да, если качество ниже порога |
| W04 | P0 | **C-A snapshot isolation + C-C coverage** → incremental worktree overlay, safe lifecycle, scale/restart | DBC-05, 06, 13 | Да |
| W05 | P1 | Vertex ingestion **только разрешённых** fixtures, реальные citations/version/conflict | DBC-07, 14 | Да для capabilities с документацией |
| W06 | P0 | Реальный local-only Graphiti inference + факты/temporal recall с **C-E as-of truth** | DBC-10, 11 | Да для memory capability |
| W07 | P0 | Durable outbox/ack/reconciliation, source-safe purge, аварийное восстановление | DBC-10, 11 | Да для memory capability |
| W08 | P0 | Unified code+docs+memory и MCP `ace_memory_search` + **C-C coverage truth**, correct routing/completeness | DBC-01, 06, 11, 14 | Да для объединённой ACE |
| W09 | P1 | Билингвальная проверка memory-admission filter и экономика записи/поиска | DBC-11, 12 | Да, если включать фильтр по умолчанию |
| W10 | P1 | Deterministic required-source planner на runtime; Jev — отдельно как опциональный эксперимент | DBC-01, 06, 07, 14 | Planner — да; Jev — нет |
| W11 | P0 | Аутентифицированный host helper и безопасное live-tree подключение pod в существующем k3s | DBC-05, 07, 08, 13 | Да для k3s production deployment |
| W12 | P0 | Security/privacy/provider-failure hardening и реальный многопровайдерный E2E | DBC-01, 05, 06, 07, 08, 09, 11, 14 | Да |
| W13 | P0 | Репрезентативный **natural-use** Harbor, трёхрукавный дизайн, полная экономика | DBC-03, 04, 12 | Да |
| W14 | P0 | Пройти и документировать все нормативные DBC gates с real evidence | DBC-01…14 | Да |
| W15 | P0 | License/operations/docs/owner review, финальное решение о promotion | ADR-008, 012, 013 | Да |
| W16 | P2/Deferred | Jev production, полная observability, дополнительные языки/CPG/многонодовая HA | ADR-002, 010 | **Нет**, если не включены в scope |

### Зависимости и критический путь

`W00/RED → (C-D ↔ C-A ↔ C-C, C-B) → W01–W04 → (W05, W06/W07/C-E) → W08/W10 → W11/W12 → W13 → W14 → W15`

Параллельно: `W05` (Vertex); `W06 → W07 → W08` (memory); `W11` (host/k3s); `W09` (memory quality); `W10` (routing). Harbor exploratory прогоны можно запускать **сразу**, не дожидаясь финального утверждения моделей: они дают ранний сигнал и не являются production sign-off.

## 3. Подробные work packages

### W00 — Зафиксировать truth baseline и устранить status drift (P0)

**Проблема:** документы прошлых PR ещё содержат «нет кода», «пять OpenSpec changes» или незакрытые provider-шаги, уже частично пройденные experimental E2E. Исторические отчёты не переписывать.

- [ ] Снять SHA `main`, версии Node/TS/Codex/Harbor/Qdrant/Tree-sitter/Graphiti/Serena/embeddings и fingerprints тестовых репозиториев, без токенов и персональных путей в публичных отчётах.
- [ ] Выполнить `npm ci`, `npm run check`, `npm test`, `npm run lint`, `npm run build`, OpenSpec strict validation (сначала проверить `openspec --help`), реальные тесты **лишь там, где реально доступны сервисы**.
- [ ] Проверить и обновить вводные `docs/README.md`, `docs/openspec/README.md`, historical task descriptions, учитывая уже слитые PR и текущие статусы. Старые отрицательные Harbor цифры сохранить **дословно**.
- [ ] Для каждого DBC составить evidence record: contract ID, commit, fixture+digest, провайдер/версия, точная команда, request IDs, oracle, verdict, ограничения, ссылка на raw artifacts.
- [ ] Сверить, что production checklist не отмечает `[x]` только потому, что mock/experimental sub-gate прошёл.

**DoD:** воспроизводимый baseline report, однозначная матрица `implemented / tested-real / agent-e2e / benchmark / approved`, нет ложных `production-ready` меток.  
**Артефакт:** новый `docs/reviews/*-baseline-verification.md` + актуальные `docs/openspec/changes/*/tasks.md` (только по подтверждённому evidence).

### W01 — Production embedding: модель, runtime, качество и лицензия (P0)

**Обязательный correctness prerequisite: C-D.** Рабочая модель должна сама подтвердить фактический artifact/runtime identity, а не только получить label от родительского процесса. Кандидатные comparisons ниже не заменяют C-D.

**Сейчас:** реальный FastEmbed/ONNX работает; сравнение против Sentence-Transformers на 9 синтетических примерах — полезный spike, но не final selection. **Ollama не нужен и не должен стать зависимостью по умолчанию (ADR-013).**

- [ ] Собрать и заморозить отдельный development set + **unseen holdout** из нескольких реальных TS/JS кодовых баз: behavior-not-name, RU↔EN, близкие имена, алиасы, похожие методы, межмодульная зависимость, изменение файлов. Отдельно сравнить BM25/lexical/hybrid.
- [ ] Сопоставить не менее двух **реальных** конфигураций `model@revision + artifact digest + runtime + preprocessing`; сохранить current FastEmbed baseline; измерить Recall@1/3/5, MRR/nDCG, p50/p95, RSS, cold model load, indexing throughput, warm retrieval.
- [ ] Проверить запросные/document prefixes, нормализацию, CPU/headroom, лицензии и воспроизводимое получение артефактов. Модельную/препроцессинговую смену всегда изолировать новым Qdrant namespace и корректным reindex.
- [ ] Проверить exact source verification, секреты/локальность и качество на agent tasks, не только на близости vectors.
- [ ] Представить сравнительный verdict + версионированную конфигурацию **владельцу на production approval**. Отсутствие согласия — experimental, а не блокировка дальнейших измерений.

**DoD:** независимый frozen holdout + воспроизводимые metrics + выбранный владельцем production model/runtime/препроцессинг.  
**Evidence:** `benchmarks/reports/embedding-provider-comparison*.{json,md}`, DBC-01/03 и Harbor ablation.

### W02 — Serena против TypeScript Language Service (P0)

**Обязательный semantic prerequisite: C-B.** Никакое «оба нашли одинаковое имя» не является настоящим LSP identity oracle. Сначала exact identifier span, Unicode и dependency snapshot.

- [ ] На одинаковом pinned TS/JS корпусе прогнать **оба** провайдера, а не разные демонстрационные smoke.
- [ ] Test oracle: 2+ одноимённых метода в разных классах/файлах; inheritance/overloads, aliases/re-exports, type references, references vs definitions vs assignments, decorators, broken/partial files, UTF-8 byte vs TS UTF-16 coordinates.
- [ ] Отдельно проверить корректность на dirty working tree и смене snapshot: LSP identity относится к **тем же verified bytes**, что и AST/Qdrant candidate; не разрешать старой snapshot выдавать новую семантическую уверенность.
- [ ] Измерить cold/warm latency, память и стоимость инициализации, ошибки, языковое покрытие, license/version, влияние на actual Codex task outcomes.
- [ ] Обновить сравнение в `docs/reviews/serena-vs-ts-language-service.md`; предложить owner decision без автоматического преимущества уже установленного TS LS.

**DoD:** одобренный semantic provider и real exact-symbol E2E без ложных связей (`DBC-04`). Если direct TS LS выигрывает, Serena необязательна как runtime dependency.

### W03 — Качество, hybrid routing и компактность ContextBundle (P0)

- [ ] Benchmark behavior-first queries с трудными distractors; нынешний tiny E2E нашёл top-k, но ошибался с top-1. Объявить заранее пороги качества/latency и сравнить с `rg`/BM25/hybrid.
- [ ] По необходимости реализовать hybrid sparse+dense, symbol-aware prefilters или дешёвый reranking **как контролируемые ablations**, а не как автоматически принятые сервисы.
- [ ] Проверить первичную выдачу по novelty, реальной полезности для задачи, duplicate symbol hits, source/provenance, citation path, токены текста и экономию native reads; не обрубать `ace_expand`.
- [ ] Протестировать AST identifier anchors вместо substring/первого совпадения имени, включая Unicode/aliases/comment string traps; не выдавать неустановленные semantic edges как `direct`.
- [ ] Измерить payload в `locate`/`inspect`, число `ace_expand`, число повторных agent `cat/rg` после ACE и качество окончательного патча.
- [ ] Добавить unsupported language, syntax-error, stale/missing-source negative cases.

**DoD:** source-exact, качественно конкурентный retrieval с принятой precision/recall и неухудшением качества Codex; отчёт с measured tokens/latency. `DBC-02/03/04`. **Никаких произвольных обязательных token ceilings на полные исходники (ADR-006).**

### W04 — Инкрементальный index + честная freshness и сохранность (P0)

**Обязательные prerequisites: C-A + C-C + C-D.** Инкрементальное обновление не должно начинаться с потенциально перезаписываемого snapshot или неучтённых ошибок coverage. Ниже дополнительные задачи delta-index после изоляции публикации.

**Сейчас:** warm Qdrant reuse по content key и полный rebuild при dirty snapshot. Этого недостаточно для `DBC-13`.

- [ ] Спроектировать per-file/per-symbol manifest с digest, model fingerprint, parser version, source generation, tombstones, атомарным publish/staging текущего snapshot; не смешивать разные модели/versions.
- [ ] Реализовать delta-index/re-embed **только изменённых** файлов, удаление старых symbol vectors, tracking newly added/deleted/renamed files и uncommitted overlay без ложных `current` claims.
- [ ] Рассмотреть count-only snapshot reuse как smoke, но доказать содержательную корректность принадлежности нужных точек/manifest и конкурентных reader/writer scenarios (равное число точек само по себе не доказывает идентичность).
- [ ] Индексация/обновление из существующего worktree и после restart без подмены observation epoch; перезапуски между upsert/commit/prune должны быть recoverable.
- [ ] Ограничить cost cold scan, сохранить точечную verification hot path; замерить 1k/10k+ файлов, cold/warm/change-only индексирование, latency и RSS.
- [ ] E2E: изменить один файл, удалить один, переименовать, создать untracked, инициировать параллельный запрос, restart, Qdrant timeout, interrupted index writer. Проверить `index_status` и отсутствие stale direct evidence.

**DoD:** реальный incremental overlay, измеримая разница full vs delta, crash/restart proof, DBC-05/06/13. Существующие warm-restart sub-gates сохранить.

### W05 — Vertex: реальный разрешённый docs RAG и conflict evidence (P1)

**Не повторять:** corpus `ace-europe-stage2` в `europe-west4` уже **создан и одобрен**; не удалять и не создавать новый по умолчанию. Corpus по имеющемуся отчёту пуст.

- [ ] Согласовать отдельный scope *публичных/синтетических* fixture-документов; только после этого загрузить минимальные versioned ADR/spec/runbook fixtures. Приватный source/dialogue export не разрешён автоматически.
- [ ] Проверить IAM/auth using short-lived host `gcloud` token/ADC, `retrieveContexts`: sourceUri, citation, content, document revision/timestamps; различать unsupported metadata и проверенные версии.
- [ ] Отделить `docs refreshed` / `docs stale` / `empty corpus` / `permission denied` / `timeout` / `cloud prohibited` и доказать policy-denial **до HTTP**, secret detection/query egress.
- [ ] Реальный кейс: ADR утверждает X, новый рабочий код Y. Вывести оба источника, актуальность, конфликт и приоритет code truth; никаких фальшивых `current` для cloud chunk.
- [ ] Зафиксировать стоимость, лимиты/квоты и документацию по разрешённому импорту и обновлению/удалению.

**DoD:** real Vertex E2E c разрешёнными fixtures и DBC-07/14; если corpus по-прежнему пуст, оставить `documentation not_ready/partial`, не ставить ✓.

### W06 — Graphiti: работающая local-only extraction и temporal recall (P0)

**Historical prerequisite: C-E** для release temporal search: `as_of` должен иметь настоящую историю transitions, а не текущую mutable state.

**Сейчас:** FalkorDB healthy; архив работает; Graphiti add_memory MCP отдаёт `pending`. **Ни extraction, ни `search_memory_facts` provider E2E пока не доказаны.**

- [ ] Выбрать/запустить поддерживаемую установленной Graphiti версией **локальную** LLM + embeddings (+ reranker, если используется), проверить реальную конфигурацию factory/client; **Ollama не требовать**. Измерить outbound policy: отсутствие запросов с private dialogues на внешние endpoints.
- [ ] Запустить Graphiti MCP against existing local FalkorDB. Импортировать разрешённый synthetic + проверенный Codex fixture, сохранить оригинальные bytes/digest/session IDs в archive.
- [ ] Доказать путь `archive → admission → add_memory enqueue → processing complete → Graphiti search_memory_facts → original episode citation`; Graphiti-derived facts по умолчанию `proposed/unverified`.
- [ ] Передавать точное `reference_time` исходного эпизода, проверять temporal as-of, superseded/rejected/accepted distinctions, конфликты и group/workspace isolation.
- [ ] Измерить generation/embedding token cost (или честно `unknown`), p50/p95 ingest/search, memory/storage, ошибки extractor и качество на вопросах через дни/недели.

**DoD:** real end-to-end evidence с фактическими facts, датами, ссылками на исходный диалог; memory branch usable, но ещё не production без W07/W08.

### W07 — Надёжность и безопасное удаление памяти (P0)

- [ ] Durable outbox/ack: атомарная фиксация оригинала + persistent projection intent с replay после crash; не путать `queued`, `pending`, `completed`, `failed`.
- [ ] Reconciliation по idempotency key и extractor version; safe retries/backoff/dead-letter/manual repair без duplicate claims.
- [ ] Полный delete path: сначала derived Graphiti purge с **проверкой реального отсутствия**, затем tombstone оригинала; shared source digest остаётся доступен другим эпизодам; denial/failure rollback честен.
- [ ] Multi-process и actual storage semantics: SIGKILL во время enqueue/purge, lock timeout, orphan lock recovery, конкурирующие import/delete, restart Graphiti/FalkorDB. Файловый `mkdir` lock на POSIX **не** считать автоматически distributed consensus на NFS/RWX.
- [ ] Зафиксировать backup/restore, retention, owner-initiated deletion, wipe derived indexes и операционную процедуру reconcile.

**DoD:** DBC-10/11 проходит с *реальной* Graphiti/FalkorDB, в том числе shared-content/derived purge и восстановление при прерывании.

### W08 — Один агентский runtime для code + docs + memory (P0)

**Completeness prerequisite: C-C.** Единый bundle объединяет не только найденное, но и честный per-source/index coverage status.

**Самая важная функциональная интеграция:** сейчас `ace-mcp.ts` создаёт code context (+ условный Vertex DocumentationPort), но **не инжектирует Graphiti-backed MemorySearchPort**; `ace_memory_search` возвращает `not_ready`. В самом Qdrant `includeMemory` отмечает missing provider. Отдельный `ace-memory` CLI не является unified runtime.

- [ ] Реализовать адаптер `Graphiti.search_memory_facts → typed TemporalMemoryPort` с проверяемой связью к archived originals, статусами и evidence classes.
- [ ] Подключить память в `makeMcpGateway` runtime `ace-mcp.ts`, не заменяя отдельный import/delete CLI; обеспечить `ace_memory_search` и `ace_context(include_memory=true)` на реальном провайдере.
- [ ] Собрать deterministic required-source planner в **runtime**: запрос на реализацию → code + structural/semantic; «почему приняли решение» → память/документация; cross-source → оба/три источника **если разрешены**.
- [ ] Разделить `required`, `optional`, `not_requested`, `denied`, `unavailable`; `complete` только когда все *обязательные* источники и freshness соблюдены; не вызывать тяжёлые provider без необходимости.
- [ ] Слить evidence с source types, revisions, timestamps, exact citations, conflictKey, priority current code > derived docs/memory для вопросов «что делает код сейчас», без молчаливого уничтожения исторического решения.
- [ ] E2E: одна Codex session спрашивает cross-file behavior, затем rationale из Vertex и historical rejected decision из Graphiti; видит проверяемые три источника и no-silent-omission.
- [ ] Проверить mixed failure: Graphiti down + code up, Vertex opt-in off, source edited mid-request, stale docs, contradictory accepted/proposed claims. Не превращать отказ cloud policy в технический fallback.

**DoD:** совместная реальная MCP демонстрация 3 источников и typed partial/failure flow; DBC-01/06/07/11/14.

### W09 — Admission filter и экономика memory (P1)

- [ ] Frozen EN+RU holdout содержит durable decisions/constraints/preferences/questions, paraphrases без триггерных слов, conflict/supersession и шумные транскрипты.
- [ ] Прогнать `archive-only/admission-filter` против `project-all` (или корректного разрешённого unfiltered baseline), мерить durable-memory recall@k, missed critical items, false promotion, ingestion cost и amortized reuse.
- [ ] Ограничение 4000 символов/keyword heuristic **не** принимать как смысловую фильтрацию без сравнения; raw archive всегда сохраняет оригинал независимо от admission.
- [ ] Подключить реальные счётчики Graphiti/extractor, где доступны; если не доступны — `unknown`, не $0 и не «экономия токенов» по char count.
- [ ] При потере важного контекста улучшить heuristic/admission или выключить фильтр production-default.

**DoD:** документированная quality/cost trade-off и отсутствие неприемлемого recall regression.

### W10 — Routing и Jev: обязательное против опционального (P1/P2)

- [ ] Подключить существующую детерминированную route policy к 실제 `ace_context` orchestration (W08), с явной source coverage. Проверить приоритет разрешений над route suggestions.
- [ ] Измерять маршрутные miss/false positives, лишние provider calls и end-to-end стоимость против simple reference routing.
- [ ] **Jev отдельно:** только если получены credentials/owner data authorization, провести opt-in A/B на разрешённых входных данных; сопоставить quality/cost/latency с deterministic route.
- [ ] Не подключать Jev production-default, пока новый ADR с доказательством и owner approval не принят. Отсутствие Jev **не блокирует** ACE release.

**DoD mandatory:** deterministic route with truthful coverage. **Jev:** либо отрицательное/положительное исследование позже, либо остаётся deferred.

### W11 — Production k3s и host worktree helper (P0)

**Сейчас:** ADR-008 требует существующий локальный k3s, но SPIKE выбрал host helper лишь на уровне дизайна. Dev pods с Qdrant/FalkorDB **не** означают production ACE gateway.

- [ ] Утвердить контракт host-side helper: аутентификация pod, workspace binding, allowlisted canonical relative paths, expected digest/version, race-aware exact reads; **не** принимать caller-controlled absolute roots.
- [ ] Реализовать mTLS/Unix-socket или эквивалентный строго локальный authenticated boundary с least privilege; негативные path traversal/symlink swap/rename/concurrent-write attacks, zero user-worktree writes.
- [ ] Сконфигурировать минимальные контейнеры/Deployments/PVC/secrets/health/readiness/NetworkPolicy для ACE MCP и имеющихся Qdrant/FalkorDB без лишних микросервисов; кластера заново не создавать.
- [ ] На существующем k3s доказать, что running Codex worktree (включая uncommitted/untracked изменения) корректно виден ACE до/после изменений, pod/service restart, token rotation, denial и out-of-sync errors.
- [ ] Описать rollback (helper off → `not_ready`), back-up/restore и ресурсные лимиты; index/archive persistence, cloud egress allowlist.

**DoD:** signed-off threat model, real race/containment E2E, reproducible deployment/restart recovery, read-only worktree unchanged; ADR-008, DBC-05/07/08/13.

### W12 — End-to-end failure/security hardening (P0)

- [ ] Применить origin/data-class-scoped policy на каждый outbound call и на трансформации запросов; проверить query-secret detection, no-cloud exfil, no logging source/token, correct opt-in downgrade.
- [ ] Проверить unauthorized workspace/path, symlinks, binary/invalid-UTF8 input, stale index, secret-bearing filenames, auth expiration, model mismatch, provider timeout/cancellation/retries.
- [ ] Настоящий cross-source race: snapshot D1 → async LSP/Graphiti/Vertex wait → D2. Финальная проверка должна не маркировать D1 current; использовать PR #8 regression как базовый contract.
- [ ] Audit safe correlation: ACE request ID → embedding query → Qdrant query_points → TS-LS definition → source verified; Graphiti/Vertex provenance где применимо, без слива сырых данных.
- [ ] Проверить поведение readiness/status: Green process ≠ ready provider, `complete` не равен «нет исключения», false-current и fake partial недопустимы.

**DoD:** safe negative and crash-path suite на действующих providers, P0/P1 security blockers закрыты; минимум trace receipt для каждого required branch.

### W13 — Harbor: natural-use comparison, качество и **полная стоимость** (P0)

**Benchmark trust prerequisites:** C-A/C-C/C-D и релевантные части C-B должны пройти реальные provider gates до финального сравнительного утверждения. Exploratory тесты запускать разрешено и раньше, но не квалифицировать их как production acceptance.

**Фиксированное историческое отрицательное измерение:** 9/9 vs 9/9; native 891 950 vs forced ACE 1 571 768 tokens, native/ACE **0.567482×**. Его **не исправлять** и не переводить в savings. W13 запускается параллельно с W01/W03/W06.

- [ ] Задать минимум три явно отличные ветки: **(A)** native Codex natural/no ACE; **(B)** Codex+ACE **optional natural** с одинаковым текстом задачи и без «must call ACE»; **(C)** ACE forced-use **diagnostic only**.
- [ ] По ADR-009 включить baseline `Codex+Serena` и ablations по возможности: lexical only / vectors / AST+LSP / docs / memory. Пиновать Codex model/reasoning/CLI, runtime settings, source commit, verifier, caching, state and wall-time caps.
- [ ] Frozen hidden holdout: больше одного репозитория, cross-file dependencies, behavior-not-name, same-name, architecture vs current code, many-turn/warm-index и dirty-tree. Не тюнить на holdout после просмотра результатов.
- [ ] Собирать raw Codex JSONL, actual ACE observed/success/failed calls, request-ID provider correlation, exact source digests/citation use, native read duplication, quality oracle, all failures/retries.
- [ ] Разнести `startup cold index`, `warm repeated queries`, `agent context cost`; total/cached/uncached/output tokens без double-counting, Codex-reported USD **плюс** measured/estimated-or-unknown local CPU/RAM/electricity/indexing and Vertex/Graphiti/inference costs; latency p50/p95.
- [ ] Сравнить paired accepted task quality до ratio. Отдельно сообщить, если ACE не был добровольно вызван, или если вызовы привели к duplicate native exploration.
- [ ] Сохранить negative results и отчет о причинной неопределённости; 5× — **цель/гипотеза**, не предпосылка запуска тестов и не автоматический release flag.

**DoD:** воспроизводимый Harbor 3-arm + ablation отчёт с реальными ACE uses и полной известной стоимостью или явным `unknown`; DBC-12 не закрывать forced-only/zero-call.

### W14 — Финальный acceptance DBC-01…14 (P0)

Следующая матрица — **сводка открытых нормативных работ**, а не отрицание уже прошедших experimental sub-gates.

| DBC | Состояние на дату ревизии | Что нужно до нормативного закрытия |
|---|---|---|
| 01 composition | Экспериментальный real-provider path есть | Approved embedding + approved LSP, real runtime composition + failure proof |
| 02 precision | **Real 2000/25 gate пройден** | Сохранить evidence при новых версиях провайдера |
| 03 behavior RAG | Tiny 3-query gate пройден, distractor top-1 | Большой labeled holdout + approved model + quality oracle |
| 04 same-name LSP | Реальные TS LS/Serena sub-gates | Полное matched comparison и approved semantic choice |
| 05 freshness | **Real race gate + PR #8 docs-race regression пройдены** | Регрессии для overlay и multibranch async запросов |
| 06 failure truth | **Real outage/degraded gate пройден** | Multi-provider partial matrix после W08 |
| 07 policy safety | **Denial-before-network test пройден** | Проверки реальных Vertex/Graphiti/local routes и k3s |
| 08 exact bytes | **Real exact expand + Unicode gate пройден** | Сохранить no-truncation при новых транспортных форматах |
| 09 official MCP | **SDK/Codex client/Harbor invocation доказаны** | Сохранить conformance при deployment |
| 10 stable memory IDs | **Cross-process JSONL append/replay пройден** | Сохранить invariant после real Graphiti integration |
| 11 memory safe delete | Archive shared-blob sub-gate прошёл | **Real Graphiti derived purge + crash consistency** |
| 12 benchmark attribution | **Не пройден**; forced 3×3 отрицателен | Frozen natural optional paired, correlated provider traces, full cost/quality |
| 13 persistence | Warm/dirty restart sub-gate пройден | **Incremental index/overlay**, restart/recovery/perf |
| 14 docs conflict | Test DocumentationPort logic sub-gate прошёл | **Real authorized Vertex citation/version vs current code** |

Для каждого теста обязателен evidence manifest: `DBC-ID, SHA source commit, fixture digest, tool versions, provider credentials scope (без секретов), exact command, request IDs, artifact links, observed results, verdict`. Для непроведённого теста фиксировать `NOT_RUN / BLOCKED`, а не «passed by exception».

### W15 — Финальная сборка, эксплуатация и approval (P0)

- [ ] Проверить лицензии, pinning/SBOM, image provenance, secret handling, backup/restore, pod restart, resource budgets, retention и deletion runbook.
- [ ] Устранить документационную рассинхронизацию `docs/README.md` vs текущий code/PR; сделать короткую installation/configuration matrix: *local dev*, *experimental real provider*, *production-approved*, *degraded*, *offline*. Объяснить `ACE_ENABLE_EXPERIMENTAL_QDRANT` и явный `ACE_ALLOW_LOCAL_FALLBACK`.
- [ ] Проверить `npm ci`, typecheck/lint/contracts/build, OpenSpec strict, real-provider integration, MCP Codex E2E, Graphiti, Vertex, K8s race, Harbor в соответствующих реальных environments; все отсутствующие тесты назвать.
- [ ] Согласовать результаты production embedding и semantic provider, cloud data scope, resource/cost budget; получить явный owner sign-off по фактическим тестам.
- [ ] Обновить OpenSpec 001–006, актуальные ADR statuses/evidence и release notes. Не архивировать 006 при любом открытом обязательном gate.

**DoD:** корректно ограниченный/подтверждённый набор production capabilities; **весь ACE** называть production-ready только после обязательных runtime/provider/agent/benchmark/security gates и owner approval. Если code-only pipeline готов раньше memory или Vertex — разрешено выпускать как **ограниченный scope**, явно отмечая `docs/memory not_ready`, но не объявляя объединённую систему законченной.

### W16 — Что **не надо** притворно включать в критический путь

- [ ] **Jev:** опциональный эксперимент, не обязательный router по умолчанию, требуется отдельный comparative study/ADR.
- [ ] **Полная observability** (OTel/Langfuse/Prometheus dashboards, SLO/alerting): **Deferred ADR-010**. Не откладывать при этом безопасные traces, usage и audit для Harbor/security.
- [ ] **Rust rewrite, микросервисы, отдельная Graphiti memory database abstraction вместо Graphiti, полный CPG/callgraph, HA/multinode**: только по измеренной необходимости и новому ADR.
- [ ] **Другие языки кроме актуального TS/JS vertical slice**, дополнительные агенты кроме Codex: расширение покрытия после доказанных исходных требований, не тихо обещанная общая LSP полнота.

## 4. Рекомендуемые последовательные этапы и выходы

| Этап | Работы | Проверяемый результат |
|---|---|---|
| **S0 — truth, RED и critical correctness** | W00 + C-A/C-B/C-C/C-D (C-E параллельно memory); регрессии на исходном состоянии | Repro baseline, negative fixtures, fixed snapshot/worker/LSP/coverage evidence; старый negative Harbor не переписывать |
| **S1 — code retrieval quality & freshness** | W01–W04, W12 (code), после корректности C-A/C-B/C-C/C-D | Approved/provider-recommended embedding + LSP, real semantic holdout, incremental index proof, precise ContextBundle |
| **S2 — documentation & memory** | W05–W10 + C-E, W12 (mixed) | Только разрешённый Vertex cited content + working Graphiti temporal recall/purge + unified routed MCP |
| **S3 — operational deployment & economics** | W11, W13, W12 (deployment) | Real k3s live worktree, measured 3-arm natural Harbor, cold/warm cost+latency, reliable restart |
| **S4 — acceptance** | W14–W15 | DBC matrix backed by raw evidence, permissions/owner sign-off, честный scoped release verdict |

Этапы **не означают** жёстких календарных сроков. W05/W06/W11 и exploratory W13 разрешено выполнять параллельно с S1. В любом этапе сохранять негативные эксперименты и продолжать независимые направления при отсутствии одного сервиса.

## 5. Единая PR-очередь и технические зависимости

**Это одна очередь**, заменяющая раздельное выполнение «5 треков» Клода и «8 PR» старого roadmap. Параллельность допускается, но зависимость от модели snapshot не пропускать.

| Slice | Зависимости | Содержание | Exit evidence |
|---|---|---|---|
| **PR-00 — baseline и RED** | — | W00: frozen fixtures для C-A/B/C/D/E, raw negative results, source/provider versions | Воспроизводимый RED или явный \`static-unconfirmed\` |
| **PR-01 — model identity / snapshot schema** | PR-00 | **C-D** typed effective config + worker receipt; **C-A** snapshot-bound IDs, atomic manifest publish и migration plan | Real model load + real Qdrant two-reader safe publish |
| **PR-02 — lifecycle / coverage / incremental overlay** | PR-01 | **C-A** reader leases/refcount/GC, **C-C** coverage truth; W04 per-file delta index/dirty overlay | Interrupted writer, mixed coverage, warm restart, recovery |
| **PR-03 — semantic identity и provider comparison** | PR-00; publication interface PR-01 | **C-B** exact coords, Unicode, shadowing, stale deps; W02 Serena-vs-TS-LS, W03 quality | Identical fixture oracle + real LSP/agent evidence |
| **PR-04 — Graphiti temporal correctness** | PR-00; можно параллельно 01–03 | **C-E** event history, W06 real local Graphiti extraction/recall, W07 outbox/ack/purge | As-of / cross-process / crash / derived-purge real E2E |
| **PR-05 — Vertex + unified context** | PR-02, PR-03, PR-04; W05 independent | W05 approved synthetic Vertex docs; W08 code+docs+memory; W09 filter, W10 required-source routing | Real DBC-14 citations/conflict + non-false \`complete\` |
| **PR-06 — secure local k3s** | PR-01/02 contracts | W11 host helper authentication, least privilege, worktree races, restarts, W12 security | Actual k3s working-tree access, negative containment/race E2E |
| **PR-07 — retrieval-quality + provider approval** | PR-02/03; можно вести сравнительный benchmarking раньше | W01 approved embedder, W02 semantic winner, W03 frozen holdout/hybrid, perf/cost | Versioned license/approval plus reproducible quality/cost |
| **PR-08 — natural-use Harbor** | PR-02/03/07; W05/04 для multi-source | W13 3 natural/forced arms + Codex+Serena ablations, request-correlated costs/quality | DBC-12 natural trial report; прежний forced-negative остаётся |
| **PR-09 — normative acceptance/release** | PR-04/05/06/08 | W12/W14 DBC-01…14 evidence + W15 owner sign-off, docs/ops/licenses | Explicit scoped production verdict или clear \`not_ready\` |

Не обязательно создавать ровно 10 PR: делить/объединять slices можно по ревью-пригодности; но **одна source of truth — эта последовательность и соответствующие OpenSpec tasks**, а не параллельные конкурирующие TODO.

**Каждый PR** обязан содержать reproducible failing fixture/негативный кейс (если применимо), требуемый инвариант, исправление, compatibility/migration, real vs mock evidence, versions/commit, labels verified/pending и перечень рисков. Без доказанного provider behavior никакие production чекбоксы не закрывать.

## 6. Безусловные правила безопасности и честности

1. Source bytes/working tree — первичный факт; derived RAG/Graphiti — не более авторитетный источник кода или принятых решений.
2. Read-only кода, no secret exfil, explicit per-project/per-data-class cloud opt-in **в момент отправки**; не использовать Google credentials как согласие на выгрузку.
3. Сохранять оригинальные Codex сообщения и temporal history; `Graphiti pending` не считать `completed`; не auto-approve inferred decisions.
4. Не использовать hash vectors как настоящие embeddings, не требовать Ollama, не запускать Jev приватно без opt-in.
5. `not_ready`, `partial`, `stale`, `policy_denied` должны быть различимы; пропавший required provider никогда не даёт `complete=true`.
6. Не выдумывать порог обрезки оригинального `ace_expand` и не повторять source body дважды в MCP text + structured payload ради удобства.
7. Не заявлять 5×, cost-savings или production readiness, пока **реальные** trials/approval не подтвердят это. Измеренный отрицательный forced-use run остаётся отрицательным.
8. Работать через reviewable feature branches / PR; **не пушить в `main` напрямую** без отдельного явно данного разрешения (AGENTS.md).

## 7. Первичные ссылки для Codex / ревьюера

- [Permanent engineering rules](../../AGENTS.md)
- [Accepted ADR-003 — Qdrant for code / Vertex for docs](../docs/references/ADR-003-dual-rag.md)
- [Accepted ADR-004 — AST/LSP/freshness](../docs/references/ADR-004-ast-lsp-freshness.md)
- [Accepted ADR-005 — archive + Graphiti](../docs/references/ADR-005-persistent-memory.md)
- [Accepted ADR-007 — safety policy](../docs/references/ADR-007-security-failure-policy.md)
- [Accepted ADR-008 — local Kubernetes](../docs/references/ADR-008-local-kubernetes.md)
- [Accepted ADR-009 — Harbor](../docs/references/ADR-009-harbor-benchmark.md)
- [ADR-010 — deferred observability](../docs/references/ADR-010-observability-deferred.md)
- [Accepted ADR-012 — production gates](../docs/references/ADR-012-production-capability-and-provider-gates.md)
- [Accepted ADR-013 — embedding evaluation, not model selection](../docs/references/ADR-013-embedding-evaluation-without-ollama.md)
- [OpenSpec 003](../openspec/changes/003-unified-retrieval/tasks.md) · [004](../openspec/changes/004-temporal-memory/tasks.md) · [005](../openspec/changes/005-adaptive-routing-spike/tasks.md) · [006](../openspec/changes/006-production-retrieval-vertical-slice/tasks.md)
- [Normative DBC-01…DBC-14](../docs/architecture/07-architecture-fitness-contracts.md)
- [Current Codex execution plan](../openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md)
- [Real provider E2E](../reviews/2026-10-19-real-provider-e2e.md)
- [Efficiency/Harbor methodology audit](../reviews/2026-10-19-ace-efficiency-benchmark-audit.md)
- [Local Graphiti status](../reviews/graphiti-archive-recovery.md)
- [Vertex corpus status](../reviews/2026-10-19-vertex-gcloud-corpus-validation.md)
- [Serena vs TS LS evidence](../reviews/serena-vs-ts-language-service.md)
- [K8s host helper design](../docs/spikes/SPIKE-K8S-WORKTREE.md)

## 8. Происхождение и способ согласования двух планов

| Источник | Что перенесено в единый план | Что не менялось |
|---|---|---|
| [Claude post-merge correctness](./2026-10-19-post-merge-correctness-plan.md) | **C-A** isolation/leases/manifest/migration; **C-B** declaration coordinate identity; **C-C** coverage/completeness; **C-D** resolved embedding worker receipt; **C-E** historical event/state reconstruction, RED tests и real concurrency | Его наблюдения названы статическими, пока не воспроизведены; P2 temporal history не блокирует code-only эксперименты |
| [Предыдущий ACE roadmap](./2026-10-19-ace-production-completion-roadmap.md) | Стратегические **W00–W16**: provider selection, indexing, Vertex, Graphiti, unified context, memory admission, routing, k3s, Harbor, DBC/release, deferred scope | Отрицательные исторические Harbor цифры; owner-approved ADR-012; разрешённый Europe Vertex corpus; no-Ollama/no-private-egress policy |

**Изменение приоритета:** C-A/C-B/C-C/C-D становятся correctness prerequisites для benchmark/production gating. Не выполнять поверх них дорогое W04 incremental или объявлять warm cache успешным только по совпадению counts. C-E обязателен для версии с исторической памятью, но не тормозит ограниченный code-only milestone.

**Проверка готовности и миграций:** случайно прошедшие unit mocks, существовавшие до данного плана E2E и исторические PR #8/11 остаются историческим evidence. Новые A-D изменения могут потребовать Qdrant schema+cache migration и повторения DBC-02/05/06/08/09/13; изменение memory decision schema требует теста реального migration/unknown history, а не присвоения несуществующих временных меток.

**Связь с нормативными документами:** OpenSpec 001–006 и Accepted ADR имеют приоритет над этим execution backlog. При подтверждении нового требования подготовить OpenSpec change/delta и привязать к DBC. Не менять AGENTS.md под очередной sprint.

**Открытость критического пути ≠ запрет продолжать работу.** У владельца уже одобрены шесть критериев ADR-012, создание Vertex Europe corpus и исследовательская локальная Graphiti-конфигурация. Нового владельческого согласования **не нужно** для разрешённых безопасных exploratory tests; оно требуется для конкретного production provider decision, отдельной передачи приватных данных в облако и финального release promotion.
