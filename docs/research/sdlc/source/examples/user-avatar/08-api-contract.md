# 08-api-contract — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/08-api-contract.md`. WebP screenshots: IMG_5616. Evidence: HTTP paths and error table visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Describe upload (multipart), DELETE /api/users/:id/avatar, expanded GET /api/users/:id with avatar_urls. Define auth/authorization, valid/invalid input, stable error taxonomy, 400/403/404/500 mapping, response schema and backwards compatibility. Exact original status/payload is not fully visible; treat placeholders as requiring actual API approval.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
