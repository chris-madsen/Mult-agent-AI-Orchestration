# Research output template — AS-IS only

> Store under the existing research path and bind claims to the current commit. Delete unused headings rather than inventing content.

```yaml
---
title: "<research question>"
date: YYYY-MM-DD
researcher: "<agent/client or human>"
repository: "<owner/name>"
branch: "<branch>"
git_commit: "<full sha>"
status: partial
topics:
  - "<topic>"
---
```

## 1. Question and scope
Original question:
Boundaries/exclusions:
Relevant accepted decisions (context, not proof):
Runtime/provisioning limits:
Source SHA and worktree status:

## 2. Summary
Three to five bullet points of observed **current** behavior only. Each consequential assertion links to a detailed finding.

## 3. Findings

### R-001: <specific factual conclusion>
**Source identity:** branch and commit.

**Where:** `src/path.ts:L10-L30`; `src/other.ts:L20-L50`.

**What it does:** current behavior, not recommended changes.

**Entry point:** call or request path.

**Dependencies:** providers chosen, ports and adapters called.

**Dataflow:** input → validation → application → provider → output.

**Errors:** explicit typed and exceptional behavior.

**Authorization/data flow:** principal, data class, destination.

**Evidence type:** CODE / TEST / CONFIG / RUN; real/fake/unknown.

**Uncertainty:** what remains unobserved.

Repeat one subsection per conclusion; do not group unrelated claims under one citation.

## 4. Runtime composition
| Entrypoint | Runtime factory/composition | Selected provider | Evidence | Ambiguity |
|---|---|---|---|---|
| ... | ... | ... | `path:line` | ... |

## 5. Exact source index
| File/range | Role in path | Key symbols | Current SHA verified |
|---|---|---|---|
| ... | ... | ... | ... |

## 6. Existing tests and observations
| Test/command | Fixture/provider | Ran? | Result | Proves | Does not prove |
|---|---|---|---|---|---|
| ... | ... | YES/NO | ... | ... | ... |

## 7. Contradictions
| Claim A | Claim B | Evidence | Resolution or UNRESOLVED |
|---|---|---|---|

## 8. Open questions
- **Q-01:** missing source or runtime evidence; exact next inspection/probe.
- **Q-02:** permission/credential blocker and permitted alternative.

## 9. Completion check
- [ ] Path:line for material code claims.
- [ ] Selected runtime wiring, not hypothetical adapter.
- [ ] Old plans/docs not treated as current behavior.
- [ ] No proposals in factual research.
- [ ] No invented PASS.
- [ ] SHA and question recorded.
- [ ] Missing evidence explicitly labeled.
