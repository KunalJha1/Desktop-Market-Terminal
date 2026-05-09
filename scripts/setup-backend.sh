#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$BACKEND_DIR/.venv"

# llama-cpp-python 0.3.x uses std::filesystem which requires macOS 10.15+,
# but its CMake defaults to 10.13. Force 11.0 (first ARM-native release).
export MACOSX_DEPLOYMENT_TARGET=11.0
export CMAKE_ARGS="-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0"

# Detect venv python path (cross-platform: Windows uses Scripts/, Unix uses bin/)
if [ -f "$VENV_DIR/Scripts/python.exe" ]; then
    VENV_PYTHON="$VENV_DIR/Scripts/python.exe"
elif [ -f "$VENV_DIR/bin/python" ]; then
    VENV_PYTHON="$VENV_DIR/bin/python"
else
    VENV_PYTHON=""
fi

# Fast path: venv already exists — sync requirements in case they changed
if [ -f "$VENV_DIR/pyvenv.cfg" ]; then
    if command -v uv &>/dev/null; then
        uv pip install -q -r "$BACKEND_DIR/requirements.txt" \
            || echo "[setup-backend] Warning: failed to sync requirements — some packages may be outdated"
    elif [ -n "$VENV_PYTHON" ] && [ -f "$VENV_PYTHON" ]; then
        "$VENV_PYTHON" -m pip install -q -r "$BACKEND_DIR/requirements.txt" \
            || echo "[setup-backend] Warning: failed to sync requirements — some packages may be outdated"
    else
        echo "[setup-backend] Warning: neither uv nor venv python found — skipping sync"
    fi
    exit 0
fi

echo "[setup-backend] Setting up Python backend environment..."

if ! command -v uv &>/dev/null; then
    echo "[setup-backend] 'uv' not found — installing automatically..."
    if command -v curl &>/dev/null; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v powershell &>/dev/null || command -v pwsh &>/dev/null; then
        PWSH=$(command -v pwsh 2>/dev/null || command -v powershell)
        "$PWSH" -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    else
        echo "[setup-backend] ERROR: cannot install uv — install it manually from https://docs.astral.sh/uv/"
        exit 1
    fi
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
