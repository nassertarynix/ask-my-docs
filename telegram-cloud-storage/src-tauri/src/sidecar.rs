//! Starting, waiting for and stopping the Python backend. Standard library only, so it can be tested without Tauri.
//!
//! The shell picks a free port and generates a secret token, then starts the backend with them in its environment. The
//! backend refuses any request that does not carry the token, so only this app's window (which gets the token from the
//! `backend_config` command) can use it.

use std::io;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub port: u16,
    pub token: String,
    pub data_dir: PathBuf,
}

/// Ask the operating system for a free port on the loopback interface.
pub fn free_port() -> io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// Hex-encode random bytes into a token. The caller supplies the bytes so this stays dependency-free.
pub fn token_from_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Where the backend executable is in a release build: next to the app, named `tgcs-backend` (`.exe` on Windows).
pub fn release_binary(exe_dir: &Path) -> PathBuf {
    exe_dir.join(if cfg!(windows) { "tgcs-backend.exe" } else { "tgcs-backend" })
}

pub fn spawn(spec: &LaunchSpec) -> io::Result<Child> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .env("TGCS_PORT", spec.port.to_string())
        .env("TGCS_TOKEN", &spec.token)
        .env("TGCS_DATA_DIR", &spec.data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no black console box next to the app
    }
    command.spawn()
}

/// Block until something accepts connections on the port, or give up after `timeout`.
pub fn wait_until_listening(port: u16, timeout: Duration) -> Result<(), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("The storage service did not start within {} seconds.", timeout.as_secs()));
        }
        sleep(Duration::from_millis(100));
    }
}

/// Stop the backend and reap it so no zombie is left. Safe to call twice.
pub fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_port_is_usable_and_loopback() {
        let port = free_port().unwrap();
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).expect("the port should be free to bind");
    }

    #[test]
    fn token_is_lowercase_hex_of_double_length() {
        assert_eq!(token_from_bytes(&[0, 15, 255]), "000fff");
        assert_eq!(token_from_bytes(&[7; 24]).len(), 48);
    }

    #[test]
    fn release_binary_sits_next_to_the_app() {
        let p = release_binary(Path::new("/opt/app"));
        assert!(p.starts_with("/opt/app") && p.file_name().unwrap().to_string_lossy().starts_with("tgcs-backend"));
    }

    #[test]
    fn wait_succeeds_once_a_listener_exists() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(wait_until_listening(port, Duration::from_secs(2)).is_ok());
    }

    #[test]
    fn wait_times_out_when_nothing_listens() {
        let port = free_port().unwrap(); // free, so nobody is listening
        let started = Instant::now();
        let error = wait_until_listening(port, Duration::from_millis(400)).unwrap_err();
        assert!(error.contains("did not start"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[cfg(unix)]
    #[test]
    fn spawn_passes_port_token_and_data_dir_in_the_environment() {
        let out = std::env::temp_dir().join(format!("tgcs-sidecar-test-{}", std::process::id()));
        let spec = LaunchSpec {
            program: PathBuf::from("sh"),
            args: vec!["-c".into(), format!("echo \"$TGCS_PORT|$TGCS_TOKEN|$TGCS_DATA_DIR\" > {}", out.display())],
            cwd: None,
            port: 4321,
            token: "secret-token-abc".into(),
            data_dir: PathBuf::from("/tmp/some-data"),
        };
        let mut child = spawn(&spec).unwrap();
        child.wait().unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "4321|secret-token-abc|/tmp/some-data");
        let _ = std::fs::remove_file(out);
    }

    #[cfg(unix)]
    #[test]
    fn stop_kills_a_running_child_and_can_be_repeated() {
        let spec = LaunchSpec { program: PathBuf::from("sleep"), args: vec!["30".into()], cwd: None, port: 1, token: "t".into(), data_dir: PathBuf::from("/tmp") };
        let mut child = spawn(&spec).unwrap();
        assert!(child.try_wait().unwrap().is_none(), "still running");
        stop(&mut child);
        assert!(child.try_wait().unwrap().is_some(), "reaped");
        stop(&mut child);
    }

    #[test]
    fn spawn_reports_a_missing_program() {
        let spec = LaunchSpec { program: PathBuf::from("/definitely/not/here"), args: vec![], cwd: None, port: 1, token: "t".into(), data_dir: PathBuf::from("/tmp") };
        assert!(spawn(&spec).is_err());
    }
}
