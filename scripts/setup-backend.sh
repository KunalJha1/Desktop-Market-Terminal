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

_install_core() {
    local installer="$1"  # "uv" or path to venv python
    if [ "$installer" = "uv" ]; then
        uv pip install -q -r "$BACKEND_DIR/requirements.txt" \
            || { echo "[setup-backend] Warning: failed to sync core requirements"; return 1; }
        uv pip install -q -r "$BACKEND_DIR/requirements-ml.txt" \
            || echo "[setup-backend] Note: ML packages (llama-cpp-python) not installed — AI features disabled"
    else
        "$installer" -m pip install -q -r "$BACKEND_DIR/requirements.txt" \
            || { echo "[setup-backend] Warning: failed to sync core requirements"; return 1; }
        "$installer" -m pip install -q -r "$BACKEND_DIR/requirements-ml.txt" \
            || echo "[setup-backend] Note: ML packages (llama-cpp-python) not installed — AI features disabled"
    fi
}

# Detect venv python path (cross-platform: Windows uses Scripts/, Unix uses bin/)
if [ -f "$VENV_DIR/Scripts/python.exe" ]; then
    VENV_PYTHON="$VENV_DIR/Scripts/python.exe"
elif [ -f "$VENV_DIR/bin/python" ]; then
    VENV_PYTHON="$VENV_DIR/bin/python"
else
    VENV_PYTHON=""
fi

# Fast path: venv already exists — verify it's healthy, then sync requirements
if [ -f "$VENV_DIR/pyvenv.cfg" ]; then
    # Sanity-check: can the venv python actually import a stdlib module?
    VENV_HEALTHY=0
    if [ -n "$VENV_PYTHON" ] && [ -f "$VENV_PYTHON" ]; then
        "$VENV_PYTHON" -c "import sys" 2>/dev/null && VENV_HEALTHY=1
    fi

    # Also check for corrupted site-packages (invalid distributions like ~ip)
    PACKAGES_HEALTHY=0
    if [ "$VENV_HEALTHY" = "1" ]; then
        "$VENV_PYTHON" -c "import httpx, fastapi" 2>/dev/null && PACKAGES_HEALTHY=1
    fi

    if [ "$VENV_HEALTHY" = "0" ] || [ "$PACKAGES_HEALTHY" = "0" ]; then
        echo "[setup-backend] Venv is broken or missing packages — rebuilding automatically..."
        rm -rf "$VENV_DIR"
        # Fall through to full setup below
    else
        if command -v uv &>/dev/null; then
            _install_core "uv"
        else
            _install_core "$VENV_PYTHON"
        fi
        exit 0
    fi
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
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "[setup-backend] Installing Python 3.12..."
uv python install 3.12

echo "[setup-backend] Creating virtual environment..."
cd "$BACKEND_DIR"
uv venv --python 3.12 --clear

echo "[setup-backend] Installing dependencies..."
_install_core "uv"

echo "[setup-backend] Done."
