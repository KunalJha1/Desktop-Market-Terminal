import { useState, useEffect } from "react";
import { type as osType } from "@tauri-apps/api/os";

interface PlatformInfo {
  isMac: boolean;
  isWindows: boolean;
  ready: boolean;
}

let cached: PlatformInfo | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_IPC__" in window;
}

function detectFallback(): PlatformInfo {
  const ua = navigator.platform?.toLowerCase() ?? "";
  const isMac = ua.includes("mac");
  const isWindows = ua.includes("win");
  return { isMac, isWindows, ready: true };
}

export function usePlatform(): PlatformInfo {
  const [platform, setPlatform] = useState<PlatformInfo>(
    cached ?? { isMac: false, isWindows: false, ready: false },
  );

  useEffect(() => {
    if (cached) {
      setPlatform(cached);
      return;
    }

    osType()
      .then((t) => {
        cached = {
          isMac: t === "Darwin",
          isWindows: t === "Windows_NT",
          ready: true,
        };
        setPlatform(cached);
      })
      .catch(() => {
        // Tauri runtime not available (e.g. Vite dev in browser)
        cached = detectFallback();
        setPlatform(cached);
      });
  }, []);

  return platform;
}
