---
name: worktree-lifecycle
description: Use before creating, reusing, auditing, or cleaning Git worktrees in this repository.
---

# Worktree lifecycle

Use the project guard for every worktree lifecycle operation:

```bash
npm run worktree:audit -- --json
npm run worktree:preflight -- --task-id <task-id> --json
npm run worktree:start -- --task-id <task-id> --path <worktree-path> --json
npm run worktree:status -- --task-id <task-id> --json
npm run worktree:cleanup -- --task-id <task-id> --json
```

## Invariants

- One task has one deterministic `codex/<task-id>` branch, one worktree, and one PR.
- Run `audit` or `preflight` before any branch or worktree mutation.
- Reuse an existing task branch/worktree; never create a follow-up duplicate because the existing one is inconvenient.
- New worktrees are created from `origin/main`, not from a dirty checkout or a local stale `main`.
- Do not bypass the guard with raw `git worktree add` for task work.
- A dirty index, conflict entry, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, or `REBASE_HEAD` is a recovery state. Preserve it and report it; do not resolve or delete it automatically.
- `audit` is read-only and must not switch branches, stop agents, or remove worktrees.
- Cleanup is allowed only after the guard confirms a merged PR and a clean worktree. Remote branches are never deleted automatically.

The guard intentionally does not use a global lock. The deterministic branch name and post-operation inventory prevent duplicate work for the same task where Git can provide that guarantee; concurrent different tasks remain visible in the audit report.
