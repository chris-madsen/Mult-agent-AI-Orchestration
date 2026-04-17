"""Build AutoGen llm_config + optional register_model_client for policy-driven roles."""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from agents.env_config import get_google_cloud_location, get_google_cloud_project
from model_config import ModelConfig, load_runtime_config


def _resolve_gemini_vertex_location(raw: str, model: str) -> str:
    """Resolve Gemini location with backward-compatible defaults.

    Newer Gemini 3.x preview models can require `global` endpoint, while older
    2.x paths usually work via regional endpoints.
    """
    r = (raw or "us-central1").strip()
    model_id = (model or "").strip().lower()
    if r == "global" and model_id.startswith("gemini-3"):
        return "global"
    if r == "global":
        return (os.getenv("CONSILIUM_VERTEX_GEMINI_REGION") or "us-central1").strip()
    return r


def _google_entries(role_cfg: ModelConfig, project: str | None, location: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for model in role_cfg.models:
        loc = _resolve_gemini_vertex_location(location, model)
        e: dict[str, Any] = {
            "model": model,
            "api_type": "google",
            "project_id": project,
            "location": loc,
        }
        entries.append(e)
    return entries


def _vertex_anthropic_entries(role_cfg: ModelConfig, project: str | None, location: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for model in role_cfg.models:
        entries.append(
            {
                "model": model,
                "api_type": "openai",
                "model_client_cls": "VertexAnthropicClient",
                "project_id": project,
                "location": location,
            }
        )
    return entries


def _codex_cli_entries(role_cfg: ModelConfig) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for model in role_cfg.models:
        entries.append(
            {
                "model": model,
                "api_type": "openai",
                "model_client_cls": "CodexCLIClient",
                "request_timeout_sec": role_cfg.timeout_sec,
            }
        )
    return entries


def build_role_llm(
    role: str,
) -> tuple[dict[str, Any], Callable[[Any], None] | None]:
    """Returns (llm_config, register_fn). register_fn(agent) wires custom ModelClient classes."""
    role_cfg = load_runtime_config().model_for(role)
    provider = (role_cfg.provider or "").strip().lower()
    project = get_google_cloud_project()
    location = get_google_cloud_location()

    base: dict[str, Any] = {
        "config_list": [],
        "temperature": role_cfg.temperature,
    }

    if provider == "google":
        base["config_list"] = _google_entries(role_cfg, project, location)
        return base, None

    if provider == "vertex-anthropic":
        base["config_list"] = _vertex_anthropic_entries(role_cfg, project, location)

        def _register(agent: Any) -> None:
            from agents.vertex_anthropic_autogen import VertexAnthropicClient

            agent.register_model_client(VertexAnthropicClient)

        return base, _register

    if provider == "codex-cli":
        base["config_list"] = _codex_cli_entries(role_cfg)

        def _register_codex(agent: Any) -> None:
            from agents.codex_cli_autogen import CodexCLIClient

            agent.register_model_client(CodexCLIClient)

        return base, _register_codex

    raise ValueError(f"Unsupported provider for role {role!r}: {role_cfg.provider}")
