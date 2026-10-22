#!/usr/bin/env python3
"""Convert the official RepoBench-R pickle export to a lossless JSONL boundary.

The upstream artifact is a gzip-compressed pickle. This is intentionally an
explicit tooling boundary: the resulting JSONL is what TypeScript adapters
consume, while the original bytes and their digest remain the evidence source.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pickle
import re
import sys
from pathlib import Path
from typing import Any, NoReturn


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--config", choices=("python_cff", "python_cfr", "java_cff", "java_cfr"), required=True)
    parser.add_argument("--split", choices=("test_easy", "test_hard", "train_easy", "train_hard"), required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha256", required=True, help="SHA-256 pinned independently before loading the pickle")
    parser.add_argument(
        "--trust-pickle-source", action="store_true",
        help="Explicitly acknowledge that Python pickle can execute arbitrary code; only use an independently trusted artifact",
    )
    return parser.parse_args()


def fail(message: str) -> NoReturn:
    print(f"BLOCKED: {message}", file=sys.stderr)
    raise SystemExit(2)


def normalize_row(row: Any, index: int) -> tuple[dict[str, Any], str | None]:
    if not isinstance(row, dict):
        fail(f"record {index} is not an object")
    required = ("repo_name", "file_path", "context", "code", "golden_snippet_index")
    if any(key not in row for key in required):
        fail(f"record {index} is missing an upstream field")
    context = row["context"]
    if not isinstance(context, list) or not all(isinstance(snippet, str) for snippet in context):
        fail(f"record {index} context is not a string list")
    invalid_reason = None
    if not isinstance(row["golden_snippet_index"], int) or not 0 <= row["golden_snippet_index"] < len(context):
        invalid_reason = "gold_index_invalid"
    gold_index = row["golden_snippet_index"] if invalid_reason is None else (len(context) if context else 0)
    normalized = {
        "repo_name": row["repo_name"],
        "file_path": row["file_path"],
        "context": [{"snippet": snippet} for snippet in context],
        "code": row["code"],
        "gold_snippet_index": gold_index,
    }
    if isinstance(row.get("import_statement"), str): normalized["import_statement"] = row["import_statement"]
    if isinstance(row.get("next_line"), str): normalized["next_line"] = row["next_line"]
    if invalid_reason is not None: normalized["_conversion_invalid_reason"] = invalid_reason
    return normalized, invalid_reason


def main() -> int:
    args = parse_args()
    source = Path(args.input)
    target = Path(args.output)
    if not source.is_file():
        fail(f"missing pickle input: {source}")
    raw = source.read_bytes()
    actual_sha = hashlib.sha256(raw).hexdigest()
    if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256):
        fail("expected SHA-256 must be a 64-digit lowercase hexadecimal digest")
    if actual_sha != args.expected_sha256:
        fail("upstream pickle digest does not match independently trusted SHA-256; refusing deserialization")
    if not args.trust_pickle_source:
        fail("pickle is executable data: pass --trust-pickle-source only after independent source verification and run in an isolated environment")
    try:
        with gzip.open(source, "rb") as handle:
            dataset = pickle.load(handle)
    except Exception as exc:  # noqa: BLE001 - provider boundary must become an explicit BLOCKED result.
        fail(f"official RepoBench pickle could not be decoded: {exc}")
    try:
        split_name, subset_name = args.split.split("_", 1)
        rows = dataset[split_name][subset_name]
    except (KeyError, TypeError) as exc:
        fail(f"requested pinned split is absent from the upstream pickle: {exc}")
    normalized_with_status = [normalize_row(row, index) for index, row in enumerate(rows)]
    normalized = [row for row, _ in normalized_with_status]
    invalid_rows = sum(1 for _, reason in normalized_with_status if reason is not None)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        for row in normalized:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    metadata = {
        "schemaVersion": 1,
        "status": "READY",
        "source": str(source.resolve()),
        "sourceSha256": actual_sha,
        "config": args.config,
        "split": args.split,
        "records": len(normalized),
        "invalidInputRows": invalid_rows,
        "python": sys.version.split()[0],
        "output": str(target.resolve()),
        "outputSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }
    target.with_name("conversion-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
