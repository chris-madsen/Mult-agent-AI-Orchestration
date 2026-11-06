# План применения AI-assisted SDLC в ACE

## A. Подключение инструкций

1. Главным источником правил остаётся корневой `AGENTS.md`.
2. Для выполнения задач используется `docs/operations/ai-assisted-sdlc.md`.
3. Агент читает существующие OpenSpec и ADR, а не заводит второй набор архитектурных норм.
4. Подробные команды для отдельных этапов доступны в `source/commands/`; готовые нейтральные промпты — в `PROMPTS-ACE.md`.
5. Уровень процесса выбирается по риску изменения: T0, T1, T2.

## B. Сквозная проверка на реальной задаче

1. Найти незакрытый баг или небольшую фичу, проверив свежую ветку, реализацию и открытые PR.
2. Выполнить фактологический Research с ссылками `path:line`.
3. Подготовить краткий Design и получить одобрение принципиальных решений.
4. Записать фазы в существующем OpenSpec/исполнительном плане.
5. Для багов воспроизвести RED, затем добиться GREEN после исправления.
6. Выполнять четыре последовательные проверки: build, architecture, security, plan completeness.
7. Запустить применимые real-provider проверки, отдельно зафиксировать тесты, которые не запускались.
8. Запушить изменения в отдельный PR и получить точный SHA, результаты CI и человеческое ревью.
9. После завершения провести cross-phase проверку всей доработки.

## C. Дополнительные quality gates

Исследовать текущие GitHub Actions, secret scanning, зависимости, соблюдение архитектурных границ и ссылки документации. Добавлять только недостающие проверки, которые дают измеримую пользу. Не копировать Go-oriented инструменты в TypeScript проект.

## Не делать

- Не вводить Claude TeamCreate/TaskCreate как зависимость.
- Не создавать новый orchestrator для SDLC.
- Не дублировать OpenSpec, ADR или CI.
- Не выдавать самопроверку одного агента за независимое ревью.
- Не выдавать mock-only тест за подтверждение реального provider-E2E.

## Критерий завершения

Минимум один реальный PR с прохождением необходимых стадий, воспроизводимыми тестами и наблюдаемыми результатами quality gates; затем можно подкреплять описание этого подхода в CV ссылкой на PR.

## Quality Gates extension — execute as small follow-up PRs

See [research comparison](QUALITY-GATES-VIDEO-SPHERICON-ACE.md), [gate catalog](QUALITY-GATES-CATALOG.md), and [implementation plan](QUALITY-GATES-IMPLEMENTATION-PLAN.md).

Recommended order:
1. **QG0:** offline local Markdown links — no broad npm install for docs-only CI.
2. **QG1:** source secret scanning and GitHub workflow syntax/security, pinned tools.
3. **QG2:** two to four verified ACE-specific architecture rules with positive+negative fixtures and human-approved scope.
4. **QG3:** read-only G02 Design Consistency with a real acceptance crosswalk; already introduced as a *manual procedural* gate in this SDLC.
5. **QG4–QG6:** report-only Knip, compatibility checks and nightly vulnerability/mutation/property tests when justified.
6. **QG7 conditional:** typed SCIP/easement or a new toolchain manager such as mise only if a measured ACE architecture/reproducibility problem requires them.
7. **QG8 owner-selected:** TypeSpec rollout is required for new or migrated public machine contracts under the selected architecture, but the compiler/emitters/generators remain separate staged implementation work. SQL schema tooling remains conditional on ACE actually adopting SQL.

Do not copy Sphericon's PostgreSQL/Go SQL testing, frontend bundle-size gate, worktree isolation daemon or its project-specific TypeSpec generators as mandatory ACE checks. ACE has selected TypeSpec contract ownership for in-scope public wire surfaces; the **specific generators** must still be maintained, pinned and proven fit before adoption. Existing ACE deterministic tests, real providers and release supply-chain proof remain independent authoritative checks.

A future tool PR must show both a clean fixture and deliberately violating fixture, observed commands and GitHub CI result at the exact PR SHA. All proposed tools remain NOT INSTALLED until those PRs are completed.

## Owner decision update — TypeSpec and functional domain

- TypeSpec is **selected**, no longer a speculative P2 option. Introduce it through staged TS-00..06 tasks in [codegen coverage](TYPESPEC-CODEGEN-COVERAGE.md).
- For each material T2 design begin with Event Storming, derive readonly ADTs/pure invariants, and keep Effect use cases at I/O boundaries.
- Codegen output target is wider than DTO types: client SDK, server handler/route interfaces, runtime validation, mechanical mappings, typed permission metadata, mocks/fixtures, docs and reproducibility.
- Require fail-on-unmapped fields/enums, schema compatibility and actual wire roundtrip. No claim all targets are available from TypeSpec alone.
- A curated selection from Sphericon's pinned Matt v1.3.2 release is documented in the [import plan](MATT-POCOCK-SKILLS.md). The upstream files are **not committed**; this document must not claim installation.
- Don't invoke upstream `implement-spec` as a multi-agent executor. The one-agent ACE process remains canonical.
