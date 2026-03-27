#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::api::process::{Command as SidecarCommand, CommandChild as SidecarChild};
use tauri::{AppHandle, Manager};

const OAUTH_CALLBACK_PORT: u16 = 17284;

/// Inline SVG logo for the OAuth callback pages
const LOGO_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 380 120"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#2563eb"/></linearGradient></defs><g transform="translate(20,20)"><circle cx="32" cy="32" r="30" fill="url(#g)"/><path d="M 20 38 Q 24 30 28 32 T 36 28 T 44 24" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M 20 44 Q 24 38 28 40 T 36 36 T 44 34" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.6"/><circle cx="44" cy="24" r="3" fill="#fff"/></g><text x="110" y="62" font-size="56" font-weight="900" font-family="system-ui,-apple-system,sans-serif" fill="#fff">DAILY<tspan fill="#3b82f6">IQ</tspan></text><text x="112" y="92" font-size="14" font-weight="600" letter-spacing="0.2em" font-family="system-ui,-apple-system,sans-serif" fill="#cbd5e1">STOCK INTELLIGENCE</text></svg>"##;

/// Shared CSS for callback pages
const PAGE_STYLE: &str = r##"*{margin:0;padding:0;box-sizing:border-box}body{background:#0D1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}.card{background:#161B22;border:1px solid #30363d;border-radius:12px;padding:48px 56px;text-align:center;max-width:420px;width:90%}.logo{margin-bottom:32px}.status{color:#8b949e;font-size:14px;margin-top:16px}.spinner{display:inline-block;width:24px;height:24px;border:3px solid #30363d;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px}@keyframes spin{to{transform:rotate(360deg)}}.check{display:inline-block;width:48px;height:48px;border-radius:50%;background:#00C853;margin-bottom:16px;position:relative}.check::after{content:'';position:absolute;left:16px;top:10px;width:14px;height:24px;border:solid #fff;border-width:0 3px 3px 0;transform:rotate(45deg)}"##;

/// HTML page that reads tokens from the URL fragment and sends them back
const RELAY_HTML: &str = r##"HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Connection: close

<!DOCTYPE html>
<html>
<head><title>DailyIQ — Signing In</title><style>PAGESTYLE</style></head>
<body>
<div class="card">
  <div class="logo">LOGOSVG</div>
  <div class="spinner"></div>
  <p class="status" id="msg">Signing you in...</p>
</div>
<script>
const hash = window.location.hash.substring(1);
if (hash) {
  window.location.replace('/token?' + hash);
} else {
  document.getElementById('msg').textContent = 'Authentication failed — no tokens received.';
}
</script>
</body>
</html>"##;

const SUCCESS_HTML: &str = r##"HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Connection: close

<!DOCTYPE html>
<html>
<head><title>DailyIQ — Signed In</title><style>PAGESTYLE</style></head>
<body>
<div class="card">
  <div class="logo">LOGOSVG</div>
  <div class="check"></div>
  <p class="status">Signed in successfully. You can close this tab.</p>
</div>
<script>setTimeout(()=>window.close(),2000)</script>
</body>
</html>"##;

fn extract_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        if kv.next()? == key {
            return kv.next();
        }
    }
    None
}

#[tauri::command]
fn start_oauth_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", OAUTH_CALLBACK_PORT))
        .map_err(|e| format!("Failed to start OAuth listener: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    std::thread::spawn(move || {
        let relay_page = RELAY_HTML
            .replace("PAGESTYLE", PAGE_STYLE)
            .replace("LOGOSVG", LOGO_SVG);
        let success_page = SUCCESS_HTML
            .replace("PAGESTYLE", PAGE_STYLE)
            .replace("LOGOSVG", LOGO_SVG);

        let empty_response = b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";

        // Set a timeout so this thread doesn't hang forever if the user
        // closes the browser tab before completing the flow.
        listener
            .set_nonblocking(false)
            .ok();

        // Loop to handle requests — browsers send extra requests (favicon, etc.)
        // that we need to skip past to reach the /token request.
        let mut got_tokens = false;
        for _ in 0..10 {
            let (mut stream, _) = match listener.accept() {
                Ok(conn) => conn,
                Err(_) => break,
            };

            let mut buf = [0u8; 16384];
            let n = match stream.read(&mut buf) {
                Ok(n) => n,
                Err(_) => continue,
            };

            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");

            if path.starts_with("/callback") {
                // Serve the relay page that reads the fragment and redirects
                let _ = stream.write_all(relay_page.as_bytes());
                let _ = stream.flush();
            } else if path.starts_with("/token?") {
                // Extract tokens from query params
                let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
                let access_token = extract_param(query, "access_token")
                    .unwrap_or_default()
                    .to_string();
                let refresh_token = extract_param(query, "refresh_token")
                    .unwrap_or_default()
                    .to_string();

                let _ = stream.write_all(success_page.as_bytes());
                let _ = stream.flush();
                drop(stream);

                if !access_token.is_empty() && !refresh_token.is_empty() {
                    let payload = serde_json::json!({
                        "access_token": access_token,
                        "refresh_token": refresh_token,
                    });

                    // Primary: inject tokens directly into the webview via eval
                    // (bypasses Tauri event system which can silently fail)
                    if let Some(window) = app_handle.get_window("main") {
                        let json = serde_json::to_string(&payload).unwrap_or_default();
                        let js = format!(
                            "window.dispatchEvent(new CustomEvent('oauth-tokens', {{ detail: {} }}));",
                            json
                        );
                        let _ = window.eval(&js);
                        let _ = window.set_focus();
                    }

                    // Fallback: also emit via Tauri event system
                    let _ = app_handle.emit_all("oauth-callback", payload);
                }
                got_tokens = true;
                break;
            } else {
                // Favicon, preflight, or other browser request — ignore
                let _ = stream.write_all(empty_response);
                let _ = stream.flush();
            }
        }

        if !got_tokens {
            eprintln!("OAuth server: timed out waiting for tokens");
        }
    });

    Ok(port)
}

#[derive(serde::Serialize)]
struct ProbeResult {
    port: u16,
    connection_type: String,
}

#[tauri::command]
fn probe_tws_ports() -> Option<ProbeResult> {
    let ports: [(u16, &str); 4] = [
        (7496, "tws-live"),
        (7497, "tws-paper"),
        (4001, "gateway-live"),
        (4002, "gateway-paper"),
    ];

    for (port, conn_type) in &ports {
        let addr: SocketAddr = ([127, 0, 0, 1], *port).into();
        if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
            return Some(ProbeResult {
                port: *port,
                connection_type: conn_type.to_string(),
            });
        }
    }
    None
}

/// Spawn a detached tab as a new native window (drag-out support)
#[tauri::command]
fn spawn_tab_window(
    app_handle: tauri::AppHandle,
    label: String,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let url = tauri::WindowUrl::App("index.html".into());
    let builder = tauri::WindowBuilder::new(&app_handle, &label, url)
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(800.0, 600.0)
        .position(x, y);

    #[cfg(target_os = "windows")]
    let builder = builder.decorations(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    Ok(())
}

enum ManagedChild {
    System(Child),
    Sidecar(SidecarChild),
}

impl ManagedChild {
    /// Returns true if the process has already exited.
    /// Only works for System children; Sidecar children always return false.
    fn has_exited(&mut self) -> bool {
        match self {
            ManagedChild::System(child) => child.try_wait().ok().flatten().is_some(),
            ManagedChild::Sidecar(_) => false,
        }
    }

    /// Kill the entire process tree rooted at `pid`.
    /// On Windows, uses `taskkill /F /T` (blocking) to terminate all descendants.
    /// On Unix, sends SIGKILL to the process group via `kill -- -<pid>`.
    fn kill_tree(pid: u32) {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(&["/F", "/T", "/PID", &pid.to_string()])
                .output(); // .output() blocks until taskkill exits
        }
        #[cfg(not(target_os = "windows"))]
        {
            // Negative PID targets the process group. Only works if the child
            // was spawned as a group leader (setsid / setpgid), otherwise falls
            // back to killing just the direct process — still an improvement.
            let _ = Command::new("kill")
                .args(&["--", &format!("-{}", pid)])
                .output();
        }
    }

    fn kill(self) {
        match self {
            ManagedChild::System(mut child) => {
                let pid = child.id();
                Self::kill_tree(pid);
                let _ = child.kill();
                let _ = child.wait();
            }
            ManagedChild::Sidecar(child) => {
                let pid = child.pid();
                Self::kill_tree(pid);
                let _ = child.kill();
            }
        }
    }
}

struct SidecarState {
    child: Mutex<Option<ManagedChild>>,
    worker_child: Mutex<Option<ManagedChild>>,
    valuation_worker_child: Mutex<Option<ManagedChild>>,
    port: Mutex<Option<u16>>,
}

/// Find a backend script in the source tree for local dev runs.
fn find_backend_script() -> Option<PathBuf> {
    // Try common locations relative to the executable
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        // Walk up to 5 levels to find the project root
        for _ in 0..5 {
            if let Some(ref d) = dir {
                let candidate = d.join("backend").join("main.py");
                if candidate.exists() {
                    return Some(candidate);
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    // Also try CWD-relative as a fallback
    let cwd_candidate = PathBuf::from("backend/main.py");
    if cwd_candidate.exists() {
        return Some(cwd_candidate);
    }
    None
}

fn find_worker_script() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(ref d) = dir {
                let candidate = d.join("backend").join("worker_watchlist.py");
                if candidate.exists() {
                    return Some(candidate);
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    let cwd_candidate = PathBuf::from("backend/worker_watchlist.py");
    if cwd_candidate.exists() {
        return Some(cwd_candidate);
    }
    None
}

fn find_valuation_worker_script() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(ref d) = dir {
                let candidate = d.join("backend").join("worker_valuations.py");
                if candidate.exists() {
                    return Some(candidate);
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    let cwd_candidate = PathBuf::from("backend/worker_valuations.py");
    if cwd_candidate.exists() {
        return Some(cwd_candidate);
    }
    None
}

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to resolve app data directory".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    Ok(dir)
}

fn bundled_env(app_handle: &AppHandle) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();
    env.insert(
        "DAILYIQ_DATA_DIR".to_string(),
        app_data_dir(app_handle)?.to_string_lossy().to_string(),
    );
    Ok(env)
}

fn spawn_dev_python(
    app_handle: &AppHandle,
    script_path: &PathBuf,
    extra_args: &[String],
) -> Result<ManagedChild, String> {
    let mut args = vec![script_path.to_string_lossy().to_string()];
    args.extend(extra_args.iter().cloned());
    let cwd = script_path
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| format!("Failed to resolve working directory for {}", script_path.display()))?;
    let app_data = app_data_dir(app_handle)?;

    // Prefer the uv-managed venv Python if it exists (avoids Windows App Execution Alias)
    let venv_python = if cfg!(target_os = "windows") {
        cwd.join("backend").join(".venv").join("Scripts").join("python.exe")
    } else {
        cwd.join("backend").join(".venv").join("bin").join("python")
    };

    let child = if venv_python.exists() {
        Command::new(&venv_python)
            .args(&args)
            .current_dir(cwd)
            .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to spawn venv Python: {}", e))?
    } else {
        Command::new("python3")
            .args(&args)
            .current_dir(cwd)
            .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
            .spawn()
            .or_else(|_| {
                Command::new("python")
                    .args(&args)
                    .current_dir(cwd)
                    .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
                    .spawn()
            })
            .or_else(|_| {
                Command::new("py")
                    .args(&args)
                    .current_dir(cwd)
                    .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
                    .spawn()
            })
            .map_err(|e| format!("Failed to spawn Python process: {}", e))?
    };

    Ok(ManagedChild::System(child))
}

fn spawn_bundled_sidecar(
    app_handle: &AppHandle,
    binary_name: &str,
    args: &[String],
) -> Result<ManagedChild, String> {
    let current_dir = app_data_dir(app_handle)?;
    let envs = bundled_env(app_handle)?;
    let (_rx, child) = SidecarCommand::new_sidecar(binary_name)
        .map_err(|e| format!("Failed to resolve sidecar '{}': {}", binary_name, e))?
        .args(args.iter().map(|s| s.as_str()))
        .envs(envs)
        .current_dir(current_dir)
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar '{}': {}", binary_name, e))?;

    Ok(ManagedChild::Sidecar(child))
}

/// Shared logic: spawn the Python sidecar, poll /health, store state.
/// Returns the port on success.
fn do_spawn_sidecar(app_handle: &AppHandle, state: &SidecarState) -> Result<u16, String> {
    // If already running, return existing port
    if let Some(port) = *state.port.lock().unwrap() {
        return Ok(port);
    }

    // Find a free port in the 18100-18200 range
    let sidecar_port = (18100u16..=18200)
        .find(|p| TcpListener::bind(format!("127.0.0.1:{}", p)).is_ok())
        .ok_or_else(|| "No free port in 18100-18200 range".to_string())?;

    let args = vec!["--port".to_string(), sidecar_port.to_string()];
    let child = if let Some(script_path) = find_backend_script() {
        spawn_dev_python(app_handle, &script_path, &args)?
    } else {
        spawn_bundled_sidecar(app_handle, "dailyiq-sidecar", &args)?
    };

    *state.child.lock().unwrap() = Some(child);
    *state.port.lock().unwrap() = Some(sidecar_port);

    // Poll /health until ready (max 10s)
    let addr = format!("127.0.0.1:{}", sidecar_port);
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(250));
        let sock_addr: SocketAddr = addr.parse().unwrap();
        if let Ok(mut stream) = TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)) {
            let request = format!("GET /health HTTP/1.1\r\nHost: {}\r\n\r\n", addr);
            if std::io::Write::write_all(&mut stream, request.as_bytes()).is_ok() {
                let mut buf = [0u8; 512];
                if stream.read(&mut buf).is_ok() {
                    let response = String::from_utf8_lossy(&buf);
                    if response.contains("200") {
                        return Ok(sidecar_port);
                    }
                }
            }
        }
    }

    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill();
    }
    *state.port.lock().unwrap() = None;

    Err("Sidecar failed to become ready within 10s".to_string())
}

fn do_spawn_worker(app_handle: &AppHandle, state: &SidecarState) -> Result<(), String> {
    if state.worker_child.lock().unwrap().is_some() {
        return Ok(());
    }

    let mut args = Vec::new();
    if let Some(probe) = probe_tws_ports() {
        args.push("--tws-port".to_string());
        args.push(probe.port.to_string());
    }

    let child = if let Some(script_path) = find_worker_script() {
        spawn_dev_python(app_handle, &script_path, &args)?
    } else {
        spawn_bundled_sidecar(app_handle, "dailyiq-worker", &args)?
    };

    *state.worker_child.lock().unwrap() = Some(child);
    Ok(())
}

fn do_spawn_valuation_worker(app_handle: &AppHandle, state: &SidecarState) -> Result<(), String> {
    if state.valuation_worker_child.lock().unwrap().is_some() {
        return Ok(());
    }

    let child = if let Some(script_path) = find_valuation_worker_script() {
        spawn_dev_python(app_handle, &script_path, &[])? 
    } else {
        spawn_bundled_sidecar(app_handle, "dailyiq-valuation-worker", &[])? 
    };

    *state.valuation_worker_child.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
fn spawn_sidecar(app_handle: tauri::AppHandle, state: tauri::State<'_, SidecarState>) -> Result<u16, String> {
    do_spawn_sidecar(&app_handle, &state)
}

/// Query the sidecar port (returns None if not yet running).
/// The frontend polls this on mount to get the auto-spawned port.
#[tauri::command]
fn get_sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn kill_sidecar(state: tauri::State<'_, SidecarState>) {
    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill();
    }
    if let Some(child) = state.worker_child.lock().unwrap().take() {
        child.kill();
    }
    if let Some(child) = state.valuation_worker_child.lock().unwrap().take() {
        child.kill();
    }
    *state.port.lock().unwrap() = None;
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            worker_child: Mutex::new(None),
            valuation_worker_child: Mutex::new(None),
            port: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_oauth_server,
            spawn_tab_window,
            probe_tws_ports,
            spawn_sidecar,
            kill_sidecar,
            get_sidecar_port,
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // Spawn sidecar + worker in a background thread so the window
            // opens immediately instead of blocking for up to ~11s.
            let handle = app.handle();
            std::thread::spawn(move || {
                let state: tauri::State<SidecarState> = handle.state();
                match do_spawn_sidecar(&handle, &state) {
                    Ok(port) => println!("Sidecar auto-started on port {}", port),
                    Err(e) => eprintln!("Sidecar auto-start failed (will retry on demand): {}", e),
                }
                if let Err(e) = do_spawn_worker(&handle, &state) {
                    eprintln!("Worker auto-start failed (will retry on demand): {}", e);
                }
                if let Err(e) = do_spawn_valuation_worker(&handle, &state) {
                    eprintln!("Valuation worker auto-start failed (will retry on demand): {}", e);
                }
            });

            // Watchdog: detect sidecar process death and auto-restart it.
            let watchdog_handle = app.handle();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(5));
                    let state: tauri::State<SidecarState> = watchdog_handle.state();

                    // Check if the child process has exited without us killing it.
                    let has_exited = {
                        let mut guard = state.child.lock().unwrap();
                        match guard.as_mut() {
                            Some(child) => child.has_exited(),
                            None => false,
                        }
                    };

                    if has_exited {
                        eprintln!("Watchdog: sidecar process exited unexpectedly, restarting...");
                        // Take the dead child out and clear the stale port.
                        { let _ = state.child.lock().unwrap().take(); }
                        *state.port.lock().unwrap() = None;

                        match do_spawn_sidecar(&watchdog_handle, &state) {
                            Ok(port) => println!("Watchdog: sidecar restarted on port {}", port),
                            Err(e) => eprintln!("Watchdog: sidecar restart failed: {}", e),
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                let label = event.window().label().to_string();
                // Only kill the sidecar when the main window closes.
                // Detached tab windows close freely without touching the sidecar.
                if label == "main" {
                    // Prevent the window from closing until child processes are killed.
                    // Using CloseRequested (not Destroyed) because on Windows, Destroyed
                    // fires too late — the runtime may already be partially torn down.
                    api.prevent_close();
                    let window = event.window().clone();
                    let app_handle = window.app_handle();
                    let state: tauri::State<SidecarState> = window.state();
                    if let Some(child) = state.child.lock().unwrap().take() {
                        child.kill();
                    }
                    if let Some(worker) = state.worker_child.lock().unwrap().take() {
                        worker.kill();
                    }
                    if let Some(worker) = state.valuation_worker_child.lock().unwrap().take() {
                        worker.kill();
                    }
                    *state.port.lock().unwrap() = None;
                    // Close any detached tab windows so they don't linger as orphan processes.
                    for (lbl, win) in app_handle.windows() {
                        if lbl != "main" {
                            let _ = win.close();
                        }
                    }
                    let _ = window.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
