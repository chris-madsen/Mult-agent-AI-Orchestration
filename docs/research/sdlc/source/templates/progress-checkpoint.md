# Durable context checkpoint

Use this before compaction, session switch or when execution spans multiple interactions. The checkpoint is an index back to authoritative files, **not a substitute** for reading them.

## Source identity
- Repository and canonical remote:
- Branch:
- BASE SHA:
- Current HEAD SHA:
- Open PR URL/number:
- Worktree status (dirty/untracked/unrelated):
- Date and agent/client:
- Current execution environment:
- Permission to perform external actions:

## Authoritative instructions
- Root/nested AGENTS:
- Accepted ADR IDs:
- Applicable OpenSpec change/spec:
- Governing execution plan:
- Active phase ID:
- Research/design references:

## Progress ledger
| Phase | State | Last verified SHA | Required next action |
|---|---|---|---|
| ... | READY/IN-PROGRESS/VERIFIED/BLOCKED/DELIVERED | ... | ... |

## Accepted decisions
| Decision | Owner | Reference | Effect on next phases |
|---|---|---|---|

## Completed work
- Behavior actually implemented:
- Files changed and removed:
- Commits pushed:
- Claims supported by tests:

## Actual test and gate evidence
| Command or gate | SHA | Outcome / exit | Artifact | Limitations |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Open findings
- Failed or unknown gate:
- Affected file and line:
- Root-cause hypothesis:
- Whether the owner has approved change:
- Provider/credential/test blockers:

## Exact next operation
1. Verify PR HEAD and working tree still match checkpoint.
2. Reopen specific source/design files:
3. Re-run relevant command/test:
4. Continue phase:
5. Do NOT do yet:

## Safe resumption
- Never assert tests remain valid after SHA changed.
- Never discard unrelated user edits.
- Never infer a blocked mandatory gate has passed.
- Never silently re-run side-effecting tool actions after a crash without idempotency evidence.
- Never use checkpoint prose to override accepted ADR/OpenSpec or fresh source.
