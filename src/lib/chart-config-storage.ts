import { open, save } from "@tauri-apps/api/dialog";
import { appDataDir } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";
import type { DailyIqChartFile } from "./chart-config";
import { createDailyIqChartFile, parseDailyIqChartFile } from "./chart-config";
import { isTauriRuntime } from "./platform";

export type ChartConfigImportResult =
  | { status: "success"; file: DailyIqChartFile }
  | { status: "canceled" }
  | { status: "invalid" }
  | { status: "error" };

export async function importChartConfigFromFile(): Promise<ChartConfigImportResult> {
  if (!isTauriRuntime()) return { status: "error" };

  try {
    const defaultDir = await appDataDir();
    const selected = await open({
      defaultPath: defaultDir,
      filters: [{ name: "DailyIQ Chart", extensions: ["diqc"] }],
      multiple: false,
    });
    if (typeof selected !== "string") return { status: "canceled" };
    const content = await readTextFile(selected);
    const file = parseDailyIqChartFile(content);
    return file ? { status: "success", file } : { status: "invalid" };
  } catch (err) {
    console.error("Failed to import chart config:", err);
    return { status: "error" };
  }
}

export async function exportChartConfigToFile(config: DailyIqChartFile["chart"]): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    const defaultDir = await appDataDir();
    const filePath = await save({
      defaultPath: `${defaultDir}chart.diqc`,
      filters: [{ name: "DailyIQ Chart", extensions: ["diqc"] }],
    });
    if (typeof filePath !== "string") return false;

    const file = createDailyIqChartFile(config);
    await writeTextFile(filePath, JSON.stringify(file, null, 2));
    return true;
  } catch (err) {
    console.error("Failed to export chart config:", err);
    return false;
  }
}
