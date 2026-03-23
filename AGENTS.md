# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript UI, including pages, shared hooks, charting engine, and dashboard components.
- `src-tauri/`: Tauri desktop shell and native window/sidecar bootstrap logic.
- `backend/`: FastAPI sidecar, IBKR/Yahoo data workers, SQLite helpers, and backend tests.
- `data/`: static market metadata such as `tickers.json` and `etfs.json`.
- `public/`: bundled brand assets and logos.
- `backend/tests/`: Python regression tests; keep new backend tests here.

## Build, Test, and Development Commands
- `npm install`: install frontend and Tauri JS dependencies.
- `npm run dev`: start the Vite frontend.
- `npm run build`: run TypeScript compile and production build.
- `npm run tauri dev`: launch the desktop app with the Tauri shell.
- `python3 backend/main.py --port 18100`: run the FastAPI sidecar directly.
- `python3 backend/worker_watchlist.py`: run the background market-data worker directly.
- `python3 -m py_compile backend/main.py backend/worker_watchlist.py backend/db_utils.py`: quick backend syntax check before committing.

## Coding Style & Naming Conventions
- TypeScript uses 2-space indentation, React function components, and `camelCase` for variables/hooks.
- Python uses 4-space indentation, type hints where practical, and `snake_case` for functions/modules.
- Prefer explicit, descriptive names: `use-market-data.ts`, `worker_watchlist.py`, `HeatmapPage.tsx`.
- Keep changes aligned with existing patterns; do not introduce a new framework or formatter ad hoc.

## Testing Guidelines
- Frontend changes should at minimum pass `npm run build`.
- Backend changes should pass targeted syntax checks and relevant regression tests in `backend/tests/`.
- Name Python tests `test_*.py`.
- For IBKR-dependent behavior, prefer small regression tests plus manual smoke validation against TWS/Gateway.

## Commit & Pull Request Guidelines
- Current history uses plain-English, descriptive commit messages rather than strict Conventional Commits.
- Keep commit subjects specific and scoped, for example: `Add market snapshot endpoint for heatmap`.
- PRs should include:
- a short summary of user-visible behavior
- affected areas (`src/`, `backend/`, `src-tauri/`)
- validation performed (`npm run build`, `py_compile`, manual TWS check)
- screenshots or screen recordings for UI changes

## Security & Configuration Tips
- Do not commit credentials, tokens, or local IBKR account details.
- Treat `data/market.db` and TWS connection settings as local runtime state.
- Prefer the existing client ID manager and sidecar worker flow over hard-coded IB client IDs.
