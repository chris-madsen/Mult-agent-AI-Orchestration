# ADR-015 — Hermes как primary agent для Harbor feedback loop

**Статус:** Accepted  
**Проект:** Agentic Code Intelligence Harness / Adaptive Context Engine (ACE)  
**Дата:** 2026-10-23  
**Источник решения:** явное решение владельца проекта в ходе PR #157.  

## Контекст

> **Superseded delivery detail (owner decisions 2026-10-23/24):** This ADR retains the historical Hermes-as-benchmark-agent and OAuth decision. **Its ACE-via-native-MCP injection assumption is obsolete.** ADR-016 documents the implemented request-local Hermes `ContextEngine` / direct JSONL bridge, with MCP reserved for explicit tools. ADR-017 selects planned Bifrost → ACE projection for configurable-endpoint agents. Neither a registered MCP server nor an MCP call proves model-bound context delivery. LangGraph orchestrates agents outside ACE.

ACE задуман agent-neutral и должен передавать проверенный контекст через MCP, а не зависеть от особенностей одной агентной оболочки. Текущий feedback loop был собран вокруг Codex, но практическая цель этого контура — проверить, улучшает ли ACE работу агента при естественном использовании контекста. Для этой цели владелец выбрал Hermes: у него есть native MCP integration и более подходящая для эксперимента модель подмешивания контекста.

При этом менять underlying GPT-модель или уходить на отдельный API billing не требуется. Hermes поддерживает provider `openai-codex`, который использует ChatGPT/Codex OAuth state. Harbor 0.24.0 умеет запускать Hermes и передавать MCP servers, но его встроенный Hermes adapter не поддерживает этот OAuth provider, поэтому для benchmark runtime нужен узкий адаптер.

## Решение

1. **Hermes — primary agent для текущего Harbor feedback loop.** Native и ACE-optional arms используют один и тот же Hermes version, модель, reasoning effort, task image, source revision, timeout и один attempt.
2. **GPT подключается через Hermes `openai-codex`.** Источник аутентификации — отдельный Hermes-owned store `~/.hermes/auth.json`, созданный `hermes auth add openai-codex`. Benchmark не заимствует `~/.codex/auth.json`: Hermes upstream разделяет эти refresh-token chains, чтобы Codex CLI/VS Code и Hermes не инвалидировали OAuth друг друга. Store копируется только в `HERMES_HOME=/tmp/hermes` ephemeral task container; после serial trial обновлённый OAuth state атомарно синхронизируется обратно в host Hermes store. Credential bytes не попадают в manifest/log artifacts.
3. **ACE подключается как native Hermes MCP server.** Baseline arm не получает ACE; ACE-optional arm получает ровно один server `ace` через stdio с entrypoint `/ace/scripts/harbor-ace-mcp.sh`.
4. **Harbor 0.24.0 сохраняется.** До появления upstream-поддержки `openai-codex` используется минимальный custom Harbor adapter `scripts.harbor_hermes_codex_oauth:HermesCodexOAuth`, основанный на штатном Harbor Hermes runtime.
5. **Hermes version должен быть pinned в experiment/job evidence.** На момент принятия решения feedback loop закрепляет `v0.22.3`; обновление требует нового provenance/evidence, а не молчаливого `latest`.
6. **Исторический Codex evidence не переписывается.** Он остаётся валидным только для того runtime, на котором был получен. После смены агента требуется новый one-task Hermes smoke перед main/repeats/holdout.
7. **Codex остаётся comparison/compatibility client.** Это решение не делает ACE Hermes-specific и не запрещает matched head-to-head Codex runs.

## Инварианты сравнения

- В paired Hermes run единственная намеренная разница между arms — наличие ACE MCP.
- Provider/model/reasoning identity совпадает между arms.
- Zero ACE calls => `ACE_NOT_USED`, а не ACE-caused savings.
- Missing Hermes/provider usage остаётся `UNKNOWN`, а не нулём.
- Hermes session/MCP evidence сохраняется и коррелируется с ACE provider trace/request IDs.
- Raw source, credentials и private session payloads не публикуются.

## Последствия

Плюсы:

- ACE получает естественный native MCP путь вместо Codex-specific config injection.
- Harness можно менять отдельно от underlying GPT subscription/model.
- Контракт эксперимента становится ближе к agent-neutral архитектуре ACE.

Цена:

- До upstream-поддержки Harbor нужен небольшой adapter boundary, который stage/sync-ит Hermes-owned OAuth store и не касается Codex CLI credentials.
- Предыдущий Codex smoke/preflight не является Hermes E2E proof.
- Token/cache fields зависят от того, что реально экспортируют Hermes/Harbor/provider; недоступные поля должны оставаться unknown.

## Критерий пересмотра

Решение пересматривается, если Harbor upstream нативно поддержит Hermes `openai-codex` OAuth с теми же provenance/security свойствами, Hermes потеряет необходимый MCP/session evidence contract, либо matched benchmark покажет, что другой agent harness лучше подходит для основной feedback loop.

## Связанные документы

- ADR-001 — agent-neutral MCP boundary
- ADR-006 — structured Context Bundle / progressive disclosure
- ADR-009 — Harbor benchmarking (agent-specific Codex clauses superseded here)
- ADR-014 — Hybrid Context Engine
- ADR-016 — implemented Hermes native request-time projection (supersedes MCP injection here)
- ADR-017 — planned Bifrost model-bound gateway for configurable-endpoint agents
- OpenSpec change `002-harbor-evaluation`
