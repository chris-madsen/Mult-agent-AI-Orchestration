# W15 supply-chain availability

**Date:** 2026-10-20T14:16:14.872372Z  
**Exact current commit:** `161cc480bc91757df0f7c31340dbbc3774c61751`  
**Status:** INCOMPLETE

Fresh `npm sbom --package-lock-only --omit=dev --sbom-format cyclonedx` and
`npm audit --omit=dev --audit-level=high --json` were run for this commit. The
audit found zero info/low/moderate/high/critical vulnerabilities. The retained
report records the SBOM, audit and package-lock digests without retaining any
credential or source/session payload.

This does **not** satisfy supply-chain provenance. The exact immutable ACE image
digest and signed provenance attestation are not retained, and no independent
license review is bound to this SBOM and commit. W15 therefore remains blocked.
