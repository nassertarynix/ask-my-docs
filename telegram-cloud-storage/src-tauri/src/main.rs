// Hides the extra console window on Windows release builds. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, RunEvent, State};

#[derive(Clone, Serialize)]
struct BackendConfig {
    url: String,
    token: String,
}

struct Backend {
    config: BackendConfig,
    port: u16,
    child: Mutex<Option<Child>>,
}

/// The window asks for the backend's address and secret token. It waits until the backend accepts connections, so the
/// interface never has to guess whether the Python service has finished starting.
#[tauri::command]
async fn backend_config(state: State<'_, Backend>) -> Result<BackendConfig, String> {
    let port = state.port;
    tauri::async_runtime::spawn_blocking(move || sidecar::wait_until_listening(port, Duration::from_secs(25)))
        .await
        .map_err(|e| e.to_string())??;
    Ok(state.config.clone())
}

/// In a debug build the backend is the Python source next to this crate; in a release build it is the bundled executable.
fn launch_spec(port: u16, token: String, data_dir: PathBuf) -> Result<sidecar::LaunchSpec, String> {
    if cfg!(debug_assertions) {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let python = std::env::var("TGCS_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
        Ok(sidecar::LaunchSpec { program: python.into(), args: vec!["-m".into(), "backend.main".into()], cwd: Some(project_root), port, token, data_dir })
    } else {
        let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().map(PathBuf::from).ok_or("no executable folder")?;
        Ok(sidecar::LaunchSpec { program: sidecar::release_binary(&exe_dir), args: vec![], cwd: None, port, token, data_dir })
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

            let mut random = [0u8; 24];
            getrandom::getrandom(&mut random).map_err(|e| e.to_string())?;
            let token = sidecar::token_from_bytes(&random);
            let port = sidecar::free_port().map_err(|e| e.to_string())?;

            let child = sidecar::spawn(&launch_spec(port, token.clone(), data_dir)?).map_err(|e| format!("Could not start the storage service: {e}"))?;
            app.manage(Backend { config: BackendConfig { url: format!("http://127.0.0.1:{port}"), token }, port, child: Mutex::new(Some(child)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_config])
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(backend) = app.try_state::<Backend>() {
                    if let Some(mut child) = backend.child.lock().unwrap().take() {
                        sidecar::stop(&mut child);
                    }
                }
            }
        });
}
