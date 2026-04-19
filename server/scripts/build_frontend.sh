#!/usr/bin/env bash
# Build the React frontend and copy the dist bundle to server/app/static/
# so FastAPI can serve it at `/` in production / demo mode (plan.md Step 15, D9).
#
# Usage (from repo root or anywhere):
#   ./server/scripts/build_frontend.sh [--ci]
#
# --ci uses `npm ci` (strict lockfile) instead of `npm install` — recommended
# in CI and when checking out a fresh clone.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"
WEB_DIR="${REPO_ROOT}/web"
STATIC_DIR="${REPO_ROOT}/server/app/static"

install_cmd="install"
if [[ "${1:-}" == "--ci" ]]; then
  install_cmd="ci"
fi

# Node via nvm (on this box). Users outside this box should have node 20+ on PATH.
if [[ -z "${NVM_DIR:-}" && -f /opt/nvm/nvm.sh ]]; then
  export NVM_DIR=/opt/nvm
fi
if [[ -n "${NVM_DIR:-}" && -f "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "${NVM_DIR}/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not on PATH — install Node 20+ or source nvm first" >&2
  exit 1
fi
node_major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [[ "${node_major}" -lt 20 ]]; then
  echo "node >= 20 required, found ${node_major}" >&2
  exit 1
fi

echo "==> Installing web deps (npm ${install_cmd})"
cd "${WEB_DIR}"
npm "${install_cmd}"

echo "==> Building web/dist"
npm run build

echo "==> Replacing ${STATIC_DIR}"
# Atomic swap: stage the new bundle next to the live one, then `mv` over it.
# `mv` across paths on the same filesystem is a rename(2), which is atomic
# from any concurrent reader's perspective — so a uvicorn serving requests
# during the rebuild never sees the in-between "no static dir" state that
# `rm -rf && cp -r` would expose.
STAGING_DIR="${STATIC_DIR}.new"
OLD_DIR="${STATIC_DIR}.old"
rm -rf "${STAGING_DIR}" "${OLD_DIR}"
cp -r "${WEB_DIR}/dist" "${STAGING_DIR}"
# Two-step rename so we can roll back cleanly if the new dir is malformed.
if [[ -d "${STATIC_DIR}" ]]; then
  mv "${STATIC_DIR}" "${OLD_DIR}"
fi
mv "${STAGING_DIR}" "${STATIC_DIR}"
rm -rf "${OLD_DIR}"

echo "==> Done. Static bundle at: ${STATIC_DIR}"
ls -la "${STATIC_DIR}" | head -20
