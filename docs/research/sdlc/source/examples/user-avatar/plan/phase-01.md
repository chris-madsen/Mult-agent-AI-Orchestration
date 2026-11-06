# Phase 01: AvatarKey VO + User Entity Extension

## Goal
AvatarKey VO + User Entity Extension as one independently verifiable slice.

## Dependencies
none.

## Layer
Domain.

## Implementation steps
Create the AvatarKey value object, extend User entity state transitions and builder/validation. Check absence and malformed keys, keep existing entity invariants and known error codes.

## Files to create or modify
**Illustrative placeholder only — exact repository paths are NOT-VERIFIED because the source project is not attached.** In a real plan this section must be populated from current source inspection before the phase may move from NOT-RUN to READY.

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
