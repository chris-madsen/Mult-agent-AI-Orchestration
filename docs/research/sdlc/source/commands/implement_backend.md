# Implement Backend

## Visible baseline of the author's workflow
- Lead orchestrates; **Lead does not write implementation code**. No phase completes until its quality gate passes.
- Read the **entire** plan, all `phase-*.md`, dependency order, verification, acceptance and design/C4/sequence documents first.
- Claude-specific `TeamCreate`, `TaskCreate`, `TaskUpdate`, Delegate Mode and persistent teammates: implementer `backend` plus reviewers `rv-build`, `rv-arch`, `rv-sec`, `rv-plan`.
- One task per phase, explicit dependency edges and a final cross-phase review.
- Implementer reads mandated `prompts/be/` rules; runs build, test, lint and reports changed files; no next phase without approval.
- Four reviewers check build/test/lint, architecture/standards, security, plan completeness/design compliance. Rejects return to implementer; reviewers recheck the corrected phase.
- Final cross-phase review checks shared error codes, orphan code, naming consistency, dependency/DI wiring and smoke behavior; exact progress is saved before compaction.

## Procedure

1. Read the plan and all relevant phase files, design documents and standards. Identify done vs not-done by **actual checks/evidence**, not checkboxes alone.
2. Choose the first unblocked phase. Record source SHA, task objective, file create/modify map, blocked dependencies, explicit invariants and tests.
3. Implement just the phase's smallest coherent slice. Keep changes within plan; if a change to design is necessary, stop and obtain an explicit decision.
4. Run quick tests and capture command + exit code. Use existing project tools, not Go commands blindly.
5. Run four **separate passes**, in order, with the agent explicitly switching reviewer hats and re-reading the diff fresh:
   - **BUILD:** commands, relevant tests, lint, typecheck, failures/skip reasons.
   - **ARCH:** dependency direction, design compliance, domain contracts, duplication, existing upstream reuse.
   - **SEC:** input/trust boundaries, auth, secrets, prompt injection, safe errors and outbound policy.
   - **PLAN:** checklist every planned file/rule/acceptance test; deviations require approval.
6. In each pass report PASS/FAIL/UNKNOWN with `path:line`, log evidence and risk. **One agent is not an independent reviewer.** Thus these passes improve discipline but never count as independent approval.
7. If any reviewer FAIL, fix, rerun affected tests and all four passes. UNKNOWN is not PASS.
8. Before phase closure, run project-approved PR gate and relevant real-provider acceptance. Record exact commit and commands.
9. After all phases run one cross-phase review and real smoke/integration evidence. Human owner controls architecture sign-off and merge.

## Standard phase report
| Gate | Status | Evidence | Missing / risk |
|---|---|---|---|
| Build/tests/lint | PASS/FAIL/UNKNOWN | command + log + SHA | ... |
| Architecture | PASS/FAIL/UNKNOWN | path:line / accepted design | ... |
| Security | PASS/FAIL/UNKNOWN | test, secret scan, paths | ... |
| Plan completeness | PASS/FAIL/UNKNOWN | requirement-test map | ... |

**Do not claim:** independent multi-agent review, real provider testing, or production readiness merely because the agent wrote PASS.

## Detailed procedure

### Pass 1 — rv-build
Read full phase goal and modified files. Run relevant compile/typecheck, unit tests, lint and affected integration tests. Inspect actual command and exit status; do not accept agent-written prose as test evidence. Report BLOCKER for failing required command; UNKNOWN when command unavailable. Attach SHA, command, relevant output and fixture.

### Pass 2 — rv-arch
Read changed files completely, accepted design, standards and relevant dependency owners. Inspect dependency direction (domain must not depend on infra), circular imports, duplicate/handwritten implementation of installed libraries, layer ownership, value object/domain invariants, repository mapping, explicit errors, DI/router wiring. Screenshot reviewer also checked use of consistent typed errors and discouraged giant functions; adapt such thresholds to the project rather than inventing hard Go file-size rules. Classify findings as BLOCKER/MAJOR/MINOR with file:line and actual rule.

### Pass 3 — rv-sec
Read changed entrypoints, auth, transport and provider boundaries. Check validation, authorization, trusted identity (do not take security identity directly from user payload), no exposed secrets/PII or stack traces, safe error handling, no unsafe assertions, no permissive wildcard CORS with credentials, route middleware coverage and path traversal. For ACE add untrusted retrieved instructions, model/tool action authorization and forbidden cloud egress. Include negative tests for meaningful concerns.

### Pass 4 — rv-plan
For every approved phase line: locate created/changed file, business rule, mapping, error code and verification. Compare the result with behavior diagrams and public contracts, not merely implementation checkboxes. **Additional scope** is documented for owner review; **reduced scope** or design contradiction is a failed gate. Classify DONE/PARTIAL/MISSING with evidence and list any requested deviation.

### Reviewer result schema
| Reviewer | PASS/FAIL/UNKNOWN | Evidence | File/line finding | Required correction |
|---|---|---|---|---|
| build | ... | ... | ... | ... |
| arch | ... | ... | ... | ... |
| sec | ... | ... | ... | ... |
| plan | ... | ... | ... | ... |

### Coordinator loop
1. Assign one unblocked phase with full context and exact file map.
2. Implement and run local tests; generate phase handoff with changed paths.
3. Review with all four categories. If any FAIL, combine findings, return **same phase** to repair, then run the gates again.
4. On all gates verified, record commit, mark phase complete and move to next unblocked dependent phase.
5. After all phases, perform final cross-phase audit: stable error codes, API consistency, dependency wiring, missing/unused symbols, persistence state, security and real smoke test.
6. Create PR/handoff report; owner, not agent prose, approves merge and production promotion.

### Context handling
Video bugfix prompt shows approximate 0–40/40–60/60–80/80–100% usage regions. Such percentages are heuristic and unavailable in some clients. Save a durable checkpoint before compaction: task, plan/phase and last accepted SHA, working files, gates performed, failed findings, exact next step. Re-read source after resuming.
