# Phase 06: Repository Model + Response

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-06.md`. WebP screenshots: IMG_5619, IMG_5627. Evidence: phase named in plan table; complete body not visible. The completion below is newly authored where the screenshot was cut.


## Goal
Repository Model + Response as one independently verifiable slice.

## Dependencies
01.

## Layer
Persistence/response.

## Key implementation decisions — reconstructed
Map AvatarKey to UserModel and back; update response representation while retaining existing fields and null semantics. Verify round-trip and backward compatibility.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
