# ACE token savings: measurement, not an admission gate

**Owner decision (2026-11-14):** Token-savings accounting is observational. Lack of a model-exact counter **MUST NOT introduce a new context-delivery block or authorization failure**. An obsolete proposal to block Gateway on an unverified model token counter is rejected (PR #239). Existing independent safety/identity checks are unaffected.

## Local request-level diagnostic

Hermes's native `AceContextEngine` writes JSONL receipts when `ACE_CONTEXT_RECEIPT_FILE` is configured. These already contain `originalEstimatedTokens`, `projectedEstimatedTokens` and `estimatedAddedTokens`. New receipts also carry `estimatedTokensSaved` and `tokenSavingsMeasurement=message_content_char_heuristic_v1`. The new fields are **reporting only** and do not influence `select_context` decisions.

Run:

```sh
python3 scripts/report-ace-token-savings.py path/to/receipts.jsonl
python3 scripts/report-ace-token-savings.py path/to/receipts.jsonl --json
```

The report sums distinct request receipts (deduplicated on session/request identity). It excludes blocked, malformed and unsupported rows and handles older receipts without the added fields. No-op projections contribute zero savings. It reports the **net difference between pre- and post-projection content-only heuristic estimates**; it does not store text or print credentials.

## Provider-measured savings for a completed agent task

The heuristic is approximately message-content characters / 4. It excludes provider-added wrappers, tool schemas, actual model tokenization, cached tokens and generated output. It is **not** an actual GPT model token count, a monetary cost saving or proof of the project's 5× hypothesis.

To measure actual token efficiency, compare *matched, successful* baseline and ACE task runs, using provider or Harbor `n_input_tokens`, `n_output_tokens`, cached input and costs. The existing `scripts/render-harbor-paired-report.ts` already produces a baseline-vs-ACE token and cost delta. A single post-request `usage` record is actual usage for that request, **not** the counterfactual number of tokens saved relative to an unsent request.

Missing estimates are represented as missing/not measured; do not fabricate model-exact counts. Telemetry must not alter authorization, model requests or retry behavior.
