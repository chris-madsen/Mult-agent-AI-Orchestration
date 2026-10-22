# ACE — ревью остатка unified correctness plan и full release preflight

**Дата:** 2026-10-20  
**Статическая база:** `main` @ [`560c49b043ef73b6ee08ceaf55b170ff780e4718`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/commit/560c49b043ef73b6ee08ceaf55b170ff780e4718). Последние commits после `7cfe49d` меняли review-документы; выводы о коде относятся к проверенным файлам этого snapshot.  
**Предмет:** [единый W00–W16/C-A…C-E plan](2026-10-19-unified-ace-correctness-and-production-plan.md) и [full unified release preflight](unified-production-release-preflight.md). Для корректной оценки статусов сопоставлены [implementation evidence ledger](../reviews/2026-10-20-implementation-evidence-ledger.md), [OpenSpec 006 tasks](../../openspec/changes/006-production-retrieval-vertical-slice/tasks.md), [code-only release profile](code-only-production-release-preflight.md), [follow-up evidence](../reviews/2026-10-20-unified-plan-progress-followup-2.md), [смысловое ревью](../reviews/2026-10-20-semantic-bugs-review.md) и затронутый код.
**Метод:** чтение и сопоставление репозиторных исходников, контрактов и сохранённых описаний/артефактов. **Новые CI, k3s, Qdrant, Graphiti, Vertex, Harbor или Codex E2E здесь НЕ запускались.** Зафиксированные в репозитории PASS не считаются повторно выполненными этим ревью. `P1 static risk` не означает наблюдавшийся production incident.

## 1. Executive verdict

**Полный ACE (code + docs + temporal memory) ещё не `READY`.** Это **не** проект на стадии «порты ещё не написаны»: официальный MCP SDK, реальная экспериментальная code-retrieval цепочка, Graphiti/Vertex adapters, трёхисточниковая composition, durable outbox, delta-index, snapshot manifest, host-helper, тестовые runners и preflight-код существуют. Не создавать всё это заново из-за открытых checkbox в плане от 19 октября.

Остаются **три разных класса незавершённости**, которые нельзя смешивать:

1. **Исправления корректности:** потенциальные гонки delete/reconcile и Qdrant leases, Graphiti MCP error parsing, crash window archive→projection-intent; надёжность release/Harbor oracle; gap в исторических decision-state ответах и полноте `as_of` retrieval.
2. **Реальное доказательство работы:** provider/agent/k3s/recovery/backup/benchmark прогоны с неизменными fixtures и raw evidence. Наличие scripts и прошедших mocks недостаточно.
3. **Owner decisions:** окончательные embedding и semantic provider selection, лицензии, ресурсы, scope облачной передачи, бюджет и explicit sign-off на **точный** commit.

**Метрики:** исторический forced-use Harbor дал native **891 950** против ACE **1 571 768** raw tokens при 9/9 passed у обоих (native/ACE **0.567482×**). Это измеренный отрицательный diagnostic, **не** natural-use эксперимент и не доказательство 5×. Цель 5× **не является обязательным release threshold**, но качество, реальные natural ACE calls, атрибуция и полная стоимость должны быть проверены.

**Два независимых verdict:** `READY_CODE_ONLY` допустим после отдельного [code-only preflight](code-only-production-release-preflight.md) (host или k3s по профилю), **не** даёт права заявлять docs/memory ready. `READY` полного unified продукта требует отдельный [full preflight](unified-production-release-preflight.md), runtime `k3s`, все DBC-01…14, весь список external evidence и owner approval. Не ослаблять full gate ради code-only выпуска.

## 2. Что уже реализовано и что действительно осталось (W00–W16)

`Implementation` ниже означает наличие wiring/кода/контрактов, **не** нормативный PASS. Сохранять historical test receipts привязанными к их собственным source SHA.

| W | Подтверждено кодом / сохранённым evidence | Осталось для закрытия |
|---|---|---|
| **W00** baseline | W00 clean baseline PASS на `8ab84f9`; strict OpenSpec 001–006 и обязательные проверки PASS **на том SHA**; обновлён ledger | Свой exact-head/exact-release receipt; свести устаревшие формулировки планов/tasks к current implementation без переписывания исторических результатов |
| **W01 / C-D** embeddings | Real FastEmbed/ONNX, worker identity handshake, provider fingerprint namespace, comparison runner/gate | Frozen unseen **multi-repo** EN/RU behavior holdout, измерения model@revision/artifact + лицензия/latency/RSS/хост, approved model/runtime/preprocessing и совместимый runtime receipt |
| **W02 / C-B** semantic | AST identifier anchors, byte/UTF-16 checks, direct TS-LS и сравнимый fixture для Serena | **Оба** провайдера на matched corpus/oracles, aliases/overloads/dirty-tree/unicode/dependency snapshot, p95/RSS/license и owner choice; если победит Serena — реально заменить/подключить runtime, а не только переименовать метку |
| **W03** retrieval quality | Quality/compactness evaluator, locate/inspect, exact expansion, small real semantic E2E | Frozen multi-repo lexical/dense/hybrid ablations, top-1 & Recall@k, deceptive names, relevance, tokens, source exactness, качество патча; hybrid только по измеренной выгоде |
| **W04 / C-A/C-C** index | Per-file vector reuse/delta/caches, atomic manifest, coverage, 1k/10k real runs, 8/8 bounded crash scenario | Конкурирующие same-snapshot writers, live shared-state GC/lease, missing/unreadable paths, mid-upsert crash, storage/k3s, repeated cold/warm/change-only perf на selected host, DBC-13 |
| **W05** Vertex | Policy-first HTTP/secret guards, token refresh, synthetic conflict runner, существующий разрешённый Europe corpus | Авторизованный synthetic fixture import и **реальный** retrieveContexts с source URI/version/citation; доказательство code-vs-doc conflict, квоты, egress/cost и negative tests |
| **W06 / C-E** Graphiti | Immutable archive, local Graphiti MCP adapter, typed provenance-backed fact search, valid-time decision logic в domain | Настоящий local inference + FalkorDB extraction/ack/fact recall/as-of + linked originals, версии/trace/cost; объединить историю decisions с MCP-facing memory answer, проверить late facts/top-k |
| **W07** memory safety | Outbox, retry/reconcile, verified purge-before-archive-tombstone, crash runner, file backup tooling | Устранить **F-01…F-03** ниже; real SIGKILL на обоих существенных crash windows, concurrent delete/reconcile, shared blob, backup/restore, inference proof |
| **W08** unified MCP | **УЖЕ внедрены** Graphiti memory port в `ace-mcp.ts`, code+docs+memory context, отдельный `ace_memory_search`, typed required/optional coverage | Real Codex session использует три разрешённых источника; mixed outages, cross-source temporal conflicts и фактические decision-state semantics, source versions |
| **W09** admission | EN/RU fixture/evaluator и `unknown` вместо выдуманной стоимости | Реальный project-all vs admission-filter Graphiti recall и расходы; если filter default — отдельное acceptance доказательство или отключение |
| **W10** routing | **УЖЕ внедрена** deterministic runtime route; Jev необязателен | Многоязычная/семантическая корректность required-source planner, negative cross-source tests, трассировка misses; Jev — deferred opt-in |
| **W11** k3s | mTLS host-helper, containment contracts, k3s evidence runner | Реальный pod→live worktree K3S-01…10 (untracked/dirty, symlink swap, auth, restart, storage), NetworkPolicy/PVC/limits, threat model |
| **W12** failure/security | Source revalidation, policy guards, source race tests, safe traces, cancellation adapters | Real mixed-provider failure/race/denial matrix, fail-closed trace receipts, проверка startup disposition/secret egress на выбранной топологии |
| **W13** Harbor | Strict three-arm job-design checker, отчёты и gate; отрицательный forced-use diagnostic сохранён | Frozen **natural optional** Harbor + native + forced diagnostic, actual provider-call correlation, quality-first, Codex+Serena/ablations, full **structured** cost/latency; устранить F-05 |
| **W14** DBC | Evidence manifest, hash checking и typed statuses, часть ранних DBC sub-gates | Exact-release DBC-01…14; семь пунктов ещё открыты в OpenSpec 006; исправить F-05/F-06/F-07 перед использованием PASS как release oracle |
| **W15** operations/release | Full/code-only preflight, resource/runtime config & supply-chain/backup runners, docs/ops | Реальный resource budget, SBOM/image provenance, provider versions, backup/restore, runtime capture, owner approval и полный immutable evidence bundle на конкретный release commit |
| **W16** deferred | Scope корректно отделён | Jev default, OTel dashboards, Rust rewrite, CPG, другие языки, HA **не** объявлять обязательными release задачами |

**C-A…C-E:** реализация для всех пяти correctness-треков существенно продвинулась, но нормативная приёмка всё ещё требует их собственных negative/provider oracles; не переносить старое описание «ещё не реализовано» на современный код.

**Реальные границы показаний:** 1k/10k индексный отчёт даёт cold/warm/change-only 102625/8402/10183 мс и 983239/24814/33162 мс соответственно; реальные Qdrant crash sub-tests дают 8 PASS в конкретном сценарии. Не переносить эти результаты на произвольные host/storage, workload, selected provider или concurrent GC. [Scale report](../../benchmarks/reports/2026-10-20-index-scale-real-provider.md), [crash report](../../benchmarks/reports/2026-10-20-qdrant-snapshot-crash-real-provider.md).

## 3. Нормативный DBC статус, не проценты готовности

Сейчас в [OpenSpec 006](../../openspec/changes/006-production-retrieval-vertical-slice/tasks.md) **семь отмеченных** DBC: **02, 05, 06, 07, 08, 09, 10**, и **семь открытых**: **01, 03, 04, 11, 12, 13, 14**. Первые семь — evidence на соответствующих предыдущих SHA/fixtures; это **не** 7/14 PASS на новом release SHA. Из последних семи:

| DBC | Обязательный остаток |
|---|---|
| **01** | Реальная MCP composition с *approved* embedding/LSP, соответствующей конфигурацией и failure semantics |
| **03** | Не tiny fixture, а большой, замороженный, behavior-based retrieval holdout с distractors |
| **04** | Matched Serena–TS-LS + exact symbol identity + approval |
| **11** | Реальная Graphiti-derived deletion, concurrent recovery safety и отсутствие resurrected facts |
| **12** | Реальное natural ACE usage, качество, attributable calls и полный учёт ресурсов/стоимости |
| **13** | Selected-target real delta/index/restart/GC/concurrency acceptance |
| **14** | Реальный разрешённый Vertex doc-code conflict с проверяемыми цитатами и актуальным кодом |

Для полного release **все 14** должны иметь evidence на точном коммите, включая повторный прогон/эквивалентное доказательство применимости ранее принятых sub-gates. `PASS` не возникает от копирования старого checkbox.

## 4. Конкретные дефекты и смысловые несоответствия, которые надо исправить

Приоритеты здесь означают blocker для достоверности full release или соответствующей capability. Где сценарий ещё не запущен, статус **static risk / negative test required**; это не утверждение о наблюдавшемся сбое.

### F-01 — P1 / Graphiti: error в typed read интерпретируется как успешная пустота

**Статически подтверждено.** В [`src/adapters/graphiti-mcp.ts`](../../src/adapters/graphiti-mcp.ts) `replyJsonObject()` принимает `structuredContent` либо JSON text **раньше** проверки `isError`. Для `{isError:true, structuredContent:{episodes:[]}}` возможен `Ok([])`, далее `projectionState.isPresent=false`. На пути delete это может стать ложным доказательством purge. Аналогично `facts:[]` скрывает retrieval failure.

**Fix:** проверять `isError` первым независимо от формы content; typed `Result.Err` на все MCP error responses. **RED:** structured/text `isError` + `episodes:[]`/`facts:[]`, и oracle «при ошибке проверки `archive.deleteEpisode` не вызван». Real provider negative run перед W07/DBC-11.

### F-02 — P1 / memory delete: concurrent reconciliation может воскресить удалённую derived projection

**Статически выведено; нужен deterministic interleaving.** В [`retained-memory.ts`](../../src/application/retained-memory.ts) порядок purge→verify absent→archive delete; запись terminal `outbox tombstoned` происходит позднее в CLI. Параллельный reconciler может прочесть original раньше удаления и отправить projection после verify. [`file-projection-outbox.ts`](../../src/adapters/file-projection-outbox.ts) делает atomic `rename`, но **не CAS / fencing**, так что старый writer может перезаписать tombstoned receipt.

**Fix:** durable deletion intent **до** purge, episode-level version/fence, согласование in-flight projector, terminal-state CAS и финальный post-drain absence oracle. **RED:** два процесса с barriers после original read и после verified absence; после delete ни один derived fact не возникает вновь, tombstone невозможно перезаписать старой версией.

### F-03 — P1 / memory import: crash между archive persist и созданием outbox intent

**Статически подтверждён control-flow gap.** [`memory-import.ts`](../../src/application/memory-import.ts) сохраняет **все** originals (phase 1), затем вызывает `outbox.begin` (phase 2). Если процесс погиб между фазами, original остаётся, но reconcile перечисляет лишь outbox receipts; автоматического projection recovery нет. Нынешний real Graphiti crash runner покрывает **другое** окно — after-provider-enqueue-before-durable-receipt.

**Fix:** durable archive+projection-intent transaction либо reconcile по admitted archived episodes, отсутствующим в outbox. **RED:** SIGKILL после archive persist и до `begin`; restart/reconcile восстанавливает projection без ручного reimport; `archive_only` не получает фиктивный intent.

### F-04 — P1 / Qdrant: lease acquire vs recursive cleanup

**Статически выведено; не доказанный инцидент.** В [`file-qdrant-snapshot-state.ts`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/560c49b043ef73b6ee08ceaf55b170ff780e4718/src/adapters/file-qdrant-snapshot-state.ts) `close()` и `activeIndexKeys()` после пустого `readdir` выполняют recursive `rm`. Между проверкой и удалением другой процесс может создать успешный lease. `readdir(...).catch(()=>[])` смешивает отсутствие каталога с EACCES/EIO и не всегда fail-closed. Scope: **один state owner/root при разрешённом GC**; explicit shared collection без exclusive ownership пропускает GC и не является универсально уязвимой.

**Fix:** запретить recursive removal на устаревшей оценке пустоты; atomically coordinate lease acquisition with GC epoch/lock, fail-closed I/O handling, distinguish ENOENT. **RED:** acquire в окне readdir/rm, same-snapshot writers, reader между scan и Qdrant delete, EIO/EACCES/ENOTEMPTY; real concurrent storage test.

### F-05 — P1 / Harbor acceptance: «полная стоимость» подтверждается произвольной строкой

**Статически подтверждено.** [`src/domain/harbor-three-arm.ts`](../../src/domain/harbor-three-arm.ts) ставит `costTelemetryComplete = !/unmeasured|unknown|codex-reported-usage-only/.test(costScope ?? 'unknown')`. Пустая или произвольная строка проходит, даже если численные cost fields `null`. В `assessThreeArmReports()` также нет полноценной проверки исходного report acceptance и тождественности job/config; [CLI](../../scripts/harbor-three-arm-gate.ts) приводит JSON к TS-типу без runtime schema. При остальных true-флагах возможен ложный `measured-not-necessarily-5x`.

**Fix:** typed `Measurement<known|estimated|unknown>` по каждому компоненту (Codex + indexing/model CPU/RAM + Graphiti/Vertex + amortization), проверяемые provenance/job/commit/fixture identities и исходные quality verdicts; missing/unknown не становятся `complete=true`. RED с `costScope: ""`, `"all good"`, null costs, подменённой конфигурацией, rejected pair report. Это **acceptance-contract gap**, не утверждение о фактическом выпуске ложного отчёта.

### F-06 — P1 / release: разные входы имеют неодинаковую глубину проверки

**Статически подтверждено.** [`src/domain/release-preflight.ts`](../../src/domain/release-preflight.ts) повторно валидирует resource-budget/runtime-config/external documents, но embedding/semantic selections, retrieval-quality и Harbor принимает в основном по вложенным `verdict.productionApproved`, `measurementAccepted`, `outcome.*`. [CLI](../../scripts/release-preflight.ts) хеширует эти JSON как файлы, но не сверяет с первичными reports/policies/tasks, и не связывает все результаты с одним release build/runtime/model/fixture. Наличие хеша документа само по себе не проверяет истинность его метрики.

**Fix:** schema-validated input provenance, re-evaluation/attested receipt исходных gate outputs, связка `selected model+artifact+preprocessing`, `semantic provider`, `code index fingerprint`, `runtime configuration`, report job IDs и release commit. Исторические measurements могут быть переносимы между commits **по явной политике**, а не по неявному совпадению строки `APPROVED`. RED: forged flags, mismatched selected artifact/runtime, stale benchmark/rejected source report.

### F-07 — P2 / release CLI: DBC artifact объявлен произвольным байтовым, но парсится как JSON

**Подтверждено несовпадение контрактов.** [`DbcArtifactEvidence`](../../src/domain/dbc-evidence.ts) содержит `path/sha256/kind` без ограничения JSON-only. [`scripts/release-preflight.ts`](../../scripts/release-preflight.ts) и [code-only CLI](../../scripts/code-release-preflight.ts) проверяют каждый artifact посредством `readEvidence()`, делающего **безусловный `JSON.parse`**. Корректные text, JSONL или binary logs приведут к exception до SHA comparison. Это может заблокировать корректный release evidence.

**Fix:** hash raw bytes; JSON parsing только для нормативных structured documents. Тесты для plain text, multi-record JSONL, binary + digest mismatch; отдельное объяснение `BLOCKED` вместо необработанного parse error. Для symlinks в evidence paths проверить realpath containment согласно policy.

### F-08 — P1 / W06-W08: temporal decision truth не доведена до реального MCP memory answer

**Функциональный contract gap, не утечка данных.** В [`src/adapters/graphiti-mcp.ts`](../../src/adapters/graphiti-mcp.ts) memory search возвращает для hits `decisionStates: []`, глобально `conflicts: []` и вызывает Graphiti `search_memory_facts` с `max_facts: 50` **без серверного `as_of`**, затем фильтрует времена локально. Доменная [`decisionStateAt`](../../src/domain/memory.ts) уже умеет valid-time history, но она не инжектирована в этот result. Поэтому `ace_memory_search` пока нельзя считать доказанным answers-with-decision-timeline; исторически релевантные факты за пределами первых 50 могут быть пропущены.

**Fix:** подкреплённая immutable source decision repository/timeline в runtime search; связать fact и verified archived episode/decision ID, вычислять applicable accepted/rejected/superseded `as_of`; time-aware provider query или корректная exhaustive pagination+filter, с явным `partial` если провайдер не гарантирует полноту. **RED:** accepted→superseded, two conflicting decisions, late invalidated facts и >50 свежих distractors; true old fact обязан появиться либо возвращаться honest incomplete, не ложная пустота.

### F-09 — P1 / W10: deterministic routing не распознаёт русскоязычное намерение к памяти/докам

**Прямо видно в коде.** [`src/domain/routing.ts`](../../src/domain/routing.ts) ищет `decision, why did we, session` для memory и `adr, rationale, documentation` для docs; русские эквиваленты отсутствуют. Например, запрос **«Почему мы раньше отклонили Graphiti?»** без explicit include flags маршрутизируется как `code`, а required memory вообще не запрашивается. `complete=true` для ошибочно выбранного required-source plan не доказывает answer completeness.

**Fix:** multilingual intent fixtures (RU/EN, paraphrases, mixed query), явные запросные source hints, obligation-aware coverage и oracle для `why/decision/as-of`; измерить source misses/overfetch; не делать Jev обязательной зависимостью.

### F-10 — P1 / readiness policy: противоречие fatal vs not_ready при embedding startup failure

[Operational matrix](../operations/ace-configuration-and-readiness-matrix.md) утверждает, что **embedding provider preflight failure или pinned identity mismatch → fatal process exit**. В текущем [`src/bin/ace-mcp.ts`](../../src/bin/ace-mcp.ts) `embeddings.probe()` с `Err` приводит к `readiness.code_retrieval/unified_context = not_ready`, закрывает worker и оставляет MCP process работать. Не все mismatch пути идентичны, но заявленное правило preflight в целом несовместимо с реально наблюдаемым control flow.

**Fix:** утвердить одну таблицу для **bad pinned identity**, **provider temporarily unavailable**, **missing runtime** и **Qdrant outage**, реализовать и задокументировать одинаково; negative executable startup tests для exit code, `ace_workspace_status` и no false current.

### F-11 — P2 / release governance: approval и evidence identity должны быть проверяемыми

[Full preflight](unified-production-release-preflight.md) требует explicit owner approval, но [`evaluateReleasePreflight`](../../src/domain/release-preflight.ts) доверяет `status: approved` + непустой `reference` и правильный `releaseCommit`; сам факт, кем и как утверждено, технически не удостоверяется. Это **граница модели доверия**, не доказанная подделка: если policy в repo управляется только владельцем, риск может приниматься осознанно.

**Fix/decision:** документировать trust root (protected approval PR/commit, signed attestation или ручное подтверждение владельца со ссылкой на неизменяемый record), retention и how-to replay exact-commit release evidence. Raw artifacts могут быть git-ignored: зафиксировать immutable storage/URI+digest и срок хранения. Иначе `READY` подтверждает наличие *введённой строки*, но не происхождение approval.

### F-12 — P2 / планы и runbooks: stale «сейчас» и неоднозначные требования

Сводный [план](2026-10-19-unified-ace-correctness-and-production-plan.md) фиксирует исторические тезисы «W04 только warm reuse», «W08 не inject Graphiti», «W10 routing не подключён». В [новом ledger](../reviews/2026-10-20-implementation-evidence-ledger.md) и текущем коде это **уже не так**. Это **status drift**, а не доказательство ложной реализации. Также [OpenSpec 006 CODEX execution plan](../../openspec/changes/006-production-retrieval-vertical-slice/CODEX-EXECUTION-PLAN.md) содержит устаревшие immediate wiring instructions. Не запускать повторную реализацию на основе этих абзацев.

**Fix:** оставить старый historical baseline с датой, добавить краткое `current delta/status as-of SHA` и ссылки на ledger; чётко пометить какой документ — backlog, какой — normative contract, какой — generated evidence. Приоритет Accepted ADR/OpenSpec не менять.

## 5. Смысловые вопросы между двумя планами/preflight

| Вопрос | Проверка и решение |
|---|---|
| **«W13 достаточно cost unknown» vs «full preflight complete cost telemetry»** | Это не обязательно прямое противоречие: *diagnostic measurement* может честно вернуть `unknown`, но **production acceptance не может назвать это полной стоимостью**. Явно прописать два исхода `REPORT_RETAINED_WITH_UNKNOWNS` и `PRODUCTION_COST_COMPLETE`; F-05 делает второй машинно доказуемым. |
| **5× goal vs release gate** | По обоим документам 5× — research North Star, **не критерий PASS**; требовать измерение, quality non-inferiority и attribution. Не превращать отрицательный forced-use результат в blocking 5× threshold или в экономию. |
| **Full `READY` vs `READY_CODE_ONLY`** | Осмысленные **разные scopes**, не противоречие: host допустим code-only, full profile требует k3s и все три capabilities; разные DBC subsets и внешние gates. |
| **W09 admission optional vs full memory** | План условно блокирует release только если admission-filter включён по умолчанию, но full preflight **не содержит отдельного admission-quality evidence** и runtime config не фиксирует выбранную admission policy. Либо отключить filter в release, либо включить критерий non-regression/critical recall в DBC/release manifest. |
| **Semantic provider choice vs hardcoded direct TS-LS** | Текущий [runtime bootstrap](../../src/bin/ace-mcp.ts) использует TS-LS, а [runtime evidence script](../../scripts/runtime-config-evidence.ts) явно пишет `typescript-language-service`. Это честное текущее ограничение. Если W02 выберет Serena, **нужен реальный кодовый switch + новое evidence**, не просто `ownerApproval=Serena`. |
| **Full preflight `always writes BLOCKED`** | Документ ограничивает обещание structurally usable files, но в [CLI](../../scripts/release-preflight.ts) malformed-but-readable source/external evidence и неверный hash могут вызвать `throw` до JSON verdict. Уточнить типы `INVALID_INPUT`, `EVIDENCE_INVALID`, `BLOCKED` или гарантировать machine-readable fail output даже при validator failure. |
| **Exact-commit validation** | Нормативный release действительно требует evidence и approval для одного exact commit. В то же время повтор всех внешних сравнений после docs-only commit дорог и не всегда необходим. Зафиксировать versioned lineage/compatibility rule для переносимых измерений, но DBC/release receipt и фактическая runtime-конфигурация должны ссылаться на **точный** release commit. F-06 закрыть прежде, чем опираться на переносимость. |

## 6. Минимальный упорядоченный remaining execution / acceptance plan

1. **P1 correctness first (RED→GREEN):** F-01…F-04, F-08, обязательные negative fixtures, затем Graphiti concurrent delete/reconcile и Qdrant shared-root GC/lease на реальном storage. Закрыть два **разных** Graphiti crash windows; исправить F-10 startup contract.
2. **P1 release integrity:** F-05/F-06, затем F-07 и owner/evidence trust policy; CI-тесты для `forged cost scope`, неконсистентного report selection, non-JSON DBC logs, неверного release SHA. До этого **не полагаться** на выданный гипотетический `READY` как на достаточный доказательный oracle.
3. **Freeze providers, not assumptions:** W01 frozen multi-repo embedder test, W02 matched semantic test, W03 precision/compactness, W04 selected-host scale/GC/restart. Зафиксировать licensed approved identities и artifact digests. Если Serena выиграет, переподключить runtime.
4. **Memory/docs proof:** W05 authorized Vertex fixture ingestion + code conflict; W06 Graphiti local inference/facts/temporal; W07 crash/purge/backup; W08 реальная Codex session с 3 источниками; W09 admission evaluation если policy активна; F-09 RU/EN planner.
5. **k3s/security:** W11 реальные K3S-01…10 на рабочем worktree и PV/NetworkPolicy, W12 deny/timeout/cancellation/race/security provider matrix с request-correlated receipts.
6. **Real Harbor + freeze:** W13 три ветки (native, ACE natural optional, ACE forced diagnostic), Codex+Serena baseline где применимо; verify model/effort/tasks/commit, repeated natural calls, quality, latency, full accounting without null→0. Не использовать вынужденное обращение как причинный выигрыш.
7. **Final acceptance:** W14 DBC-01…14 с raw fixtures/hashes на финальном SHA; W15 runtime/resources/supply-chain/backup/Graphiti/Vertex/k3s evidence; отдельные code-only/full preflights; owner approval exact commit. Обновить OpenSpec tasks по **фактически** выполненным нормативным gates и release notes.

### Машинные exit gates (не декларации)

- **Code-only:** применимые DBC-01…09,12,13 + approved embedding/LSP + frozen retrieval quality + natural Harbor + resource/runtime/supply-chain; k3s evidence при profile=k3s; одобрена только `code`.
- **Full unified:** **все DBC-01…14** + approved providers + real Graphiti lifecycle **и** crash + Vertex conflict + k3s worktree + backup/restore + supply chain + owner-approved budgets/runtime + natural Harbor + exact-commit approval code/docs/memory.
- **Deferred:** Jev production, all-purpose observability, extra languages, Rust/CPG/HA не являются самостоятельной причиной BLOCKED, пока не введены в release scope.

## 7. Итог и границы достоверности

**Не переписывать ACE; устранить P1 correctness/acceptance gaps и накопить ещё отсутствующее real evidence.** Архитектура и основной кодовый каркас достаточно развиты для targeted hardening. Самое рискованное сейчас — **false evidence of absence**, resurrection после удаления, ошибочная GC, неполный historical recall и **ложный release/Harbor PASS**. Эти проблемы важнее косметики документации.

Статические пути F-01/F-03/F-05/F-07/F-08/F-09/F-10 подтверждены чтением исходников; сценарии гонок F-02/F-04 требуют детерминированного RED reproduction. Внешних запусков в рамках этого ревью не было, поэтому оно **не устанавливает**, что найденные ошибки уже случались на настоящем Graphiti/Qdrant. Полный production `READY` и 5× **не доказаны**.

**Полезные первичные ориентиры:** [normative contracts DBC-01…14](../docs/architecture/07-architecture-fitness-contracts.md) · [implementation ledger](../reviews/2026-10-20-implementation-evidence-ledger.md) · [full release preflight](unified-production-release-preflight.md) · [code-only preflight](code-only-production-release-preflight.md) · [более ранний code-review finding log](../reviews/2026-10-20-semantic-bugs-review.md).
