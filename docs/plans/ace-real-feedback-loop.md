# ACE: реальный feedback loop — план запуска и критерии успеха

**Статус:** план исполнения, **не отчёт о выполненном эксперименте**.  
**Исходный код при планировании:** `main@37b38a7d0319dd23a826b93359b8fdc28c2d14a3` (22 октября 2026).  
**Цель:** как можно быстрее получить воспроизводимый ответ на два вопроса: (1) помогает ли ACE агенту находить нужный *проверенный* код; (2) уменьшается ли суммарный расход **фактических токенов агента** без ухудшения решения задач.

## Принцип: замкнуть петлю, а не строить ещё один release gate

```text
фиксированная реальная задача/репозиторий
  → исходный агент без ACE (native)
  → тот же агент с доступным, но необязательным ACE (natural-use)
  → реальные MCP-вызовы + полные provider traces + agent usage + проверка ответа
  → сопоставление конкретных ошибок, лишних чтений и контекста
  → ОДНО целевое исправление ACE
  → повторить тот же диагностический набор, затем проверить на неиспользованном наборе
```

*Достаточно одного честного отрицательного или положительного эксперимента, чтобы начался feedback.* Не ждём 5×, Graphiti, Vertex, k3s-release, сертификатов и одобрений моделей. CI проверяет регрессии, но не заменяет эксперимент.

### Что уже есть и что нельзя считать доказательством полезности

Уже реализовано: `ace_context`, `ace_expand`, настоящий MCP; ast-grep outline/CST-диапазоны; отдельный LSP-адаптер; FastEmbed и Qdrant; dense/sparse/hybrid; context delivery/receipts; `scripts/retrieval-benchmark-runner.ts`; Harbor jobs и gate/reconciliation. Не нужно переписывать эти компоненты.

**Установленный дефект интеграции:** `ast-grep outline` отдаёт диапазон декларации, но не координаты её имени. До исправления структурные кандидаты не получали `semanticAnchor`, и LSP verification часто становился `uncertain`. PR с этим планом исправляет консервативное извлечение именованных якорей и добавляет интеграционный тест ast-grep → реальный TS-LSP. Якоря для сложных/неоднозначных деклараций намеренно остаются unknown; это не доказательство универсального CST+LSP покрытия.

**Нельзя переиспользовать как новый feedback:** старые синтетические fixtures, `428/428 PASS`, старые forced-Harbor агрегаты без строгой correlation, предыдущие `5×`-рассуждения. Это отдельные исторические данные с ограничениями. Любые новые числа — только из нового реального прогона.

## Этап 0 — восстановить и доказать реальную CST → LSP цепочку

**Задачи:**

1. Дождаться CI для изменения ast-grep name-anchor; зафиксировать точный коммит и провалившиеся/прошедшие тесты.
2. Протестировать не только LSP `definition` отдельно, но и `ast-grep → local-code-index → Qdrant → ace_context → LSP proofClass` на *реальном, не подставленном* TypeScript-файле. Никаких вручную созданных `semanticAnchor` в ключевом интеграционном тесте.
3. В отдельном отчёте измерить покрытие: `indexed_structural_symbols`, `anchored_symbols`, `lsp_confirmed_symbols`, `lsp_unconfirmed_symbols`, ошибки по языкам. Отдельно примеры class/function/method, одинаковые имена в разных scopes, Unicode, импорт/реэкспорт, overload, nested declarations.
4. Проверить, что неоднозначные якоря не получают ложный `direct`; `uncertain` и причины доступны для диагностики.
5. Открыть отдельные issues на отсутствующие CST name nodes/поддержку LSP для иных языков, вместо маскировки их обычными зелёными тестами.

**Критерий:** есть сохранённый raw trace настоящего MCP `ace_context` хотя бы для одного TS-symbol с `LSP definition confirmed` из реального ast-grep кандидата. Пока нет — `NOT_VERIFIED`. Никакого утверждения о качестве retrieval.

## Этап 1 — один рабочий локальный стек без дополнительных систем

**Нужно:** Node и locked npm dependencies; ast-grep CLI; `typescript-language-server`; Python environment `.venv-embedding-fast` с FastEmbed/ONNX и sparse BM25; Qdrant в Docker либо через проброс localhost; фиксированный checkout ACE + отдельно checkout репозитория с задачами; доступный Codex/OAuth или иной **явно зафиксированный** agent provider.

**Пример проверки на машине, где развернут ACE** (не утверждение, что выполнено):

```bash
npm ci --ignore-scripts
npm run build
./node_modules/.bin/ast-grep --version
./node_modules/.bin/typescript-language-server --version
.venv-embedding-fast/bin/python -c 'import fastembed, onnxruntime; print(fastembed.__version__)'
curl --fail http://127.0.0.1:6333/collections
```

Запуск `ace-mcp` со своим `ACE_WORKSPACE_ROOT` и собственными state/artifact каталогами и `ACE_ENABLE_EXPERIMENTAL_QDRANT=true`. Проверить `ace_workspace_status` => `ready`; не подменять недоступный Qdrant лексическим/mock provider. Не менять замороженные репозитории/holdouts. Обязательное условие: **правильный source/runtime provenance** и логи реальных provider invocation.

**Стоп-причины:** `NOT_READY`, неразрешённый index coverage, несовпадение source digest, отсутствующий embedding worker, нет авторизации агента. Записать BLOCKED с конкретной причиной; не подставлять ноль или PASS.

## Этап 2 — реальная проверка retrieval отдельно от агентной экономики

**Первый датасет:** [RepoBench-R](https://huggingface.co/datasets/tianyang/repobench-r), опубликованный cross-file retrieval benchmark (Python/Java). Не создаём и не размечаем вручную 20 собственных задач. Его objective — нужный внешний snippet/cross-file context. **Важно:** его исходная единица релевантности — не наши CST чанки; нужно документировать *однозначное сопоставление* gold snippet с фактическим файлом и exact source span. Если сопоставить нельзя — кейс INVALID, а не ложный miss/hit.

**Задачи адаптера (минимум):**

1. Скачать выбранные split/версию и source fixtures; зафиксировать commit/revision/sha256 данных; сохранить неизменный manifest c ids и gold.
2. Преобразовать запросы и relevant spans в формат уже существующего `RetrievalHoldout`; не переписывать benchmark evaluator. Никакой золотой подсказки в запросе или runtime.
3. Проверить доступность исходных файлов/коммитов; при отсутствии repo snapshot — остановить именно этот benchmark и перейти к Harbor dataset, а не синтезировать репозиторий.
4. Выполнить через реальный MCP `dense`, `sparse`, `hybrid_rrf` на одной и той же версии источника, без reranker (текущие кандидаты не одобрены). Сохранять per-query `requestId`, ranked candidate IDs, paths, byte ranges, AST/LSP verdict, retrieval trace, raw MCP response и latency.
5. Считать `Recall@k`, `MRR@k`/точность найденных gold spans, % unknown/uncertain, payload bytes, стоимость проекции/дубликаты; токены payload через явный токенизатор конкретной модели, отдельно от agent billing. Не делить на ноль и не интерпретировать байты как токены.
6. Отобрать не только среднее, но худшие кейсы: не нашёл, неверный symbol/scope, anchor unverified, громоздкий payload, устаревший источник.

**Критерий:** сохранены реальные ranked результаты, воспроизводимый подсчёт gold@k и список конкретных ошибок. Числа могут быть плохими. Инструмент только помогает ответить, *почему*.

## Этап 3 — настоящая агентная польза через Harbor

**Первый Harbor датасет:** `scale-ai/swe-atlas-qna` — готовый public dataset глубокого понимания кода, 124 задачи/11 проектов (см. [Harbor Hub](https://hub.harborframework.com/datasets) и [SWE-Atlas QnA](https://huggingface.co/datasets/ScaleAI/SWE-Atlas-QnA)). Это проверки agent QnA, **не gold-labelled CST retrieval**.

### Технические задачи перед экспериментом

- Проверить **точную** версию установленного Harbor и команду `harbor run --help`, перечислить доступные датасеты (`harbor datasets list`), зафиксировать dataset version и pinned repository commits. Не полагаться на пример команды как на доказательство совместимости.
- Подключить настоящий ACE-MCP к *каждому* task container/agent runtime с source root **того же** pinned checkout, который видит Codex. В Docker `127.0.0.1` внутри контейнера — не обязательно Qdrant хоста; проверить сетевую достижимость и монтирования.
- Фактически проверить в первом агентном trial доступность `ace_context`, состояние Qdrant, чтение исходников и корректные provider receipts. Недостаточно просто прописать `mcp_servers` в TOML.
- Сохранить одинаковую модель, reasoning effort, инструменты (кроме ACE), температуру/seed если применимо, task input, время/ограничения и image digest для paired trials. Запускать serial; независимый state между задачами. Фиксировать cache cold/warm честно.
- Две минимально необходимые руки: **native** (Codex без ACE), **ACE optional** (доступен, но Codex сам решает вызывать ли). **ACE forced** — только отдельная диагностика, не результат natural-use.
- Стартовать с 1 smoke-task в каждой руке (инфраструктурный PASS, не метрика выгоды), затем 10 одних и тех же зафиксированных задач × 2 руки. Позже — ≥3 независимых повторения, расширение набора и отдельный untouched holdout.
- Подсчитывать **фактические** provider-reported input/cached-input/output tokens, cost USD, tool output body bytes/tokens, число `ace_context`/`ace_expand` и обычных native file reads, duration, errors, task-quality score. Токены native CLI и токены ACE MCP ответов — разные измерения.
- Вести request-ID correlation `Codex tool call → MCP result → ACE provider trace → exact evidence/source revision`; если связи нет — соответствующая метрика `UNKNOWN`, экономию не засчитывать.
- Проверить, что испытание реально использовало ACE: если **0 calls** в optional руке, фиксируем `ACE_NOT_USED` и не приписываем изменения токенов retrieval. Это тоже полезный продуктовый feedback.

**Пример от upstream Harbor (проверить pinned версию/имя датасета перед выполнением):**

```bash
harbor datasets list
harbor run --help
harbor run -d scale-ai/swe-atlas-qna -a codex -m "$CODEX_MODEL" --n-tasks 1 --n-concurrent 1
```

**Сравниваем 2 самостоятельных результата:**
1. *Agent quality:* correctness/grader/verifier и failed trials — non-inferiority нужна **до** расчёта выгоды.
2. *Economics:* raw total tokens, uncached/cached breakdown, $ cost, p50/p95 duration и paired deltas. Эффективность `native_total_tokens / ace_total_tokens`, когда обе величины реально наблюдались и положительны; 5× — пока гипотеза, а не цель для подгонки.

**Критерий:** есть ≥1 реальная парная задача, одинаковый source/task SHA, реальные agent logs, успешный grader и полный raw usage обеих рук; все missing metrics явно отмечены. После 10 задач — первая статистическая таблица, даже если ACE проиграл.

## Этап 4 — замкнуть короткий инженерный цикл

По каждому неудачному запросу создаём debugging card:
- текст/ID задачи без секретов и без gold leakage;
- версия source, AST symbol/range, LSP verification;
- ranked top-k и delivery payload;
- конкретная причина ошибки: recall, scope, LSP, dedupe, контекст без caller/callee, слишком много body, лишний agent native read, bad prompt/discovery;
- **одно** изменение ACE + локальная regression на тот же кейс;
- повторный прогон diagnostics + отдельная untouched выборка, чтобы избежать overfitting.

Не оптимизировать prompt на тестах, которые позже объявляем holdout. Не менять dataset/task после просмотра решения. Не удалять неудачные trials.

## Удобный итоговый artefact/отчёт — не гигантский CI-лог

`artifacts/feedback/<run-id>/` (raw files вне Git, с sha256 receipts):
```text
manifest.json          source/task/agent/stack/model/cold-warm/version
raw-agent-native/      реальные траектории, usage и verifier
raw-agent-ace/         те же материалы + настоящие MCP requests/responses
provider-trace.jsonl   trace ACE с requestId
retrieval-rows.jsonl   per-query gold, ranked spans, LSP, bytes, latencies
metrics.json           вычисляемые производные; unknown остаётся unknown
```

Короткий versioned summary в `benchmarks/reports/` c hash-ссылками на сырые файлы:
| Query/task ID | Gold found@k | LSP proof | ACE called? | Native tokens | ACE tokens | Quality Δ | Token ratio | Failure |
|---|---|---|---|---:|---:|---|---:|---|
| ... | actual/unknown | actual/unknown | yes/no | measured | measured | measured | measured/unknown | specific |

**Никаких строк с выдуманными числами.** Таблица выше — схема будущего отчёта.

## Порядок исполнения и объём до первой пользы

| Шаг | Минимальная поставка | Нужен до первой реальной обратной связи? |
|---|---|---|
| 0. CST → LSP fix + реальный end-to-end trace | Якорь + подтверждение LSP, без mock | Да для семантического proof; сам поиск можно изучать и раньше |
| 1. Поднять реальный ACE provider stack | Qdrant + workers + MCP ready | Да |
| 2. Harbor SWE-Atlas smoke, native и ACE optional | Один task × 2, реальные сырые результаты | Да — это самый короткий маршрут к **первому agent feedback** |
| 3. Harbor 10-task paired | Реальные успешность/токены/ACE calls | Да — чтобы видеть направленность, без претензии на 5× |
| 4. RepoBench-R adapter и retrieval diagnostic | Gold@k, names/ranges/coverage | Параллельно/сразу после smoke; не блокирует его |
| 5. Повторить ≥3 раза и на untouched holdout | Больше надёжности, confidence intervals | После первоначального feedback |
| 6. Четыре Harbor arms, полный H6/release gates | Formal acceptance | Позже; **не блокирует** первый измеримый продуктовый эффект |

## Ответственность и явные решения

- Инженер ACE: исправления индекса/LSP, разбор per-query traces и качество coverage.
- Оператор среды: реальный local Qdrant, pinned model worker, Docker/Harbor, авторизация Codex и версии зависимостей.
- Исследователь бенчмарков: подтверждение лицензии/репозиториев dataset, frozen task selection, без утечки gold,paired run aggregation.
- Владелец продукта: определить минимально приемлемую task-quality non-inferiority и целевые p95 latency/token cost **до** просмотра финального untouched результата.

### Checklist запуска

- [ ] CST/LSP patch CI зелёный; нет подставленных name anchors в интеграционном тесте.
- [ ] Реальный MCP `ace_context` на pinned repository возвращает current evidence и LSP proof.
- [ ] Доступен Qdrant + FastEmbed + BM25; `ace_workspace_status = ready`.
- [ ] Harbor task pinned; агент OAuth/API route реальный; code mount/schema проверены.
- [ ] Один native и один ACE-optional smoke trial с корректной оценкой задачи.
- [ ] ACE optional arm либо реально вызвал ACE (есть correlated receipts), либо однозначно помечен `ACE_NOT_USED`.
- [ ] По крайней мере 10 парных задач, raw usage/quality/cost сохранены; никакого fake 5×.
- [ ] RepoBench-R rank/grounding evaluation проведена отдельно, без подмены agent metrics.
- [ ] Разобраны три крупнейшие причины ошибок и подготовлена следующая итерация.

## Проверенные upstream-источники

- [Harbor CLI run reference](https://github.com/harbor-framework/docs/blob/main/cli/run.mdx)
- [Harbor dataset registry](https://hub.harborframework.com/datasets)
- [SWE-Atlas QnA official dataset card](https://huggingface.co/datasets/ScaleAI/SWE-Atlas-QnA)
- [RepoBench-R dataset card](https://huggingface.co/datasets/tianyang/repobench-r)
- [ast-grep outline JSON schema](https://ast-grep.github.io/reference/cli/outline)
