#!/usr/bin/env python3
"""Read-only Hermes ACE context savings report from existing receipt JSONL.

Counts the same message-content character heuristic already recorded in Hermes
receipts. This script never participates in context selection, provider dispatch,
authorization, compaction or task preflight. It must not be used as a replacement
for paired provider-metered Harbor benchmarks of total agent tokens per task.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def _token_estimate(value: Any) -> int | None:
    return value if type(value) is int and value >= 0 else None


def summarize_receipts(path: Path) -> dict[str, Any]:
    scanned = measured = replacements = no_ops = blocked = duplicates = skipped = 0
    before = after = 0
    unique_requests: set[tuple[str, str]] = set()

    # The input is a locally retained diagnostic artifact, not network data.
    # Only numerical aggregates are emitted; never print message contents.
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            scanned += 1
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if not isinstance(record, dict):
                skipped += 1
                continue
            if record.get("status") == "blocked":
                blocked += 1
                continue
            mode = record.get("deliveryMode")
            if mode not in ("replacement", "no_op"):
                skipped += 1
                continue
            original = _token_estimate(record.get("originalEstimatedTokens"))
            projected = _token_estimate(record.get("projectedEstimatedTokens"))
            session_id, request_id = record.get("sessionId"), record.get("requestId")
            if (original is None or projected is None
                    or not isinstance(session_id, str) or not session_id
                    or not isinstance(request_id, str) or not request_id
                    or (mode == "no_op" and original != projected)):
                skipped += 1
                continue
            added = record.get("estimatedAddedTokens")
            if added is not None and (type(added) is not int or added != projected - original):
                skipped += 1
                continue
            saved = record.get("estimatedTokensSaved")
            if saved is not None and (type(saved) is not int or saved != max(0, original - projected)):
                skipped += 1
                continue
            key = (session_id, request_id)
            if key in unique_requests:
                duplicates += 1
                continue
            unique_requests.add(key)
            measured += 1
            before += original
            after += projected
            if mode == "replacement":
                replacements += 1
            else:
                no_ops += 1

    net = before - after
    return {
        "measurement": "message_content_char_heuristic_v1",
        "scope": "Hermes_ACE_request_local_projection",
        "recordsScanned": scanned,
        "measuredRequests": measured,
        "replacements": replacements,
        "noOps": no_ops,
        "blocked": blocked,
        "duplicates": duplicates,
        "skipped": skipped,
        "originalEstimatedTokens": before,
        "projectedEstimatedTokens": after,
        "estimatedTokensSaved": max(0, net),
        "estimatedTokensAdded": max(0, -net),
        "estimatedNetSavingsPercent": round(100 * net / before, 2) if before > 0 else None,
        "limitations": [
            "not_provider_usage",
            "not_total_agent_tokens_or_cost",
            "not_proof_of_counterfactual_task_savings",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "receipt_file", type=Path, nargs="?",
        help="Path to ACE_CONTEXT_RECEIPT_FILE (defaults to the environment value)",
    )
    parser.add_argument("--json", action="store_true", help="Emit only a JSON aggregate")
    args = parser.parse_args()
    path = args.receipt_file or (
        Path(os.environ["ACE_CONTEXT_RECEIPT_FILE"])
        if os.environ.get("ACE_CONTEXT_RECEIPT_FILE") else None
    )
    if path is None:
        parser.error("supply a receipt file or set ACE_CONTEXT_RECEIPT_FILE")
    report = summarize_receipts(path)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print("Hermes ACE request-local token estimate (NOT provider-metered usage)")
        print(f"Measured requests: {report['measuredRequests']} "
              f"(replacements {report['replacements']}; no-op {report['noOps']})")
        print(f"Estimated before:  {report['originalEstimatedTokens']}")
        print(f"Estimated after:   {report['projectedEstimatedTokens']}")
        print(f"Estimated saved:   {report['estimatedTokensSaved']}")
        print(f"Estimated added:   {report['estimatedTokensAdded']}")
        pct = report["estimatedNetSavingsPercent"]
        print(f"Estimated net savings: {pct:.2f}%" if pct is not None
              else "Estimated net savings: N/A (no measured tokens)")
        print(f"Excluded: blocked {report['blocked']}; duplicates "
              f"{report['duplicates']}; malformed/unsupported {report['skipped']}")
        print("For actual agent token savings compare matched baseline vs ACE "
              "provider usage in Harbor, including input, output and cache.")


if __name__ == "__main__":
    main()
