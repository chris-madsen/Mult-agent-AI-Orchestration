# ACE — Tactical DDD: Entities, Value Objects, Aggregates, invariants

**Статус:** Proposed; модель выведена из PRD/ADR, именование и поля — новые проектные предложения. Следование этому документу не означает необходимость DDD framework, ORM или отдельной БД для каждого контекста.

**Owner modeling preference (2026-11-05):** this document names **logical identities, aggregate consistency boundaries and domain invariants**. It does **not** prescribe rich mutable Entity/Aggregate classes. ACE implementation defaults to **readonly ADTs and pure domain transition functions**; application orchestration and side effects live in Effect. The explicit choice and TypeSpec wire-contract policy are in [Functional DDD + TypeSpec architecture](../../research/sdlc/ARCHITECTURE-FUNCTIONAL-DDD-TYPESPEC.md). Keep all existing source-truth and provider safety invariants; update their code representation incrementally, not with a big-bang refactor.

## 1. Соглашения

- **Entity**: идентичность сохраняется при изменении атрибутов; уникальные IDs не равны путям и именам.
- **Value Object (VO)**: сравнение по значениям, immutable; валидируется при создании.
- **Aggregate**: consistency boundary, единственный транзакционный root; не делать агрегатами «весь workspace» или «всю историю» целиком.
- **Domain function** (вместо OO Domain Service по умолчанию): чистая операция над immutable domain state/ADT, размещённая в модуле owning bounded context (например, merge/relevance scoring).
- **Aggregate root**: логическая consistency/authorization/version boundary, а не требование mutable root object с методами. Команды могут обрабатываться чистыми функциями `transition(state, command)` и сохраняться через CAS/Effect.
- **Port**: абстрактный интерфейс (например, `CodeCandidatePort`), без Qdrant/Vertex DTO в домене.
- **Eventual consistency** между агрегатами допустима; `current=true` без проверки рабочего дерева запрещено.

## 2. BC-01 Workspace Truth

**Logical aggregate/consistency boundary `Workspace`** (identified immutable state; not an OO class requirement)

| Поле | Тип | Семантика |
|---|---|---|
| `workspaceId` | `WorkspaceId` VO | стабильный UUID/ULID, без path traversal |
| `rootRef` | `RepositoryRoot` VO | канонический локальный путь/разрешённый mount handle |
| `gitRef` | `GitRevision` VO | HEAD SHA + branch, может быть detached |
| `observationEpoch` | monotonic VO | версия наблюдений рабочего дерева, не глобальная транзакция FS |
| `registeredAt` | Timestamp VO | когда workspace принят |
| `accessScope` | VO | разрешённые rooted paths, policy reference |

**Child Entity `TrackedFile`**: относительный `RepoPath`, `ContentDigest` (`sha256`), `FileState` (`tracked/untracked/deleted/ignored`), `observedAt`, optional `language`, `lastEpoch`. Для больших repos это **отдельная проекция**, а не миллионы children в одной транзакции root.

**VO:** `WorkspaceId`, `RepoPath`, `ContentDigest`, `GitRevision`, `WorkingTreeVersion = (HEAD, epoch, selectedFileDigests)`, `SafeRoot`, `ObservationTime`.

**Инварианты:** пути строго внутри canonical root, symlink escape не разрешён; `WorkspaceId` не переиспользуется; content hash необходим для `VerifiedCurrent`; нельзя считать HEAD единственной текущей версией; `ObservationEpoch` монотонен; удалённый/заменённый файл не может materialize старый snippet как текущий.

**Commands/events:** `RegisterWorkspace→WorkspaceRegistered`, `ObserveChanges→WorkspaceChanged/SnapshotObserved`, `DeactivateWorkspace→WorkspaceDeactivated`.

## 3. BC-02 Code Discovery

**Aggregate root `IndexGeneration`**: `generationId`, `workspaceId`, `baseRevision`, `indexSchemaVersion`, `embeddingProfileId`, `state`, `coverage`, `startedAt`, `publishedAt`. Root владеет **атомарным pointer switch** `activeGeneration` в рамках workspace. Не захватывает транзакцией Qdrant и файловую систему одновременно.

**Entity `CodeIndexEntry`**: стабильный logical `entryId` (workspace+path+symbolOccurrence), `symbolKey?`, `sourceDigest`, `range`, `embeddingProfileId`, `indexedAt`, `generationId`, `tombstone`.

**VO:** `CandidateId`, `SymbolKey` (language-aware, не просто имя), `SourceSpan` (start/end, encoding convention), `IndexCoverage`, `EmbeddingProfile`, `RetrievalScore` (relative—not probability of truth).

**Инварианты:** published generation неизменяем; изменённый digest аннулирует `current` для соответствующего entry; collision symbol names не сливаются без определения; внешнее similarity score не превращается в verified semantic fact; выдача stale обязана иметь marker.

**Events:** `IndexBuildStarted`, `IndexBuildFailed`, `CodeIndexPublished`, `IndexEntryInvalidated`.

**Repositories/ports:** `IndexGenerationRepository`, `CodeCandidatePort` (Qdrant ACL), `LexicalCandidatePort` (rg/Zoekt optional), `EmbeddingPort` (локальная модель по default, cloud only opt-in).

## 4. BC-03 Semantic Intelligence

**Ключевое решение:** символы и факты о них **могут быть entity/read models**, но **не требуют собственной ACID транзакции**: они вычисляются относительно файла/версии.

**Entity `SymbolObservation`**: `symbolObservationId`, `workspaceId`, `symbolKey`, `sourceDigest`, `span`, `language`, `provider`, `observedAt`. `SymbolKey` строится из доступного language-service identity, не из имени без контекста.

**Entity `SemanticRelationObservation`**: typed edge (`defines`, `references`, `implements`, `imports`, `may_call`, `observed_calls`), `from`, `to`, `evidenceId`, `certaintyClass`.

**VO:** `AstNodeKind`, `SymbolSignature`, `Diagnostic`, `RelationKind`, `CertaintyClass = {static-resolved, static-possible, runtime-observed, unknown}`. `runtime-observed` только для имеющихся внешних traces/tests; не означает coverage всех путей.

**Domain service:** `ResolveCandidate(candidate, snapshot) → ResolvedEvidence | UnresolvedEvidence`; `ImpactExplorer` expands only on request/risk, with cycle guard.

**Инварианты:** LSP references не используются как доказательство отсутствия dynamic calls; current требует наблюдённого digest, диагностика не равна test success, non-supported language returns `unsupported`.

**Порты:** `StructuralSearchPort` (Tree-sitter / ast-grep), `LanguageSemanticsPort` (Serena/tsserver spike), `RuntimeEvidencePort` (optional/deferred).

## 5. BC-04 Documentation Knowledge

**Aggregate root `DocumentCorpus`**: `corpusId`, `projectId`, `cloudPolicyRef`, `documentSetVersion`, `state`. Допустим отдельный read-only adapter без собственной материализованной копии corpus, если Vertex отдаёт необходимый provenance.

**Entity `DocumentReference`**: `documentId`, `version`, `sectionId`, `sourceUri` (allowlisted), `checksum?`, `importStatus`.

**VO:** `DocumentCitation`, `DocumentExcerpt`, `DocumentVersion`, `DocumentAccessClass`.

**Инварианты:** нельзя искать/импортировать неразрешённый документ; retrieved excerpt — claim об источнике, не текущая норма автоматически; конфликты с исходным кодом сохраняются как два evidence; ссылка на цитату должна быть пригодна для проверки.

**Port:** `DocumentationSearchPort` backed by Vertex AI RAG Engine (не смешивать с локальным Qdrant).

## 6. BC-05 Engineering Memory

**Aggregate root `SessionArchive`**: `sessionId`, `sourceSystem=Codex`, `workspaceId?`, `episodes[]` (logically append only, physically segmented), `archiveState`, `sourceDigest`, `createdAt`, `captureVersion`.

**Entity `SessionEpisode`**: `episodeId`, `sequence`, `occurredAt`, `originalContentRef`, `byteDigest`, `speakerRole`, `sourcePointer`. **Оригинал не заменяется summary**. Сегментация допускается для больших сессий.

**Aggregate root `DecisionRecord`**: `decisionId`, `projectId`, `proposition`, `status`, `acceptedBy?`, `statusTimeline`, `evidenceEpisodeRefs`, `supersededBy?`.

**Entity `KnowledgeClaim`**: `claimId`, `extractionVersion`, `text`, `sourceEpisodeRefs`, `status=unconfirmed/verified_against_source/contradicted`, `temporalValidity`.

**VO:** `EpisodePointer`, `OriginalDigest`, `TimeInterval(validFrom, validTo?)`, `DecisionStatus`, `ClaimConfidence` (not automatic acceptance), `ApprovalActor`, `DeletionScope`.

**Инварианты:** `Accepted` только явным подтверждением; замена решения фиксирует старое; факты Graphiti — вторичный индекс; memory answer о старом обсуждении всегда содержит source episode; удаление/отзыв данных проталкивается и в derived indexes и privacy audit. Append-only **не** отменяет права на безопасное удаление.

**Ports:** `RawSessionArchive`, `TemporalKnowledgePort` (Graphiti ACL), `CodexSessionImportPort` (requires feasibility spike), `MemoryExtractionPort` (must obey local/cloud policy).

## 7. BC-06 Context Orchestration (главный Core)

**Aggregate root `ContextRequest`**: `requestId`, `workspaceId`, `query`, `intent`, `requestedAt`, `routingPolicyVersion`, `state`, `authorizedSources`, `warnings`, `bundleRef?`, `correlationId`. Не включать гигантский контекст и содержимое архивных сессий внутрь ACID root.

**Entities внутри request projection:** `RetrievalAttempt` (`sourceKind`, `started`, `ended`, `outcome`, `failureKind`, `resultRefs`), `EvidenceLink` (`candidateId`, `sourceRef`, `method`, `freshness`, `uncertainty`), `BundleSection` (`kind`, `rank`, `sourceRefs`, `exactExpansionToken?`).

**VO:** `RetrievalIntent` (`symbol|behavior|docs|history|impact|mixed`), `EvidenceStatus`, `FreshnessStatus` (`current/stale/unknown/changed_during_request`), `ContextBundleId`, `RoutingPlan`, `Provenance`, `ExpansionHandle` (opaque and access-checked), `CompletenessStatus` (`complete_within_scope/partial/unknown`).

**Domain services:** `RoutePlanner` (rule baseline / Jev strategy experiment), `EvidenceMerger` (identity/score policies), `FreshnessVerifier`, `BundleComposer`, `DisclosureResolver`.

**Инварианты:** нет bundle до Policy Gate; хотя бы одна честно указанная provenance на значимые claims; `VerifiedCurrent` невозможен без live revision check; `partial` не скрывается; long outputs lossless; никому не выдавать enterprise/private sources из другого workspace; data from retrieval treated untrusted.

**Queries/MCP projection:** `ace_context`, `ace_expand`, `ace_memory_search`; read-only с точки зрения файлов репозитория. `ace_index_status` optional internal. Корректный MCP tool contract описан в `05-contracts-and-deployment.md`.

## 8. BC-07 Trust & Policy

**Aggregate root `ProjectDataPolicy`**: `policyId`, `workspaceId`, `policyVersion`, `cloudOptIn`, `allowedProviders`, `deniedPaths`, `dataClasses`, `retentionClass`.

**Entity `AccessDecision`**: `decisionId`, `principal`, `action`, `dataClass`, `destination`, `outcome=allowed/denied`, `reasonCode`, `policyVersion`, `occurredAt`. Хранить минимально достаточные атрибуты, а не сырой payload.

**VO:** `Principal`, `DataClass`, `ProviderId`, `Operation`, `PolicyReason`, `SanitizationResult`.

**Инварианты:** deny на auth/policy/data residency/secrets fail-closed; backend timeout ≠ deny, возможен local fallback; нет облачного вызова без allow/consent; retry другого провайдера проходит новый Policy Gate; prompt injection внутри README не может менять policy.

## 9. BC-08 Evaluation

**Aggregate root `EvaluationSuite`**: `suiteId`, `suiteVersion`, `taskManifests`, `frozen`, `holdoutFlag`, `qualityRubric`, `comparatorSet`, `environmentRules`. Изменения frozen-suite только новой версией.

**Aggregate root `BenchmarkRun`**: `runId`, `suiteVersion`, `taskId`, `agentConfigId`, `repoBaseCommit`, `environmentFingerprint`, `state`, `tokenLedger`, `testOutcome`, `artifactRefs`, `failureReason?`, `startedAt/endedAt`.

**Entity `UsageSample`**: `sampleId`, `provider`, `eventSource`, `counterKind` (`delta/cumulative`), `sequence`, `input`, `cachedInput`, `output`, `reasoningOutput`, `cost` with `unknown` semantics.

**Aggregate root `ComparisonReport`**: `reportId`, `suiteVersion`, `runIds`, `metricMethodVersion`, `stats`, `releasedAt`, `limitations`, `evidenceHash`.

**VO:** `TaskFingerprint`, `ModelConfiguration`, `TokenCounts`, `CostBreakdown`, `MetricValidity`, `QualityGate`, `RunReproducibilityKey`.

**Инварианты:** `cached_input` подмножество input, `reasoning_output` подмножество output; cumulative не суммируется как delta; unknown не 0; failed runs сохраняются; сравнение 5× требует одинаковых task fixtures и quality gate, raw trace audit.

## 10. Агрегаты и границы транзакций — сводка

| Root | ACID boundary | Что никогда не кладём в эту транзакцию |
|---|---|---|
| Workspace | identity/config/observation version | Git файлы всего репо |
| IndexGeneration | active pointer/state/coverage | vector upserts + FS snapshot как единая транзакция |
| SessionArchive | метаданные эпизода + checksum | Graphiti indexing и внешний provider call |
| DecisionRecord | статус/approval/supersession | переписывание оригинального чата |
| ProjectDataPolicy | версия policy + audit outcome | облачную фактическую обработку данных |
| ContextRequest | статус и итоговые refs | большие output bundles целиком |
| EvaluationSuite | замороженный набор и версия | выполнение task в Harbor |
| BenchmarkRun | переходы run state и usage samples | локальный git tree и Harbor environment |

## 11. Cross-aggregate invariants (не решаются одной БД-транзакцией)

- `WorkspaceChanged → IndexInvalidated`: eventual consistency + **synchronous freshness check на выдаче**. Нельзя надеяться только на задержанное событие.
- `SessionArchived → GraphitiIndexed`: retries и idempotency, архив никогда не удаляется при failure projection.
- `PolicyAllowed → CloudRequestSent`: permission проверяется непосредственно перед отправкой, включая меняющуюся версию policy.
- `BenchmarkCompleted → UsageRecorded`: если нет достоверных usage событий, report маркирует `measurement_unavailable`; не синтезирует.
- `EvidenceRetrieved → BundleDelivered`: хэши перепроверяются после retrieval; при гонке результат `changed_during_request`/повторный fetch.

## 12. Не переносить неверные DDD допущения на реализацию

- Не создавать огромный `RepositoryService`, контроллер или Effect use-case, куда размазаны инварианты сразу нескольких bounded contexts. **Пассивные immutable ADT/records допустимы и предпочтительны**, когда их поведение сосредоточено в чистых доменных функциях соответствующего контекста. Агрегат остаётся consistency boundary, даже если нет класса `AggregateRoot`.
- Не распределять систему на 8 Deployments только из-за 8 Bounded Contexts.
- Не использовать Event Sourcing для всех агрегатов: raw archive immutable, но большинство состояний нормально хранятся как обычные записи + domain event/outbox.
- Не моделировать все spans/references как синхронные дочерние сущности большого Workspace aggregate.
- Не объявлять data-flow/static call graph «знанием runtime поведения».
- Не требовать фиксированной верхней границы выдачи корректного 2000-строчного patch (ADR-006).

## 13. Mapping: Event Storming → ADT and pure decisions

Use the accepted/owner-reviewed Event Storming outputs to design each context without class-based modeling as a default:

| Event Storming concept | Functional implementation artifact |
|---|---|
| Actor and command | validated immutable `Command` ADT with explicit origin and authorization context |
| Domain event (past tense) | immutable `Event` ADT emitted by a successful transition *when a consumer/audit exists* |
| Policy/business rule | pure `decide` / `transition` function in the owning bounded context |
| Aggregate | state identity/version + invariant-preserving transition and CAS/outbox when persisted |
| Hot spot / invariant | explicit error branch, property/transition test and concurrency case |
| Read model | immutable projection (Qdrant/Graphiti/other) with source identity, never the source-of-truth domain record |
| External system | Effect port/adapter with typed error, auth and cancellation; no domain SDK imports |

For a new feature, document (a) `State` ADT, (b) `Command` ADT, (c) `DomainError` ADT, (d) function signature and transition table, (e) emitted events if warranted, (f) persistence boundary and (g) TypeSpec wire DTO mapping. Do not force Event Sourcing or an event bus without a real replay/process requirement.

For example, `IndexGeneration` is a versioned state plus pure `canPublish/decidePublication` rules; the Effect application layer performs Qdrant publication and atomic pointer/CAS with crash/replay safeguards. `ContextRequest` is a typed result process, not a mutable domain object's lifecycle; operational request trace events are not necessarily durable domain events.

**TypeSpec owns the external protocol contract, not internal state.** A context's discriminated union maps explicitly to generated JSON/HTTP/MCP DTOs, and adapters validate untrusted payloads. Source freshness, private-code policy and real provider selection remain enforced at I/O time, not by TypeSpec annotations alone.
