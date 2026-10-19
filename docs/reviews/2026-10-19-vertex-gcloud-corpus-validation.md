# Vertex AI RAG validation — Europe

**Date:** 2026-10-19
**Status:** authenticated API validation; corpus is intentionally empty.

## Resource

- Project: `poetic-emblem-494722-v2`
- Location: `europe-west4`
- Display name: `ace-europe-stage2`
- Resource: `projects/258931953910/locations/europe-west4/ragCorpora/2305843009213693952`
- Vector configuration: Vertex-managed vector database with
  `text-embedding-005` in `europe-west4`

The resource was created with the existing authenticated `gcloud` session **after explicit owner authorization to create the Europe Vertex corpus**. It is an approved test resource and must not be removed as a remediation.
No access token, identity, private document or uploaded fixture is stored in
this repository.

## Real calls

1. `GET .../locations/europe-west4/ragCorpora/2305843009213693952` returned
   the corpus metadata and HTTP 200.
2. `POST .../locations/europe-west4:retrieveContexts` with the safe synthetic
   query `ACE synthetic readiness probe` returned HTTP 200 and body `{}`.

The empty body is accepted by `src/adapters/vertex-rag.ts` as an empty result;
the ContextBundle marks documentation as a required partial source and emits
`Vertex documentation corpus returned no contexts`. No documentation is
invented and no empty corpus is reported as a successful documentation hit.

## Policy and next gate

The MCP composition enables this provider only when
`ACE_ENABLE_VERTEX=true`, `ACE_VERTEX_PROJECT` and `ACE_VERTEX_CORPUS_ID` are
explicitly configured. `ACE_VERTEX_LOCATION` defaults to `europe-west4`.
Outbound calls use the short-lived `gcloud auth print-access-token` result in
memory and pass through the project data policy. The corpus remains empty in this evidence snapshot. Its creation is authorized. Private source must not be sent to Vertex without separate data-scope authorization; any synthetic/public fixture import must remain traceable and non-secret.
