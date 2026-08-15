//! Tinymist language-server transport and process lifecycle.
//!
//! The editor talks to Tinymist over the standard LSP byte stream.  Keeping
//! framing and process ownership in Rust gives the webview a single, small
//! JSON-RPC seam while leaving Tinymist messages untouched.

#[cfg(feature = "desktop")]
use crate::model::AppState;
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::ffi::OsStr;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

#[cfg(feature = "desktop")]
use std::process::{Child, ChildStdin, Stdio};
#[cfg(feature = "desktop")]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(feature = "desktop")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "desktop")]
use std::thread;
#[cfg(feature = "desktop")]
use tauri::{AppHandle, Emitter, Manager};

pub const TINYMIST_MESSAGE_EVENT: &str = "tinymist-message";
pub const TINYMIST_LOG_EVENT: &str = "tinymist-log";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TinymistMessage {
    pub generation: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TinymistLog {
    pub generation: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TinymistStatus {
    pub available: bool,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TinymistSessionInfo {
    pub generation: u64,
    pub root_path: String,
    pub source_path: String,
}

#[cfg(feature = "desktop")]
pub struct TinymistProcess {
    pub generation: u64,
    pub child: Child,
    pub stdin: Arc<Mutex<ChildStdin>>,
}

#[cfg(feature = "desktop")]
impl TinymistProcess {
    fn stop(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(feature = "desktop")]
impl Drop for TinymistProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(feature = "desktop")]
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Write a complete LSP message to a stream.
pub fn write_lsp_message<W: Write>(writer: &mut W, message: &str) -> io::Result<()> {
    let bytes = message.as_bytes();
    write!(writer, "Content-Length: {}\r\n\r\n", bytes.len())?;
    writer.write_all(bytes)?;
    writer.flush()
}

/// Read all complete LSP messages from a byte stream.
///
/// The reader accepts arbitrary packet boundaries and multiple frames in one
/// read.  A malformed `Content-Length` header is reported as an error instead
/// of being forwarded to the editor as a partial JSON-RPC message.
pub fn read_lsp_messages<R: Read, F: FnMut(String)>(
    mut reader: R,
    mut on_message: F,
) -> io::Result<()> {
    let mut pending = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            if pending.is_empty() {
                return Ok(());
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Tinymist closed the stream in the middle of an LSP message",
            ));
        }
        pending.extend_from_slice(&chunk[..read]);
        while let Some(message) = take_lsp_message(&mut pending)? {
            on_message(message);
        }
    }
}

fn take_lsp_message(buffer: &mut Vec<u8>) -> io::Result<Option<String>> {
    let Some(separator) = find_header_end(buffer) else {
        return Ok(None);
    };
    let header = std::str::from_utf8(&buffer[..separator]).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Tinymist emitted a non-UTF-8 LSP header: {error}"),
        )
    })?;
    let length = parse_content_length(header)?;
    let body_start = separator + 4;
    let body_end = body_start.checked_add(length).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Tinymist emitted an overflowing Content-Length header",
        )
    })?;
    if buffer.len() < body_end {
        return Ok(None);
    }
    let body = buffer[body_start..body_end].to_vec();
    buffer.drain(..body_end);
    String::from_utf8(body).map(Some).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Tinymist emitted non-UTF-8 JSON-RPC content: {error}"),
        )
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(header: &str) -> io::Result<usize> {
    for line in header.lines() {
        let Some((name, value)) = line.split_once(':') else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Tinymist emitted an invalid LSP header line: {line:?}"),
            ));
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            return value.trim().parse::<usize>().map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Tinymist emitted an invalid Content-Length: {error}"),
                )
            });
        }
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "Tinymist message has no Content-Length header",
    ))
}

pub(crate) fn resolve_tinymist_executable_from(
    configured: Option<&OsStr>,
    bundled_directories: &[PathBuf],
    search_path: Option<&OsStr>,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(path) = configured
        .map(Path::new)
        .filter(|path| is_executable_file(path))
    {
        return Ok(path.to_path_buf());
    }

    for directory in bundled_directories {
        let candidate = directory.join(platform_tinymist_name());
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
    }

    if let Some(path) = search_path.and_then(|value| {
        env::split_paths(value)
            .map(|directory| directory.join(platform_tinymist_name()))
            .find(|path| is_executable_file(path))
    }) {
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    {
        let mut candidates = vec![
            PathBuf::from("/opt/homebrew/bin/tinymist"),
            PathBuf::from("/usr/local/bin/tinymist"),
        ];
        if let Some(home) = home {
            candidates.push(home.join(".cargo/bin/tinymist"));
            candidates.push(home.join(".local/bin/tinymist"));
        }
        if let Some(path) = candidates.into_iter().find(|path| is_executable_file(path)) {
            return Ok(path);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
    }

    let configured_hint = "TINYMIST_PATH";
    Err(format!(
        "Tinymist is unavailable. Install Tinymist, ensure `tinymist` is on PATH, or set {configured_hint} to an executable."
    ))
}

fn resolve_tinymist_executable(bundled_directories: &[PathBuf]) -> Result<PathBuf, String> {
    resolve_tinymist_executable_from(
        env::var_os("TINYMIST_PATH").as_deref(),
        bundled_directories,
        env::var_os("PATH").as_deref(),
        env::var_os("HOME").as_deref().map(Path::new),
    )
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn platform_tinymist_name() -> &'static str {
    if cfg!(windows) {
        "tinymist.exe"
    } else {
        "tinymist"
    }
}

#[cfg(feature = "desktop")]
fn bundled_directories(app: Option<&AppHandle>) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(app) = app {
        if let Ok(resource) = app.path().resource_dir() {
            directories.push(resource);
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            directories.push(parent.to_path_buf());
        }
    }
    directories
}

#[cfg(feature = "desktop")]
pub fn tinymist_status() -> TinymistStatus {
    let directories = bundled_directories(None);
    let executable = match resolve_tinymist_executable(&directories) {
        Ok(path) => path,
        Err(error) => {
            return TinymistStatus {
                available: false,
                version: None,
                executable: None,
                error: Some(error),
            }
        }
    };
    match std::process::Command::new(&executable)
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => TinymistStatus {
            available: true,
            version: Some(parse_tinymist_version(&String::from_utf8_lossy(
                &output.stdout,
            ))),
            executable: Some(executable.to_string_lossy().into_owned()),
            error: None,
        },
        Ok(output) => TinymistStatus {
            available: false,
            version: None,
            executable: Some(executable.to_string_lossy().into_owned()),
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_owned()),
        },
        Err(error) => TinymistStatus {
            available: false,
            version: None,
            executable: Some(executable.to_string_lossy().into_owned()),
            error: Some(error.to_string()),
        },
    }
}

fn parse_tinymist_version(output: &str) -> String {
    if let Some(version) = output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Build Git Describe:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }) {
        return format!("tinymist {version}");
    }
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("tinymist")
        .to_owned()
}

#[cfg(feature = "desktop")]
pub fn start_tinymist(state: &AppState, app: &AppHandle) -> Result<TinymistSessionInfo, String> {
    let (root_path, source_path) = {
        let session = state.session.lock().map_err(lock_error)?;
        let session = session
            .as_ref()
            .ok_or_else(|| "No deck is open.".to_owned())?;
        (session.root.clone(), session.source_path.clone())
    };
    stop_process(state);

    let executable = resolve_tinymist_executable(&bundled_directories(Some(app)))?;
    let mut child = std::process::Command::new(&executable)
        .arg("lsp")
        .current_dir(&root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Unable to start Tinymist at {}: {error}",
                executable.display()
            )
        })?;
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => return stop_spawned_child(child, "Tinymist did not expose a stdin pipe."),
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => return stop_spawned_child(child, "Tinymist did not expose a stdout pipe."),
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => return stop_spawned_child(child, "Tinymist did not expose a stderr pipe."),
    };
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    let stdin = Arc::new(Mutex::new(stdin));
    let process = TinymistProcess {
        generation,
        child,
        stdin,
    };

    let reader_app = app.clone();
    thread::spawn(move || {
        let result = read_lsp_messages(stdout, |message| {
            let _ = reader_app.emit(
                TINYMIST_MESSAGE_EVENT,
                TinymistMessage {
                    generation,
                    message,
                },
            );
        });
        let message = match result {
            Ok(()) => "Tinymist stopped unexpectedly.".to_owned(),
            Err(error) => format!("Tinymist output stopped: {error}"),
        };
        let _ = reader_app.emit(
            TINYMIST_LOG_EVENT,
            TinymistLog {
                generation,
                message,
            },
        );
    });

    let log_app = app.clone();
    thread::spawn(move || {
        let mut stderr = stderr;
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        if !text.trim().is_empty() {
            let _ = log_app.emit(
                TINYMIST_LOG_EVENT,
                TinymistLog {
                    generation,
                    message: text,
                },
            );
        }
    });

    *state.tinymist.lock().map_err(lock_error)? = Some(process);
    Ok(TinymistSessionInfo {
        generation,
        root_path: root_path.to_string_lossy().into_owned(),
        source_path: source_path.to_string_lossy().into_owned(),
    })
}

#[cfg(feature = "desktop")]
fn stop_spawned_child(mut child: Child, message: &str) -> Result<TinymistSessionInfo, String> {
    let _ = child.kill();
    let _ = child.wait();
    Err(message.to_owned())
}

#[cfg(feature = "desktop")]
pub fn send_tinymist_message(
    state: &AppState,
    generation: u64,
    message: String,
) -> Result<(), String> {
    let stdin = {
        let process = state.tinymist.lock().map_err(lock_error)?;
        let process = process
            .as_ref()
            .ok_or_else(|| "Tinymist is not running.".to_owned())?;
        if process.generation != generation {
            return Err(format!(
                "Ignoring stale Tinymist generation {generation}; active generation is {}.",
                process.generation
            ));
        }
        Arc::clone(&process.stdin)
    };
    let value: Value = serde_json::from_str(&message)
        .map_err(|error| format!("Tinymist message must be valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("Tinymist message must be a JSON object.".to_owned());
    }
    let mut stdin = stdin.lock().map_err(lock_error)?;
    write_lsp_message(&mut *stdin, &message).map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
pub fn stop_process(state: &AppState) {
    stop_process_generation(state, None);
}

#[cfg(feature = "desktop")]
pub fn stop_process_generation(state: &AppState, generation: Option<u64>) {
    if let Ok(mut process) = state.tinymist.lock() {
        if process
            .as_ref()
            .is_some_and(|active| !stop_request_matches(active.generation, generation))
        {
            return;
        }
        if let Some(process) = process.take() {
            process.stop();
        }
    }
}

fn stop_request_matches(active_generation: u64, requested_generation: Option<u64>) -> bool {
    requested_generation.is_none_or(|requested| requested == active_generation)
}

#[cfg(feature = "desktop")]
fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("Application state is unavailable: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Cursor, Read};

    struct ChunkedReader {
        bytes: Vec<u8>,
        offset: usize,
        chunk_size: usize,
    }

    impl Read for ChunkedReader {
        fn read(&mut self, destination: &mut [u8]) -> io::Result<usize> {
            if self.offset == self.bytes.len() {
                return Ok(0);
            }
            let size = self
                .chunk_size
                .min(destination.len())
                .min(self.bytes.len() - self.offset);
            destination[..size].copy_from_slice(&self.bytes[self.offset..self.offset + size]);
            self.offset += size;
            Ok(size)
        }
    }

    #[test]
    fn writes_unicode_content_length_in_bytes() {
        let mut output = Vec::new();
        write_lsp_message(&mut output, r#"{"jsonrpc":"2.0","message":"你好"}"#).unwrap();
        assert!(output.starts_with(b"Content-Length: 36\r\n\r\n"));
        assert!(output.ends_with("你好\"}".as_bytes()));
    }

    #[test]
    fn reads_multiple_frames_from_one_stream() {
        let bytes = b"Content-Length: 2\r\n\r\n{}Content-Length: 2\r\n\r\n[]";
        let mut messages = Vec::new();
        read_lsp_messages(Cursor::new(bytes), |message| messages.push(message)).unwrap();
        assert_eq!(messages, vec!["{}", "[]"]);
    }

    #[test]
    fn reads_frames_split_across_reads() {
        let bytes = b"Content-Length: 5\r\n\r\nhello";
        let mut messages = Vec::new();
        read_lsp_messages(
            ChunkedReader {
                bytes: bytes.to_vec(),
                offset: 0,
                chunk_size: 1,
            },
            |message| messages.push(message),
        )
        .unwrap();
        assert_eq!(messages, vec!["hello"]);
    }

    #[test]
    fn rejects_invalid_header() {
        let error = read_lsp_messages(Cursor::new(b"Content-Length nope\r\n\r\n{}"), |_| {})
            .expect_err("invalid header must fail");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[cfg(unix)]
    fn create_test_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, []).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn resolver_prefers_configured_then_bundled_then_path() {
        let root = std::env::temp_dir().join(format!("tinymist-resolver-{}", std::process::id()));
        let configured = root.join("configured");
        let bundled_dir = root.join("bundle");
        let path_dir = root.join("path");
        fs::create_dir_all(&bundled_dir).unwrap();
        fs::create_dir_all(&path_dir).unwrap();
        let bundled = bundled_dir.join("tinymist");
        let path = path_dir.join("tinymist");
        create_test_executable(&configured);
        create_test_executable(&bundled);
        create_test_executable(&path);
        let resolved = resolve_tinymist_executable_from(
            Some(configured.as_os_str()),
            std::slice::from_ref(&bundled_dir),
            Some(path_dir.as_os_str()),
            None,
        )
        .unwrap();
        assert_eq!(resolved, configured);
        fs::remove_file(configured).unwrap();
        let resolved = resolve_tinymist_executable_from(
            None,
            &[bundled_dir],
            Some(path_dir.as_os_str()),
            None,
        )
        .unwrap();
        assert_eq!(resolved, bundled);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(all(unix, feature = "desktop"))]
    #[test]
    fn stale_generation_is_rejected_before_writing() {
        let mut child = std::process::Command::new("cat")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let state = AppState::default();
        *state.tinymist.lock().unwrap() = Some(TinymistProcess {
            generation: 7,
            child,
            stdin: Arc::new(Mutex::new(stdin)),
        });

        let error = send_tinymist_message(&state, 6, r#"{"jsonrpc":"2.0"}"#.to_owned())
            .expect_err("stale generation must be rejected");
        assert!(error.contains("stale Tinymist generation"));
        let error = send_tinymist_message(&state, 7, "[]".to_owned())
            .expect_err("non-object JSON must be rejected");
        assert!(error.contains("JSON object"));
        stop_process(&state);
    }

    #[test]
    fn stale_cleanup_cannot_stop_a_newer_generation() {
        assert!(stop_request_matches(7, Some(7)));
        assert!(!stop_request_matches(8, Some(7)));
        assert!(stop_request_matches(8, None));
    }

    #[test]
    fn extracts_a_compact_version_from_release_metadata() {
        let output =
            "tinymist \nBuild Timestamp: now\nBuild Git Describe: v0.15.2\nCommit SHA: abc";
        assert_eq!(parse_tinymist_version(output), "tinymist v0.15.2");
        assert_eq!(
            parse_tinymist_version("tinymist 0.15.2\n"),
            "tinymist 0.15.2"
        );
    }
}
