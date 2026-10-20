# ACE — отдельное ревью смысловых ошибок

Дата: 2026-10-20. Основание: проверка 14:04 EEST, оформление по запросу 14:20 EEST.
Проверенная база: `8192397de26334c9827ea2508dcaebba54c3a83d`. Код на этой базе соответствует `7cfe49d24a8c288f4fc97a251bc01623d1f68d70`; последующие до указанной базы commits меняли только review.

## Объём и достоверность

Это отдельный список шести конкретных проблем из последнего ответа, не новый полный аудит и не отчёт о выполнении всего production-плана. Основан на чтении исходников через GitHub API в предыдущих проходах и повторной проверке Graphiti adapter на указанной базе. Сценарии не запускались мной; статический дефект ветвления не следует путать с наблюдавшимся сбоем настоящего провайдера. Исправления и тестовые результаты не заявляются.

Связанный расширенный отчёт: [ревью выполнения плана](./2026-10-20-unified-plan-progress-1227.md). Здесь находки имеют отдельные ID SB-01…06 для однозначных ссылок; они не являются новыми DBC-контрактами.

## SB-01 — P1: MCP error может стать доказательством отсутствия Graphiti episode

Файл: `src/adapters/graphiti-mcp.ts`; `replyJsonObject`, `projectionState.isPresent`, `parseGraphitiFactSearchReply`.

Парсер принимает `structuredContent` до проверки `isError`; JSON text block также может быть принят до этой проверки. Например:

```json
{"isError":true,"structuredContent":{"episodes":[]}}
```

Этот ответ даёт успешный typed object, затем `isPresent=false`. Аналогичный `facts:[]` может выглядеть как успешный пустой поиск. Проверка строкового поля `error` не заменяет обработку флага MCP. Mutation validators обрабатывают isError отдельно; ошибка относится к typed-read пути.

Последствие: после успешного purge ошибка проверочного get_episodes может разрешить tombstone оригинала, хотя отсутствие derived данных не доказано.

Исправление: отвергать MCP isError до любого разбора данных. Тесты: ошибочный structured/text ответ с episodes/facts, malformed reply, и интеграция с delete — archive.deleteEpisode не вызывается при verification error.

## SB-02 — P1: удаление не ограждено от concurrent reconciliation

Файлы: `src/application/retained-memory.ts`, `src/bin/ace-memory.ts`, `src/adapters/file-projection-outbox.ts`.

Порядок удаления: purge → verified absence → archive.delete; outbox помечается tombstoned позже в CLI. Возможный interleaving:

1. Reconcile читает original для retry.
2. Delete очищает Graphiti, проверяет отсутствие и удаляет original.
3. Reconcile отправляет уже прочитанный original в Graphiti.
4. Старый writer сохраняет pending/projected receipt поверх tombstoned: outbox.put использует rename без CAS/проверки terminal-state версии.

Риск: derived данные воскресают после подтверждённого удаления. Атомарность одного файла не даёт атомарности всей операции. Защита общих archive blobs решает другую задачу.

Исправление: durable deletion intent, episode-level fencing и version/CAS transitions; координация in-flight projection и финальная проверка purge. Тест: barriers после original read и после verified absence, два независимых процесса, запрет overwrite tombstoned устаревшим writer. Статически выведено, не воспроизведено.

## SB-03 — P1: падение между archive persist и outbox.begin оставляет projection без задания

Файлы: `src/application/memory-import.ts`, `src/bin/ace-memory.ts`.

Phase 1 сохраняет originals; phase 2 создаёт projection receipts. При kill между ними original остаётся, intent отсутствует. Reconcile перебирает только outbox.list и такой original не обнаруживает. Повторный import может восстановить работу, но автоматическое recovery этим не обеспечено.

Это не потеря исходных байтов, а потеря durable намерения спроецировать admitted episode. Не смешивать с другим failpoint: provider enqueue до записи receipt.

Исправление: согласованный archive+intent commit либо reconciliation archived admitted episodes без receipts. Тест: kill после persist, до begin; restart reconcile восстанавливает intent без ручного reimport. Archive-only admission не должна ошибочно включаться в projection.

## SB-04 — P1: acquire lease конфликтует с recursive cleanup

Файл: `src/adapters/file-qdrant-snapshot-state.ts`; `acquireLease().close`, `activeIndexKeys`.

A читает каталог как пустой; B записывает новый lease и получает успех; A делает recursive rm и удаляет lease B. Аналогичная гонка возможна при очистке пустого каталога в activeIndexKeys. Дополнительно `readdir(...).catch(()=>[])` превращает ошибки доступа/I/O в отсутствие lease; обработка ENOENT может потерять уже найденные active keys.

Scope: процессы одного state root/owner и включённый GC. Explicit shared collection без exclusive-owner разрешения пропускает GC; прежняя cross-owner проблема имеет отдельное исправление. Нельзя утверждать, что ломается любой двухпроцессный запуск.

Исправление: не делать recursive rm на основании устаревшей пустоты; безопасное удаление пустого каталога, fail-closed I/O и координация acquire с решением об удалении Qdrant. Тесты: barrier acquire между readdir/rm, EACCES/EIO/ENOENT, новый reader между lease scan и data delete. Статически выведено.

## SB-05 — P1 acceptance-contract gap: строка costScope заменяет доказательство полной стоимости

Файлы: `src/domain/harbor-three-arm.ts`, `scripts/harbor-three-arm-gate.ts`.

Полнота вычисляется отрицательным regex по costScope. Пустая/произвольная строка без unmeasured/unknown/codex-reported-usage-only проходит, даже при null численных cost fields. При остальных подходящих флагах возможен measured-not-necessarily-5x; acceptance исходного pair-report не участвует в решении.

CLI приводит входной JSON к TS-типу, не обеспечивая независимую runtime schema. Штатный pair generator сейчас честно маркирует unmeasured: находка не означает наблюдавшуюся ложную публикацию, но гейт не защищён от некорректного входа.

Исправление: structured measurements с явными known/unknown и проверкой компонентов стоимости, исходных verdicts и execution/config identity. Тесты: пустой costScope, произвольная метка, null costs, rejected report, неверная job/config привязка. Не требовать 5x для принятия корректного измерения.

## SB-06 — P2: release loader требует JSON от произвольных DBC artifacts

Файлы: `scripts/release-preflight.ts`, контракт `src/domain/dbc-evidence.ts`.

DBC artifact задаётся path/hash/kind без JSON-only ограничения. CLI для повторной проверки hash вызывает readEvidence, которая всегда JSON.parse. Текстовый лог, многострочный JSONL или бинарный artifact завершают preflight ошибкой ещё до сравнения digest.

Исправление: отдельно читать/хешировать raw bytes и отдельно парсить structured evidence documents. Тест: валидный PASS DBC record с plain-text и multi-event JSONL; несовпадение digest по-прежнему блокирует release. Проверить CLI, а не только domain gate.

## Не считать багом

Одинаковый runtime `snapshot_identity` после edits сам по себе не является ошибкой: это prefix retrieval/provider fingerprint, а не content index_key. Прежняя интерпретация исправлена в связанном review. Недостающий production approval также не равен дефекту кода.

## Порядок работы

1. RED fixtures SB-01…04; исправления memory error/intent/fencing и lease cleanup.
2. Реальные Graphiti и shared-state Qdrant crash/concurrency проверки с сохранёнными oracle и source commit.
3. SB-05/06 до использования acceptance/release pipeline для sign-off.
4. Regression suite, точный CI commit и отдельная фиксация реальных provider результатов.

Документ фиксирует найденные проблемы, а не гарантирует отсутствие других. Реализация существенно продвинулась; указанные ошибки требуют адресной доводки, а не переписывания проекта.
