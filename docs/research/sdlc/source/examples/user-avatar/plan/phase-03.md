# Phase 03: ImageProcessor Adapter

## Goal
ImageProcessor Adapter as one independently verifiable slice.

## Dependencies
02.

## Layer
Adapter.

## Implementation steps
Connect the chosen imaging library through the interface. Validate media type, size, memory pressure, dimensions and output formats. Test mocked adapter contract plus real provider when available.

## Files to create or modify

## Verification
- Test positive and negative behavior, error contracts and boundary violations.
- Run the appropriate compiler/build, unit and integration checks on the exact revision.
- Four pass categories: build; architecture; security; plan completeness. Failures require repair and repeated review.
- Mark phase accepted only with observed commands, status and accepted code SHA. In the video, runtime reviewers were separate; in ACE single-agent adaptation they are sequential self-checks.
