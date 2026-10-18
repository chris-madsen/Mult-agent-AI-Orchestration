# SPIKE — Adaptive routing readiness

**Status:** Controlled exception; deterministic routing remains the only default

The deterministic strategy routes exact file/symbol requests to code and structural
sources, temporal questions to memory, architecture questions to documentation, and
ambiguous requests to multiple sources. Candidate route comparison records required
sources and rejects a quality win when a required source is missed.

Jev is represented only by an explicit opt-in adapter boundary. The official API
surface is now verified read-only with `npm run probe:jev`: `/v1/models` returns
`403` without credentials and `/v1/systemone` advertises `POST` only. The public
documentation identifies Jev `1.14.x`/`jev-latest` and pricing of `$0.042` per
million input tokens with free output; no authenticated request was made. Private
code without explicit policy opt-in never reaches the boundary. The HTTP candidate
adapter validates route sources and records provider failures; no cost, latency or
quality superiority claim is made, and no production default is changed.

The authenticated experiment remains open because this environment has no Jev
credential and the project has not approved sending routing metadata externally.
