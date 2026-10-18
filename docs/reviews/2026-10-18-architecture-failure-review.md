# ЖЁСТКОЕ АРХИТЕКТУРНОЕ РЕВЬЮ: контракты есть, полезный ACE не собран

**Статус:** Blocking architectural review · **Дата:** 2026-10-18 · **Код:** [`ef2c7967ec6876a978800de01523146a8d077709`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/commit/ef2c7967ec6876a978800de01523146a8d077709)

**Вердикт:** Это не полноценная реализация нашей согласованной гипотезы RAG+AST+LSP. Это типизированный архитектурный каркас с отдельными адаптерами, но работающий MCP bootstrap направлен в слабый lexical/whole-file path. Нельзя подменять факт наличия интерфейсов фактом работоспособности продукта. У архитектурной документации и моей прежней SDD-декомпозиции тоже есть доля ответственности: формулировки не поставили достаточно жёсткий end-to-end gate. **Ниже проверяемые замечания, не приписывание мотивов автору.** Это статическое ревью; код/интеграции в этой проверке локально не запускались.

## Blocking findings

### P0 — Проектный смысл потерян в главном executable пути

- [`src/bin/ace-mcp.ts#L35-L68`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/bin/ace-mcp.ts#L35-L68) запускает `buildLocalCodeIndex` и `makeLocalContextProvider`; Qdrant, Tree-sitter, approved LSP, Graphiti и Vertex там не связаны в одну production композицию.
- [`src/adapters/local-code-index.ts#L28-L91`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/local-code-index.ts#L28-L91) извлекает имена регуляркой `symbolPattern`, задаёт для каждого `range: 1..endLine` и `text` целиком. Слово `symbol-aware` не делает полнофайловый сниппет символом.
- [`src/domain/retrieval.ts#L127-L158`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/domain/retrieval.ts#L127-L158) ранжирует лексическим `includes`, не исполняет semantic retrieval.
- **Почему это серьёзно:** цель — точная экономная доставка контекста, а не найденное имя + весь исходник. **Blocking acceptance:** DBC-01/02/03, настоящая цепочка Codex→MCP→Qdrant→AST→LSP→current source→bundle.

### P0 — SHA-256 выдаёт deterministic projection, но не semantic embedding

[`src/adapters/local-hash-embedding.ts#L17-L40`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/local-hash-embedding.ts#L17-L40) генерирует псевдовекторы из криптографического хэша. Семантическая близость текстов из этого **не следует**. В `SPIKE-RETRIEVAL-PROVIDERS.md` реализация названa `local_sha256_projection_v1`, то есть это не скрывается — и это смягчающее обстоятельство. Но измеренные `2/3` на трёх кейсах ничего не доказывают о качественных embeddings. **Blocking acceptance:** использовать измеренную настоящую embedding-модель, локальную по умолчанию; hash допускается только как fixture double.

### P1 — Собственный MCP transport без оправданного ADR

[`src/transport/mcp-stdio.ts#L112-L165`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/transport/mcp-stdio.ts#L112-L165) самостоятельно обслуживает JSON-RPC и lifecycle MCP. Почему мы оплачиваем поддержку протокола, когда есть официальный TypeScript SDK? Контрактное тестирование текущего кода не эквивалентно conformance актуального клиента. **Blocking acceptance:** SDK или отдельный ADR с доказанной необходимостью кастомной реализации.

### P1 — Неверная семантика references

[`src/adapters/typescript-language-service.ts#L95-L100`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/typescript-language-service.ts#L95-L100) устанавливает `isDefinition: item.isWriteAccess`. Write access не означает definition. Это дефект фактов, а не вкус команды. **Blocking acceptance:** использовать корректный контракт language service и тест same-name symbols / write-reference.

### P1 — Память может разрушить данные и потерять стабильную ссылку

- [`src/adapters/file-memory-archive.ts#L69-L85`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/file-memory-archive.ts#L69-L85) удаляет `contentPath(existing.contentDigest)` без учёта того, могут ли другие episodes ссылаться на тот же digest. При общем blob'е один delete способен сломать второго.
- [`src/adapters/codex-session-history.ts#L52-L83`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/codex-session-history.ts#L52-L83) включает `sourceDigest` **всего файла** в episode ID. Дописывание новой истории изменяет идентичность старой записи; replay больше не идемпотентен при append.
- **Blocking acceptance:** DBC-10/11, stable event identity + reference-safe deletion, atomicity and replay tests.

### P1 — `complete` может быть неправдой

[`src/domain/retrieval.ts#L159-L179`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/domain/retrieval.ts#L159-L179) ставит `complete` по freshness найденного evidence. Если требуемый provider не дал результатов и только добавил warning, `complete` всё равно может быть true. **Blocking acceptance:** completeness = required source coverage + successful checks, а не только отсутствие stale items.

### P1 — Расходы и производительность пока не доказывают ACE-value

[`benchmarks/reports/ace-local-smoke-paired-repeat5.md`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/benchmarks/reports/ace-local-smoke-paired-repeat5.md) сообщает baseline **263,441** vs ACE **654,919** токенов (10 ACE вызовов, качество в smoke одинаково); ACE требует примерно **2.49×** исходного количества токенов. [`ace-local-smoke-natural-paired-repeat5.md`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/benchmarks/reports/ace-local-smoke-natural-paired-repeat5.md) сообщает **362,152** vs **300,432**, но **0 ACE вызовов**. Это не «5×» и не доказательство экономии через retrieval. Оба отчёта **честно оговаривают ограничения**, что важно сохранить. **Blocking acceptance:** сложные paired code-intelligence задания, provider traces, actual ACE calls, no forced trivial smoke as proof.

### P2 — Hot path сканирует и хэширует весь workspace

[`src/adapters/local-context-provider.ts#L26-L46`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/local-context-provider.ts#L26-L46) делает snapshot перед поиском; [`node-workspace-port.ts#L44-L76`](https://github.com/chris-madsen/Mult-agent-AI-Orchestration/blob/ef2c7967ec6876a978800de01523146a8d077709/src/adapters/node-workspace-port.ts#L44-L76) рекурсивно читает и хэширует файлы. Даже без бенчмарка очевидно, что стоимость зависит от размера дерева, а не только запроса; **величина** замедления не измерена. Нужны incremental observer + адресные digest checks и p95 latency profiling, прежде чем выбирать Rust.

## Root causes: не только «агент накосячил»

1. **Моя/наша SDD-ошибка:** горизонтально расписали порты и задачи, но не зафиксировали E2E продукт как единственный критерий приёмки. Документированное `controlled exception` слишком легко скрывает неготовый mandatory provider.
2. **Слабое управление инструкциями:** корневой AGENTS был на сотни строк общих правил; ACE-specific договор лежал только в `docs/AGENTS.md` и автоматически не распространялся на `src/`.
3. **Ошибка реализации:** работающий bootstrap выбрал слабый fallback; основные выбранные технологии в нём не выполняют функцию продукта; отдельные семантические/архивные баги не ловятся существующими тестами.
4. **Чрезмерно раннее закрытие чекбоксов:** `[x]` рядом с порто- и smoke-тестами создаёт неверное впечатление зрелости без runtime provider acceptance.

## Требование на исправление — без новой многомесячной схемы

- Сохранить DDD boundaries, строгие типы, тесты, правильные security-инварианты и Harbor-отчёты.
- Не создавать 8 микросервисов или новый parsing/embedding/MCP framework.
- Прописать каждый обязательный Meyer контракт в `docs/docs/architecture/07-architecture-fitness-contracts.md`; исправить OpenSpec 001/002/003/004; в `006-production-retrieval-vertical-slice` принять **только реальную end-to-end композицию** с provider- and agent-proof.
- Блокировать `Production Ready` до owner review, реальных E2E/provider tests, quality-gated Harbor и утверждения pending ADR.
- Сначала конкретно починить точный AST span, approved embeddings, LSP refs, memory content sharing и semantics `complete`.

**Тон этого ревью намеренно резкий, потому что архитектурное несоответствие дорого. Но выводы адресованы коду и процессу, а не личности разработчика.** Исправляемое достижение здесь — уже имеющиеся контракты и адаптеры, а не новый проект с нуля.
