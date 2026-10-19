#!/usr/bin/env python3
"""Small provider boundary for Tree-sitter structural facts.

The parser and grammars remain external provider code. This process only maps
their result to a stable JSON boundary; it never executes source text.
"""

from __future__ import annotations

import json
import platform
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from tree_sitter import Language, Parser
import tree_sitter_typescript


def language_for(path: str) -> Language:
    return Language(
        tree_sitter_typescript.language_tsx()
        if Path(path).suffix.lower() in {".tsx", ".jsx"}
        else tree_sitter_typescript.language_typescript()
    )


NAME_NODES = {
    "class_declaration": "class",
    "function_declaration": "function",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
    "method_definition": "method",
    "abstract_class_declaration": "class",
}


def symbols(node, source: bytes):
    result = []
    kind = NAME_NODES.get(node.type)
    if kind is not None:
        name_node = node.child_by_field_name("name")
        if name_node is not None:
            result.append(
                {
                    "name": name_node.text.decode("utf-8"),
                    "kind": kind,
                    "start_line": node.start_point[0] + 1,
                    "start_column": node.start_point[1] + 1,
                    "end_line": node.end_point[0] + 1,
                    "end_column": node.end_point[1] + 1,
                    "name_start_line": name_node.start_point[0] + 1,
                    "name_start_column": name_node.start_point[1] + 1,
                    "name_end_line": name_node.end_point[0] + 1,
                    "name_end_column": name_node.end_point[1] + 1,
                }
            )
    for child in node.children:
        result.extend(symbols(child, source))
    return result


def _package_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "missing"


def main() -> int:
    request = json.load(sys.stdin)
    if request.get("operation") == "identity":
        print(
            json.dumps(
                {
                    "provider": "tree-sitter",
                    "protocol_schema": 2,
                    "python": platform.python_version(),
                    "tree_sitter": _package_version("tree-sitter"),
                    "tree_sitter_typescript": _package_version("tree-sitter-typescript"),
                },
                separators=(",", ":"),
            )
        )
        return 0
    path = request.get("path")
    source = request.get("source")
    if not isinstance(path, str) or not isinstance(source, str):
        print(json.dumps({"error": "path and source are required"}))
        return 2
    source_bytes = source.encode("utf-8")
    parser = Parser(language_for(path))
    tree = parser.parse(source_bytes)
    print(
        json.dumps(
            {
                "symbols": symbols(tree.root_node, source_bytes),
                "has_error": tree.root_node.has_error,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
