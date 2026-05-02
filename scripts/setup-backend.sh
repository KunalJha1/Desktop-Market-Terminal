#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$BACKEND_DIR/.venv"

# Fast path: venv already exists — sync requirements in case they changed
if [ -f "$VENV_DIR/pyvenv.cfg" ]; then
    uv pip install -q -r "$BACKEND_DIR/requirements.txt" 2>/dev/null || true
    exit 0
fi

echo "[setup-backend] Setting up Python backend environment..."

if ! command -v uv &>/dev/null; then
    echo "[setup-backend] 'uv' not found — installing automatically..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Add uv to PATH for the rest of this script
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "[setup-backend] Installing Python 3.12..."
uv python install 3.12

echo "[setup-backend] Creating virtual environment..."
cd "$BACKEND_DIR"
uv venv --python 3.12

echo "[setup-backend] Installing dependencies..."
uv pip install -r requirements.txt

echo "[setup-backend] Done."
