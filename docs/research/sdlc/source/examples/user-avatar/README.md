# README — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/README.md`. WebP screenshots: IMG_5607, IMG_5627. Evidence: filename seen, body not shown. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Describe user-avatar upload/delete, image processing, S3 persistence and retrieval of avatar URLs. Index architecture, behavior, decisions, tests, persistence mapping and API contract. State exclusions: no migration of unrelated profile fields, no silent changes to existing user API. Require human design review before implementation.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
