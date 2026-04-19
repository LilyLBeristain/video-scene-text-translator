#!/usr/bin/env bash
# Dev convenience: runs the FastAPI backend (uvicorn --reload :8000) and the
# Vite frontend dev server (:5173) in parallel. Browse http://localhost:5173.
# Vite proxies /api/* to :8000 so CORS isn't a concern (plan.md D9).
#
# Ctrl+C stops both.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"

# Activate conda env if nothing is active; otherwise verify the active env
# is `vc_final`. A wrong env silently boots uvicorn against a Python that
# doesn't have FastAPI / torch / etc., producing cryptic import errors.
REQUIRED_ENV="vc_final"
if [[ -z "${CONDA_DEFAULT_ENV:-}" ]]; then
  if [[ -f /opt/miniforge3/bin/conda ]]; then
    # shellcheck disable=SC1091
    eval "$(/opt/miniforge3/bin/conda shell.bash hook)"
    conda activate "${REQUIRED_ENV}"
  elif [[ -f /opt/miniconda3/bin/conda ]]; then
    # shellcheck disable=SC1091
    eval "$(/opt/miniconda3/bin/conda shell.bash hook)"
    conda activate "${REQUIRED_ENV}"
  fi
elif [[ "${CONDA_DEFAULT_ENV}" != "${REQUIRED_ENV}" ]]; then
  echo "WARNING: CONDA_DEFAULT_ENV is '${CONDA_DEFAULT_ENV}', expected '${REQUIRED_ENV}'" >&2
  echo "         uvicorn may fail with ModuleNotFoundError if this env lacks FastAPI." >&2
  echo "         Deactivate and re-run, or: conda activate ${REQUIRED_ENV}" >&2
fi

# Activate nvm if available (Node)
if [[ -f /opt/nvm/nvm.sh ]]; then
  export NVM_DIR=/opt/nvm
  # shellcheck disable=SC1091
  source "${NVM_DIR}/nvm.sh"
fi

# Trap SIGINT/SIGTERM → kill both children
pids=()
cleanup() {
  for pid in "${pids[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  wait
}
trap cleanup INT TERM EXIT

echo "==> starting FastAPI (uvicorn :8000)"
(cd "${REPO_ROOT}" && python -m uvicorn server.app.main:app --host 0.0.0.0 --port 8000 --reload) &
pids+=($!)

echo "==> starting Vite (:5173)"
(cd "${REPO_ROOT}/web" && npm run dev -- --host) &
pids+=($!)

wait
