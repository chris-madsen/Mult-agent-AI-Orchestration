# ACE: повторное ревью выполнения плана

Дата запроса: 2026-10-20, 12:27 EEST.
Проверенная база: `7cfe49d24a8c288f4fc97a251bc01623d1f68d70` (main после PR #82).
План: [единый backlog](../plans/2026-10-19-unified-ace-correctness-and-production-plan.md).

## Вывод и границы проверки

Прогресс существенный: теперь есть сохранённые реальные scale/crash результаты, а не только генераторы доказательств. Однако production-приёмка не завершена; найдены остаточные статические дефекты lifecycle и acceptance-инструментов.

Это не полный построчный аудит всей репы и не повторный запуск тестов. Непосредственно изучены текущий ledger, оба follow-up, scale/crash отчёты и raw JSON crash/10k, snapshot-state и его тесты, Harbor three-arm domain/CLI, release-preflight domain/CLI, DBC evidence domain, package.json и CI workflow. Каталоги reports/reviews/application/domain и история main проверены выборочно. Большой канонический план обрезается в W02; таблица W00–W16 и correctness-треки доступны, остальные статусы сверены по ledger. Непрочитанный хвост не считается проверенным. LCon2 временно не предоставил инструменты; реальные провайдеры, npm tests и OpenSpec мной не запускались.

CI head PR #82: contracts SUCCESS (run 39393955567, job 118531948688). Это не отдельный прогон merge-SHA. Ledger сообщает W00 PASS на `8ab84f9c86ef84ea4e47ac3c673bf3d401bdea0d`; ignored raw receipt мной не перечитан.

## 1. Реально появившиеся доказательства

Источники: [scale report](../../benchmarks/reports/2026-10-20-index-scale-real-provider.md), [10k JSON](../../benchmarks/reports/index-scale-2026-10-20-10000.json), [crash report](../../benchmarks/reports/2026-10-20-qdrant-snapshot-crash-real-provider.md), [crash JSON](../../benchmarks/reports/qdrant-snapshot-crash-2026-10-20.json).

| Файлов | Cold, мс | Warm, мс | Change-only, мс | Warm reused vectors |
|---:|---:|---:|---:|---:|
| 1 000 | 102 625 | 8 402 | 10 183 | 1 000 |
| 10 000 | 983 239 | 24 814 | 33 162 | 10 000 |

1k сверено по Markdown; 10k дополнительно по raw JSON. Change-only 10k переиспользует 9 997 векторов; по одному edit/add/delete/rename, coverageFailed=0. Это подтверждает reuse, но не постоянную стоимость обновления: warm/change-only зависят от размера workspace. Cold 10k около 16 минут; нужны повторы и согласованный бюджет целевого хоста.

Crash JSON содержит 8 PASS и request IDs: SIGKILL после Qdrant verification, до publish; S1 сохраняет неизменённый символ после crash и S2 publication. State roots различаются, GC explicit shared collection выключен. Partial response S1 после изменения другого файла — ожидаемое честное поведение.

Это bounded sub-gate, не доказательство GC под нагрузкой, kill посреди upsert или полного DBC-13. Source commits измерений: scale `c79afd87686579fe11174c4fd2182c2357ef9cc5`, crash `07b143b1cef5fddb79d1c59be52f904c0c097762`; не переименовывать их в прогон текущего main.

Утренние F1–F6 имеют disposition в [follow-up](./2026-10-20-unified-plan-progress-followup.md) и [follow-up 2](./2026-10-20-unified-plan-progress-followup-2.md): owner isolation, conservative reaping, narrow payloads, verified namespace, readiness, all-decision valid-time semantics, ledger refresh. В snapshot-state непосредственно подтверждены stateOwnerId и conservative режим; остальные fixes здесь документально сверены, не воспроизведены. Старые замечания нельзя повторять как неисправленные.

## 2. Остаточные находки

### R1 — P1: close/GC могут удалить новый lease

`src/adapters/file-qdrant-snapshot-state.ts`: close читает пустой каталог, затем делает recursive rm. Между readdir и rm другой процесс может успешно записать новый lease; rm удалит его вместе с каталогом. Аналогично activeIndexKeys удаляет каталог по устаревшему наблюдению. Это same-state-root гонка, не исправленная изоляцией разных state owners.

Статически выведено, не воспроизведено. Нужен barrier-тест acquire между readdir/rm и реальный shared-state тест. Использовать безопасное удаление только пустого каталога с обработкой ENOTEMPTY; отдельно координировать решение об удалении Qdrant с acquire. Не считать это полным решением всей GC-транзакции.

### R2 — P1: ошибка чтения lease превращается в отсутствие защиты

Там же: `readdir(directory).catch(() => [])`; внешний ENOENT возвращает пустое множество. EACCES/EIO внутри каталога превращаются в пустой список, после чего возможен recursive rm. Исчезновение одного каталога при обходе может потерять сведения об остальных active keys.

Статический риск, не storage reproduction. Нужны tests EACCES/EIO/concurrent ENOENT; неопределённость должна блокировать GC, не разрешать удаление.

### R3 — P1 для W13: cost telemetry определяется строкой

`src/domain/harbor-three-arm.ts`: costTelemetryComplete вычисляется отрицательным regex по costScope. Пустая или произвольная строка без unmeasured/unknown/codex-reported-usage-only проходит, даже при null costUsd. При observed_complete, quality parity и correlation возможен measured-not-necessarily-5x. acceptance входного pair-report не учитывается. CLI `scripts/harbor-three-arm-gate.ts` делает type assertion, не runtime validation; fingerprint дизайна не сравнивается с привязкой выполненных reports к jobs.

Это gap входного контракта, не доказанная ложная публикация. Текущий pair generator честно маркирует unmeasured. Исправление: типизированные компоненты затрат с unknown, проверка внутренних verdicts и config/task/model identities. Negative tests: пустая/произвольная costScope, null counters, rejected report, чужой config digest.

### R4 — P1/P2: release доверяет непересчитанным verdicts

`src/domain/release-preflight.ts` глубоко валидирует external/runtime/resource evidence, но embedding/semantic selection, retrieval quality и Harbor в основном проверяет nested verdict/status flags. `scripts/release-preflight.ts` хеширует прочитанные JSON, но не пересчитывает эти acceptance решения; аналогичной DBC/external exact-commit проверки четырёх документов в прочитанном domain нет.

Риск: перенос устаревшего или противоречивого measurement/approval при прочих валидных inputs. Это не обход всех гейтов одним файлом. Нужна семантическая валидация и согласованность provider/model/artifact/config/corpus; явная политика переносимости измерений, cross-commit/config и forged-verdict тесты.

### R5 — P2: raw DBC artifacts ошибочно требуют JSON

DbcArtifactEvidence (`src/domain/dbc-evidence.ts`) допускает path/hash/kind без JSON-only ограничения. Но release CLI проверяет каждый artifact через readEvidence, всегда выполняющий JSON.parse. Валидный plain-text лог, многострочный JSONL или бинарный artifact ломает preflight до сверки digest.

Разделить read/hash bytes и parse JSON. Тестировать DBC PASS с текстовым логом и многострочной трассой. Это blocker реального evidence bundle, не inference bug.

### R6 — P2: change-only oracle недостаточен

Raw 10k JSON содержит одинаковый snapshotIdentity `b06c1391174d` в cold/warm/change-only при edit/add/delete/rename. `scripts/index-scale-e2e.mjs` проверяет rebuilt и delta counters, но не cold=warm/cold!=changed для content key и не точный D2 digest изменённого символа.

Причина одинакового поля неизвестна: возможно, оно не означает index_key или ошибочно логируется. Это не доказательство stale retrieval. Уточнить метрику; сохранять полный index_key и source digest; добавить identity и D2-content assertions. Тайминги полезны, но не закрывают этот oracle.

## 3. Что осталось по плану

| Пакеты | Текущий уровень | Остаток |
|---|---|---|
| W00 | baseline PASS заявлен для exact 8ab84f9, ledger актуализирован | receipt финального release commit |
| W01–W03 / C-B,C-D | comparison tooling, identity, direct TS-LS sub-evidence по ledger | frozen multi-repo embedding/quality, matched Serena, лицензии и owner approval |
| W04 / C-A,C-C | реальные 1k/10k и bounded crash | R1/R2/R6; same-snapshot writers, mid-upsert kill, timeout, target storage/k3s и repeated resource budgets |
| W05 | adapter/policy/runner по ledger | настоящий разрешённый Vertex corpus и citations/conflict |
| W06–W07 / C-E | history/outbox/reconcile/crash runner по ledger | local inference + Graphiti/FalkorDB, ack-gap kill, purge/replay/restore |
| W08–W10 | unified/routing/admission implementation по ledger | реальная Codex-сессия с тремя источниками, counters и admission economics |
| W11–W12 | k3s/helper/security implementation по ledger | K3S-01…10 и реальная provider-failure/privacy matrix |
| W13 | three-arm tooling | R3; natural-use measurements и полная атрибуция стоимости |
| W14–W15 | DBC/preflight/resource/runtime/supply-chain tooling | R4/R5; exact-release evidence bundle и scoped owner sign-off |
| W16 | deferred | не расширять критический путь без основания |

Отсутствие результата в просмотренных reports не доказывает, что вне репы ничего не запускалось. Pending не означает failed. Процент готовности не выводится из числа PR или гейтов.

## 4. Следующая итерация

1. RED/GREEN R1/R2 и реальный shared-state GC test: текущий crash с выключенным GC его не заменяет.
2. R3–R5 до формального Harbor/release acceptance.
3. Уточнить R6, добавить source/identity oracle, сохранить новые артефакты без переписывания исторических.
4. Frozen W01–W03; exploratory natural Harbor можно запускать до production approval, явно diagnostic.
5. Параллельно real Vertex и local Graphiti; затем unified Codex, k3s и recovery.
6. Зафиксировать release candidate; exact-commit CI/OpenSpec/DBC/resources/runtime/supply-chain; scoped owner approval.

Направление верное, реальных доказательств стало больше. Но полный план ещё не закрыт; production-ready и 5x не подтверждены.
