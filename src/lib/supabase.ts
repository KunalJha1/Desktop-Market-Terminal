import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/tauri";
import { isTauriRuntime } from "./platform";

let _supabase: SupabaseClient | null = null;

export async function initSupabase(): Promise<void> {
  if (_supabase) return;

  let supabaseUrl: string;
  let supabaseAnonKey: string;

  if (isTauriRuntime()) {
    const config = await invoke<{ supabaseUrl: string; supabaseAnonKey: string }>(
      "get_app_config"
    );
    supabaseUrl = config.supabaseUrl;
    supabaseAnonKey = config.supabaseAnonKey;
  } else {
    // Dev/browser fallback — uses Vite env vars if present
    supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
    supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  }

  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "dailyiq-auth",
      storage: window.localStorage,
    },
  });
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) throw new Error("Supabase not initialized — call initSupabase() first");
  return _supabase;
}
