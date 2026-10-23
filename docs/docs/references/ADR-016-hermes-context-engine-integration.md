# ADR-016 — Hermes ContextEngine как основной путь интеграции ACE

**Статус:** Accepted direction; implementation and evidence pending
**Дата:** 2026-10-23
**Проект:** Adaptive Context Engine (ACE)

## Решение

Для текущего Hermes feedback loop ACE не должен передавать обязательный контекст через MCP tool call. MCP остаётся дополнительной плоскостью для явных операций: `ace_expand`, диагностика и операторские запросы.

Основной путь — Hermes `ContextEngine.select_context(...)`, который выполняется перед provider request и возвращает request-only представление контекста. Durable Hermes transcript и исходная история сессии не переписываются.

Если зафиксированный Hermes runtime не предоставляет совместимый `select_context`, допустим временный fallback через `pre_llm_call`, который добавляет ACE context к текущему user message. Fallback не заменяет основной ContextEngine contract и требует отдельного runtime evidence.

## Граница интеграции

ACE предоставляет прямой локальный JSONL bridge, не зависящий от MCP transport:

```text
Hermes ContextEngine
        |
        | JSONL request/response, local subprocess
        v
ACE context-transform service
        |
        +-- workspace/worktree observation
        +-- dense+sparse retrieval / RRF
        +-- structural/LSP verification
        +-- source-aware delivery and receipts
        v
request-only ContextProjection
```

Bridge принимает версию запроса, session/turn/request identity, workspace identity, query, budget и known evidence state. Ответ содержит bounded context text, evidence/receipt identity, provider/runtime identity, estimated tokens, selected/omitted evidence и typed readiness status.

## Инварианты

- Transformation влияет только на следующий provider request.
- Durable Hermes history остаётся byte-stable, кроме существующего request-sidecar механизма, необходимого для точного replay/cache поведения.
- Tool-call/result пары, provider-specific reasoning carriers и другие обязательные логические message groups не разрываются.
- Текущие проверенные source bytes имеют приоритет над stale index, memory и docs.
- Timeout, malformed response, provider outage, missing receipt или identity mismatch дают `UNKNOWN`/`BLOCKED`; они не превращаются в `ACE_NOT_USED` или measured zero.
- Hermes v0.22.3 сам fail-open для обычных исключений из `select_context()`: host ловит `Exception` и отправляет исходный request. Поэтому strict ACE feedback runtime намеренно завершает Hermes process через `SystemExit` при blocked transform, чтобы provider request не ушёл без обязательного ACE context. Это version-specific seam и должно заново проверяться при каждом обновлении Hermes.
- Native и Hermes+ACE arms используют одинаковые model/provider/reasoning/task/image/source/runtime identities. Намеренная разница — только request-time ACE transformation.
- ACE context receipts не содержат raw source payloads, auth state или credentials.
- Context economy считается только вместе с task quality и verified transformation evidence.

## Runtime pinning

Перед реализацией нужно проверить, что exact pinned Hermes runtime поддерживает:

```text
ContextEngine.select_context(request_messages, conversation_messages, incoming_message, budget_tokens)
```

Нельзя считать host Hermes compatibility доказательством для Harbor-пина. Если `v0.22.3` не содержит совместимый contract, нужно принять отдельное owner decision о runtime pin или временном `pre_llm_call` fallback.

## Последствия

Плюсы:

- ACE управляет фактическим model context, а не ждёт добровольного tool call.
- Durable transcript и request projection разделены.
- Retrieval остаётся в ACE и не дублируется Python plugin’ом.
- MCP сохраняет полезность для exact expansion и диагностики.

Цена:

- Нужен Python Hermes plugin и прямой local bridge между Python и TypeScript.
- Нужно сохранять message-group/provider invariants.
- Benchmark evidence должен связывать plugin, bridge, ACE runtime, source revision и каждый transformation receipt.
- Реальный Hermes smoke обязателен; Codex evidence не закрывает эту интеграцию.
