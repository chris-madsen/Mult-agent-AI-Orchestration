#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
EXAMPLE_FILE="${ROOT_DIR}/.env.example"

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ ! -f "${EXAMPLE_FILE}" ]]; then
    echo "[fail] Missing ${EXAMPLE_FILE}" >&2
    exit 1
  fi
  cp "${EXAMPLE_FILE}" "${ENV_FILE}"
  echo "[run] created .env from .env.example"
fi

read_env_value() {
  local key="$1"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
      value = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?[^=]+=[[:space:]]*/, "", value)
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "${ENV_FILE}"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    {
      if (!updated && $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=") {
        if ($0 ~ /^[[:space:]]*export[[:space:]]+/) {
          print "export " key "=" value
        } else {
          print key "=" value
        }
        updated = 1
        next
      }
      print $0
    }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "${ENV_FILE}" > "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

ensure_env_value() {
  local key="$1"
  local desired="$2"
  local current
  current="$(read_env_value "$key")"
  if [[ -z "$current" ]]; then
    set_env_value "$key" "$desired"
  fi
}

maybe_set_google_project() {
  local current
  current="$(read_env_value GOOGLE_CLOUD_PROJECT)"
  if [[ -n "$current" && "$current" != "your-gcp-project-id" ]]; then
    return 0
  fi

  if command -v gcloud >/dev/null 2>&1; then
    local detected
    detected="$(gcloud config get-value project 2>/dev/null || true)"
    detected="${detected//$'\n'/}"
    if [[ -n "$detected" && "$detected" != "(unset)" ]]; then
      set_env_value GOOGLE_CLOUD_PROJECT "$detected"
      echo "[ok] GOOGLE_CLOUD_PROJECT <- gcloud config"
      return 0
    fi
  fi

  if [[ -z "$current" ]]; then
    set_env_value GOOGLE_CLOUD_PROJECT "your-gcp-project-id"
  fi
  echo "[warn] GOOGLE_CLOUD_PROJECT is not auto-detected; set it in .env if Architect/Critic are needed"
}

generate_api_key() {
  local hex
  hex="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'consilium-%s\n' "$hex"
}

maybe_set_api_key() {
  local current
  current="$(read_env_value CONSILIUM_API_KEY)"
  case "$current" in
    ""|"replace-with-strong-key"|"consilium-mvp-key")
      local generated
      generated="$(generate_api_key)"
      set_env_value CONSILIUM_API_KEY "$generated"
      echo "[ok] generated strong CONSILIUM_API_KEY"
      ;;
  esac
}

ensure_env_value GOOGLE_CLOUD_LOCATION global
ensure_env_value CONSILIUM_STRICT_API_KEY 1
ensure_env_value CONSILIUM_PUBLIC_MODEL consilium-auto
ensure_env_value CONSILIUM_RALPHEX_MODE auto
ensure_env_value CONSILIUM_RALPHEX_TIMEOUT_SEC 1200
ensure_env_value CONSILIUM_RALPHEX_IDLE_TIMEOUT_SEC 300
ensure_env_value CONSILIUM_RALPHEX_HEARTBEAT_SEC 15
ensure_env_value CONSILIUM_RALPHEX_IDLE_WARN_SEC 45
ensure_env_value CONSILIUM_AUTO_GIT_INIT 1

maybe_set_google_project
maybe_set_api_key

chmod 600 "${ENV_FILE}" 2>/dev/null || true

echo "[ok] local config bootstrap complete"
