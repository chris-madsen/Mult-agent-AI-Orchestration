# ACE docs-scoped writing instructions

**The root `/AGENTS.md` is the authoritative ACE implementation contract and applies to all files.** Read it first. The previous version of this nested file held critical implementation rules scoped only to `docs/`; those rules are now at repository root to ensure they apply to `src/` and `test/` too.

Documentation must distinguish **Accepted ADR**, **Proposed design**, **implemented**, **tested with real providers**, and **production-ready**; no false `[x]` due only to a mock, port, test double or a "controlled exception". New normative behavior belongs in OpenSpec capability requirements with verifiable preconditions, postconditions, invariants and negative cases; architectural rationale belongs in `docs/docs/architecture/` or a proposed ADR. Do not retroactively edit accepted decisions without owner approval.

Keep links, path references, spec identities and dates accurate. Review findings are source-specific and must distinguish observed defects from plausible risks. Strong wording is fine; unsupported claims are not.
