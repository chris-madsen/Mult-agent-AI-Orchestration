# 06-repo-model — user-avatar design example

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/06-repo-model.md`. WebP screenshots: IMG_5615. Evidence: file opened, mapping excerpt visible. The completion below is newly authored where the screenshot was cut.


## Evidence-grounded subject
Map MongoDB UserModel avatar_key (null/absent/string) to domain AvatarKey and back. Verify no existing User fields are dropped. Define round-trip tests, serialization, compat with old documents and validation when persisted key is malformed. Reference Builder as a Go example, not a universal requirement.

## Reconstructed completion / acceptance
1. Identify preconditions and permitted callers; all claims about existing code require path:line in a real repository.
2. State expected normal and failure behavior for this artifact; connect each requirement to another design document and test.
3. Note N/A and evidence gaps rather than invent undocumented APIs or storage guarantees.
4. Record owner approval before work changes the public contract.

**Portability:** design artifact structure is reusable; Go/Fiber/S3 implementation details are a video case study, not ACE decisions.
