# Implement Backend — reconstructed team command

> **Source reconstruction — not an original file.** Original path: `.claude/commands/implement_backend.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5627); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5628); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5629); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5630); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5631); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5632); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5633); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5634); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5635); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5636); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5637); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5638); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5639); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5641). Confidence: **most of its operational workflow visible, gaps bridged below**. 
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Visible baseline of the author's workflow
- Lead orchestrates; **Lead does not write implementation code**. No phase completes until its quality gate passes.
- Read the **entire** plan, all `phase-*.md`, dependency order, verification, acceptance and design/C4/sequence documents first.
- Claude-specific `TeamCreate`, `TaskCreate`, `TaskUpdate`, Delegate Mode and persistent teammates: implementer `backend` plus reviewers `rv-build`, `rv-arch`, `rv-sec`, `rv-plan`.
- One task per phase, explicit dependency edges and a final cross-phase review.
- Implementer reads mandated `prompts/be/` rules; runs build, test, lint and reports changed files; no next phase without approval.
- Four reviewers check build/test/lint, architecture/standards, security, plan completeness/design compliance. Rejects return to implementer; reviewers recheck the corrected phase.
- Final cross-phase review checks shared error codes, orphan code, naming consistency, dependency/DI wiring and smoke behavior; exact progress is saved before compaction.

## Reconstructed completion — runnable *single-agent* variant of the same logic
This section is a **proposed translation**, not a claim that the original video uses one agent. AI provider-agnostic implementation belongs in `ACE-SINGLE-AGENT-SDLC.md`; preserve this file as source analysis.

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
