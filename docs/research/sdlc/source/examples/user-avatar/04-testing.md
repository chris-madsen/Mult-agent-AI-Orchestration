# 04-testing — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/04-testing.md`. WebP screenshots: IMG_5613, IMG_5614. Evidence: coverage and cases visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Map domain AvatarKey validation and entity transitions, boundary/use-case authorization, invalid MIME/oversize, storage failures, persistence mapping and HTTP error codes to tests. Include test filename/path, type, fixture, expected assertion and negative case. Separate unit mock tests from real S3/provider integration.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
