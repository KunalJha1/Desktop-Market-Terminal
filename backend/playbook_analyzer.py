"""Playbook rules compliance analyzer using a locally-cached GGUF model."""

import logging
import threading
from pathlib import Path

import requests

from runtime_paths import data_dir

logger = logging.getLogger(__name__)

MODEL_REPO_ID = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
MODEL_FILENAME = "qwen2.5-0.5b-instruct-q4_k_m.gguf"
_DOWNLOAD_URL = (
    f"https://huggingface.co/{MODEL_REPO_ID}/resolve/main/{MODEL_FILENAME}"
)


def _models_dir() -> Path:
    return data_dir() / "models"


def _model_path() -> Path:
    return _models_dir() / MODEL_FILENAME


class PlaybookAnalyzer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._status = "not_downloaded"
        self._progress = 0
        self._error = ""
        self._llm = None

        if _model_path().exists():
            self._status = "ready"
            self._progress = 100

    def get_status(self) -> dict:
        with self._lock:
            return {
                "status": self._status,
                "progress": self._progress,
                "error": self._error,
                "model_filename": MODEL_FILENAME,
            }

    def start_download(self) -> bool:
        with self._lock:
            if self._status in ("downloading", "ready"):
                return False
            self._status = "downloading"
            self._progress = 0
            self._error = ""
        threading.Thread(target=self._download_worker, daemon=True).start()
        return True

    def _download_worker(self) -> None:
        dest = _model_path()
        tmp = dest.with_suffix(".tmp")
        try:
            _models_dir().mkdir(parents=True, exist_ok=True)
            r = requests.get(_DOWNLOAD_URL, stream=True, timeout=60)
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            downloaded = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        with self._lock:
                            self._progress = min(99, int(downloaded / total * 100))
            tmp.rename(dest)
            with self._lock:
                self._status = "ready"
                self._progress = 100
            logger.info("Playbook model downloaded to %s", dest)
        except Exception as exc:
            logger.error("Model download failed: %s", exc)
            tmp.unlink(missing_ok=True)
            with self._lock:
                self._status = "error"
                self._error = str(exc)

    def _load_llm(self) -> None:
        if self._llm is not None:
            return
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise RuntimeError("llama-cpp-python is not installed") from exc
        self._llm = Llama(
            model_path=str(_model_path()),
            n_ctx=2048,
            n_gpu_layers=-1,
            verbose=False,
        )

    def analyze(self, rules: str, market_context: dict) -> str:
        with self._lock:
            if self._status != "ready":
                raise RuntimeError(f"Model not ready (status={self._status})")
        self._load_llm()
        context_text = _format_market_context(market_context)
        user_msg = (
            f"Trading rules:\n{rules}\n\n"
            f"Current market context:\n{context_text}\n\n"
            "Write a short paragraph (3–5 sentences) assessing whether these trading rules "
            "are currently being followed or are at risk of being violated based on the data above. "
            "Be direct, specific, and concise."
        )
        resp = self._llm.create_chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a concise trading rules compliance monitor. "
                        "You receive a trader's personal rules and live market context, "
                        "then summarize rule compliance in plain English. "
                        "Be direct, specific, and brief."
                    ),
                },
                {"role": "user", "content": user_msg},
            ],
            max_tokens=350,
            temperature=0.3,
        )
        return resp["choices"][0]["message"]["content"].strip()


def _format_market_context(ctx: dict) -> str:
    lines: list[str] = []

    vix = ctx.get("vix")
    if vix is not None:
        regime = "elevated" if vix > 25 else "normal" if vix > 15 else "low"
        lines.append(f"VIX: {vix:.2f} ({regime} volatility)")

    portfolio = ctx.get("portfolio") or {}
    positions = portfolio.get("positions") or []
    if positions:
        lines.append(f"Open positions: {len(positions)}")
        oversized = [p for p in positions if abs(float(p.get("pctOfPortfolio") or 0)) > 12]
        if oversized:
            syms = ", ".join(p["symbol"] for p in oversized[:5])
            lines.append(f"  Oversized (>12% of portfolio): {syms}")
        avg_pnl = sum(float(p.get("unrealizedPnl") or 0) for p in positions) / len(positions)
        lines.append(f"  Avg unrealized P&L per position: ${avg_pnl:+,.0f}")

    watchlist = ctx.get("watchlist_quotes") or []
    if watchlist:
        movers = sorted(watchlist, key=lambda q: abs(float(q.get("changePercent") or 0)), reverse=True)
        summary = ", ".join(
            f"{q['symbol']} {float(q.get('changePercent', 0)):+.1f}%"
            for q in movers[:6]
        )
        lines.append(f"Watchlist movers: {summary}")

    tech_scores = ctx.get("tech_scores") or {}
    if tech_scores:
        valid = [v for v in tech_scores.values() if v is not None]
        if valid:
            avg = sum(valid) / len(valid)
            lines.append(f"Avg 1D tech score: {avg:.0f}/100 across {len(valid)} symbols")

    return "\n".join(lines) if lines else "No market data available."


_analyzer: PlaybookAnalyzer | None = None
_init_lock = threading.Lock()


def get_analyzer() -> PlaybookAnalyzer:
    global _analyzer
    if _analyzer is None:
        with _init_lock:
            if _analyzer is None:
                _analyzer = PlaybookAnalyzer()
    return _analyzer
