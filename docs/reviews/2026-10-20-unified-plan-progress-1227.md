# ACE — повторная проверка выполнения плана

Дата: 2026-10-20. Расширенная редакция после запроса 13:25 EEST.
База исходников: `main` @ `38668d3d08c38bae532dccdedaaa735a4a2d9e77`; предыдущий commit изменял только этот review, код соответствует `7cfe49d24a8c288f4fc97a251bc01623d1f68d70`.
[Канонический план](../plans/2026-10-19-unified-ace-correctness-and-production-plan.md).

## 1. Заключение

Реализация существенно продвинулась и находится на стадии интеграционной доводки, а не в начале разработки. Есть реальные scale/crash sub-gates. Отсутствие финального acceptance не означает, что большая часть кода отсутствует. Оценки «99%» и «далеко» без общего знаменателя не обоснованы.

Но полного выполнения плана пока нет: остаются конкретные code-level риски, реальные provider/agent measurements и owner decisions. Приоритет — конкурентная сохранность, temporal-memory runtime и достоверность acceptance, а не очередное наращивание отчётной инфраструктуры.

Это расширенное статическое ревью через GitHub API, НЕ полный построчный аудит всех файлов и НЕ запуск тестов. Не выдавать этот документ за доказательство отсутствия багов. В предыдущей редакции ограниченная проверка создавала чрезмерно общий вывод; ниже отдельно указаны кодовые наблюдения, документальные статусы и непроверенные сценарии.

## 2. Что проверено

Повторно прочитаны полностью OpenSpec tasks 003/004/006, авторитетный 006 CODEX-EXECUTION-PLAN; gateway, source-coverage, retained-memory, memory-import, ace-memory CLI, file-projection-outbox, Graphiti MCP adapter, semantic-snapshot, Vertex RAG adapter; Graphiti parser/delete и Harbor three-arm tests. Использованы небольшие commit patches для восстановления caller context GC и startup metrics, который ранее был обрезан.

В предыдущем проходе прочитаны snapshot-state и его tests, Harbor domain/CLI, release domain/CLI, DBC evidence, scale runner, package/workflow; ledger, follow-up 1/2 и первичные crash/10k JSON. Это совокупный охват двух проходов, не утверждение о повторном запуске всех проверок.

Полный unified plan обрезается в W02; таблица W00–W16 и C-A…C-E доступны. Подробные требования retrieval/memory сверены по полностью прочитанным нормативным tasks и execution plan; непрочитанный хвост общего плана не считается проверенным. Большие runtime/retrieval файлы не прочитаны полностью; восстановлены конкретные относящиеся к findings участки. Непроверенные области: полный host-helper/storage/supply-chain аудит, все тесты, полный benchmark corpus и локальные ignored artifacts.

Тесты/провайдеры не запускались. Проверенный CI head PR #82: SUCCESS, run 39393955567; это не отдельный прогон merge-SHA. W00 PASS на `8ab84f9` — утверждение ledger с retained digest, сам ignored receipt не перечитан.

## 3. Прогресс и корректная интерпретация

| Область | Основание | Итог |
|---|---|---|
| W00 | ledger и W00 receipt reference | baseline выполнен на конкретном старшем commit; финальному release нужен свой receipt |
| C-A/W04 | raw crash JSON + scale report/10k JSON | реальные bounded sub-gates, не полный lifecycle acceptance |
| C-B | exact-anchor regression и verified semantic snapshot service | index/LSP bytes связаны на этапе композиции; matched Serena/approval остаются |
| C-C | coverage regression/manifest и source-coverage domain | required/optional/denied явно различаются; полная реальная mixed-source матрица не подтверждена |
| C-D | documented worker receipt и исправленный runtime namespace | нельзя повторять прежний default-env дефект как неисправленный; production selection отдельно |
| C-E | tasks 004 и domain history из предыдущего прохода | valid-time и decisionViews специфицированы; Graphiti runtime не равен domain search |
| W05 | Vertex adapter | policy до token/network, bounded refresh; реальные версии/цитаты ещё требуют доказательств |
| W06/W07 | import/outbox/delete/reconcile и их tests | код существует, но остались crash/concurrency окна (ниже) |
| W08/W10 | actual gateway/source-coverage | deterministic route реально управляет вызовами; это не только port |
| W09 | ledger | admission tooling есть; реальные quality/economics не перепроверены |
| W11/W12 | ledger/runbooks | deployment/security реализация не равна real k3s acceptance |
| W13 | Harbor domain/CLI/tests | natural/forced разделены; обнаружен слабый cost/acceptance oracle |
| W14/W15 | release domain/CLI и runbook | профиль полной готовности есть; не все входные доказательства семантически перепроверяются |
| W16 | ledger | deferred, не блокирует ограниченный scope |

Tasks 006 имеют семь отмеченных DBC (02,05,06,07,08,09,10) и семь открытых (01,03,04,11,12,13,14). Это состояние документа, НЕ процент выполненной разработки и НЕ проверка всех PASS на нынешнем release commit.

### Реальные измерения

[Scale report](../../benchmarks/reports/2026-10-20-index-scale-real-provider.md): 1k cold/warm/change-only = 102625/8402/10183 мс; 10k = 983239/24814/33162 мс. Raw 10k подтверждает reuse 9997 vectors при edit/add/delete/rename и нулевые coverage failures. Это измерения одного хоста на `c79afd8`, не production performance approval.

[Crash JSON](../../benchmarks/reports/qdrant-snapshot-crash-2026-10-20.json): восемь PASS на `07b143b`, distinct state roots, kill после verification до publish, S1 продолжает отдавать неизменённый символ. Explicit shared-collection GC выключен. Поэтому тест не доказывает корректность включённого GC и не покрывает kill mid-upsert. Partial S1 после изменения другого файла ожидаем и корректен.

## 4. Исправление прежних выводов

Прежние утренние F1–F6 имеют отдельные исправления и dispositions; не переносить их автоматически в backlog как неисправленные.

**Прежний R6 частично отозван.** В runtime patch `fc261011` явно видно `snapshot_identity=${retrievalFingerprint.slice(0,12)}`. Это fingerprint провайдеров, а не content `sourceKey`. Одинаковая метрика cold/warm/changed ожидаема и НЕ свидетельствует о stale snapshot. Осталась отдельная observability/test задача: назвать поле provider/retrieval fingerprint и сохранять actual content index_key; scale runner не проверяет смену этого ключа и точный D2 digest. Это неполный oracle, а не обнаруженная ошибка актуальности выдачи.

## 5. Findings с caller context

### R1/R2 — P1, статически выведено: lease lifetime и fail-closed GC

`file-qdrant-snapshot-state.ts`: после readdir пустого каталога close/activeIndexKeys выполняют recursive rm. Между этими действиями другой acquire может записать lease и получить успех; последующий rm уничтожит новую защиту. `readdir(...).catch(()=>[])` также смешивает I/O/permission failure с отсутствием lease; внешний ENOENT может вернуть пустое множество вместо остальных уже найденных active keys.

Caller проверен по patch `fc261011`: explicit collection без exclusive-owner opt-in пропускает GC; default owner-isolated collection выполняет его по active keys. Поэтому риск относится к конкурентным процессам одного state root/owner и к разрешённому GC, а НЕ к любому двухпроцессному запуску. Исправление прежней cross-owner проблемы полезно, но не исключает этот interleaving.

Нужны barrier tests close/acquire, ENOTEMPTY/EACCES/EIO/ENOENT, stale retained-set/acquire-before-delete и реальный shared-state Qdrant сценарий. Не удалять каталоги рекурсивно по старому наблюдению пустоты; операция retain/delete требует координации с acquire. Не воспроизведено на провайдере.

### R3 — P1 acceptance-contract gap: Harbor cost/дизайн

`harbor-three-arm.ts` определяет costTelemetryComplete отрицательным regex по costScope. Пустая строка проходит; численные cost fields могут быть null. acceptance pair-report не учитывается. CLI читает JSON с type assertion; нормализованный job fingerprint не сравнивается с фактически выполненным report config. Прочитанные tests покрывают unknown costs/zero calls/разные native aggregates, но не эти отрицательные входы.

При остальных валидных флагах можно выдать measured-not-necessarily-5x без доказанной полной стоимости. Это не наблюдавшаяся ложная публикация: штатный pair generator помечает unmeasured и остаётся diagnostic. Требуются structured cost measurements, runtime schema, source report verdict и execution identity bindings. Хеш текста сам по себе не доказывает качество измерений.

### R4 — P1/P2: неодинаковая глубина release validation

В `release-preflight.ts` external/runtime/resource документы глубоко валидируются; embedding/semantic selections, retrieval quality и Harbor принимаются преимущественно по вложенным verdict flags. CLI хеширует JSON, но не пересчитывает их из measurement inputs. Это создаёт риск устаревших/противоречивых approvals при прочих валидных release inputs, не обход всех гейтов одним файлом.

Нужна явная политика переносимости provider-selection measurements между commits плюс точное связывание model/artifact/config/corpus/release scope; negative tests forged verdict и incompatible config. Не требовать бессмысленно повторять все сравнительные эксперименты после каждой правки документации.

### R5 — P2: DBC raw artifacts и JSON-only loader несовместимы

`DbcArtifactEvidence` разрешает path/hash/kind без JSON-only ограничения. Release CLI повторно хеширует каждый artifact через readEvidence, которая всегда JSON.parse. Текстовый лог, multi-event JSONL или бинарный artifact ломает preflight до сверки digest. Нужны отдельные raw-byte hashing и structured JSON parsing с CLI regression tests.

### M1 — P1 W07: архив и durable projection intent имеют crash gap

`importMemoryEpisodes` сначала сохраняет все originals (phase 1), а outbox.begin выполняет позже (phase 2). При kill между фазами original сохранён, intent отсутствует. `ace-memory reconcile` перебирает только outbox.list, а не архив, поэтому такой эпизод не будет найден этим путём без повторного import.

Это не потеря original bytes, но разрыв автоматического projection recovery. Существующий описанный crash gate проверяет enqueue-before-durable-receipt, то есть другое окно. Нужно durable intent вместе с archive commit либо reconciliation, обнаруживающий admitted archived episodes без receipt. Тест: SIGKILL после archive persist и до outbox.begin; restart reconcile обязан восстановить pending intent без ручного reimport.

### M2 — P1 W07: delete и reconcile не имеют episode-level fencing

`deleteEpisodeWithProjection` выполняет purge → isPresent=false → archive.delete. CLI помечает outbox tombstoned только после этого. Concurrent reconcile может уже прочитать original до purge, затем заново project после verified absence/delete. `file-projection-outbox.put` атомарно заменяет файл, но не выполняет CAS: старый pending/projected writer может перезаписать tombstoned receipt.

Риск: derived данные возвращаются после подтверждённого удаления; byte-exact archive safety этого не предотвращает. Delete tests проверяют задержку/outage, но в прочитанном файле нет concurrent projection case. Нужно persisted deletion intent, episode fence/version, остановка/координация projector, terminal-state CAS и проверка отсутствия после завершения in-flight операций. Статически выведено, не real reproduction.

### M3 — P1/P2: ошибочный MCP reply может стать успешным Graphiti search/absence

В `replyJsonObject` structuredContent принимается ДО проверки isError. Поэтому `{isError:true, structuredContent:{episodes:[]}}` проходит parser и даёт isPresent=false; аналогично facts=[] может выглядеть как успешный empty search. Mutation validators проверяют isError отдельно, но projectionState/search используют этот parser. Для deletion oracle это опасно: error не может доказывать absence.

Нужно проверять isError в начале parsing для всех typed reads. Добавить tests error-bearing structured episodes/facts, malformed replies и ensure archive deletion count=0. Статический reachable branch, не наблюдавшийся ответ настоящего провайдера.

### M4 — P2: domain temporal decisions не подключены к Graphiti memory result

Graphiti adapter строит hits с `decisionStates: []`, conflicts=[] и не получает decision repository. Следовательно, корректные decisionViews/as-of из domain search сами по себе не дают такой функциональности `ace_memory_search` через этот adapter. Query сначала запрашивает top 50 facts без as_of и фильтрует время локально; это не доказательство полноты исторического recall вне этих 50.

Нужны explicit claim boundary и интеграция validated decision history; historical-query oracle с поздними/invalidated facts. Отсутствие decision annotations безопаснее выдуманных Accepted, но capability ещё не полностью доведена.

## 6. Очередность и acceptance

1. Детерминированные RED fixtures R1/R2/M1/M2/M3; затем реальные shared-state GC и Graphiti crash/delete-concurrency проверки. Не подменять один failpoint другим.
2. R3–R5 до formal Harbor/release sign-off. Честный BLOCKED без запуска допустим, но не равен проверенной работоспособности release pipeline.
3. Поднять реальные W01/W02 comparisons и W03 holdout; получить provider/license/host-budget decisions. Exploratory natural Harbor разрешён до production approval с явным diagnostic статусом.
4. Real Vertex и local Graphiti; затем unified Codex (три источника), admission counters, k3s/security/backup-restore.
5. Заморозить release candidate; собрать exact-commit DBC/runtime/resources/supply-chain и owner approval. Не переносить старый receipt как доказательство нового кода.

Дополнительная W00 правка: полностью прочитанный authoritative CODEX-EXECUTION-PLAN всё ещё говорит, что current main возвращает NOT_READY для experimental Qdrant и требует восстановить wiring. Это устаревшая инструкция относительно уже работающего runtime; актуализировать её, не меняя принятые ADR. Tasks 004 также сохраняют историческую формулировку «stable IDs unfulfilled» рядом с отмеченным DBC-10. Документальная неоднозначность не должна порождать повторную реализацию готового кода.

## 7. Итоговая оценка

Большинство крупных компонентов существует; существенный объём работы — проверка интеграции и доводка конкретных границ, а не написание всего заново. Однако для full code+docs+memory есть ещё не только approval-пункты, но и реальные runtime/recovery gaps. Для code-only и полного scope нужны разные выводы. Ни 99%, ни «далеко» без трудозатрат и scope не обоснованы. Этот отчёт не подтверждает production readiness, 5x или отсутствие иных багов.
