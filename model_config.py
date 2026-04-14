from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_POLICY_PATH = Path(".consilium/policies/model_config.yaml")


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    model: str
    temperature: float
    max_tokens: int
    timeout_sec: int


@dataclass(frozen=True)
class RuntimeConfig:
    execution_adapter: str
    roles: dict[str, ModelConfig]

    def model_for(self, role: str) -> ModelConfig:
        key = role.strip().lower()
        if key not in self.roles:
            raise KeyError(f"Role model not configured: {role}")
        return self.roles[key]


_DEFAULT_CONFIG: dict[str, Any] = {
    "execution": {
        "adapter": "ralphex",
    },
    "roles": {
        "architect": {
            "provider": "google",
            "model": "gemini-3.1-pro-preview",
            "temperature": 0.3,
            "max_tokens": 8192,
            "timeout_sec": 120,
        },
        "critic": {
            "provider": "google",
            "model": "gemini-2.5-flash",
            "temperature": 0.1,
            "max_tokens": 4096,
            "timeout_sec": 120,
        },
        "implementer": {
            "provider": "codex-cli",
            "model": "gpt-5.3-codex",
            "temperature": 0.1,
            "max_tokens": 65536,
            "timeout_sec": 1200,
        },
    },
}


def _merge_defaults(cfg: dict[str, Any]) -> dict[str, Any]:
    merged = {
        "execution": {
            "adapter": (
                cfg.get("execution", {}).get("adapter")
                or _DEFAULT_CONFIG["execution"]["adapter"]
            ),
        },
        "roles": {},
    }

    provided_roles = cfg.get("roles", {})
    for role, role_default in _DEFAULT_CONFIG["roles"].items():
        candidate = provided_roles.get(role, {})
        merged["roles"][role] = {
            "provider": candidate.get("provider", role_default["provider"]),
            "model": candidate.get("model", role_default["model"]),
            "temperature": float(candidate.get("temperature", role_default["temperature"])),
            "max_tokens": int(candidate.get("max_tokens", role_default["max_tokens"])),
            "timeout_sec": int(candidate.get("timeout_sec", role_default["timeout_sec"])),
        }
    return merged


def load_runtime_config() -> RuntimeConfig:
    if _POLICY_PATH.exists():
        raw = yaml.safe_load(_POLICY_PATH.read_text(encoding="utf-8")) or {}
    else:
        raw = {}

    cfg = _merge_defaults(raw)
    roles = {
        role: ModelConfig(**role_cfg)
        for role, role_cfg in cfg["roles"].items()
    }
    return RuntimeConfig(
        execution_adapter=str(cfg["execution"]["adapter"]).strip().lower(),
        roles=roles,
    )

