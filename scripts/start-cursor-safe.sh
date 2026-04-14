#!/usr/bin/env bash
set -euo pipefail

# Manual override has priority.
cursor_bin="${CURSOR_BIN:-}"

if [[ -z "$cursor_bin" ]]; then
  if compgen -G "$HOME/.local/bin/Cursor-*-x86_64.AppImage" >/dev/null; then
    cursor_bin="$(ls -1 "$HOME"/.local/bin/Cursor-*-x86_64.AppImage | sort -V | tail -n 1)"
  elif command -v cursor >/dev/null 2>&1; then
    cursor_bin="$(command -v cursor)"
  fi
fi

if [[ -z "$cursor_bin" || ! -x "$cursor_bin" ]]; then
  echo "[fail] Cursor binary not found. Set CURSOR_BIN=/absolute/path/to/cursor" >&2
  exit 1
fi

cursor_bin_resolved="$(readlink -f "$cursor_bin" 2>/dev/null || printf '%s' "$cursor_bin")"
render_mode="${CURSOR_RENDER_MODE:-gpu}" # gpu | safe
gpu_backend="${CURSOR_GPU_BACKEND:-auto}" # auto | intel | nvidia
cursor_nice="${CURSOR_NICE:-6}"
cursor_filter_noise="${CURSOR_FILTER_NOISE:-1}" # 1=filter known harmless startup noise
cursor_suppress_node_deprecations="${CURSOR_SUPPRESS_NODE_DEPRECATIONS:-1}" # 1=suppress node deprecation warnings
cursor_kill_conflicts="${CURSOR_KILL_CONFLICTS:-1}" # 1=stop already running incompatible Cursor binary

codium_pid="$(pgrep -f '/vscode/codium' | head -n 1 || true)"
codium_cpuset=""

load_codium_env() {
  local key value line
  [[ -n "${codium_pid}" ]] || return 0
  while IFS= read -r line; do
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      DISPLAY|XAUTHORITY|XDG_SESSION_TYPE|GTK_IM_MODULE|GTK_MODULES|QT_IM_MODULE|QT_ACCESSIBILITY|ELECTRON_NO_ATTACH_CONSOLE|DRI_PRIME|__NV_PRIME_RENDER_OFFLOAD|__GLX_VENDOR_LIBRARY_NAME|__VK_LAYER_NV_optimus)
        export "$key=$value"
        ;;
    esac
  done < <(tr '\0' '\n' <"/proc/${codium_pid}/environ" 2>/dev/null || true)
}

detect_backend_from_codium() {
  [[ -n "${codium_pid}" ]] || return 1
  if tr '\0' '\n' <"/proc/${codium_pid}/environ" 2>/dev/null | rg -q '^(DRI_PRIME=1|__NV_PRIME_RENDER_OFFLOAD=1|__GLX_VENDOR_LIBRARY_NAME=nvidia)$'; then
    echo "nvidia"
    return 0
  fi
  echo "intel"
}

detect_cpuset_from_codium() {
  local cg path full cpuset
  [[ -n "${codium_pid}" ]] || return 1
  cg="$(sed -n 's/^0:://p' "/proc/${codium_pid}/cgroup" 2>/dev/null | head -n 1 || true)"
  [[ -n "${cg}" ]] || return 1
  path="${cg}"
  while [[ -n "${path}" && "${path}" != "/" ]]; do
    full="/sys/fs/cgroup${path}"
    if [[ -f "${full}/cpuset.cpus.effective" ]]; then
      cpuset="$(<"${full}/cpuset.cpus.effective")"
      if [[ -n "${cpuset}" ]]; then
        echo "${cpuset}"
        return 0
      fi
    fi
    path="$(dirname "${path}")"
  done
  return 1
}

stop_conflicting_cursor_instances() {
  local pid cmd exe exe_base
  local -a conflicts=()
  [[ "${cursor_kill_conflicts}" == "1" ]] || return 0
  while IFS= read -r line; do
    pid="${line%% *}"
    cmd="${line#* }"
    [[ -n "${pid}" && "${pid}" =~ ^[0-9]+$ ]] || continue
    [[ "${cmd}" == *"--type="* ]] && continue
    [[ "${cmd}" == *"chrome_crashpad_handler"* ]] && continue
    exe="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
    [[ -n "${exe}" ]] || continue
    exe_base="$(basename "${exe}")"
    case "${exe_base}" in
      cursor|Cursor-*-x86_64.AppImage) ;;
      *) continue ;;
    esac
    if [[ "${exe}" != "${cursor_bin_resolved}" ]]; then
      conflicts+=("${pid}")
      echo "[cursor] stopping conflicting instance pid=${pid} exe=${exe}" >&2
    fi
  done < <(pgrep -af '/cursor' || true)

  ((${#conflicts[@]})) || return 0
  kill "${conflicts[@]}" 2>/dev/null || true
  sleep 1
  for pid in "${conflicts[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done
}

run_cursor() {
  local -a cmd=("$@")
  if [[ "${cursor_filter_noise}" == "1" ]]; then
    exec "${cmd[@]}" 2> >(
      grep -E -v \
        -e '^\(node:[0-9]+\) \[DEP0040\] DeprecationWarning: The `punycode` module is deprecated\.' \
        -e '^\[.*vaapi_wrapper\.cc:[0-9]+\] Installed VAAPI version is too old\.' \
        -e '^\[.*mime_util_xdg\.cc:[0-9]+\] Invalid mime\.cache file does not contain null prior to ALIAS_LIST_OFFSET=' \
      >&2
    )
  fi
  exec "${cmd[@]}"
}

# Keep Electron safe from shell-level overrides.
unset ELECTRON_RUN_AS_NODE
unset LD_LIBRARY_PATH
unset LIBRARY_PATH
unset LD_PRELOAD
unset NIX_LD
if [[ "${cursor_suppress_node_deprecations}" == "1" ]]; then
  export NODE_NO_WARNINGS=1
fi
stop_conflicting_cursor_instances
echo "[cursor] binary=${cursor_bin_resolved}"

if [[ "${render_mode}" == "safe" ]]; then
  unset LD_LIBRARY_PATH
  unset DRI_PRIME
  unset __NV_PRIME_RENDER_OFFLOAD
  unset __GLX_VENDOR_LIBRARY_NAME
  unset __VK_LAYER_NV_optimus
  export LIBGL_ALWAYS_SOFTWARE=1
  export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
  codium_cpuset="$(detect_cpuset_from_codium || true)"
  echo "[cursor] mode=safe (software render) cpuset=${codium_cpuset:-default}"
  if [[ -n "${codium_cpuset}" ]] && command -v taskset >/dev/null 2>&1; then
    run_cursor taskset -c "${codium_cpuset}" nice -n "${cursor_nice}" "$cursor_bin" \
      --ozone-platform=x11 \
      --disable-gpu \
      --disable-gpu-compositing \
      --use-gl=swiftshader \
      "$@"
  fi
  run_cursor nice -n "${cursor_nice}" "$cursor_bin" \
    --ozone-platform=x11 \
    --disable-gpu \
    --disable-gpu-compositing \
    --use-gl=swiftshader \
    "$@"
fi

# GPU mode: align with VSCodium runtime profile.
load_codium_env
if [[ "${gpu_backend}" == "auto" ]]; then
  gpu_backend="$(detect_backend_from_codium || true)"
  gpu_backend="${gpu_backend:-intel}"
fi

case "${gpu_backend}" in
  nvidia)
    export __NV_PRIME_RENDER_OFFLOAD=1
    export __GLX_VENDOR_LIBRARY_NAME=nvidia
    export __VK_LAYER_NV_optimus=NVIDIA_only
    export DRI_PRIME=1
    ;;
  intel|*)
    unset __NV_PRIME_RENDER_OFFLOAD
    unset __GLX_VENDOR_LIBRARY_NAME
    unset __VK_LAYER_NV_optimus
    unset DRI_PRIME
    ;;
esac

codium_cpuset="$(detect_cpuset_from_codium || true)"
echo "[cursor] mode=gpu backend=${gpu_backend} cpuset=${codium_cpuset:-default} (codium_pid=${codium_pid:-none})"
if [[ -n "${codium_cpuset}" ]] && command -v taskset >/dev/null 2>&1; then
  run_cursor taskset -c "${codium_cpuset}" nice -n "${cursor_nice}" "$cursor_bin" --ozone-platform=x11 "$@"
fi
run_cursor nice -n "${cursor_nice}" "$cursor_bin" --ozone-platform=x11 "$@"
