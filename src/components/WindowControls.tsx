import { useEffect, useState, useCallback } from "react";
import { appWindow } from "@tauri-apps/api/window";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);

    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMaxToggle = useCallback(async () => {
    const isMax = await appWindow.isMaximized();
    if (isMax) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  }, []);

  return (
    <div data-no-drag className="flex items-center">
      {/* Minimize */}
      <button
        onClick={() => appWindow.minimize()}
        className="flex h-8 w-11 items-center justify-center text-white/40 transition-colors duration-75 hover:bg-white/[0.08] hover:text-white/70"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={handleMaxToggle}
        className="flex h-8 w-11 items-center justify-center text-white/40 transition-colors duration-75 hover:bg-white/[0.08] hover:text-white/70"
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M2 0h6v2h2v6H8v2H0V4h2V0zm1 1v2h5v5h1V2H3zm-2 3v5h6V4H1z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        onClick={() => appWindow.close()}
        className="flex h-8 w-11 items-center justify-center text-white/40 transition-colors duration-75 hover:bg-[#c42b1c] hover:text-white"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            d="M1 0L5 4L9 0L10 1L6 5L10 9L9 10L5 6L1 10L0 9L4 5L0 1Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
