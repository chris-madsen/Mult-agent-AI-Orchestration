#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
VERSION="${VERSION:-26.5409.20454}"
VSIX_URL="${VSIX_URL:-https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5409.20454/1775869840451/Microsoft.VisualStudio.Services.VSIXPackage}"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
SETTINGS_JSON="${SETTINGS_JSON:-$HOME/.config/VSCodium/User/settings.json}"
TARGET_DIR="${TARGET_DIR:-$CODEX_HOME/vendor/codex-cli-$VERSION-linux-x86_64}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$CODEX_HOME/backups/override-codex-cli-binary-$TIMESTAMP}"

usage() {
  cat <<'EOF'
Usage:
  override-codex-cli-binary.sh [--apply]

Defaults to dry-run. Use --apply to execute.

What it does:
  1) downloads VSIX with newer codex binary
  2) extracts bin/linux-x86_64/{codex,rg} into ~/.codex/vendor/...
  3) sets VSCodium setting chatgpt.cliExecutable to extracted codex path
  4) writes rollback script and summary to backup directory

Safety:
  - does NOT install/uninstall/update extension
  - does NOT delete extension folders
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      shift
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

if pgrep -af 'codex app-server|VSCodium|/codium' >/dev/null; then
  echo "Refusing to run while VSCodium/codex app-server is active." >&2
  pgrep -af 'codex app-server|VSCodium|/codium' || true
  exit 1
fi

mkdir -p "$BACKUP_ROOT/files" "$BACKUP_ROOT/metadata"
echo "mode=$MODE"
echo "backup_root=$BACKUP_ROOT"
echo "target_dir=$TARGET_DIR"
echo "settings_json=$SETTINGS_JSON"

if [[ -f "$SETTINGS_JSON" ]]; then
  cp -a "$SETTINGS_JSON" "$BACKUP_ROOT/files/settings.json.before"
fi

if [[ "$MODE" != "apply" ]]; then
  echo "Dry-run only. Re-run with --apply to execute."
  exit 0
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
VSIX_PATH="$TMPDIR/openai.chatgpt-$VERSION.vsix"

echo "Downloading VSIX..."
curl -fL "$VSIX_URL" -o "$VSIX_PATH"

mkdir -p "$TARGET_DIR"
export VSIX_PATH TARGET_DIR
python3 - <<'PY'
import os
import stat
import zipfile
from pathlib import Path

vsix_path = Path(os.environ["VSIX_PATH"]).expanduser()
target_dir = Path(os.environ["TARGET_DIR"]).expanduser()

with zipfile.ZipFile(vsix_path) as zf:
    for rel in ("extension/bin/linux-x86_64/codex", "extension/bin/linux-x86_64/rg"):
        try:
            data = zf.read(rel)
        except KeyError as exc:
            raise SystemExit(f"Missing {rel} in VSIX: {exc}")
        out = target_dir / Path(rel).name
        out.write_bytes(data)
        out.chmod(out.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
PY

export SETTINGS_JSON TARGET_DIR BACKUP_ROOT
python3 - <<'PY'
import json
import os
from pathlib import Path

settings_path = Path(os.environ["SETTINGS_JSON"]).expanduser()
target_dir = Path(os.environ["TARGET_DIR"]).expanduser()
backup_root = Path(os.environ["BACKUP_ROOT"]).expanduser()
cli_path = str((target_dir / "codex").resolve())

if settings_path.exists():
    raw = settings_path.read_text(encoding="utf-8").strip()
    if raw:
        data = json.loads(raw)
    else:
        data = {}
else:
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    data = {}

if not isinstance(data, dict):
    raise SystemExit("settings.json is not a JSON object")

before = data.get("chatgpt.cliExecutable", None)
data["chatgpt.cliExecutable"] = cli_path
settings_path.write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")

rollback = backup_root / "metadata" / "rollback.sh"
rollback.write_text(
    "#!/usr/bin/env bash\n"
    "set -euo pipefail\n"
    f"SETTINGS_JSON={json.dumps(str(settings_path))}\n"
    f"BEFORE={json.dumps(before)}\n"
    "python3 - <<'PY2'\n"
    "import json, os\n"
    "p=os.path.expanduser(os.environ['SETTINGS_JSON'])\n"
    "before=json.loads(os.environ['BEFORE'])\n"
    "try:\n"
    "    raw=open(p,'r',encoding='utf-8').read().strip()\n"
    "    data=json.loads(raw) if raw else {}\n"
    "except FileNotFoundError:\n"
    "    data={}\n"
    "if before is None:\n"
    "    data.pop('chatgpt.cliExecutable', None)\n"
    "else:\n"
    "    data['chatgpt.cliExecutable']=before\n"
    "with open(p,'w',encoding='utf-8') as f:\n"
    "    f.write(json.dumps(data, ensure_ascii=True, indent=2)+'\\n')\n"
    "print('rollback done')\n"
    "PY2\n",
    encoding="utf-8",
)
rollback.chmod(0o755)

summary = {
    "settings_json": str(settings_path),
    "chatgpt_cliExecutable_before": before,
    "chatgpt_cliExecutable_after": cli_path,
    "codex_bin": cli_path,
    "rg_bin": str((target_dir / "rg").resolve()),
    "rollback_script": str(rollback),
}
(backup_root / "metadata" / "override-summary.json").write_text(
    json.dumps(summary, ensure_ascii=True, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps(summary, ensure_ascii=True, indent=2))
PY

echo "summary=$BACKUP_ROOT/metadata/override-summary.json"
echo "rollback=$BACKUP_ROOT/metadata/rollback.sh"
