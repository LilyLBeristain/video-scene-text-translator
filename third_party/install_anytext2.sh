#!/usr/bin/env bash
# Install and run AnyText2 Gradio server for Stage A text editing.
#
# This runs AnyText2 in a SEPARATE conda env (anytext2, Python 3.10)
# to avoid dependency conflicts with the main vc_final env.
#
# Usage:
#   1. Run this script once to set up:
#        bash third_party/install_anytext2.sh
#
#   2. Start the server:
#        bash third_party/install_anytext2.sh serve
#
#   3. Configure the pipeline to use it:
#        text_editor:
#          backend: "anytext2"
#          server_url: "http://localhost:45843/"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${SCRIPT_DIR}/AnyText2"
CONDA_ENV="anytext2"
PORT="${ANYTEXT2_PORT:-45843}"

# ---- Helper ----
info() { echo -e "\033[1;34m[AnyText2]\033[0m $*"; }
err()  { echo -e "\033[1;31m[AnyText2 ERROR]\033[0m $*" >&2; exit 1; }

# ---- Serve mode ----
if [[ "${1:-}" == "serve" ]]; then
    if [[ ! -d "$INSTALL_DIR" ]]; then
        err "AnyText2 not installed. Run: bash $0"
    fi
    info "Starting AnyText2 Gradio server on port $PORT ..."
    eval "$(conda shell.bash hook)"
    conda activate "$CONDA_ENV"
    cd "$INSTALL_DIR"
    python demo.py --port "$PORT" --listen 0.0.0.0
    exit 0
fi

# ---- Install ----
info "Installing AnyText2 into $INSTALL_DIR"

# 1. Clone repo
if [[ -d "$INSTALL_DIR" ]]; then
    info "Repository already exists at $INSTALL_DIR, skipping clone"
else
    info "Cloning AnyText2 repository..."
    git clone https://github.com/tyxsspa/AnyText2.git "$INSTALL_DIR"
fi

# 2. Create conda env
eval "$(conda shell.bash hook)"
if conda env list | grep -q "^${CONDA_ENV} "; then
    info "Conda env '$CONDA_ENV' already exists, skipping creation"
else
    info "Creating conda env '$CONDA_ENV' from environment.yaml..."
    cd "$INSTALL_DIR"
    if [[ -f environment.yaml ]]; then
        conda env create -f environment.yaml -n "$CONDA_ENV"
    else
        info "No environment.yaml found, creating manually..."
        conda create -n "$CONDA_ENV" python=3.10 -y
        conda activate "$CONDA_ENV"
        pip install -r requirements.txt
    fi
fi

# 3. Download model weights
info "Model weights must be downloaded separately."
info "See: https://github.com/tyxsspa/AnyText2#download"
info "Place them in: $INSTALL_DIR/models/"

info ""
info "Setup complete!"
info "To start the server: bash $0 serve"
info "Default port: $PORT (override with ANYTEXT2_PORT env var)"
