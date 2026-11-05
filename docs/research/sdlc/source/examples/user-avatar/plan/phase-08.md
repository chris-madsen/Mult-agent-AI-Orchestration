# Phase 08: Init / Dependency Injection / Routing

> **Illustrative reconstruction, NOT the author's file or an ACE implementation.** Original example: `user-service/docs/user-avatar/plan/phase-08.md`. WebP screenshots: IMG_5619, IMG_5627. Evidence: phase named in plan table; complete body not visible. The completion below is newly authored where the screenshot was cut.


## Goal
Init / Dependency Injection / Routing as one independently verifiable slice.

## Dependencies
03,04,05,07.

## Layer
Bootstrap.

## Key implementation decisions — reconstructed
Register all components, environment config and routes in actual service init chain; smoke start and validate real request→handler→use-case→adapter wiring.

## Files to create or modify
Use the source plan's file map and inspect actual paths before writing. **Do not assume** that inferred original Go file lists are complete or automatically correct.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
