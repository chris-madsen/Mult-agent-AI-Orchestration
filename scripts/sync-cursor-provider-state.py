#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from pathlib import Path


REACTIVE_KEY = (
    "src.vs.platform.reactivestorage.browser."
    "reactiveStorageServiceImpl.persistentStorage.applicationUser"
)
OPENAI_KEY_ROW = "cursorAuth/openAIKey"
DEFAULT_EXTRA_API_MODELS = ("gpt-5.3-codex",)


def _dedupe(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        value = (item or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _make_model_card(model_id: str, display_name: str) -> dict:
    variant = {
        "parameterValues": [],
        "displayName": display_name,
        "isMaxMode": False,
        "isDefaultMaxConfig": True,
        "isDefaultNonMaxConfig": True,
        "displayNameOutsidePicker": display_name,
        "variantStringRepresentation": f"{model_id}[]",
    }
    tooltip = {
        "primaryText": "",
        "secondaryText": "",
        "secondaryWarningText": False,
        "icon": "",
        "tertiaryText": "",
        "tertiaryTextUrl": "",
        "markdownContent": (
            f"**{display_name}**<br />Consilium gateway public alias. "
            "Internal routing is dynamic."
        ),
    }
    return {
        "name": model_id,
        "defaultOn": False,
        "parameterDefinitions": [],
        "variants": [variant],
        "legacySlugs": [],
        "idAliases": [],
        "supportsAgent": True,
        "degradationStatus": 0,
        "tooltipData": tooltip,
        "supportsThinking": True,
        "supportsImages": True,
        "supportsMaxMode": True,
        "clientDisplayName": display_name,
        "serverModelName": model_id,
        "supportsNonMaxMode": True,
        "tooltipDataForMaxMode": tooltip,
        "isRecommendedForBackgroundComposer": False,
        "supportsPlanMode": True,
        "inputboxShortModelName": display_name,
        "supportsSandboxing": True,
        "supportsCmdK": True,
        "namedModelSectionIndex": 1,
    }


def _env_public_model_aliases() -> list[str]:
    raw = (os.getenv("CONSILIUM_PUBLIC_MODEL_ALIASES") or "").strip()
    if not raw:
        return []
    return [part for part in re.split(r"[\s,]+", raw) if part.strip()]


def _update_json_payload(raw: str, base_url: str, api_models: list[str]) -> str:
    payload = json.loads(raw)
    payload["openAIBaseUrl"] = base_url
    payload["useOpenAIKey"] = True

    existing_api_models = payload.get("availableAPIKeyModels")
    if not isinstance(existing_api_models, list):
        existing_api_models = []
    payload["availableAPIKeyModels"] = _dedupe(
        [*(str(x) for x in existing_api_models), *api_models]
    )

    default_models = payload.get("availableDefaultModels2")
    if not isinstance(default_models, list):
        default_models = []
    known_server_names = {
        str(item.get("serverModelName"))
        for item in default_models
        if isinstance(item, dict) and item.get("serverModelName")
    }
    custom_cards = []
    for model_id in api_models:
        if model_id in known_server_names:
            continue
        display_name = "Consilium Auto" if model_id == api_models[0] else model_id
        custom_cards.append(_make_model_card(model_id=model_id, display_name=display_name))
    if custom_cards:
        default_models.extend(custom_cards)
    payload["availableDefaultModels2"] = default_models

    ai_settings = payload.get("aiSettings")
    if not isinstance(ai_settings, dict):
        ai_settings = {}
    payload["aiSettings"] = ai_settings

    user_added = ai_settings.get("userAddedModels")
    if not isinstance(user_added, list):
        user_added = []
    ai_settings["userAddedModels"] = _dedupe([*(str(x) for x in user_added), *api_models])

    model_override_enabled = ai_settings.get("modelOverrideEnabled")
    if not isinstance(model_override_enabled, list):
        model_override_enabled = []
    ai_settings["modelOverrideEnabled"] = _dedupe(
        [*(str(x) for x in model_override_enabled), *api_models]
    )

    model_config = ai_settings.get("modelConfig")
    if isinstance(model_config, dict):
        for feature_cfg in model_config.values():
            if isinstance(feature_cfg, dict):
                feature_cfg["modelName"] = api_models[0]
                feature_cfg["maxMode"] = False
                feature_cfg["selectedModels"] = None

    feature_model_configs = payload.get("featureModelConfigs")
    if isinstance(feature_model_configs, dict):
        for feature_cfg in feature_model_configs.values():
            if isinstance(feature_cfg, dict):
                feature_cfg["defaultModel"] = api_models[0]
                fallback = feature_cfg.get("fallbackModels")
                if isinstance(fallback, list):
                    feature_cfg["fallbackModels"] = _dedupe(
                        [api_models[0], *(str(x) for x in fallback)]
                    )

    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Cursor OpenAI provider state for Consilium.")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--legacy-model", default="ralphex-mcp")
    parser.add_argument("--extra-model", action="append", default=[])
    parser.add_argument(
        "--db-path",
        default=os.path.expanduser("~/.config/Cursor/User/globalStorage/state.vscdb"),
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser()
    if not db_path.exists():
        print(f"[warn] Cursor state DB not found: {db_path}")
        return 0

    api_models = _dedupe(
        [
            args.model,
            args.legacy_model,
            *DEFAULT_EXTRA_API_MODELS,
            *_env_public_model_aliases(),
            *(args.extra_model or []),
        ]
    )
    if not api_models:
        print("[fail] no models provided")
        return 1

    try:
        con = sqlite3.connect(str(db_path), timeout=10)
    except sqlite3.Error as exc:
        print(f"[warn] Cursor state DB unavailable: {exc}")
        return 0
    try:
        cur = con.cursor()
        cur.execute("PRAGMA busy_timeout = 5000")
        row = cur.execute("select value from ItemTable where key = ?", (REACTIVE_KEY,)).fetchone()
        if not row or not isinstance(row[0], str) or not row[0].strip():
            print(f"[warn] Cursor reactive state key missing: {REACTIVE_KEY}")
            return 0

        try:
            updated = _update_json_payload(row[0], args.base_url, api_models)
        except json.JSONDecodeError as exc:
            print(f"[warn] Cursor reactive state payload is not valid JSON: {exc}")
            return 0
        cur.execute("update ItemTable set value = ? where key = ?", (updated, REACTIVE_KEY))
        cur.execute(
            """
            insert into ItemTable(key, value)
            values(?, ?)
            on conflict(key) do update set value = excluded.value
            """,
            (OPENAI_KEY_ROW, args.api_key),
        )
        con.commit()
    except sqlite3.Error as exc:
        print(f"[warn] Cursor state update skipped: {exc}")
        return 0
    finally:
        con.close()

    print(
        "[ok] Cursor provider state synced "
        f"(base_url={args.base_url}, models={','.join(api_models)})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
