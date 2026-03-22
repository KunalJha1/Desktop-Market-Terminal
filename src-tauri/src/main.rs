#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

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
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return Some(ProbeResult {
                port: *port,
                connection_type: conn_type.to_string(),
            });
        }
    }
    None
}

/// Stub for spawning a tab as a new native window (future drag-out support)
#[tauri::command]
fn spawn_tab_window(app_handle: tauri::AppHandle, label: String, title: String) -> Result<(), String> {
    let url = tauri::WindowUrl::App("index.html".into());
    let builder = tauri::WindowBuilder::new(&app_handle, &label, url)
        .title(&title)
        .inner_size(1440.0, 900.0)
        .min_inner_size(1280.0, 800.0);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    Ok(())
}

struct SidecarState {
    child: Mutex<Option<Child>>,
    worker_child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

/// Find the project root by searching upward from the executable for backend/main.py.
/// In dev mode (cargo tauri dev), the exe is in src-tauri/target/debug/.
/// In prod, the backend would be bundled alongside the exe.
fn find_backend_script() -> Option<std::path::PathBuf> {
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
    let cwd_candidate = std::path::PathBuf::from("backend/main.py");
    if cwd_candidate.exists() {
        return Some(cwd_candidate);
    }
    None
}

fn find_worker_script() -> Option<std::path::PathBuf> {
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
    let cwd_candidate = std::path::PathBuf::from("backend/worker_watchlist.py");
    if cwd_candidate.exists() {
        return Some(cwd_candidate);
    }
    None
}

/// Shared logic: spawn the Python sidecar, poll /health, store state.
/// Returns the port on success.
fn do_spawn_sidecar(state: &SidecarState) -> Result<u16, String> {
    // If already running, return existing port
    if let Some(port) = *state.port.lock().unwrap() {
        return Ok(port);
    }

    let script_path = find_backend_script()
        .ok_or_else(|| "backend/main.py not found — searched up from executable".to_string())?;

    // Find a free port in the 18100-18200 range
    let sidecar_port = (18100u16..=18200)
        .find(|p| TcpListener::bind(format!("127.0.0.1:{}", p)).is_ok())
        .ok_or_else(|| "No free port in 18100-18200 range".to_string())?;

    // Try python3 first (macOS/Linux), then python (Windows / venvs)
    let args = [script_path.to_string_lossy().to_string(), "--port".to_string(), sidecar_port.to_string()];
    let cwd = script_path.parent().unwrap().parent().unwrap();
    let child = Command::new("python3")
        .args(&args)
        .current_dir(cwd)
        .spawn()
        .or_else(|_| {
            Command::new("python")
                .args(&args)
                .current_dir(cwd)
                .spawn()
        })
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

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

    Err("Sidecar failed to become ready within 10s".to_string())
}

fn do_spawn_worker(state: &SidecarState) -> Result<(), String> {
    if state.worker_child.lock().unwrap().is_some() {
        return Ok(());
    }

    let script_path = find_worker_script()
        .ok_or_else(|| "backend/worker_watchlist.py not found — searched up from executable".to_string())?;

    let cwd = script_path.parent().unwrap().parent().unwrap();

    let mut args = vec![script_path.to_string_lossy().to_string()];
    if let Some(probe) = probe_tws_ports() {
        args.push("--tws-port".to_string());
        args.push(probe.port.to_string());
    }

    let child = Command::new("python3")
        .args(&args)
        .current_dir(cwd)
        .spawn()
        .or_else(|_| {
            Command::new("python")
                .args(&args)
                .current_dir(cwd)
                .spawn()
        })
        .map_err(|e| format!("Failed to spawn worker: {}", e))?;

    *state.worker_child.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
fn spawn_sidecar(state: tauri::State<'_, SidecarState>) -> Result<u16, String> {
    do_spawn_sidecar(&state)
}

/// Query the sidecar port (returns None if not yet running).
/// The frontend polls this on mount to get the auto-spawned port.
#[tauri::command]
fn get_sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn kill_sidecar(state: tauri::State<'_, SidecarState>) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut child) = state.worker_child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.port.lock().unwrap() = None;
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            worker_child: Mutex::new(None),
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

            // Auto-spawn the Python sidecar on app start
            let state: tauri::State<SidecarState> = app.state();
            match do_spawn_sidecar(&state) {
                Ok(port) => println!("Sidecar auto-started on port {}", port),
                Err(e) => eprintln!("Sidecar auto-start failed (will retry on demand): {}", e),
            }
            if let Err(e) = do_spawn_worker(&state) {
                eprintln!("Worker auto-start failed (will retry on demand): {}", e);
            }

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                // Kill sidecar on app exit
                let window = event.window().clone();
                let state: tauri::State<SidecarState> = window.state();
                let child = state.child.lock().unwrap().take();
                if let Some(mut child) = child {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let worker = state.worker_child.lock().unwrap().take();
                if let Some(mut worker) = worker {
                    let _ = worker.kill();
                    let _ = worker.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
