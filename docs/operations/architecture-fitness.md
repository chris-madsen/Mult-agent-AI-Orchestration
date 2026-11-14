# ACE architecture fitness pilot

ACE uses the already pinned `@ast-grep/cli@0.51.0` for the first report-only architecture fitness checks.

**Authority:** `docs/research/sdlc/source/standards/Architecture Layers.md`, root `AGENTS.md`, and the MCP/Gateway plane separation in ADR-014/ADR-017.

## Commands

Native rule tests:

```bash
npm run test:arch-rules
```

Report-only production scan:

```bash
npm run check:arch
```

The rules remain `severity: warning`, so real findings are visible but do not block a PR during the pilot. Configuration/runtime failures still fail the command.

## Rules

- `ACE-ARCH-001 / ace-domain-no-adapter-import` — domain does not directly import or re-export concrete adapters.
- `ACE-ARCH-002 / ace-mcp-transport-no-gateway-projection-import` — explicit MCP stdio transport does not import or re-export Gateway Projection implementation modules.
- `ACE-ARCH-003 / ace-gateway-transport-no-mcp-import` — Gateway Projection HTTP transport does not import or re-export MCP SDK/framing modules.
- `ACE-ARCH-004 / ace-application-no-mcp-gateway-import` — application interfaces must not import the MCP-specific gateway implementation. Shared `ContextProvider` is owned by `src/application/ports.ts` (#237).
- `ACE-ARCH-005 / ace-application-no-adapter-import` — Effect application code depends on inward ports, not concrete adapters. The historical `AsyncMemoryArchivePort` import was repaired in #237; initial rule stays report-only as required by QG2.
- `ACE-ARCH-006 / ace-domain-no-application-import` — pure domain logic must not import application orchestration. It complements the existing domain→adapters rule.


Each native ast-grep rule test contains:
- invalid code that must be reported;
- valid code that must not be reported;
- a string containing a suspicious import path to prove text alone is not a finding;
- an `export ... from` crossing the same boundary, which must also be reported.

## Why the pilot is narrow

The pilot intentionally does not encode fuzzy architecture judgments such as business policy in controllers or provider failure semantics. Those require stronger semantic or design-level evidence than a simple syntax rule.

It also does not add a broad application-to-adapter prohibition in this slice because current accepted code has explicit outward dependencies that need a separate owner-reviewed architecture cleanup rather than a surprise merge blocker.

## Promotion

Changing a rule from `warning` to blocking `error` requires:
1. stable native valid/invalid/false-positive fixtures;
2. production scan evidence;
3. representative real-PR observation;
4. repair or owner-approved treatment of existing debt;
5. explicit owner approval of the blocking transition.

This pilot does not change the SDLC or architecture authority.
