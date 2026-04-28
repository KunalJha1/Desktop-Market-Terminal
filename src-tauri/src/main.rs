#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::api::process::{Command as SidecarCommand, CommandChild as SidecarChild};
use tauri::{AppHandle, Manager};

/// Windows Job Object support — ensures all spawned child processes are
/// automatically killed by the OS when the Tauri host process exits, even
/// on crash or task-kill (no graceful shutdown needed).
#[cfg(target_os = "windows")]
mod win_job {
    use std::ffi::c_void;

    pub type HANDLE = *mut c_void;

    pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    pub const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;
    pub const PROCESS_ALL_ACCESS: u32 = 0x001F_0FFF;

    #[repr(C)]
    #[derive(Default)]
    pub struct JobObjectBasicLimitInformation {
        pub per_process_user_time_limit: i64,
        pub per_job_user_time_limit: i64,
        pub limit_flags: u32,
        pub minimum_working_set_size: usize,
        pub maximum_working_set_size: usize,
        pub active_process_limit: u32,
        pub affinity: usize,
        pub priority_class: u32,
        pub scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct IoCounters {
        pub read_operation_count: u64,
        pub write_operation_count: u64,
        pub other_operation_count: u64,
        pub read_transfer_count: u64,
        pub write_transfer_count: u64,
        pub other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct JobObjectExtendedLimitInformation {
        pub basic_limit_information: JobObjectBasicLimitInformation,
        pub io_info: IoCounters,
        pub process_memory_limit: usize,
        pub job_memory_limit: usize,
        pub peak_process_memory_used: usize,
        pub peak_job_memory_used: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn CreateJobObjectW(lp_attributes: *const c_void, lp_name: *const u16) -> HANDLE;
        pub fn SetInformationJobObject(
            h_job: HANDLE,
            info_class: u32,
            lp_info: *const c_void,
            cb_info: u32,
        ) -> i32;
        pub fn AssignProcessToJobObject(h_job: HANDLE, h_process: HANDLE) -> i32;
        pub fn OpenProcess(dw_access: u32, b_inherit: i32, dw_pid: u32) -> HANDLE;
        pub fn CloseHandle(h_object: HANDLE) -> i32;
    }
}

/// Wrapper to make the raw HANDLE Send + Sync so it can live in SidecarState.
#[cfg(target_os = "windows")]
struct WinJob(win_job::HANDLE);
#[cfg(target_os = "windows")]
unsafe impl Send for WinJob {}
#[cfg(target_os = "windows")]
unsafe impl Sync for WinJob {}

/// Create a Job Object with KILL_ON_JOB_CLOSE so every assigned child process
/// is automatically terminated when this process exits.
#[cfg(target_os = "windows")]
fn create_kill_on_close_job() -> Option<WinJob> {
    use win_job::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }
        let mut info = JobObjectExtendedLimitInformation::default();
        info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            &info as *const _ as _,
            std::mem::size_of_val(&info) as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return None;
        }
        Some(WinJob(job))
    }
}

/// Assign a process (by PID) to the kill-on-close Job Object.
#[cfg(target_os = "windows")]
fn assign_to_job(job: &WinJob, pid: u32) {
    use win_job::*;
    unsafe {
        let proc = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
        if !proc.is_null() {
            AssignProcessToJobObject(job.0, proc);
            CloseHandle(proc);
        }
    }
}

const DAILYIQ_API_KEY: &str = match option_env!("DAILYIQ_API_KEY") {
    Some(k) => k,
    None => "",
};

const OAUTH_CALLBACK_PORT: u16 = 17284;
const WATCHDOG_POLL_INTERVAL_S: u64 = 5;
const WATCHDOG_FAILS_BEFORE_RESTART: u32 = 3;
const WATCHDOG_RESTART_BACKOFF_S: u64 = 20;

#[derive(Clone, serde::Serialize)]
struct BackendStatus {
    state: String,
    sidecar_port: Option<u16>,
    last_healthy_at: Option<u64>,
    last_restart_reason: Option<String>,
    restart_count: u32,
    logs_available: bool,
    log_path: Option<String>,
}

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

fn url_decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((h * 16 + l) as u8 as char);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(' ');
            i += 1;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Shared accept loop used by both the IPv4 and IPv6 OAuth listener threads.
/// The `handled` AtomicBool is shared between the two threads; whichever receives
/// the callback first claims it and the other exits immediately, ensuring the auth
/// event fires exactly once regardless of which loopback address the browser used.
fn oauth_accept_loop(
    listener: TcpListener,
    app_handle: AppHandle,
    handled: Arc<AtomicBool>,
    relay_page: String,
    success_page: String,
) {
    let empty_response = b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
    listener.set_nonblocking(false).ok();

    for _ in 0..10 {
        if handled.load(Ordering::SeqCst) {
            break;
        }

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
            let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
            let code = extract_param(query, "code").map(|s| url_decode(s));

            if let Some(code) = code {
                // Claim the auth slot — if the other thread already handled it, bail.
                if handled.swap(true, Ordering::SeqCst) {
                    break;
                }

                let _ = stream.write_all(success_page.as_bytes());
                let _ = stream.flush();
                drop(stream);

                let payload = serde_json::json!({ "code": code });

                if let Some(window) = app_handle.get_window("main") {
                    let json = serde_json::to_string(&payload).unwrap_or_default();
                    let js = format!(
                        "window.dispatchEvent(new CustomEvent('oauth-code', {{ detail: {} }}));",
                        json
                    );
                    let _ = window.eval(&js);
                    let _ = window.set_focus();
                    // On Windows, SetForegroundWindow silently fails when the app isn't
                    // already in the foreground (the user is in the browser). Flash the
                    // taskbar button so they know to switch back.
                    #[cfg(target_os = "windows")]
                    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }

                let _ = app_handle.emit_all("oauth-code", payload);
                break;
            } else {
                let _ = stream.write_all(relay_page.as_bytes());
                let _ = stream.flush();
            }
        } else if path.starts_with("/token?") {
            // Legacy fragment relay path
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
                if handled.swap(true, Ordering::SeqCst) {
                    break;
                }

                let payload = serde_json::json!({
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                });

                if let Some(window) = app_handle.get_window("main") {
                    let json = serde_json::to_string(&payload).unwrap_or_default();
                    let js = format!(
                        "window.dispatchEvent(new CustomEvent('oauth-tokens', {{ detail: {} }}));",
                        json
                    );
                    let _ = window.eval(&js);
                    let _ = window.set_focus();
                    #[cfg(target_os = "windows")]
                    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                }

                let _ = app_handle.emit_all("oauth-callback", payload);
            }
            break;
        } else {
            let _ = stream.write_all(empty_response);
            let _ = stream.flush();
        }
    }
}

#[tauri::command]
fn start_oauth_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    // Bind IPv4 loopback (works everywhere).
    let listener_v4 = TcpListener::bind(format!("127.0.0.1:{}", OAUTH_CALLBACK_PORT))
        .map_err(|e| format!("Failed to start OAuth listener: {}", e))?;
    let port = listener_v4.local_addr().map_err(|e| e.to_string())?.port();

    // Also bind IPv6 loopback — on Windows, 'localhost' often resolves to ::1,
    // so without this the browser redirect would hit an empty port and login hangs.
    let listener_v6 = TcpListener::bind(format!("[::1]:{}", port)).ok();

    let relay_page = RELAY_HTML
        .replace("PAGESTYLE", PAGE_STYLE)
        .replace("LOGOSVG", LOGO_SVG);
    let success_page = SUCCESS_HTML
        .replace("PAGESTYLE", PAGE_STYLE)
        .replace("LOGOSVG", LOGO_SVG);

    // Shared flag: whichever thread receives the callback first sets this to true
    // so the other thread exits without firing a duplicate auth event.
    let handled = Arc::new(AtomicBool::new(false));

    // IPv4 listener thread
    {
        let ah = app_handle.clone();
        let h = handled.clone();
        let (r, s) = (relay_page.clone(), success_page.clone());
        std::thread::spawn(move || oauth_accept_loop(listener_v4, ah, h, r, s));
    }

    // IPv6 listener thread — only spawned when ::1 binding succeeded
    if let Some(v6) = listener_v6 {
        let h = handled.clone();
        std::thread::spawn(move || oauth_accept_loop(v6, app_handle, h, relay_page, success_page));
    }

    Ok(port)
}

#[derive(serde::Serialize)]
struct ProbeResult {
    port: u16,
    connection_type: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DetachedTabInfo {
    tab_id: String,
    tab_type: String,
    title: String,
    window_label: String,
    original_index: usize,
    chart_state_json: Option<String>,
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
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
async fn spawn_tab_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    label: String,
    title: String,
    tab_id: String,
    tab_type: String,
    original_index: usize,
    chart_state_json: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: Option<bool>,
) -> Result<(), String> {
    let info = DetachedTabInfo {
        tab_id,
        tab_type,
        title: title.clone(),
        window_label: label.clone(),
        original_index,
        chart_state_json,
    };
    let query = format!(
        "index.html?detached=1&tabId={}&tabType={}&title={}&originalIndex={}",
        encode_query_component(&info.tab_id),
        encode_query_component(&info.tab_type),
        encode_query_component(&info.title),
        info.original_index,
    );
    state
        .detached_tabs
        .lock()
        .unwrap()
        .insert(label.clone(), info);

    let url = tauri::WindowUrl::App(query.into());
    let should_maximize = maximized.unwrap_or(true);
    let builder = tauri::WindowBuilder::new(&app_handle, &label, url)
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(800.0, 600.0)
        .position(x, y)
        .maximized(should_maximize)
        .focused(true)
        .visible(true)
        .decorations(false);

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Visible);

    builder.build().map_err(|e| {
        state.detached_tabs.lock().unwrap().remove(&label);
        format!("Failed to create window: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
async fn spawn_test_window(
    app_handle: tauri::AppHandle,
    label: String,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let url = tauri::WindowUrl::App("test-window.html".into());
    let builder = tauri::WindowBuilder::new(&app_handle, &label, url)
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(420.0, 320.0)
        .position(x, y)
        .focused(true)
        .visible(true);

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Visible);

    builder
        .build()
        .map_err(|e| format!("Failed to create test window: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_detached_tab_info(
    state: tauri::State<'_, SidecarState>,
    label: String,
) -> Option<DetachedTabInfo> {
    state.detached_tabs.lock().unwrap().get(&label).cloned()
}

enum ManagedChild {
    System(Child),
    Sidecar(SidecarChild),
}

impl ManagedChild {
    /// Returns the process ID.
    fn pid(&self) -> u32 {
        match self {
            ManagedChild::System(child) => child.id(),
            ManagedChild::Sidecar(child) => child.pid(),
        }
    }

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
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(&["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
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
    shutting_down: Mutex<bool>,
    backend_status: Mutex<BackendStatus>,
    detached_tabs: Mutex<HashMap<String, DetachedTabInfo>>,
    /// Windows-only: kill-on-close Job Object handle. All spawned child
    /// processes are assigned to this job so they die with the host process.
    #[cfg(target_os = "windows")]
    win_job: Option<WinJob>,
}

fn is_shutting_down(state: &SidecarState) -> bool {
    *state.shutting_down.lock().unwrap()
}

fn begin_shutdown(state: &SidecarState) {
    *state.shutting_down.lock().unwrap() = true;
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
    if !DAILYIQ_API_KEY.is_empty() {
        env.insert("DAILYIQ_API_KEY".to_string(), DAILYIQ_API_KEY.to_string());
    }
    // Pass our PID so child processes can self-terminate if we exit unexpectedly.
    env.insert(
        "DAILYIQ_PARENT_PID".to_string(),
        std::process::id().to_string(),
    );
    Ok(env)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn supervisor_log_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app_handle)?.join("supervisor.log"))
}

fn append_supervisor_log(app_handle: &AppHandle, message: &str) {
    let path = match supervisor_log_path(app_handle) {
        Ok(path) => path,
        Err(_) => return,
    };
    let timestamp = now_ms();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

fn update_backend_status<F>(state: &SidecarState, updater: F)
where
    F: FnOnce(&mut BackendStatus),
{
    let mut status = state.backend_status.lock().unwrap();
    updater(&mut status);
}

fn backend_status_snapshot(state: &SidecarState) -> BackendStatus {
    state.backend_status.lock().unwrap().clone()
}

fn backend_stack_presence(state: &SidecarState) -> (bool, bool, bool, bool) {
    let has_sidecar = state.child.lock().unwrap().is_some();
    let has_worker = state.worker_child.lock().unwrap().is_some();
    let has_valuation_worker = state.valuation_worker_child.lock().unwrap().is_some();
    let has_port = state.port.lock().unwrap().is_some();
    (has_sidecar, has_worker, has_valuation_worker, has_port)
}

fn remaining_backoff_seconds(last_restart_at: Option<Instant>) -> Option<u64> {
    last_restart_at.and_then(|ts| {
        let elapsed = ts.elapsed().as_secs();
        if elapsed >= WATCHDOG_RESTART_BACKOFF_S {
            None
        } else {
            Some(WATCHDOG_RESTART_BACKOFF_S - elapsed)
        }
    })
}

fn mark_backend_retry_delayed(
    app_handle: &AppHandle,
    state: &SidecarState,
    reason: &str,
    remaining_s: u64,
) {
    let message = format!("{}; retrying in {}s", reason, remaining_s);
    update_backend_status(state, |status| {
        status.state = "unhealthy".to_string();
        status.last_restart_reason = Some(message.clone());
        status.logs_available = supervisor_log_path(app_handle)
            .map(|p| p.exists())
            .unwrap_or(false);
        status.log_path = supervisor_log_path(app_handle)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
    });
}

fn ensure_backend_stack_running(
    app_handle: &AppHandle,
    state: &SidecarState,
    last_restart_at: &mut Option<Instant>,
    reason: &str,
) -> bool {
    if is_shutting_down(state) {
        return false;
    }

    if let Some(remaining_s) = remaining_backoff_seconds(*last_restart_at) {
        mark_backend_retry_delayed(app_handle, state, reason, remaining_s);
        return false;
    }

    *last_restart_at = Some(Instant::now());
    match restart_backend_stack(app_handle, state, reason) {
        Ok(port) => {
            append_supervisor_log(
                app_handle,
                &format!("Backend stack restarted on port {}", port),
            );
            true
        }
        Err(e) => {
            append_supervisor_log(
                app_handle,
                &format!("Backend restart failed after watchdog recovery: {}", e),
            );
            false
        }
    }
}

fn kill_backend_stack(state: &SidecarState) {
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
}

fn stop_backend_stack(app_handle: &AppHandle, state: &SidecarState, reason: &str) {
    begin_shutdown(state);
    append_supervisor_log(app_handle, reason);
    kill_backend_stack(state);
    update_backend_status(state, |status| {
        status.state = "stopped".to_string();
        status.sidecar_port = None;
    });
}

fn shutdown_app_runtime(
    app_handle: &AppHandle,
    state: &SidecarState,
    reason: &str,
    skip_label: Option<&str>,
) {
    if !is_shutting_down(state) {
        stop_backend_stack(app_handle, state, reason);
    }
    for (label, win) in app_handle.windows() {
        if let Some(skip) = skip_label {
            if label == skip {
                continue;
            }
        }
        let _ = win.close();
    }
    app_handle.exit(0);
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
        .ok_or_else(|| {
            format!(
                "Failed to resolve working directory for {}",
                script_path.display()
            )
        })?;
    let app_data = app_data_dir(app_handle)?;

    // Prefer the uv-managed venv Python if it exists (avoids Windows App Execution Alias)
    let venv_python = if cfg!(target_os = "windows") {
        cwd.join("backend")
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        cwd.join("backend").join(".venv").join("bin").join("python")
    };

    #[cfg(target_os = "windows")]
    let no_window_flag: u32 = 0x08000000;

    let parent_pid = std::process::id().to_string();

    let child = if venv_python.exists() {
        {
            #[allow(unused_mut)]
            let mut cmd = Command::new(&venv_python);
            cmd.args(&args)
                .current_dir(cwd)
                .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
                .env("DAILYIQ_PARENT_PID", &parent_pid)
                .env("PYTHONUNBUFFERED", "1");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(no_window_flag);
            }
            cmd.spawn()
                .map_err(|e| format!("Failed to spawn venv Python: {}", e))?
        }
    } else {
        let try_spawn = |exe: &str| {
            #[allow(unused_mut)]
            let mut cmd = Command::new(exe);
            cmd.args(&args)
                .current_dir(cwd)
                .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
                .env("DAILYIQ_PARENT_PID", &parent_pid)
                .env("PYTHONUNBUFFERED", "1");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(no_window_flag);
            }
            cmd.spawn()
        };
        try_spawn("python3")
            .or_else(|_| try_spawn("python"))
            .or_else(|_| {
                #[allow(unused_mut)]
                let mut cmd = Command::new("py");
                cmd.args(&args)
                    .current_dir(cwd)
                    .env("DAILYIQ_DATA_DIR", app_data.to_string_lossy().to_string())
                    .env("DAILYIQ_PARENT_PID", &parent_pid)
                    .env("PYTHONUNBUFFERED", "1");
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(no_window_flag);
                }
                cmd.spawn()
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
    if is_shutting_down(state) {
        return Err("App is shutting down".to_string());
    }
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

    #[cfg(target_os = "windows")]
    if let Some(job) = &state.win_job {
        assign_to_job(job, child.pid());
    }
    *state.child.lock().unwrap() = Some(child);
    *state.port.lock().unwrap() = Some(sidecar_port);

    // Poll /healthz until ready (max 10s)
    let addr = format!("127.0.0.1:{}", sidecar_port);
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(10) {
        if is_shutting_down(state) {
            if let Some(child) = state.child.lock().unwrap().take() {
                child.kill();
            }
            *state.port.lock().unwrap() = None;
            return Err("App is shutting down".to_string());
        }
        std::thread::sleep(Duration::from_millis(250));
        let sock_addr: SocketAddr = addr.parse().unwrap();
        if let Ok(mut stream) = TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)) {
            let request = format!("GET /healthz HTTP/1.1\r\nHost: {}\r\n\r\n", addr);
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

/// True when `GET /healthz` returns HTTP 200 (used by watchdog, not just process liveness).
fn probe_sidecar_http_health(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(800)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 384];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.contains(" 200 ") || head.contains("200 OK")
        }
        _ => false,
    }
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

    #[cfg(target_os = "windows")]
    if let Some(job) = &state.win_job {
        assign_to_job(job, child.pid());
    }
    *state.worker_child.lock().unwrap() = Some(child);
    Ok(())
}

fn do_spawn_valuation_worker(app_handle: &AppHandle, state: &SidecarState) -> Result<(), String> {
    if state.valuation_worker_child.lock().unwrap().is_some() {
        return Ok(());
    }

    let child = if let Some(script_path) = find_valuation_worker_script() {
        spawn_dev_python(app_handle, &script_path, &["--loop".to_string()])?
    } else {
        spawn_bundled_sidecar(app_handle, "dailyiq-valuation-worker", &[])?
    };

    #[cfg(target_os = "windows")]
    if let Some(job) = &state.win_job {
        assign_to_job(job, child.pid());
    }
    *state.valuation_worker_child.lock().unwrap() = Some(child);
    Ok(())
}

fn do_spawn_backend_stack(app_handle: &AppHandle, state: &SidecarState) -> Result<u16, String> {
    if is_shutting_down(state) {
        return Err("App is shutting down".to_string());
    }
    update_backend_status(state, |status| {
        status.state = if status.restart_count > 0 {
            "restarting".to_string()
        } else {
            "starting".to_string()
        };
        status.logs_available = supervisor_log_path(app_handle)
            .map(|p| p.exists())
            .unwrap_or(false);
        status.log_path = supervisor_log_path(app_handle)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
    });

    let port = do_spawn_sidecar(app_handle, state)?;
    if let Err(err) = do_spawn_worker(app_handle, state) {
        kill_backend_stack(state);
        return Err(err);
    }
    if let Err(err) = do_spawn_valuation_worker(app_handle, state) {
        kill_backend_stack(state);
        return Err(err);
    }

    update_backend_status(state, |status| {
        status.state = "healthy".to_string();
        status.sidecar_port = Some(port);
        status.last_healthy_at = Some(now_ms());
        status.logs_available = supervisor_log_path(app_handle)
            .map(|p| p.exists())
            .unwrap_or(false);
        status.log_path = supervisor_log_path(app_handle)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
    });
    append_supervisor_log(
        app_handle,
        &format!("Backend stack healthy on port {}", port),
    );
    Ok(port)
}

fn restart_backend_stack(
    app_handle: &AppHandle,
    state: &SidecarState,
    reason: &str,
) -> Result<u16, String> {
    if is_shutting_down(state) {
        return Err("App is shutting down".to_string());
    }
    append_supervisor_log(app_handle, &format!("Restarting backend stack: {}", reason));
    update_backend_status(state, |status| {
        status.state = "restarting".to_string();
        status.sidecar_port = None;
        status.last_restart_reason = Some(reason.to_string());
        status.restart_count += 1;
        status.logs_available = supervisor_log_path(app_handle)
            .map(|p| p.exists())
            .unwrap_or(false);
        status.log_path = supervisor_log_path(app_handle)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
    });
    kill_backend_stack(state);
    match do_spawn_backend_stack(app_handle, state) {
        Ok(port) => Ok(port),
        Err(err) => {
            update_backend_status(state, |status| {
                status.state = "failed".to_string();
                status.sidecar_port = None;
                status.last_restart_reason = Some(format!("{} ({})", reason, err));
                status.logs_available = supervisor_log_path(app_handle)
                    .map(|p| p.exists())
                    .unwrap_or(false);
                status.log_path = supervisor_log_path(app_handle)
                    .ok()
                    .map(|p| p.to_string_lossy().to_string());
            });
            append_supervisor_log(
                app_handle,
                &format!("Backend restart failed: {} ({})", reason, err),
            );
            Err(err)
        }
    }
}

#[tauri::command]
fn spawn_sidecar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<u16, String> {
    do_spawn_backend_stack(&app_handle, &state)
}

/// Force-restart the full backend stack immediately (bypasses watchdog backoff).
/// Called by the frontend when the user manually requests a restart.
#[tauri::command]
fn restart_sidecar(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<u16, String> {
    restart_backend_stack(&app_handle, &state, "manual restart requested by user")
}

/// Query the sidecar port (returns None if not yet running).
/// The frontend polls this on mount to get the auto-spawned port.
#[tauri::command]
fn get_sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
fn get_backend_status(state: tauri::State<'_, SidecarState>) -> BackendStatus {
    state.backend_status.lock().unwrap().clone()
}

#[tauri::command]
fn kill_sidecar(state: tauri::State<'_, SidecarState>) {
    kill_backend_stack(&state);
    update_backend_status(&state, |status| {
        status.state = "stopped".to_string();
        status.sidecar_port = None;
    });
}

#[tauri::command]
fn shutdown_app(app_handle: AppHandle, state: tauri::State<'_, SidecarState>) {
    shutdown_app_runtime(
        &app_handle,
        &state,
        "Frontend requested full app shutdown; stopping backend stack",
        None,
    );
}

/// Absolute path to the running executable (for diagnosing duplicate installs / shortcut targets).
#[tauri::command]
fn get_executable_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| e.to_string())
}

/// Returns runtime app config (Supabase credentials) from the bundled resource file.
#[tauri::command]
fn get_app_config(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let resource_path = app_handle
        .path_resolver()
        .resolve_resource("resources/app-config.json")
        .ok_or_else(|| "app-config.json resource not found".to_string())?;
    let contents = std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read app-config.json: {}", e))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse app-config.json: {}", e))
}

fn main() {
    // Create the Windows Job Object before building Tauri state so all
    // subsequently spawned child processes can be assigned to it.
    #[cfg(target_os = "windows")]
    let win_job = create_kill_on_close_job();

    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            worker_child: Mutex::new(None),
            valuation_worker_child: Mutex::new(None),
            port: Mutex::new(None),
            shutting_down: Mutex::new(false),
            backend_status: Mutex::new(BackendStatus {
                state: "stopped".to_string(),
                sidecar_port: None,
                last_healthy_at: None,
                last_restart_reason: None,
                restart_count: 0,
                logs_available: false,
                log_path: None,
            }),
            detached_tabs: Mutex::new(HashMap::new()),
            #[cfg(target_os = "windows")]
            win_job,
        })
        .invoke_handler(tauri::generate_handler![
            start_oauth_server,
            spawn_tab_window,
            get_detached_tab_info,
            probe_tws_ports,
            spawn_sidecar,
            restart_sidecar,
            kill_sidecar,
            shutdown_app,
            get_sidecar_port,
            get_backend_status,
            get_executable_path,
            get_app_config,
            spawn_test_window,
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // On macOS, Tauri windows don't always receive focus on launch.
            // Explicitly request focus so the window is immediately interactive.
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_window("main") {
                    let _ = window.set_focus();
                }
            }

            // Spawn sidecar + worker in a background thread so the window
            // opens immediately instead of blocking for up to ~11s.
            let handle = app.handle();
            std::thread::spawn(move || {
                let state: tauri::State<SidecarState> = handle.state();
                if is_shutting_down(&state) {
                    return;
                }
                match do_spawn_backend_stack(&handle, &state) {
                    Ok(port) => println!("Backend stack auto-started on port {}", port),
                    Err(e) => {
                        update_backend_status(&state, |status| {
                            status.state = "failed".to_string();
                            status.sidecar_port = None;
                            status.last_restart_reason = Some(e.clone());
                            status.logs_available = supervisor_log_path(&handle).map(|p| p.exists()).unwrap_or(false);
                            status.log_path = supervisor_log_path(&handle)
                                .ok()
                                .map(|p| p.to_string_lossy().to_string());
                        });
                        append_supervisor_log(&handle, &format!("Initial backend auto-start failed: {}", e));
                        eprintln!("Backend auto-start failed (will retry on demand): {}", e);
                    }
                }
            });

            // Watchdog: restart the full backend stack on sidecar exit or failed /healthz probes.
            let watchdog_handle = app.handle();
            std::thread::spawn(move || {
                let mut health_fail_streak: u32 = 0;
                let mut last_restart_at: Option<Instant> = None;
                loop {
                    std::thread::sleep(Duration::from_secs(WATCHDOG_POLL_INTERVAL_S));
                    let state: tauri::State<SidecarState> = watchdog_handle.state();
                    if is_shutting_down(&state) {
                        break;
                    }

                    let port_snapshot = *state.port.lock().unwrap();

                    // Check if the child process has exited without us killing it.
                    let has_exited = {
                        let mut guard = state.child.lock().unwrap();
                        match guard.as_mut() {
                            Some(child) => child.has_exited(),
                            None => false,
                        }
                    };

                    if has_exited {
                        health_fail_streak = 0;
                        if ensure_backend_stack_running(
                            &watchdog_handle,
                            &state,
                            &mut last_restart_at,
                            "sidecar exited unexpectedly",
                        ) {
                            println!("Watchdog: backend stack restarted after sidecar exit");
                        } else {
                            eprintln!("Watchdog: sidecar exited; restart skipped or failed");
                        }
                        continue;
                    }

                    if let Some(port) = port_snapshot {
                        if probe_sidecar_http_health(port) {
                            health_fail_streak = 0;
                            update_backend_status(&state, |status| {
                                status.state = "healthy".to_string();
                                status.sidecar_port = Some(port);
                                status.last_healthy_at = Some(now_ms());
                            });
                        } else {
                            health_fail_streak += 1;
                            update_backend_status(&state, |status| {
                                status.state = "unhealthy".to_string();
                                status.sidecar_port = Some(port);
                                status.last_restart_reason = Some(format!(
                                    "healthz failed {} times",
                                    health_fail_streak
                                ));
                            });
                            if health_fail_streak >= WATCHDOG_FAILS_BEFORE_RESTART {
                                eprintln!(
                                    "Watchdog: sidecar HTTP /healthz failed {} times; forcing full backend restart...",
                                    health_fail_streak
                                );
                                health_fail_streak = 0;
                                if ensure_backend_stack_running(
                                    &watchdog_handle,
                                    &state,
                                    &mut last_restart_at,
                                    "sidecar healthz check failed",
                                ) {
                                    println!("Watchdog: backend stack restarted after health check failures");
                                } else {
                                    eprintln!("Watchdog: backend restart skipped or failed after health check failures");
                                }
                            }
                        }
                    } else {
                        health_fail_streak = 0;
                        let status = backend_status_snapshot(&state);
                        let (has_sidecar, has_worker, has_valuation_worker, has_port) =
                            backend_stack_presence(&state);
                        let stack_missing =
                            !has_sidecar && !has_worker && !has_valuation_worker && !has_port;
                        let should_recover = stack_missing
                            && matches!(
                                status.state.as_str(),
                                "failed" | "stopped" | "unhealthy" | "starting" | "restarting"
                            );
                        if should_recover {
                            let reason = format!(
                                "backend stack missing while state={}",
                                status.state
                            );
                            if ensure_backend_stack_running(
                                &watchdog_handle,
                                &state,
                                &mut last_restart_at,
                                &reason,
                            ) {
                                println!("Watchdog: backend stack recovered from empty state");
                            } else {
                                eprintln!("Watchdog: empty backend stack detected; restart skipped or failed");
                            }
                        }
                    }
                }
            });

            // Watchdog: restart the full backend stack if either worker exits unexpectedly.
            let worker_watchdog_handle = app.handle();
            std::thread::spawn(move || {
                let mut last_backend_restart_at: Option<Instant> = None;
                loop {
                    std::thread::sleep(Duration::from_secs(WATCHDOG_POLL_INTERVAL_S));
                    let state: tauri::State<SidecarState> = worker_watchdog_handle.state();
                    if is_shutting_down(&state) {
                        break;
                    }

                    let worker_exited = {
                        let mut guard = state.worker_child.lock().unwrap();
                        match guard.as_mut() {
                            Some(child) => child.has_exited(),
                            None => false,
                        }
                    };
                    if worker_exited {
                        if ensure_backend_stack_running(
                            &worker_watchdog_handle,
                            &state,
                            &mut last_backend_restart_at,
                            "watchlist worker exited unexpectedly",
                        ) {
                            println!("Watchdog: backend stack restarted after watchlist worker exit");
                        } else {
                            eprintln!("Watchdog: worker exited; backend restart skipped or failed");
                        }
                    }

                    let valuation_worker_exited = {
                        let mut guard = state.valuation_worker_child.lock().unwrap();
                        match guard.as_mut() {
                            Some(child) => child.has_exited(),
                            None => false,
                        }
                    };
                    if valuation_worker_exited {
                        if ensure_backend_stack_running(
                            &worker_watchdog_handle,
                            &state,
                            &mut last_backend_restart_at,
                            "valuation worker exited unexpectedly",
                        ) {
                            println!("Watchdog: backend stack restarted after valuation worker exit");
                        } else {
                            eprintln!("Watchdog: valuation worker exited; backend restart skipped or failed");
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                let label = event.window().label().to_string();
                // Detached windows close independently.
                // Primary windows trigger full app shutdown.
                let is_detached = label.starts_with("detached-");
                let is_test_window = label.starts_with("test-window-");
                if label == "main" || (!is_detached && !is_test_window) {
                    api.prevent_close();
                    let window = event.window().clone();
                    let app_handle = window.app_handle();
                    let state: tauri::State<SidecarState> = window.state();
                    shutdown_app_runtime(
                        &app_handle,
                        &state,
                        "Primary window closing; stopping backend stack and exiting app",
                        Some(&label),
                    );
                } else {
                    let state: tauri::State<SidecarState> = event.window().state();
                    state.detached_tabs.lock().unwrap().remove(&label);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                let state: tauri::State<SidecarState> = app_handle.state();
                if !is_shutting_down(&state) {
                    stop_backend_stack(app_handle, &state, "Tauri runtime exiting; stopping backend stack");
                }
            }
        });
}

