# Phase 05: Use cases: Upload / Delete / Get Avatar URL

## Goal
Use cases: Upload / Delete / Get Avatar URL as one independently verifiable slice.

## Dependencies
02,03,04.

## Layer
Use case.

## Implementation steps
Coordinate authorization, image processing and storage, update entity state, handle compensation on partial failure and preserve error contracts. Use dependency ports, not concrete S3 classes.

## Files to create or modify

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
