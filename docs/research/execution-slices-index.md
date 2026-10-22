# Research execution slices index

This directory contains three research/adoption specs and their Superpowers-style one-pass execution plans.

| Research spec | One-pass execution plan | First READY slice | Main decision gate |
|---|---|---|---|
| [ast-index adoption](./ast-index-adoption-plan.md) | [ast-index execution slices](./ast-index-execution-slices.md) | AI-01 external baseline | AI-09 hybrid vs one-hop ablation |
| [Roo Code adoption](./roo-code-adoption-plan.md) | [Roo Code execution slices](./roo-code-execution-slices.md) | ROO-01 current feedback reconcile | ROO-06 chooses exactly one of chunking/scope/scheduler |
| [Xiaomi memory adoption](./xiaomi-memory-adoption-plan.md) | [Xiaomi memory execution slices](./xiaomi-memory-execution-slices.md) | XM-01 lifecycle feasibility | XM-14 deterministic checkpoint/resume paired evaluation |

## How to execute

For Codex, give it **one slice only** in a fresh run:

```text
Use Superpowers. Implement only Slice <ID> from
docs/research/<plan>-execution-slices.md.

Read the linked research spec, AGENTS.md, applicable ADR/OpenSpec and current main.
First verify the slice is not already implemented or superseded.
Complete the slice end-to-end: RED where applicable, minimal implementation,
focused tests, verify:pr when applicable, commit and PR.
Do not start the next slice.
If an external prerequisite is unavailable, retain exact BLOCKED evidence instead
of replacing it with mocks or expanding scope.
```

Recommended execution mode: `subagent-driven-development` for slices that change production code; `executing-plans` is acceptable for evidence-only/very small slices.

## Cross-plan ordering

Do not run graph, chunking and checkpoint experiments simultaneously on the same retrieval benchmark and then attribute a win to one of them.

Recommended causal order:

1. Finish/refresh the current real ACE feedback baseline.
2. Use Roo diagnostics to identify the dominant retrieval failure.
3. Run **one** chosen retrieval experiment: Roo chunk/scope/scheduler **or** ast-index one-hop graph.
4. Keep only mechanisms with isolated evidence.
5. Xiaomi checkpoint/resume can proceed in parallel at the domain/fixture level, but its agent-level token/quality claims require its own interruption corpus and paired runs.

## Status discipline

These execution files are plans, not implementation evidence. A checked item or completed PR never upgrades `real-provider-tested`, `agent-E2E-tested`, `benchmark-evaluated` or `owner-approved` unless the corresponding retained evidence exists.
