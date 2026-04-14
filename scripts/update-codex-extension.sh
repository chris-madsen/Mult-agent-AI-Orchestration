#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
EXT_ID="${EXT_ID:-openai.chatgpt}"
TARGET_PLATFORM="${TARGET_PLATFORM:-linux-x64}"

usage() {
  cat <<'EOF'
Usage:
  update-codex-extension.sh [--apply] [--target-platform <platform>]

Defaults to dry-run. Use --apply to download and install the latest VSIX.

Safety behavior:
  - Refuses to run while VSCodium is active.
  - Never kills any processes.

Environment overrides:
  EXT_ID           default: openai.chatgpt
  TARGET_PLATFORM  default: linux-x64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      shift
      ;;
    --target-platform)
      TARGET_PLATFORM="${2:-}"
      if [[ -z "$TARGET_PLATFORM" ]]; then
        echo "missing value for --target-platform" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! command -v codium >/dev/null 2>&1; then
  echo "codium binary not found in PATH" >&2
  exit 1
fi

if pgrep -af 'VSCodium|/codium' >/dev/null; then
  echo "Refusing to run while VSCodium is active. Close it and retry." >&2
  pgrep -af 'VSCodium|/codium' || true
  exit 1
fi

installed_version="$(
  python3 - <<'PY'
import glob
import json
import os
from pathlib import Path

paths = glob.glob(os.path.expanduser("~/.vscode-oss/extensions/openai.chatgpt-*/package.json"))
versions = []
for p in paths:
    try:
        data = json.loads(Path(p).read_text(encoding="utf-8"))
        v = data.get("version")
        if isinstance(v, str):
            versions.append(v)
    except Exception:
        pass
print(sorted(versions)[-1] if versions else "")
PY
)"

read -r latest_version latest_vsix_url <<<"$(
python3 - "$EXT_ID" "$TARGET_PLATFORM" <<'PY'
import json
import sys
import urllib.request

ext_id = sys.argv[1]
target = sys.argv[2]

url = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1"
body = {
    "filters": [{
        "criteria": [{"filterType": 7, "value": ext_id}],
        "pageNumber": 1,
        "pageSize": 1,
        "sortBy": 0,
        "sortOrder": 0,
    }],
    "assetTypes": [],
    "flags": 914,
}
req = urllib.request.Request(
    url,
    data=json.dumps(body).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json;api-version=7.2-preview.1",
        "User-Agent": "codex-offline-updater",
    },
)
res = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
ext = res["results"][0]["extensions"][0]

chosen = None
for v in ext.get("versions", []):
    if v.get("targetPlatform") == target:
        chosen = v
        break
if chosen is None:
    for v in ext.get("versions", []):
        if v.get("targetPlatform") == "universal":
            chosen = v
            break
if chosen is None:
    raise SystemExit(f"no matching package found for target platform: {target}")

vsix = None
for f in chosen.get("files", []):
    if f.get("assetType") == "Microsoft.VisualStudio.Services.VSIXPackage":
        vsix = f.get("source")
        break
if not vsix:
    raise SystemExit("VSIX asset URL not found in Marketplace metadata")

print(chosen["version"], vsix)
PY
)"

echo "extension_id=$EXT_ID"
echo "target_platform=$TARGET_PLATFORM"
echo "installed_version=${installed_version:-<none>}"
echo "latest_version=$latest_version"
echo "latest_vsix_url=$latest_vsix_url"

if [[ -n "$installed_version" && "$installed_version" == "$latest_version" ]]; then
  echo "Already up to date."
  exit 0
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Dry-run only. Re-run with --apply to install $latest_version."
  exit 0
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
vsix_path="$tmpdir/$EXT_ID-$latest_version-$TARGET_PLATFORM.vsix"

echo "Downloading VSIX..."
curl -fL "$latest_vsix_url" -o "$vsix_path"

echo "Installing in codium..."
codium --install-extension "$vsix_path" --force

echo "Installed versions:"
if command -v rg >/dev/null 2>&1; then
  codium --list-extensions --show-versions | rg '^openai.chatgpt@' || true
else
  codium --list-extensions --show-versions | grep -E '^openai\.chatgpt@' || true
fi
