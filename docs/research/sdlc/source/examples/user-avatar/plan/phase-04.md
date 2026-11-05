# Phase 04: S3 FileStorage Adapter

## Goal
S3 FileStorage Adapter as one independently verifiable slice.

## Dependencies
02.

## Layer
Adapter.

## Implementation steps
Implement put/get/delete object handling and configuration with explicit authorization and retry/failure semantics. Test missing object, partial upload, transient error and idempotent cleanup.

## Files to create or modify

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
