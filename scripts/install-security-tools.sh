#!/usr/bin/env bash
set -euo pipefail

dest="${1:?usage: install-security-tools.sh <destination-bin-dir> [betterleaks] [zizmor] [actionlint]}"
shift

mkdir -p "${dest}"

if [[ "$#" -eq 0 ]]; then
  set -- betterleaks zizmor actionlint
fi

install_tarball() {
  local tool="$1"
  local url="$2"
  local expected_sha256="$3"
  local tmp archive extracted binary

  tmp="$(mktemp -d)"
  archive="${tmp}/archive.tar.gz"
  extracted="${tmp}/extracted"
  mkdir -p "${extracted}"

  curl --fail --location --silent --show-error "${url}" -o "${archive}"
  printf '%s  %s\n' "${expected_sha256}" "${archive}" | sha256sum --check --status
  tar -xzf "${archive}" -C "${extracted}"

  binary="$(find "${extracted}" -type f -name "${tool}" -print -quit)"
  if [[ -z "${binary}" ]]; then
    echo "Could not find ${tool} in verified archive ${url}" >&2
    rm -rf "${tmp}"
    exit 1
  fi

  install -m 0755 "${binary}" "${dest}/${tool}"
  rm -rf "${tmp}"
}

for tool in "$@"; do
  case "${tool}" in
    betterleaks)
      install_tarball         betterleaks         "https://github.com/betterleaks/betterleaks/releases/download/v1.10.0/betterleaks_1.10.0_linux_x64.tar.gz"         "9d9ad503cd5d80d18a939352266c3fcca52f10da9b83cd5cfe646989b13940fe"
      ;;
    zizmor)
      install_tarball         zizmor         "https://github.com/zizmorcore/zizmor/releases/download/v1.32.0/zizmor-x86_64-unknown-linux-gnu.tar.gz"         "bb110cc765eca9cd7efb2e284a956be5974c60027b0970f16397d86208a9957b"
      ;;
    actionlint)
      install_tarball         actionlint         "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz"         "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
      ;;
    *)
      echo "Unknown security tool: ${tool}" >&2
      exit 2
      ;;
  esac
done
