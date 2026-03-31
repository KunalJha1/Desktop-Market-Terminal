import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getSupabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";
import { open } from "@tauri-apps/api/shell";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "./platform";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
}

function readCachedSession(): Session | null {
  try {
    const raw = window.localStorage.getItem("dailyiq-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.access_token && parsed?.user) return parsed as Session;
  } catch { /* corrupted or missing */ }
  return null;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  authError: null,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = readCachedSession();
  const [session, setSession] = useState<Session | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [authError, setAuthError] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);

    if (!isTauriRuntime()) {
      setAuthError("Google sign-in is only available in the desktop app.");
      return;
    }

    // Start a local HTTP server to receive the OAuth callback
    let port: number;
    try {
      port = await invoke<number>("start_oauth_server");
    } catch (e) {
      // Port likely already in use from a previous click
      console.warn("[auth] OAuth server already running, reusing port");
      port = 17284;
    }

    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        skipBrowserRedirect: true,
        redirectTo: `http://localhost:${port}/callback`,
      },
    });

    if (error) {
      console.error("Google OAuth error:", error.message);
      setAuthError(error.message);
      return;
    }

    if (!data.url) {
      console.error("[auth] No OAuth URL returned — check VITE_SUPABASE_ANON_KEY in .env");
      setAuthError("Unable to start Google sign-in. Check your configuration.");
      return;
    }

    await open(data.url);
  }, []);

  useEffect(() => {
    getSupabase().auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch((error) => {
        console.error("[auth] Failed to load session:", error);
        setAuthError("Unable to initialize authentication.");
      })
      .finally(() => {
        setLoading(false);
      });

    const {
      data: { subscription },
    } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // Handle OAuth tokens from the Rust side and set the Supabase session
    let handled = false;
    const handleTokens = async (tokens: OAuthTokens) => {
      if (handled) return; // prevent double-handling from both listeners
      handled = true;
      console.log("[auth] Received OAuth tokens, setting session...");
      const { data, error } = await getSupabase().auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) {
        console.error("[auth] Failed to set session:", error.message);
        handled = false; // allow retry from the other listener
      } else {
        console.log("[auth] Session set, user:", data.session?.user?.email);
        setSession(data.session);
      }
    };

    // Primary: DOM CustomEvent injected by Rust via window.eval()
    const onDomEvent = (e: Event) => {
      const detail = (e as CustomEvent<OAuthTokens>).detail;
      if (detail?.access_token && detail?.refresh_token) {
        handleTokens(detail);
      }
    };
    window.addEventListener("oauth-tokens", onDomEvent);

    // Fallback: Tauri event system
    const unlisten = isTauriRuntime()
      ? listen<OAuthTokens>("oauth-callback", (event) => {
          if (event.payload?.access_token && event.payload?.refresh_token) {
            handleTokens(event.payload);
          }
        })
      : Promise.resolve(() => {});

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("oauth-tokens", onDomEvent);
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, authError, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
