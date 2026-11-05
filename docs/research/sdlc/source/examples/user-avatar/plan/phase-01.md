# Phase 01: AvatarKey VO + User Entity Extension

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-01.md`. WebP screenshots: IMG_5623, IMG_5627. Evidence: individual file partially opened. The completion below is newly authored where the screenshot was cut.


## Goal
AvatarKey VO + User Entity Extension as one independently verifiable slice.

## Dependencies
none.

## Layer
Domain.

## Key implementation decisions — reconstructed
Create the AvatarKey value object, extend User entity state transitions and builder/validation. Check absence and malformed keys, keep existing entity invariants and known error codes.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
