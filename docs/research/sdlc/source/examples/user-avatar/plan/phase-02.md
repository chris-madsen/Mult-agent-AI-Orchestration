# Phase 02: Boundary Interfaces & Models

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-02.md`. WebP screenshots: IMG_5619, IMG_5627. Evidence: phase named in plan table; complete body not visible. The completion below is newly authored where the screenshot was cut.


## Goal
Boundary Interfaces & Models as one independently verifiable slice.

## Dependencies
01.

## Layer
Boundary.

## Key implementation decisions — reconstructed
Declare FileStorage and ImageProcessor ports and upload/delete/URL DTOs, independent from S3 and HTTP handlers. Verify compile-time boundaries and contract completeness.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
