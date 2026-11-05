# fix backend bug — name-only reconstruction

> **Source reconstruction — not an original file.** Original path: `.claude/commands/fix_backend_bug.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5595); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5642). Confidence: **filename only; body NOT visible**. This is a newly written functional substitute, not a transcription.
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Reconstructed completion — executable substitute
Reproduce the backend defect with deterministic RED evidence, trace root cause and blast radius, design a minimal repair, implement and run four sequential quality reviews. For HTTP changes write manual QA with actual curl requests/bodies, expected responses, edge cases, and record validation. Save checkpoint before context compaction.

**Inputs:** user goal; code and existing test evidence; accepted constraints; target runtime. **Outputs:** smallest necessary design/plan/diff and verified evidence report.

**Mandatory gates:** source and accepted-ADR compatibility; tests run vs skipped; security and trust boundary; requirement→acceptance mapping; PR with exact head SHA. Human review for irreversible decisions. Do not claim original prompt wording.

## Reconstructed earlier steps for the clipped bugfix command (NOT from screenshot)

1. Record failing user request and expected behavior. Search existing bug reports/PRs to avoid a duplicate repair.
2. Obtain a reproducible failing test or deterministic runtime trace; classify as RED. If no reproduction is available, mark hypothesis STATIC-UNCONFIRMED and do not claim root cause.
3. Trace from observed symptom to initiating boundary, authorization, business state transition, infrastructure provider and persistence. Capture precise file:line.
4. Assess blast radius: other call sites, API clients, backward compatibility, migrations, retries/replays and tests.
5. Design smallest contract-preserving repair. If behavior or architecture changes, request owner acceptance and update canonical plan.
6. Implement narrow fix, run local tests and four separate build/arch/security/plan checks. Correct all FAIL findings.
7. Run actual smoke QA if backend/HTTP: document executable curl commands with explicit method, auth configuration, body and expected code; negative cases include unauthorized, malformed, repeated action, provider outage and not-found.
8. Save reproducible manual QA at the source-suggested manual_qa/{service}/{feature}/test-flow.md (or link into existing ACE evidence location).
9. Before compaction retain exact current phase, accepted decisions and check results, not merely a prose recap.

Only the manual-QA and context-management **tail** was visible in IMG_5642; steps 1–6 are deliberately completed by us.
