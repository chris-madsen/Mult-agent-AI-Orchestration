# Phase 06: Repository Model + Response

## Goal
Repository Model + Response as one independently verifiable slice.

## Dependencies
01.

## Layer
Persistence/response.

## Implementation steps
Map AvatarKey to UserModel and back; update response representation while retaining existing fields and null semantics. Verify round-trip and backward compatibility.

## Files to create or modify

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
