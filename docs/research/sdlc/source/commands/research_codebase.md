# Research Codebase — reconstructed command

> **Source reconstruction — not an original file.** Original path: `.claude/commands/research_codebase.md`. Evidence: https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5595); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5597); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5598); https://drive.google.com/drive/folders/15sMM_A8Y649EEVz5v0RxwspLYiHVb25K (WebP IMG_5599). Confidence: **substantial original instruction excerpts visible**. 
>
> Sections under **Reconstructed completion** are newly authored instructions inferred from visible fragments and engineering intent. They are **not quotations** from the creator. For exact source text use the screenshots.


## Visible method retained
- Research = DOCUMENT AND EXPLAIN what exists **today**, without suggestions or criticism.
- Read explicitly named files in full, decompose question into 2–4 independent areas, track tasks, cite exact file:line.
- The video's version launches up to four `codebase-researcher` subagents. Its context-overflow and concurrency limits are specific to that runtime.
- Synthesize evidence with metadata (date, agent identity, commit SHA, branch, question), Summary, Detailed Findings, Code References, Architecture Insights and Open Questions.
- Source output path: `.thoughts/research/YYYY-MM-DD-topic-name.md`.

## Reconstructed completion — runnable procedure
**Input:** precise question + optional paths, constraints and permitted external data sources.

1. Check working tree, branch, source commit and repository policies. If task has no question, ask for scope before touching unrelated code.
2. Inspect entrypoints, composition, types/interfaces, call sites and affected tests. Read all directly relevant files completely; do not infer behavior from filenames alone.
3. Split inquiry into independent topics if useful, but a single agent runs those investigations **sequentially**. Use a short checklist instead of TeamCreate/TaskCreate.
4. Capture `path:line` for every consequential fact; re-open the source around these lines if source changed.
5. Determine dependencies and inbound/outbound data flows. Compare what code does with how external providers are wired, without evaluating quality.
6. Assemble one report using `source/templates/research-output.md`. Explain unresolved ambiguities and operational checks needed for them.
7. Save at the source version's research path; when applied to ACE use `docs/research/<topic>.md` or an existing OpenSpec research link, not a second hidden authority.

**Gate:** report has source version, input question, file:line evidence, runtime wiring, open gaps. **Stop** if paths cannot be inspected; never fabricate citations.

## Detailed reconstructed research protocol (not visible verbatim)

### Request contract
- Input: question, paths if known, scope exclusions and desired output.
- If question is missing, ask for it; when supplied, do not ask for a second generic confirmation.
- Derive up to four independent inquiry areas, **but one agent executes them sequentially** rather than launching video-specific subagents.
- For each area: begin with precise entrypoint, read complete relevant files, trace imports and calls outward, map inputs/outputs, record every assertion with file/range.
- Check multiple sources against one another and resolve contradictions by reading source again, not by majority vote of descriptions.
- Limit follow-up investigations to open factual gaps. Note broad searches that did not find evidence as inconclusive rather than asserting absence.

### Research memo content
A. executive summary with source version; B. found runtime entrypoints; C. component-by-component exact code facts; D. dependencies and dataflows; E. code reference index with exact paths; F. existing conventions observed; G. unresolved unknowns. Use the original screenshot metadata shape (date, researcher, commit, branch, research question) but agent-neutral identity.

### Stop conditions
If a critical path is missing, file access is blocked, the source SHA changed, or only a test fake is accessible, mark partial research. NEVER include recommended refactoring in the factual memo. If suggestions are requested, make them in a **later Design artifact** explicitly based on this memo.
