# 02-behavior — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/02-behavior.md`. WebP screenshots: IMG_5609, IMG_5610. Evidence: DFD and sequence figures visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Define upload, delete and get URL flows. Upload: auth, validate MIME/size, process image, persist object, update user, respond; include failures after upload and compensating cleanup. Delete: identify owner, update entity/store, remove object with retry/idempotency safety. Get: authorize and return URL or absent state. Document sequence for happy and error paths.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
