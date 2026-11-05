# Phase 07: Controller Upload/Delete

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-07.md`. WebP screenshots: IMG_5625, IMG_5627. Evidence: individual file partially opened. The completion below is newly authored where the screenshot was cut.


## Goal
Controller Upload/Delete as one independently verifiable slice.

## Dependencies
05,06.

## Layer
Controller.

## Key implementation decisions — reconstructed
Wire multipart upload/delete endpoints, call use cases, verify auth and stable HTTP error/status mapping, never put business logic in controller. Define manual curl QA.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
