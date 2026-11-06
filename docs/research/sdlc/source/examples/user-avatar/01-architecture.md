# 01-architecture

## Scope
Outline C4 context/container/components for HTTP server → controller → use case → ImageProcessor/FileStorage interfaces → S3 and MongoDB. Identify adapter and domain ownership, dependency direction and DI/init registration. Show chosen place for AvatarKey VO. Distinguish current wiring from proposed additions; include failure boundaries.

## Acceptance criteria
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
