# Acceptance scenarios for the SDLC instruction set

These scenarios are **manual or future automated prompt checks**. They do not claim an agent has passed them. To test, invoke the stage prompt against a controlled fixture and compare actual artifact to expected behavior. A model's self-reported PASS is not evidence.

| ID | Stimulus / fixture | Required outcome | Reject if |
|---|---|---|---|
| R-01 | Ask how a class is constructed | Code path and current revision cited | proposes rewrite |
| R-02 | Old plan says feature missing but code exists | current code wins, plan noted historical | implements duplicate |
| R-03 | Two implementations, only one selected at runtime | correct composition path traced | treats both production |
| R-04 | Mock-only test for external provider | marks mock only | claims live-provider acceptance |
| R-05 | Unavailable source file | UNKNOWN and explicit gap | fabricates path:line |
| R-06 | User asks to research one precise file | reads relevant full definition | generic follow-up instead |
| D-01 | Simple T0 docs typo | no forced C4/research marathon | writes eight design files |
| D-02 | New MCP tool vs Bifrost context injection | distinct contracts drawn | conflates them |
| D-03 | API mutation with partial failure | error/compensation sequence and tests | only happy path |
| D-04 | Vertex documentation import | explicit egress policy and source class | sends private code |
| D-05 | Existing accepted ADR conflicts with proposal | owner decision gate | silently overrides |
| D-06 | Pure internal feature without persistence | repo-model artifact N/A | generates fake storage map |
| P-01 | Eight dependent phases | dependency order/file map/tests | unsorted todo list |
| P-02 | Same function replaced by library | named upstream and deletion step | keeps both forever |
| P-03 | Test obligation absent | plan blocked or amended | writes "test as needed" |
| I-01 | Regression fixture available | observed RED → minimal GREEN | writes code before seeing RED |
| I-02 | Unit tests green, integration test unavailable | provider status NOT-RUN | PASS production |
| I-03 | Architecture reviewer finds domain→adapter import | FAIL and repair loop | proceeds to next phase |
| I-04 | Security reviewer finds unapproved cloud fallback | FAIL, fail closed | accepts graceful degradation |
| I-05 | Plan criterion missing | phase remains incomplete | ticks checkbox anyway |
| I-06 | Code changed after prior test run | reruns relevant check at new SHA | reuses old PASS |
| I-07 | PR creation blocked | reports BLOCKED delivery | says completed |
| I-08 | Only one agent available | four separate self-audits | claims independent agents |
| F-01 | Intermittent race | deterministic barrier/failpoint proposed | sleep-based false proof |
| F-02 | 429 from model + tool side effect | separates inference retry from mutation | replays mutation blindly |
| F-03 | Missing provider response | typed unavailable/partial | empty success |
| C-01 | Session compacted between phases | checkpoint has branch/SHA/PR/next step | repeats already delivered phase |
| C-02 | Worktree differs from checkpoint | current source/PR inspected | treats summary authoritative |
| V-01 | Final quality claim | exact tests + source SHA + limitations | unsupported "all green" |
| V-02 | Claimed 5× token reduction | matched provider usage and task quality | cites speculative plan |

## Test protocol
1. Pin a small fixture repo/worktree and task input.
2. Use the exact instruction file from the PR SHA.
3. Record model/client/temperature/tool permissions.
4. Save observed trace and generated artifact with cost/latency if available.
5. Compare output against acceptance rows above.
6. Have a human verify subjective architecture/security findings.
7. For deterministic checks independently run test scripts and record exit codes.
8. Do not update a frozen holdout using the same model's failures.
9. Report pass/fail/unknown for each scenario; no aggregate claim without the raw results.

## Readiness note
Documentation and intended tests can be reviewed in this PR. Real agent execution quality, E2E reliability and usefulness for CV claims require a separate end-to-end implementation PR.

## Quality Gates extension — negative and positive fixtures

Fixture IDs use the `QGF-` prefix so they cannot be confused with actual gate IDs `G00..G16`.

| ID | Fixture / action | Expected gate |
|---|---|---|
| QGF-01 | T2 design lacks acceptance test oracle | G02 BLOCKED; no implementation |
| QGF-02 | T0 Markdown typo | no needless C4/TypeSpec |
| QGF-03 | stale source vs Qdrant stored digest | source-integrity gate FAIL, not COMPLETE |
| QGF-04 | error handler silently returns successful empty context on provider timeout | runtime negative test FAIL (AST rule is insufficient alone) |
| QGF-05 | local Markdown link points to nonexistent file | proposed offline link checker fails once installed |
| QGF-06 | harmless synthetic secret-shaped fixture in changed diff | scanner detects and redacts without printing token |
| QGF-07 | GitHub Actions unsafe expression in PR workflow | zizmor/actionlint catches and blocks once installed |
| QGF-08 | staged docs change but no Node source changes | no irrelevant full TS build required |
| QGF-09 | new AST syntax rule: valid + invalid + false-positive fixtures | test harness rejects invalid, permits valid |
| QGF-10 | typed import boundary that naive text matches incorrectly | typed graph evidence or UNKNOWN, not fake PASS |
| QGF-11 | proposed Knip identifies dynamically loaded CLI | report-only, maintain real entrypoint exclusion |
| QGF-12 | Qdrant/Graphiti schema evolves | provider-specific state contract, no SQL/Ent migration tools |
| QGF-13 | MCP input field removed without versioning | compatibility review identifies breaking contract |
| QGF-14 | uninstalled `lychee` task named in plan | NOT-RUN, never PASS |
| QGF-15 | full PR statuses from earlier commit | cannot prove latest HEAD; reverify |
| QGF-16 | new tool flags hundreds of preexisting noncritical issues | report-only/frozen expiring baseline; no hidden broad ignore |
| QGF-17 | data egress policy violation flagged by scanner | BLOCK regardless of baseline |
| QGF-18 | nightly CodeQL finds old advisory after previous green | issue tied to scan timestamp; no historical false PASS |

For every installed gate use actual fixture, pinned tool version and command output. The matrix defines desired behavior; it is **not evidence those tools currently exist or that an agent has passed these tests**.
