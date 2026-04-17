"""AutoGen ModelClient for Claude on Google Vertex (Anthropic partner models)."""

from __future__ import annotations

import os
from typing import Any, Dict

from anthropic import AnthropicVertex

from autogen.oai.anthropic import AnthropicClient


def _resolve_vertex_anthropic_region(config: Dict[str, Any]) -> str:
    raw = (config.get("location") or os.getenv("GOOGLE_CLOUD_LOCATION") or "us-east5").strip()
    if raw == "global":
        return (os.getenv("CONSILIUM_VERTEX_ANTHROPIC_REGION") or "us-east5").strip()
    return raw


class VertexAnthropicClient(AnthropicClient):
    """Same message protocol as AnthropicClient, but uses AnthropicVertex (ADC / service account)."""

    def __init__(self, config: Dict[str, Any], **kwargs: Any) -> None:
        merged: Dict[str, Any] = {**config, **kwargs}
        project_id = merged.get("project_id") or os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not project_id:
            raise ValueError("Vertex Anthropic requires project_id or GOOGLE_CLOUD_PROJECT.")
        region = _resolve_vertex_anthropic_region(merged)
        self._client = AnthropicVertex(project_id=str(project_id), region=region)
        self._last_tooluse_status: dict[str, Any] = {}
        # Attributes referenced elsewhere on AnthropicClient / introspection
        self._api_key = None
        self._aws_access_key = None
        self._aws_secret_key = None
        self._aws_session_token = None
        self._aws_region = None
