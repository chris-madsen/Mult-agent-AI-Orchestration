# Что ACE может позаимствовать из Xiaomi MiMo Code и Mi-Memory: подробный research/adoption plan

> **Статус:** исследование, предлагаемая архитектура и экспериментальный план; **не Accepted ADR, не OpenSpec requirement и не отчёт об имплементации**.
> **Дата:** 2026-10-22.
> **Pinned ACE:** [chris-madsen/Mult-agent-AI-Orchestration@`210749942202`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/tree/21074994220272b4e4fc381333967bc9a80cc7b7).
> **Pinned MiMo Code:** [XiaomiMiMo/MiMo-Code@`213365a0a3fd`](https://github.com/XiaomiMiMo/MiMo-Code/tree/213365a0a3fd1ec0b171687d85bc453f05d33863).
> **Pinned Mi-Memory:** [Darwin-Agent/Mi-Memory@`e16a60dec801`](https://github.com/Darwin-Agent/Mi-Memory/tree/e16a60dec80162cd8f07ae64cff53c0e94aba4a6) (ветка `master`).
> **Метод:** анализ README/исходников MiMo Code, README Mi-Memory и существующих ACE ADR, source adapters и execution plans. **Не выполнялись** Xiaomi code, ACE integration tests, provider E2E, сравнительные бенчмарки и agent trials в рамках исследования.
> **Важная оговорка:** Mi-Memory в этом pinned revision — **репозиторий отчёта, лендинга и диаграмм, а не доступная для интеграции реализация memory engine**. Его рекомендации ниже — исследовательские гипотезы, не проверенный код.
> **Лицензии:** в обоих upstream репозиториях указан MIT; MiMo Code дополнительно сообщает об отдельных Use Restrictions / trademark/hosted-service policies. Этот план **не копирует код**. При будущем переносе существенных фрагментов проверить действующие условия и сохранять лицензии/notice.

## 0. Executive summary

**Вывод:** ACE имеет сильный фундамент *проверяемой долгосрочной памяти* (immutable episode archive + Graphiti temporal projection + decision lifecycle + source provenance), но мало управляет *оперативным состоянием незаконченной агентной работы*. MiMo Code особенно полезен именно на этой границе. Mi-Memory — источник принципов audit-driven развития retrieval/memory policy. **Не заменять** Graphiti на Markdown, Qdrant на SQLite, ACE на fork MiMo Code и не создавать новый always-on orchestration service.

Порядок приоритетов:

| Приоритет | Идея | Источник | Предполагаемый результат | До следующего этапа |
|---|---|---|---|---|
| **P0** | Typed session checkpoint + точные указатели на исходные эпизоды | MiMo Code checkpoint writer | Корректно сохраняем цель, прогресс, незавершённые действия, доказательства | Детерминированный lifecycle тест |
| **P0** | Resume context / recovery envelope с проверкой live workspace | MiMo Code context reconstruction | Агент продолжает, а не начинает исследование заново | Paired interruption experiment |
| **P1** | Независимый, идемпотентный checkpoint writer с controlled triggers | MiMo Code checkpoint orchestration | Основной агент не отвлекается на ведение памяти | Измерить overhead и race safety |
| **P1** | Source-linked memory/history search; SQLite FTS5 — только кандидат | MiMo Code memory/history tools | Точный recall событий и команд без галлюцинации из summary | Сравнить с текущим Graphiti/grep |
| **P1** | Dream: периодическая консолидация *кандидатов* на durable knowledge | MiMo Code dream | Из повторяющихся эпизодов получаем проверенные знания | Human review, no silent promotion |
| **P2** | Governed policy evolution: diagnose → propose → shadow → gate → rollback | Mi-Memory Evolution | Модель изменения memory policy без скрытых регрессий | Сначала работающий E2E |
| **P2** | Distill: обнаружение повторяемых workflow | MiMo Code distill | Предложения обновить runbook/skill/test вместо лишних повторов | Многосессионные реальные данные |
| **Deferred** | Multimodal/cross-device memory, federation, универсальная multi-agent runtime orchestration | Mi-Memory Expansion / MiMo Code | Сейчас не добавляет пользы ACE как coding context engine | Отдельный use case и ADR |

**North star ACE не меняется:** уменьшить **фактически израсходованные токены агента на принятую задачу** (долгосрочная цель ≥5×) **без снижения качества**, учитывая запись и извлечение памяти, стоимость, latency и privacy. Не считать демонстрацию “агент вспомнил факт” доказательством экономии.

**Немедленное действие:** сначала зафиксировать обычную agent baseline / feedback loop ([план](../plans/ace-real-feedback-loop.md)), затем минимальный `checkpoint → resume` spike в отдельной ветке с флагом, затем paired long-horizon validation. Остальные механизмы — только после диагностического результата.

---

## 1. Upstream: что реально есть и что именно заимствуем

### 1.1. MiMo Code — работающая реализация, не просто статья

Проект — coding agent / fork OpenCode со встроенной долговременной памятью и собственным жизненным циклом контекста. В исследованных исходниках есть:

| Механизм | Проверяемый upstream source | Наблюдаемое поведение | Что переносим как *идею* |
|---|---|---|---|
| Session checkpoint | [checkpoint-templates.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint-templates.ts) | 11 разделов: intent, next action, directives, task tree, current work, files, durable discoveries, errors/fixes, live resources, design decisions, open notes | Структура **оперативного** состояния + budget на начальную выдачу |
| Checkpoint writer | [checkpoint.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint.ts), [checkpoint-writer.txt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/checkpoint-writer.txt) | Независимый писатель checkpoint, управление очередью и ожиданием writer, проверка содержимого, отделение от основного coding loop | Асинхронный writer за typed port; события, сериализация, retry, validation |
| Validation / recovery | [checkpoint-validator.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint-validator.ts), [checkpoint-retry.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint-retry.ts) | Явные нарушения структуры/бюджетов; механика повторных попыток | Невозможность незаметно объявить битую запись успешной |
| Compaction + rebuild | [compaction.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/compaction.ts), [checkpoint.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint.ts) | Восстановление контекста по checkpoint + выбранным сообщениям, сохранение пути к старой истории | Bounded *initial* resume envelope, не потеря исходных байтов |
| Memory projection | [memory/paths.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/paths.ts), [memory/reconcile.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/reconcile.ts) | Markdown memory files + синхронизация с поисковым индексом | Явные scopes и rebuildable projections, а не новая source-of-truth DB |
| Search | [memory/service.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/service.ts), [history/service.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/history/service.ts) | Отдельные FTS5-индексы для курируемой памяти и оригинальной траектории, фильтры по scope/session/time/tool | Отдельный маршрут “memory summary” vs “raw trajectory” |
| Exact history expansion | [tool/history.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/tool/history.ts), [tool/memory.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/tool/memory.ts) | Search/around/get, detail по part_id с offset; инструкция уточнять у originals | Evidence pointers и pagination до оригинального сообщения |
| Dream | [prompt/dream.txt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/dream.txt) | Выделение durable facts из checkpoint и raw trajectory; запрет непроверенных выводов | Candidate promotion + source verification + dedupe |
| Distill | [prompt/distill.txt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/distill.txt) | Из повторяющихся workflow предлагает skills, agents, commands | Governed workflow recommendations |
| Scheduling | [auto-dream.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/auto-dream.ts) | Default интервалы 7 / 30 дней **только если `dream.auto` / `distill.auto` включены**, плюс write gate | Опциональные scheduled passes, idempotent, disabled by default в ACE |
| Memory write gate | [memory/write-gate.ts](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/write-gate.ts) | Единый предикат допуска записи, чтение отдельно | Централизованная data-policy проверка при каждом write |

**Точная граница переноса:** MiMo управляет *собственным* runtime и знает момент compaction. ACE — **внешний agent-neutral MCP context provider**, поэтому не знает о заполнении контекстного окна клиента и не может принудительно пересобрать внутренние сообщения Codex/Claude по одному только MCP. Понадобятся добровольные client lifecycle hooks / адаптер либо явный вызов агентом функции resume. **Не обещать auto-checkpoint по 20/45/70% без подтверждённой телеметрии конкретного клиента.**

Также MiMo хранит **редактируемые** checkpoint.md/MEMORY.md, индексируя их. В ACE `immutable archive` остаётся authoritative, а checkpoint — **версионированная производная проекция**, которую можно пересчитать или отбросить. Нельзя буквально копировать “перезаписать MEMORY.md” как политику для ACE.

### 1.2. Mi-Memory — исследовательский framework, не импортируемая библиотека

[Mi-Memory README](https://github.com/Darwin-Agent/Mi-Memory/blob/e16a60dec80162cd8f07ae64cff53c0e94aba4a6/README.md) и [технический отчёт](https://arxiv.org/abs/2607.18975) описывают четыре направления: **Structure, Expansion, Evolution, Deployment**. По README в repo содержатся `README.md`, лендинг, PDF отчёта и визуальные материалы; **нет подтверждения production memory runtime, который можно подключить к ACE**.

Для ACE релевантны следующие *принципы*:

1. **Typed evidence payloads**: source identity, provenance, чёткая связь query → retrieved evidence → итоговый контекст.
2. **Stage-level diagnostic traces**: возможность понять, на каком этапе память перестала находить или искажала сведения.
3. **Governed strategy evolution**: каждое изменение retrieval/admission/promotion policy фиксируется как versioned strategy, проверяется в shadow/holdout и допускает rollback.
4. **Lifecycle of correction/forgetting**: удаление источника должно распространяться на производные индексы и показ памяти.
5. **Deployment independence**: использовать локальные уже выбранные ACE primitives; не разворачивать отдельный fleet ради исследовательской модели.

Направления multimodal sensors, IoT, cross-device fusion, cloud federated memory и экспериментальные benchmark scores из Mi-Memory **не являются подтверждением пользы для ACE** и остаются вне первого/второго этапа. Названия D²ACCI / E²MEND рассматриваем как исследовательские идеи, а не готовые библиотеки.

### 1.3. Разделение: наблюдение / предложение / подтверждение

- **Upstream observed:** перечисленные исходники MiMo Code реально содержат указанные сущности, правила и интерфейсы.
- **ACE observed:** существующий код и Accepted ADR фиксируют архив, Graphiti, decision states, source integrity и выдачу через MCP.
- **Proposed:** схемы `SessionCheckpoint`, `ResumeContext`, порты и тестовые пороги ниже — **наш дизайн-кандидат**. Их пока **нет** как production capability.
- **Unverified:** выигрыш токенов, качество возобновления сессий, ускорение от FTS и польза Dream/Distill не измерены в этом исследовании.

---

## 2. Карта текущего ACE: не создавать дублей

| Существующий слой ACE | Где смотреть | Что уже покрыто | Gap / действие |
|---|---|---|---|
| Immutable Codex episode archive | `src/adapters/codex-session-history.ts`, `src/adapters/file-memory-archive.ts` | Исходные эпизоды, digest, content-addressed bytes, tombstones | Не подменять checkpoint строкой истории |
| Import / reliable graph projection | `src/application/memory-import.ts`, `src/application/memory-reconcile.ts`, `src/adapters/file-projection-outbox.ts` | Archive-first, retry, projection states | Использовать существующую семантику idempotency для новой производной записи |
| Temporal factual memory | `src/adapters/graphiti-mcp.ts`, `src/domain/memory.ts` | Temporal search, эпизодное provenance, версионирование extracted facts | Не заменять на generic “summary facts”; запросы текущей задачи отличаются от temporal lookup |
| Decision approval | `src/domain/memory.ts`, `src/adapters/file-decision-history.ts` | Proposed / Accepted / Rejected / Superseded, транзакции решений | Dream НЕ может автоматически создавать Accepted |
| Memory admission/cost | `src/domain/memory-admission.ts`, `src/domain/memory-economics.ts`, соответствующие tests | Явный допуск проекций и экономические метрики | Связать proposed Dream с admission, считать writer tokens |
| Context delivery | `src/domain/context-delivery.ts`, `src/gateway/mcp-gateway.ts` | Evidence IDs, compact projection, receipts, exact expansion | Добавить *оперативную* resume projection, не ломая ContextBundle |
| MCP facade | `src/transport/mcp-sdk-stdio.ts` | `ace_context`, `ace_expand`, `ace_workspace_status`, `ace_memory_search` | В первой версии **не обязательно** вводить новый публичный MCP tool |
| Agent feedback | [real feedback loop](../plans/ace-real-feedback-loop.md), Harbor tooling | Существует план и harness для natural-use проверок | Нет доказанного memory-resume выигрыша; сначала собрать baseline |

**Обязательные архитектурные ограничения:**

- [ADR-005](../docs/references/ADR-005-persistent-memory.md): byte-exact, immutable original Codex history; Graphiti local-first *derived* temporal memory; owner confirmation for major decisions; source-linked deletion/tombstone.
- [ADR-006](../docs/references/ADR-006-context-integrity.md): начальная выдача компактна, но любые оригиналы и изменённые файлы должны быть recoverable losslessly; no silent truncation; MCP не контролирует internal compaction клиента.
- [ADR-014](../docs/references/ADR-014-hybrid-context-engine.md): agent-neutral MCP, source freshness, Graphiti/Vertex/Qdrant distinct roles, receipts/delta, quality-first, buy-before-build.
- [root AGENTS.md](../../AGENTS.md): TS + Effect modular monolith, no unnecessary service/database, no cloud transfer of dialogues without authorization, retain real-provider evidence, PR workflow and owner gates.
- Правила нормального *production* поведения — **только в последующем OpenSpec + при необходимости Proposed ADR**, не в данном исследовательском плане.

---

## 3. Рекомендуемая архитектура: operational memory поверх source-of-truth archive

```text
Codex / Claude Code / other agent
  │  explicit lifecycle events or voluntary MCP calls
  │  [session/workspace/agent IDs, events, task state, optional telemetry]
  ▼
ACE client adapter (optional; per client, no privileged assumption)
  │
  ├── immutable source event/episode archive (existing ACE) ───────┐
  │                                                               │
  ▼                                                               │
Session Progress Projector (new, versioned and rebuildable)       │
  │  scoped + idempotent; origin receipts; optimistic concurrency  │
  ├── Snapshot/Checkpoint (typed, derived)                         │
  ├── optional checkpoint-writer (LLM only if useful/authorized)   │
  └── task/current-work digest + evidence pointers                │
                                                                  │
                       Resume Assembly (new) ◄───────────────────┘
                         │               │
                         │               ├── working-tree Git/digest check
                         │               ├── current ACE code context
                         │               ├── Graphiti (when needed)
                         │               └── original history expansion
                         ▼
                bounded initial resume context
                   + exact expansion handles
                         │
                      agent continues

Offline/opt-in: candidate extractor (Dream) → admission/provenance review
              workflow miner (Distill) → suggested runbook/skill/AGENTS changes
              policy trial registry (Mi-Memory idea) → shadow + gates + rollback
```

### 3.1. Разделить *пять разных утверждений*

1. **Event/episode:** “В 14:05 агент выполнил test X и получил output Y” — оригинальная запись; может быть устаревшей относительно рабочего дерева.
2. **Session checkpoint:** “На момент sequence N следующая задача — проверить fix” — производная оперативная проекция с точной версией.
3. **Project learning candidate:** “У нас повторяется ошибка восстановления Qdrant” — гипотеза с source references.
4. **Accepted engineering decision:** отдельная подтверждённая owner/ADR/decision-FSM сущность; никогда не выводится автоматически из LLM-summary.
5. **Current source fact:** “В текущем коде функция X делает Y” — требует свежих байтов/AST/LSP verification; старый checkpoint не подтверждает это.

Правило ранжирования при конфликте: **явное актуальное решение владельца / Accepted ADR / применимый contract → проверенный актуальный source / current worktree → оригинальные события → извлечённые summaries/Graphiti projections**. Для вопроса о том, что пользователь *сказал*, точная цитата из оригинального сообщения сильнее inference из кода. Не превращать один универсальный порядок в подмену типов источников.

### 3.2. Scope, identity, versioning

Все checkpoint и поисковые результаты должны включать минимум `workspaceId`, `sessionId`, `agentId` / clientKind где известен, `eventCursor` / sequence, `createdAt`, `extractorVersion` / `policyVersion`, `sourceEpisodeIds` и digest источника. Один checkpoint не должен “перепрыгивать” на чужую сессию, fork или project через совпавший текст. Секреты и private conversations никогда не покидают local provider без отдельного разрешения при фактической передаче.

---

## 4. Workstream A — typed session checkpoints (P0)

**Цель:** перенять структурность MiMo Code, сохранив архив ACE.

### 4.1. Минимальная предложенная схема (illustrative, не готовый contract)

```typescript
type CheckpointStatus =
  | "building" | "ready" | "incomplete"
  | "stale" | "superseded" | "tombstoned";

interface SessionCheckpointV1 {
  schemaVersion: 1;
  workspaceId: string;
  sessionId: string;
  agentId?: string;
  sequence: number;
  predecessorCheckpointId?: string;
  sourceEpisodeIds: string[];
  sourceCursor?: string;
  sourceManifestDigest?: string;
  extractorVersion: string;
  policyVersion: string;
  createdAtMs: number;
  userIntentQuote?: { text: string; episodeId: string; exactSpan?: [number, number] };
  objective?: string;
  nextAction?: { text: string; evidenceIds: string[] };
  taskTree: Array<{ taskId: string; state: "open" | "done" | "blocked"; note?: string }>;
  currentWork: string[];
  touchedFiles: Array<{ path: string; observedDigest?: string; purpose?: string }>;
  sessionDirectives: string[];
  errorsAndFixes: Array<{ summary: string; episodeIds: string[] }>;
  liveResources: Array<{ kind: string; identifier: string; observedAtMs: number }>;
  candidateLearnings: Array<{ claim: string; episodeIds: string[] }>;
  discussionOutcomes: Array<{ claim: string; state: "unconfirmed" | "confirmed"; episodeIds: string[] }>;
  openNotes: string[];
  status: CheckpointStatus;
}
```

**Уточнение:** `exactSpan` и `sourceCursor` — предложенные поля, а не обещание, что текущий Codex history exporter уже выдаёт tool-call-precise trajectory. Проверить реальный формат событий; где exact span отсутствует, указывать `unknown`/пустое и не выдумывать provenance. `touchedFiles.observedDigest` означает состояние *на момент записи*, не fresh доказательство для следующих задач.

### 4.2. Правила записи

- Архивировать оригинальное допустимое событие **до** обновления checkpoint; checkpoint без архива или ссылки на него не становится `ready`.
- Детерминированный `checkpointId = hash(workspace, session, sourceCursor, extractorVersion, policyVersion)` либо аналогичная стабильная уникальность; операции at-least-once должны быть безопасны.
- `sequence`/predecessor проверяются CAS-like способом. При concurrent writer старый snapshot не заменяет новый.
- Atomic write/publication + crash replay + invalid/partial quarantine. Не вводить lock manager, если существующий archive/outbox port удовлетворяет инвариантам.
- Нет подтверждённых новых событий → не создавать “новый прогресс”; пустой/no-op checkpoint допустим.
- Quote пользовательской цели только из raw input; не заменять перефразированной целью. Если дословные исходники недоступны, заявить `unavailable`.
- Live resources всегда read-only hints: работающий PID, URL, branch, temp file могут устареть.
- Не дублировать весь transcript и исходники в checkpoint; хранить pointers и небольшие summaries. Для длинных артефактов — ссылки + exact expansion.
- Удаление оригинала или отзыв доступа инвалидирует производный checkpoint и любой его index; индекс не должен возвращать orphaned текст.

**Предлагаемые файлы (не утверждение о существовании):**
`src/domain/session-checkpoint.ts`, `src/application/session-checkpoint.ts`, `src/adapters/file-session-checkpoint.ts` (если целесообразно переиспользовать существующий file store), tests в текущем test-портфеле.

### 4.3. Acceptance / negative cases

- Ввод 11 категорий на реальной длинной coding trace → `ready` только если источники и cursor проверены.
- Повтор входа с тем же cursor → один идентичный snapshot.
- Параллельные writer N и N+1 → latest = N+1, устаревший ответ N не переписывает состояние.
- Crash между archive и projection → источники сохранены, projection восстанавливается.
- Invalid schema/source ID/namespace → ошибка/`incomplete`, не fabricated “latest”.
- Источник удалён → snapshot перестаёт выдаваться как активное знание.
- ≥2000 строк изменённого source/result остаются на диске / в exact artifacts, никогда не заменяются summary.

---

## 5. Workstream B — checkpoint writer и client lifecycle (P0–P1)

### 5.1. Два режима: не навязывать LLM

**Режим 1 — deterministic-first (MVP).** Client adapter передаёт явные lifecycle/task events; сервис извлекает известные поля, сохраняет receipts. Пока отсутствуют данные, значение unknown. Без LLM, когда задача сводится к копированию структурированного события.

**Режим 2 — optional bounded LLM writer (после MVP).** Модель читает только разрешённый ограниченный набор эпизодов и готовит *draft* summary с точными evidence IDs. На выходе строгий JSON schema validation, проверка ссылок на raw source, источников и workspace, обязательная обработка disagreement. Вывод модели сам по себе не устанавливает `accepted`, `verified`, `source-current`.

### 5.2. Триггеры

- На границе крупных явно завершённых шагов, перед handoff/finish, перед известным client compaction, по явной команде `save checkpoint`.
- В качестве вторичных сигналов: достаточный объём новых **достоверно полученных** событий, elapsed work, pending task transition.
- По процентажу context window — **только** если клиент реально сообщает total/used токены и эти данные валидированы. Без такого API не “угадывать” filling rate по размеру сообщений.
- Debounce/coalesce, limits на writer invocations, isolation per session. Queued job не считается сохранённым checkpoint.
- Writer никогда не блокирует основные code retrieval calls, если клиент не потребовал “checkpoint barrier”; barrier должен иметь timeout и честную `incomplete` fallback.

### 5.3. Где интегрировать

В ACE runtime создаётся новый typed port/adapter; client-specific hooks живут **за пределом domain**. Для первого эксперимента достаточно поддерживаемого Codex lifecycle adapter или explicit invocations, **не обещая**, что всякий MCP client автоматически позволит наблюдать своё compaction.

В production нельзя тихо регистрировать обязательный пятый MCP инструмент; если понадобится `ace_checkpoint`/`ace_resume`, описать capability/protocol в OpenSpec, проверить официальный MCP SDK и backward compatibility. Пока можно собрать proof с отдельным prototype adapter + существующими `ace_context`/`ace_memory_search` для исходников и памяти.

---

## 6. Workstream C — resume / context reconstruction (P0)

### 6.1. Resume envelope

Минимальный упорядоченный план выдачи:

1. **Дословный последний актуальный user intent** с оригинальным episode reference, либо explicit unknown.
2. **Next concrete action**, unresolved issues и блокеры.
3. **Task-tree / done vs pending**, чтобы агент не повторял завершённые подзадачи.
4. **Recent verified results** (включая исходные outputs/receipts, если потребуются).
5. **Files and prior source digests** как candidates на re-verification.
6. **Project decisions** только в их правильных состояниях (Accepted/Proposed/Rejected/Superseded).
7. **Optional supporting context** через Qdrant/Graphiti/Vertex только по source obligations и authorization.
8. **Exact expansion handles** для больших originals и длинных tool outputs.

Первичная выдача может иметь **адаптивный target budget** для удобства чтения, но не превращаться в жёсткий необратимый output cap. Всё, не вошедшее в initial projection, остаётся доступно через byte-exact/paginated expansion. Семантически важное не “обрезается в тишине”.

### 6.2. Freshness при возобновлении

- Прежде чем заявить “правка готова” или “тест прошёл”, проверить текущие Git status/revision, file digests и где необходимо перезапустить тест. Сохранённый лог есть **исторический outcome**, а не proof в новой worktree.
- Workspace mismatch, changed files, branch switch, deleted test artifact → `needs_recheck`; не просто убрать устаревший факт и объявить успех.
- Original user request и accepted decision — разные типы; не изменять содержание решения из-за высокого retrieval score.
- Если checkpoint отсутствует, неконсистентен или too old → fallback на source-linked raw history / explicit partial; никогда не “сделать вид, что продолжили с точного места”.
- В случае fork/parallel agents latest checkpoint выбирается по **одному scoped causal lineage**, а не глобальному timestamp.

### 6.3. Что ACE может обещать

Сервер ACE способен **выдать** ResumeContext и ссылки на originals. Он **не может** гарантировать, что Codex/Claude вставит его в собственное сжатое окно без client integration. Agent-neutral protocol должен разделять `resume_context_prepared` от `resume_context_consumed` и `task_continued`.

**Главная функция полезности:** resume предотвращает лишние повторные file reads/research и потерю принятых решений **при неухудшении финального результата**.

---

## 7. Workstream D — локальный raw-history / memory search (P1, candidate)

MiMo Code использует SQLite FTS5 для Markdown-памяти и отдельно для исходной истории. ACE уже использует Qdrant (code), Graphiti (temporal memory), а архив хранит originals. **Не добавлять SQLite FTS5 по умолчанию** только потому, что оно есть у Xiaomi.

Проверяемые стратегии в одинаковых scope/queries:

- D0: существующий `ace_memory_search` / Graphiti.
- D1: простой bounded поиск по текущему archive с построением ephemeral lexical index (без нового persistent dependency).
- D2: SQLite FTS5 **как rebuildable local projection**, отдельно индексируя `curated checkpoint fields` и `raw event text`, если D1 слишком медленный.
- D3: hybrid lexical + Graphiti results, с дедупликацией по source episode ID и явными proof statuses.

**Пожелания API:** `search(query, workspaceId, sessionId?, tool?, timeRange?, sourceType?, limit)` → краткие snippets/evidence pointers; `expand(episodeId, offset, length)` → exact originals, отдельная авторизация. Raw history/derived memory не смешивать в едином “достоверном summary”. OR/AND query semantics и Unicode tokenizer версионировать/тестировать; отсутствие FTS hit не означает отсутствие события.

**Критерий допуска FTS:** измеренный recall/precision/latency/cost выигрыш на pinned 2–3 long-running repositories; maintenance/reconcile, deletion and corruption costs учтены. При равенстве результата оставить existing primitives и не плодить индекс.

---

## 8. Workstream E — Dream: evidence-driven durable memory (P1)

**Роль:** офлайновый/ручной проход, который извлекает только **кандидаты** на полезные cross-session знания из immutable archive, checkpoints и существующего Graphiti. Первичная область: инженерные решения, неоднократные ловушки, диагностические решения, устойчивые tool/workspace facts.

```text
candidate discovery (recent archive + checkpoints)
   → cluster/dedupe + source_episode_ids
   → raw trajectory verification
   → current repo/ADR verification (for source claims)
   → classify: ephemeral | durable_candidate | conflicting | obsolete
   → admission + privacy/cost policy
   → human-review queue (for important decisions)
   → optional derived Graphiti projection
   → audit record / rollback possible
```

Требования:

- Отсутствие нового знания → валидный результат `NO_CHANGE`; не создавать факты для выполнения “плана”.
- Каждое утверждение хранит exact episode pointers, extractor identity, valid-at/context, conflict and status; одна сессия не считается многократным подтверждением.
- История rejection/supersession не перезаписывается; “obsolete” должно означать, что утверждение больше не применяется, а не что старое событие не происходило.
- Цикл консолидации нельзя замкнуть на собственные generated summaries — оригинальные эпизоды обязательны для promotion.
- Source-aware policy: “мы решили перейти на X” из разговора — `proposed` до подтверждения; “код сейчас вызывает X” — требуется live source verification; “тест Y прошёл вчера” — историческое событие.
- Manual trigger сначала; фоновая периодичность только opt-in (7 дней MiMo — **референсный default**, не обязательная частота ACE).
- Model prompts, token costs и возможная наружная передача private data остаются под локальной ACE data policy.

**Результат:** пронумерованный, проверяемый **MemoryPromotionProposal** с diff, provenance и действиями accept/reject; принятие важного engineering decision проходит существующий Decision FSM/owner gate, а не прямую правку ADR.

---

## 9. Workstream F — Distill: workflow mining без «фермы агентов» (P2)

В Xiaomi Distill просматривает повторяющиеся цепочки и предлагает reusable skills/agents/commands, предварительно проверяя уже существующие активы.

Для ACE адаптация:

1. Определить повторы по сырой последовательности tool calls + outcomes, а не по тексту summaries.
2. Кластеризовать: повторные одинаковые поиски, ручная диагностика Qdrant, восстановление Graphiti, часто забываемые CI проверки, одинаковые Git/lifecycle операции.
3. Исключить секреты, единичные инциденты, явно запрещённые операции и случайные совпадения.
4. Сверить с уже существующими `AGENTS.md`, skills, scripts, OpenSpec и operations runbooks.
5. Предложить **минимальный** артефакт: обновить runbook, добавить узкую команду, исправить UX или тест. Создание новой skill/agent — последняя мера.
6. Сохранить источник, estimated time saved, failure-risk, baseline reproduction и review outcome.

**Policy:** никогда автоматически не переписывать root `AGENTS.md`, Accepted ADR или production skills. По умолчанию результат — reviewable proposal; пустой shortlist корректен. Интервал 30 дней из MiMo применим только после накопления многосессионных данных и user opt-in.

---

## 10. Workstream G — Mi-Memory-inspired governed memory evolution (P2)

Mi-Memory формулирует diagnostic/audit contract и “governed evolution”. Для ACE предложен **маленький versioned strategy ledger**, а не новая orchestration platform.

Для **любого** изменения memory ranking, admission threshold, checkpoint extraction или Dream policy хранить:

| Поле | Зачем |
|---|---|
| `strategy_id`, `version`, `implementation_commit` | Воспроизводимость |
| `data_scope`, `client_kind`, `provider_identity` | Понимание границ применимости |
| `input_corpus_manifest`, `gold/holdout_version` | Отсутствие benchmark leakage |
| `baseline_vs_candidate` с per-case traces | На каком этапе и почему выиграли/проиграли |
| `privacy_evaluation` / `deletion_evaluation` | Нельзя выиграть recall ценой утечки |
| `cost_tokens`, `latency`, `quality` | True end-to-end economics |
| `decision_status`: shadow / trial / rejected / owner_accepted / rolled_back | Не подменять эксперимент production |
| `rollback_target`, `reason`, `approver` | Прозрачный откат |

**Принцип:** policy proposal → offline replay → adversarial fixtures → shadow deployment (без влияния на ответ) → paired trials → owner review → opt-in rollout → rollback on regressions. На первом этапе ledger может быть обычным versioned benchmark/evidence artifact (JSON), не новая БД.

**Диагностические trace stages:** `event capture` → `archive persistence` → `checkpoint extraction` → `validation` → `memory admission` → `retrieval` → `source freshness` → `resume assembly` → `agent consumption` → `task outcome`. Если один этап не наблюдаем, так и записать `UNKNOWN`. Не выдавать benchmark numbers Mi-Memory за ACE метрики.

**Deletion/correction:** scope and tombstone propagates to all checkpoint / FTS / Dream / graph projections; a deleted raw source cannot be “resurrected” from a still-active summary. Проверка отсутствия производных данных реальная, а не успешный return code. Сохранять уже принятый ADR-005 purge safety.

---

## 11. Предлагаемый порядок этапов и объём работ

Оценки — **ориентиры инженерного труда одного знакомого с ACE разработчика**, не календарное обещание. Не включают время настройки отсутствующих внешних runners, проверки PR CI и ожидание owner decisions. Все этапы исполняются **отдельными reviewable PR**; research document не санкционирует production changes.

### G0 — Baseline и feasibility: 1–3 инженерных дня

**Задачи:** проверить актуальную runtime wiring/session exporter; изучить реальные Codex и хотя бы один альтернативный agent lifecycle surface; подтвердить capture boundary, формат events, какие hooks реально доступны, есть ли token usage telemetry. Выбрать pinned long task set с прерываниями. Зафиксировать два baseline: без ACE и ACE без checkpoint.

**Артефакты:** feasibility matrix, accepted event schema v0, real usage traces, воспроизводимый набор 3–5 interruption tasks, data-policy classification.

**Gate:** можно доказательно хранить workspace+session scoped события; если компакция Codex не observable — продолжить через explicit checkpoint/resume, но **не** заявлять automatic integration.

### G1 — Checkpoint projection MVP: 3–6 инженерных дней

**Задачи:** versioned typed checkpoint, archive-first import, CAS/idempotency, source links, deterministic snapshot builder, scoped storage, read API, crash/fork/deletion contract tests. **Без LLM writer и без FTS**.

**Артефакты:** минимальные ports/adapters, актуальные тесты, sample real session checkpoints, status в readiness. Нормативное поведение оформляется через соответствующий OpenSpec change перед production promotion.

**Gate:** strict schema, no cross-workspace leak, no ghost “done”, crash replay, unchanged originals, redaction/purge behavior.

### G2 — Resume integration spike: 3–6 инженерных дней

**Задачи:** resume envelope, Git/digest revalidation, explicit unknown/stale statuses, byte-exact expansion pointers, Codex-compatible client invocation. Провести paired interrupted/restarted task runs по тому же frozen task set.

**Артефакты:** реальные agent traces и diff повторных file reads, качество продолжения, стоимость checkpoint/read/recovery.

**Gate:** задача реально возобновлена (consumed), а не только “сервер ответил”; нет потери user intent и source. Если не улучшает long-horizon outcomes — **остановить расширение памяти**.

### G3 — Optional writer + indexing candidate: 3–7 инженерных дней

**Задачи:** LLM writer только в ограниченном experiment mode; измерение semantic compression errors; сравнение текущих поисков по archive/Graphiti с lightweight FTS5 index; тесты Unicode, scope, deletion, long payload.

**Gate:** writer не ухудшает correctness; FTS сохраняется только при измеримой выгоде с учётом support cost. Можно завершить stage с отказом от FTS.

### G4 — Dream + governed promotion: 4–7 инженерных дней

**Задачи:** reviewable durable-memory candidate extraction, episode attribution, contradiction flags, no-change, owner gate, optional scheduler, trace audit. Сверить с `memory-admission.ts` и Decision FSM; не создавать альтернативную базу решений.

**Gate:** нет auto-accepted critical decisions; есть реальные unsupported-claim negative tests, replay/deletion/rollback.

### G5 — Distill + policy evolution: 4–8 инженерных дней (условно)

**Задачи:** repeated-workflow mining только по реальным multi-session data, candidate report/diff; strategy ledger + shadow evaluation + rollback gates. При недостатке corpus отложить без “демо на синтетических повторениях”.

**Gate:** хотя бы один полезный повтор, подтверждённый raw trace и владелец принял/отклонил предложенный artifact; rollout policy reversible, leakage = 0.

### Выход после G2 — **первый измеримый продуктовый результат**

Можно ответить: умеет ли ACE **сохранять реальное незавершённое состояние и вернуть агенту продолжение без переисследования**? Да/нет/неопределённо с raw trial evidence, а не “мы внедрили память Xiaomi”. G3–G5 допускаются только на основании наблюдаемого gap.

---

## 12. Benchmark и критерии успеха

### 12.1. Сравниваемые arms

На одинаковых pinned tasks / agent model / tools / workspace / time/cost budgets:

- **A Native:** coding agent без ACE.
- **B ACE retrieval-only:** текущий ACE (не вынуждать agent использовать его).
- **C ACE + checkpoint/resume (deterministic):** явный lifecycle adapter/voluntary tool access.
- **D ACE + LLM writer (candidate, только после C).**
- **E ACE + Dream/FTS (offline или shadow):** изолированная contribution оценка; **не** объявлять combined победу без ablation.

Для long-horizon tasks отдельно зафиксировать *точки принудительного restart/compaction-equivalent*, середину незавершённой задачи, смену branch/worktree, подмену source after checkpoint, смену/отзыв authority и необходимость восстановить точный вывод ранее вызванного tool. Прерывание должно быть одинаково для всех arms; если native не имеет сопоставимого lifecycle interface — явно описать limited comparability.

### 12.2. Primary metrics

1. **Task accepted quality / task completion**: real tests/reviewer or Harbor grader, **не хуже baseline** до разговора об экономии.
2. **Total actual tokens**: agent input/cached-input/output + любые дополнительные writer/extractor/LLM-search tokens; считать по provider reported usage, а не по размеру JSON.
3. **Repeat-work ratio:** сколько ранее сделанных file reads/searches/commands агент повторил без changed-source причины (source-aware).
4. **Resume correctness:** сохранены intent, pending work, rejected alternatives; не объявлены stale tests и completed tasks без proof.
5. **True total cost & wall-clock duration:** ingestion, indexing, writer, memory query, resume and agent usage.
6. **Safety:** cross-project leakage, incorrect critical decision promotion, forgotten-source resurrection, incorrect “current” claims.
7. **Observation coverage:** real checkpoint persisted, correct episode pointer, resume delivered, **actually consumed**, task resumed. Недоступная метрика = `UNKNOWN`, а не 0.

### 12.3. Предложенные gate-критерии (targets, не результаты)

- **Hard safety:** ноль подтверждённых privacy leaks, incorrect source-current assertions, false Accepted decisions, loss of original source bytes, orphan resurrection при тестах.
- **Quality:** никаких статистически убедительных регрессий на matched evaluation; на малой выборке отчитываться per-case без ложных выводов о значимости.
- **Correctness of checkpoint:** все обязательные fields validated; ни один `ready` без origin links; на вручную размеченном test set оценивать omission/false-action rates.
- **Economic gate:** positive total-token saving и/или meaningful rescue of previously failed long-horizon tasks после overhead; отсутствие выигрыша = честный `NO_ADOPTION`.
- **Freshness:** при branch/source mismatch выдаётся stale/needs_recheck, а не `current`.
- **Operational gate:** crash, concurrent writer, restart, retry и scoped deletion проверены не только в mocks.
- **Harbor:** при расширении использовать существующий [Harbor/E2E](../operations/harbor-four-arm-byte-binding.md) и real-feedback methodology, привязать request IDs/tool calls/provider receipts. Не путать retrieval recall и task quality.

Сначала **smoke + 3–5 вручную разбираемых interrupted tasks**, затем 10+ paired tasks и untouched holdout; число повторов/достаточность корпуса определять по реальной вариативности, не объявлять статистическую значимость заранее.

### 12.4. Failure cases, которые обязательно покрыть

- Checkpoint создан по *усечённому* сообщению и неверно процитировал intent.
- LLM writer “додумал” успешный тест / изменение файла / решение пользователя.
- Одновременные subagents завершают задачи в непредсказуемом порядке.
- Сессия fork и другая branch: правильное lineage не совпадает с timestamp.
- Восстановление после crash **до** ack и после ack, неоднократный replay.
- Источник изменился после checkpoint; old file path теперь указывает на другой символ.
- Оригинал удалён или доступ запрещён, но FTS/Graphiti/Dream ещё содержит прежний текст.
- Query ничего не нашёл из-за tokenizer (Unicode, punctuation, IDs); нет вывода “не было события”.
- Provider unavailable — `partial`/`not_ready`, а не пустой ответ/успех.
- Large binary/multiline tool output и ≥2000 строк source: exact expansion, hashes and pagination.
- Shadow policy случайно влияет на боевой ответ; измерить/запретить leakage.
- Token/cost telemetry missing; не подставлять фальшивую экономию.
- Intent conflict: новый прямой запрос пользователя supersedes saved older nextAction.

---

## 13. Принципиальные anti-goals

**Не делать:**

1. Полный fork MiMo Code или замену agent-neutral ACE собственным coding agent.
2. “Память на Markdown” как источник истины поверх/вместо immutable archive.
3. Параллельную state machine архитектурных решений без ACE Decision FSM/ADR.
4. Ещё одну обязательную DB (SQLite/Redis/новый vector store) до evidence.
5. Автоматическую генерацию/публикацию AGENTS.md, ADR или skills по LLM-догадкам.
6. Безусловный отдельный LLM writer при каждом tool call; подсчитать его реальную цену.
7. Тайный snapshot пользовательских бесед в cloud/Vertex; разрешение на документацию ≠ разрешение на raw sessions.
8. Глобальное автозапоминание across workspaces без policy + explicit consent.
9. Использование “benchmark scores Xiaomi” как показателя успеха ACE.
10. Нарушение неизменности исходников/byte-exact recovery ради коротких summary.

---

## 14. Design decisions, которые нужно отдельно согласовать *перед implementation production*

| Вопрос | Предварительная рекомендация | Решение |
|---|---|---|
| Какие lifecycle events доступны в Codex и Claude Code? | G0 probe на актуальной версии, explicit fallback | **Open** |
| Где хранить checkpoint: existing archive sidecar или отдельная derived projection? | Derived versioned object в существующей локальной storage boundary | **Open / benchmark** |
| Нужен ли новый MCP tool? | Сначала клиентский spike; только затем OpenSpec contract | **Open** |
| Насколько допустим model-based writer для private sessions? | Local-only opt-in + bounded calls; deterministic first | **Open / policy** |
| FTS5 vs current Graphiti/grep/other maintained primitives? | Matched query evaluation, не создавать dependency заранее | **Open / evidence** |
| Promotion durable knowledge? | Existing admission + explicit owner gate for major decisions | **Constrained by ADR-005** |
| Scheduling Dream/Distill? | Manual/disabled by default до реальных нужд | **Open / owner** |
| Какие criteria для rollout? | Quality/safety gates, paired tokens, verified rollback | **Open / evidence** |

Предложить новый ADR только при **материальном** изменении authority, data storage semantics, event capture scope или публичного MCP protocol; иначе достаточно узкого OpenSpec change и эксперимента.

---

## 15. Практическая последовательность следующих PR

1. **Этот PR: research only.** Один файл в `docs/research`. Никаких source changes, нет новых production утверждений.
2. **Feasibility + benchmark harness PR.** Frozen interruption corpus и real event collection; fixes только для обнаруженных runtime gaps. Отдельно от изменений memory logic.
3. **SessionCheckpoint MVP PR.** Typed contract, archive-backed source pointers, replay, negative tests.
4. **ResumeContext client spike PR.** Voluntary client flow + source revalidation + paired results.
5. **Conditional PRs.** Optional writer → lexical index experiment → Dream promotion → Distill / strategy ledger — только при измеренной нужде.

Каждый PR должен честно сообщить `IMPLEMENTED` / `CONTRACT_TESTED` / `REAL_PROVIDER_TESTED` / `AGENT_E2E_TESTED` / `BENCHMARKED` / `PRODUCTION_APPROVED`. Не переносить отметки между уровнями. Для source PR использовать `npm run test:affected` в inner loop и `npm run verify:pr` на готовом изменении; для research-only Markdown не притворяться, что agent/provider-E2E запускались.

---

## 16. References / проверяемая карта исходников

### Xiaomi MiMo Code (pinned `213365a0a3fd1ec0b171687d85bc453f05d33863`)
- [README](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/README.md)
- [Checkpoint templates](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint-templates.ts)
- [Checkpoint lifecycle](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint.ts)
- [Checkpoint writer prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/checkpoint-writer.txt)
- [Checkpoint validation](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/checkpoint-validator.ts)
- [Compaction](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/compaction.ts)
- [Memory search](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/service.ts)
- [History search](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/history/service.ts)
- [Memory reconcile](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/memory/reconcile.ts)
- [Memory tools](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/tool/memory.ts) / [History tools](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/tool/history.ts)
- [Dream prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/dream.txt) / [Distill prompt](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/agent/prompt/distill.txt)
- [Auto Dream/Distill configuration](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/packages/cli/src/session/auto-dream.ts)
- [MIT license](https://github.com/XiaomiMiMo/MiMo-Code/blob/213365a0a3fd1ec0b171687d85bc453f05d33863/LICENSE)

### Mi-Memory (pinned `e16a60dec80162cd8f07ae64cff53c0e94aba4a6`)
- [Project README](https://github.com/Darwin-Agent/Mi-Memory/blob/e16a60dec80162cd8f07ae64cff53c0e94aba4a6/README.md)
- [arXiv technical report](https://arxiv.org/abs/2607.18975)
- [MIT license](https://github.com/Darwin-Agent/Mi-Memory/blob/e16a60dec80162cd8f07ae64cff53c0e94aba4a6/LICENSE)
- В рамках этого файла изучены **README и структура репозитория**, а не воспроизведены experiments технического отчёта.

### ACE (pinned `21074994220272b4e4fc381333967bc9a80cc7b7`)
- [ADR-005](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/docs/docs/references/ADR-005-persistent-memory.md)
- [ADR-006](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/docs/docs/references/ADR-006-context-integrity.md)
- [ADR-014](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/docs/docs/references/ADR-014-hybrid-context-engine.md)
- [Memory domain](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/src/domain/memory.ts)
- [Memory import](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/src/application/memory-import.ts)
- [Immutable file archive](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/src/adapters/file-memory-archive.ts)
- [Graphiti adapter](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/src/adapters/graphiti-mcp.ts)
- [Progressive context delivery](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/21074994220272b4e4fc381333967bc9a80cc7b7/src/domain/context-delivery.ts)
- [Real feedback loop](../plans/ace-real-feedback-loop.md)

**Итог:** брать у MiMo Code *операционную память, writer/recovery и разделение raw history vs curated memory*, у Mi-Memory — *audit/diagnostic и ограниченную управляемую эволюцию policies*; сохранять первенство исходных событий, source freshness, статус инженерных решений и общую агентонезависимую архитектуру ACE. Первыми проверять checkpoint/resume на длинных, реально прерываемых задачах; остальное — evidence-gated.
