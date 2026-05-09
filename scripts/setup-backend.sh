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

# uv installs to ~/.local/bin — add it to PATH so subsequent runs find it
export PATH="$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------
# _kill_python_windows: release venv file locks on Windows before rm/venv ops
# ---------------------------------------------------------------------------
_kill_python_windows() {
    if command -v taskkill &>/dev/null; then
        taskkill //F //IM python.exe //T 2>/dev/null || true
        taskkill //F //IM python3.exe //T 2>/dev/null || true
        sleep 1
    fi
}

# ---------------------------------------------------------------------------
# _ensure_uv: install uv if missing
# ---------------------------------------------------------------------------
_ensure_uv() {
    if command -v uv &>/dev/null; then
        return 0
    fi
    echo "[setup-backend] 'uv' not found — installing automatically..."
    if command -v curl &>/dev/null; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v powershell &>/dev/null || command -v pwsh &>/dev/null; then
        PWSH=$(command -v pwsh 2>/dev/null || command -v powershell)
        "$PWSH" -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    else
        echo "[setup-backend] ERROR: cannot install uv — install it from https://docs.astral.sh/uv/"
        exit 1
    fi
    # Refresh PATH in case uv landed somewhere other than ~/.local/bin
    export PATH="$HOME/.local/bin:$HOME/AppData/Local/uv/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        echo "[setup-backend] ERROR: uv install succeeded but uv not found in PATH"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# _install_requirements: install packages into VENV_DIR
# VIRTUAL_ENV export makes uv target the right env without needing cd
# ---------------------------------------------------------------------------
_install_requirements() {
    export VIRTUAL_ENV="$VENV_DIR"
    echo "[setup-backend] Installing core packages..."
    uv pip install -q -r "$BACKEND_DIR/requirements.txt"
    echo "[setup-backend] Installing ML packages (optional)..."
    uv pip install -q -r "$BACKEND_DIR/requirements-ml.txt" \
        || echo "[setup-backend] Note: ML packages (llama-cpp-python) not installed — AI features disabled"
}

# ---------------------------------------------------------------------------
# _build_venv: create a fresh venv and install everything
# ---------------------------------------------------------------------------
_build_venv() {
    _ensure_uv
    _kill_python_windows
    echo "[setup-backend] Installing Python 3.12..."
    uv python install 3.12
    echo "[setup-backend] Creating virtual environment..."
    uv venv "$VENV_DIR" --python 3.12 --clear
    _install_requirements
    echo "[setup-backend] Done."
}

# ---------------------------------------------------------------------------
# Detect venv python (cross-platform)
# ---------------------------------------------------------------------------
_find_venv_python() {
    if [ -f "$VENV_DIR/Scripts/python.exe" ]; then
        echo "$VENV_DIR/Scripts/python.exe"
    elif [ -f "$VENV_DIR/bin/python" ]; then
        echo "$VENV_DIR/bin/python"
    else
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------
if [ ! -f "$VENV_DIR/pyvenv.cfg" ]; then
    # No venv at all — fresh install
    echo "[setup-backend] Setting up Python backend environment..."
    _build_venv
    exit 0
fi

VENV_PYTHON="$(_find_venv_python)"

# Check 1: venv python itself works
VENV_HEALTHY=0
if [ -n "$VENV_PYTHON" ] && "$VENV_PYTHON" -c "import sys" 2>/dev/null; then
    VENV_HEALTHY=1
fi

# Check 2: core packages are importable (catches corrupted/missing installs)
PACKAGES_HEALTHY=0
if [ "$VENV_HEALTHY" = "1" ] && "$VENV_PYTHON" -c "import httpx, fastapi, uvicorn" 2>/dev/null; then
    PACKAGES_HEALTHY=1
fi

if [ "$VENV_HEALTHY" = "0" ] || [ "$PACKAGES_HEALTHY" = "0" ]; then
    echo "[setup-backend] Venv is broken or incomplete — rebuilding automatically..."
    _kill_python_windows
    rm -rf "$VENV_DIR"
    _build_venv
    exit 0
fi

# Venv is healthy — just sync requirements in case they changed
echo "[setup-backend] Syncing requirements..."
_ensure_uv
_install_requirements
echo "[setup-backend] Done."
