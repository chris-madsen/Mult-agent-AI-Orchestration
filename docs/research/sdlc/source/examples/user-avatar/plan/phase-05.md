# Phase 05: Use cases: Upload / Delete / Get Avatar URL

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-05.md`. WebP screenshots: IMG_5619, IMG_5627. Evidence: phase named in plan table; complete body not visible. The completion below is newly authored where the screenshot was cut.


## Goal
Use cases: Upload / Delete / Get Avatar URL as one independently verifiable slice.

## Dependencies
02,03,04.

## Layer
Use case.

## Key implementation decisions — reconstructed
Coordinate authorization, image processing and storage, update entity state, handle compensation on partial failure and preserve error contracts. Use dependency ports, not concrete S3 classes.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
