# 03-decisions — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/03-decisions.md`. WebP screenshots: IMG_5611. Evidence: decision/risk table visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Decision log with options and tradeoffs: where AvatarKey lives; S3 abstraction; sync vs async processing; public vs signed URLs; object cleanup; soft-delete handling; upload error semantics. Risks include partial uploads, storage outage, concurrent uploads, memory pressure. For every decision state owner/status, rationale, rejected options and verification; open questions must not be silently closed.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
