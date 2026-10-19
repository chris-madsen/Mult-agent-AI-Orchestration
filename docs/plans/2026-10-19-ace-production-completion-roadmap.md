# ACE — реестр незавершённых работ и план доведения до production

**Дата ревизии:** 2026-10-19  
**База анализа:** `main` @ `2a4c2f79d958ed8babd28dd14ef339ac0fb9c180`, включая слитый PR #8; документы, код и отчёты на указанном состоянии.  
**Статус:** **план работ**, не отчёт о прохождении E2E и не заявление о готовности.  
**Цель:** завершить Adaptive Context Engine (ACE) как agent-neutral, read-only MCP context engine, сочетающий доказуемо актуальный код, разрешённую проектную документацию и локальную temporal memory, и измерить влияние на Codex в Harbor.

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

## 2. Сводка всех открытых направлений

| ID | Приоритет | Что осталось | Связанные контракты | Блокирует production? |
|---|---|---|---|---|
| W00 | P0 | Актуализировать baseline и разграничить исторические/нынешние статусы документации | ADR-012, DBC-01…14 | Да, для прозрачного gate |
| W01 | P0 | Выбрать по измерениям и одобрить production embedding model/runtime | DBC-01, 03, 12 | Да |
| W02 | P0 | Завершить честное Serena vs direct TS LS сравнение, одобрить semantic provider | DBC-01, 04 | Да |
| W03 | P0 | Повысить retrieval precision на реальных запросах, оценить hybrid/lexical/rerank/context payload | DBC-02, 03, 04, 12 | Да, если качество ниже порога |
| W04 | P0 | Инкрементальный working-tree index/overlay, crash-safe index lifecycle, scale/restart evidence | DBC-05, 06, 13 | Да |
| W05 | P1 | Vertex ingestion **только разрешённых** fixtures, реальные citations/version/conflict | DBC-07, 14 | Да для capabilities с документацией |
| W06 | P0 | Настоящий local-only Graphiti inference + `add_memory`/facts/temporal recall | DBC-10, 11 | Да для memory capability |
| W07 | P0 | Durable outbox/ack/reconciliation, source-safe purge, аварийное восстановление | DBC-10, 11 | Да для memory capability |
| W08 | P0 | Рабочая композиция code+docs+memory и MCP `ace_memory_search`, correct routing/completeness | DBC-01, 06, 11, 14 | Да для объединённой ACE |
| W09 | P1 | Билингвальная проверка memory-admission filter и экономика записи/поиска | DBC-11, 12 | Да, если включать фильтр по умолчанию |
| W10 | P1 | Deterministic required-source planner на runtime; Jev — отдельно как опциональный эксперимент | DBC-01, 06, 07, 14 | Planner — да; Jev — нет |
| W11 | P0 | Аутентифицированный host helper и безопасное live-tree подключение pod в существующем k3s | DBC-05, 07, 08, 13 | Да для k3s production deployment |
| W12 | P0 | Security/privacy/provider-failure hardening и реальный многопровайдерный E2E | DBC-01, 05, 06, 07, 08, 09, 11, 14 | Да |
| W13 | P0 | Репрезентативный **natural-use** Harbor, трёхрукавный дизайн, полная экономика | DBC-03, 04, 12 | Да |
| W14 | P0 | Пройти и документировать все нормативные DBC gates с real evidence | DBC-01…14 | Да |
| W15 | P0 | License/operations/docs/owner review, финальное решение о promotion | ADR-008, 012, 013 | Да |
| W16 | P2/Deferred | Jev production, полная observability, дополнительные языки/CPG/многонодовая HA | ADR-002, 010 | **Нет**, если не включены в scope |

### Зависимости и критический путь

`W00 → (W01, W02, W03, W04) → W08 → W12 → W13 → W14 → W15`

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

**Сейчас:** реальный FastEmbed/ONNX работает; сравнение против Sentence-Transformers на 9 синтетических примерах — полезный spike, но не final selection. **Ollama не нужен и не должен стать зависимостью по умолчанию (ADR-013).**

- [ ] Собрать и заморозить отдельный development set + **unseen holdout** из нескольких реальных TS/JS кодовых баз: behavior-not-name, RU↔EN, близкие имена, алиасы, похожие методы, межмодульная зависимость, изменение файлов. Отдельно сравнить BM25/lexical/hybrid.
- [ ] Сопоставить не менее двух **реальных** конфигураций `model@revision + artifact digest + runtime + preprocessing`; сохранить current FastEmbed baseline; измерить Recall@1/3/5, MRR/nDCG, p50/p95, RSS, cold model load, indexing throughput, warm retrieval.
- [ ] Проверить запросные/document prefixes, нормализацию, CPU/headroom, лицензии и воспроизводимое получение артефактов. Модельную/препроцессинговую смену всегда изолировать новым Qdrant namespace и корректным reindex.
- [ ] Проверить exact source verification, секреты/локальность и качество на agent tasks, не только на близости vectors.
- [ ] Представить сравнительный verdict + версионированную конфигурацию **владельцу на production approval**. Отсутствие согласия — experimental, а не блокировка дальнейших измерений.

**DoD:** независимый frozen holdout + воспроизводимые metrics + выбранный владельцем production model/runtime/препроцессинг.  
**Evidence:** `benchmarks/reports/embedding-provider-comparison*.{json,md}`, DBC-01/03 и Harbor ablation.

### W02 — Serena против TypeScript Language Service (P0)

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
| **S0 — truth & reproducing** | W00; заново подтвердить существующие real gates | Repro baseline, status/evidence map; не переписывать прежний negative Harbor |
| **S1 — code retrieval quality & freshness** | W01–W04, W12 (code) | Approved/provider-recommended embedding + LSP, real semantic holdout, incremental index proof, precise ContextBundle |
| **S2 — documentation & memory** | W05–W10, W12 (mixed) | Только разрешённый Vertex cited content + working Graphiti temporal recall/purge + unified routed MCP |
| **S3 — operational deployment & economics** | W11, W13, W12 (deployment) | Real k3s live worktree, measured 3-arm natural Harbor, cold/warm cost+latency, reliable restart |
| **S4 — acceptance** | W14–W15 | DBC matrix backed by raw evidence, permissions/owner sign-off, честный scoped release verdict |

Этапы **не означают** жёстких календарных сроков. W05/W06/W11 и exploratory W13 разрешено выполнять параллельно с S1. В любом этапе сохранять негативные эксперименты и продолжать независимые направления при отсутствии одного сервиса.

## 5. Короткий execution queue (первые инженерные PR)

1. **PR-A — truth/status + frozen workloads:** W00, подготовка W01/02/13, без «рисования» 5×. Выход: воспроизводимый manifest и baseline отчёт.
2. **PR-B — matched semantic/provider choice:** W01/02/03 на настоящих fixtures, сравнение Serena и TS LS, recommendation + owner approval gate.
3. **PR-C — incremental Qdrant/worktree overlay:** W04 с atomic manifest, deleted/renamed/uncommitted/raced/fault tests.
4. **PR-D — local Graphiti live extraction/reconciliation:** W06/07 + real Graphiti search/ack/purge/crash evidence.
5. **PR-E — Vertex real cited docs + unified gateway:** W05/08/10, cross-source conflict, required-source planner, memory_search.
6. **PR-F — safe k3s host helper:** W11/12, verified worktree, least-privilege, cluster restart/rollback.
7. **PR-G — natural paired Harbor:** W13, frozen multi-repo suite, 3 arms + optional ablations, provenance/cost/quality report.
8. **PR-H — acceptance/release:** W14/15, ADR decisions after measured reports, owner gate, documentation consistency.

Каждый PR должен содержать: **сформулированную ошибку/инвариант, acceptance oracle, negative test, evidence ссылки, список НЕпроведённых реальных тестов**. Не сливать большие изменения «одним коммитом на всё», особенно memory+cloud+K8s.

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

**Открытость критического пути ≠ запрет продолжать работу.** У владельца уже одобрены шесть критериев ADR-012, создание Vertex Europe corpus и исследовательская локальная Graphiti-конфигурация. Нового владельческого согласования **не нужно** для разрешённых безопасных exploratory tests; оно требуется для конкретного production provider decision, отдельной передачи приватных данных в облако и финального release promotion.
