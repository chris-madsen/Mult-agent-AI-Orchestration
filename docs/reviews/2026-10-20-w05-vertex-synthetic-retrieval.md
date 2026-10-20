# W05 Vertex synthetic retrieval

**Date:** 2026-10-20  
**Commit:** `426dd53`  
**Status:** BLOCKED — real provider reached, committed fixture not found

## What changed

The synthetic Vertex retrieval runner now explicitly authorizes only the
`vertex/project_document` data-class pair when its dedicated synthetic ACK is
set. This fixes the earlier policy denial without changing the default local
policy or permitting private source, conversation, secret, or session data.

## Real observation

Command and environment are retained in
`benchmarks/reports/vertex-synthetic-conflict-e2e-426dd53.json`.

- The policy gate passed.
- The real `retrieveContexts` path was invoked through the Vertex adapter.
- The provider response was structurally valid, but no context matched the
  committed `vertex-conflict-v1` marker and required citation content.
- No import, upload, corpus creation, or private-session transfer was
  attempted.
- Citation and server-side version identity remain unproven.

## Blocker and safe workaround

This is an environment/data prerequisite, not a reason to add a shim or relax
the E2E assertion. The existing Europe corpus must first receive the approved
committed synthetic fixture through the separately gated import command, with
an owner-authorized `gs://ace-vertex-synthetic...` destination. Until that
authorization and prefix are supplied, W05 remains blocked and cannot support
production readiness or documentation citation/version claims.
