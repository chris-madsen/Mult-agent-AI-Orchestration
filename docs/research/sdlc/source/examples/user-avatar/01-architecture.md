# 01-architecture — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/01-architecture.md`. WebP screenshots: IMG_5606, IMG_5607, IMG_5608. Evidence: C4 and dependency diagrams partly visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Outline C4 context/container/components for HTTP server → controller → use case → ImageProcessor/FileStorage interfaces → S3 and MongoDB. Identify adapter and domain ownership, dependency direction and DI/init registration. Show chosen place for AvatarKey VO. Distinguish current wiring from proposed additions; include failure boundaries.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
