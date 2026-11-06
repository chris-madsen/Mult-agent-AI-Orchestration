# 07-standards

## Scope
Feature-scoped applicable standards: entity/VO construction, layer import direction, error code stability, auth middleware, persistence mapping, tests. Point to canonical project standards rather than copying them. For each standard state applicability and verification owner.

## Acceptance criteria
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
