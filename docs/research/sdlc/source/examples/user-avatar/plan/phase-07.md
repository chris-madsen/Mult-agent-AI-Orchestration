# Phase 07: Controller Upload/Delete

## Goal
Controller Upload/Delete as one independently verifiable slice.

## Dependencies
05,06.

## Layer
Controller.

## Implementation steps
Wire multipart upload/delete endpoints, call use cases, verify auth and stable HTTP error/status mapping, never put business logic in controller. Define manual curl QA.

## Files to create or modify

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
