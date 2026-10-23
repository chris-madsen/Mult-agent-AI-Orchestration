#!/usr/bin/env python3
"""Convert an official RepoBench-R Parquet export to a lossless JSONL boundary.

Parquet is treated as data, not executable Python input.  The digest is checked
before importing the optional Arrow reader, rows are streamed in bounded
batches, and only the fields accepted by the TypeScript adapter are emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, NoReturn


HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
CONFIGS = ("python_cff", "python_cfr", "java_cff", "java_cfr")
SPLITS = ("test_easy", "test_hard", "train_easy", "train_hard")


def fail(message: str) -> NoReturn:
    print(f"BLOCKED: {message}", file=sys.stderr)
    raise SystemExit(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--config", choices=CONFIGS, required=True)
    parser.add_argument("--split", choices=SPLITS, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--expected-sha256",
        required=True,
        help="SHA-256 of the exact official Parquet bytes, checked before decoding",
    )
    return parser.parse_args()


def text(value: Any, field: str, index: int) -> str:
    if not isinstance(value, str):
        fail(f"record {index} {field} is not a string")
    return value


def normalize_context(value: Any, index: int) -> list[dict[str, str]]:
    if not isinstance(value, (list, tuple)):
        fail(f"record {index} context is not a list")
    normalized: list[dict[str, str]] = []
    for context_index, item in enumerate(value):
        if isinstance(item, str):
            normalized.append({"snippet": item})
            continue
        if not isinstance(item, dict) or not isinstance(item.get("snippet"), str):
            fail(f"record {index} context[{context_index}] is not a string snippet")
        snippet = {"snippet": item["snippet"]}
        for key in ("path", "identifier"):
            if key in item:
                if not isinstance(item[key], str):
                    fail(f"record {index} context[{context_index}].{key} is not a string")
                snippet[key] = item[key]
        normalized.append(snippet)
    return normalized


def normalize_row(row: dict[str, Any], index: int) -> dict[str, Any]:
    required = ("repo_name", "file_path", "context", "code", "gold_snippet_index")
    missing = [field for field in required if field not in row]
    if missing:
        fail(f"record {index} is missing fields: {', '.join(missing)}")
    context = normalize_context(row["context"], index)
    gold_index = row["gold_snippet_index"]
    if not isinstance(gold_index, int) or isinstance(gold_index, bool):
        fail(f"record {index} gold_snippet_index is not an integer")
    if not 0 <= gold_index < len(context):
        fail(f"record {index} gold_snippet_index is outside context")
    normalized: dict[str, Any] = {
        "repo_name": text(row["repo_name"], "repo_name", index),
        "file_path": text(row["file_path"], "file_path", index),
        "context": context,
        "code": text(row["code"], "code", index),
        "gold_snippet_index": gold_index,
    }
    for source_key, output_key in (("import_statement", "import_statement"), ("next_line", "next_line")):
        if row.get(source_key) is not None:
            normalized[output_key] = text(row[source_key], source_key, index)
    return normalized


def main() -> int:
    args = parse_args()
    source = Path(args.input)
    target = Path(args.output)
    expected = args.expected_sha256.lower()
    if not source.is_file():
        fail(f"missing Parquet input: {source}")
    if not HEX_SHA256.fullmatch(expected):
        fail("expected SHA-256 must be 64 lowercase hexadecimal characters")
    raw_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    if raw_sha != expected:
        fail("Parquet digest does not match the independently pinned artifact")
    try:
        import pyarrow.parquet as parquet  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001 - optional provider boundary
        fail(f"pyarrow is required for Parquet conversion: {exc}")
    try:
        parquet_file = parquet.ParquetFile(source)
        names = set(parquet_file.schema_arrow.names)
        required = {"repo_name", "file_path", "context", "code", "gold_snippet_index"}
        if not required.issubset(names):
            fail(f"Parquet schema is missing fields: {', '.join(sorted(required - names))}")
        target.parent.mkdir(parents=True, exist_ok=True)
        records = 0
        with target.open("w", encoding="utf-8", newline="\n") as handle:
            for batch in parquet_file.iter_batches(batch_size=256):
                for row in batch.to_pylist():
                    handle.write(json.dumps(normalize_row(row, records), ensure_ascii=False, separators=(",", ":")) + "\n")
                    records += 1
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - provider boundary
        fail(f"official Parquet could not be decoded: {exc}")
    output_sha = hashlib.sha256(target.read_bytes()).hexdigest()
    metadata = {
        "schemaVersion": 1,
        "status": "READY",
        "source": str(source.resolve()),
        "sourceSha256": raw_sha,
        "config": args.config,
        "split": args.split,
        "records": records,
        "python": sys.version.split()[0],
        "reader": "pyarrow.parquet.ParquetFile",
        "output": str(target.resolve()),
        "outputSha256": output_sha,
    }
    target.with_name("conversion-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
