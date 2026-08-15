#[cfg(feature = "desktop")]
use crate::tinymist::TinymistProcess;
use serde::Serialize;
#[cfg(feature = "desktop")]
use std::path::PathBuf;
#[cfg(feature = "desktop")]
use std::sync::atomic::AtomicBool;
#[cfg(feature = "desktop")]
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerNote {
    pub page: usize,
    pub text: String,
    pub label: String,
    pub overlay: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSnapshot {
    pub revision: u64,
    pub source_path: String,
    pub output_path: Option<String>,
    pub status: BuildStatus,
    pub diagnostics: Vec<String>,
    pub notes: Vec<SpeakerNote>,
    pub elapsed_ms: u128,
    pub typst_version: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BuildStatus {
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationState {
    pub current_page: usize,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocument {
    pub path: String,
    pub text: String,
    pub read_only: bool,
}

#[cfg(feature = "desktop")]
pub struct Session {
    pub source_path: PathBuf,
    pub source_root: PathBuf,
    pub root: PathBuf,
    pub output_path: Option<PathBuf>,
    pub snapshot: BuildSnapshot,
    pub current_page: usize,
}

#[cfg(feature = "desktop")]
pub struct WatchController {
    pub stop: Arc<AtomicBool>,
    // Keeping the watcher alive is what keeps operating-system notifications active.
    pub _watcher: notify::RecommendedWatcher,
}

#[cfg(feature = "desktop")]
#[derive(Default)]
pub struct AppState {
    pub session: Mutex<Option<Session>>,
    pub watcher: Mutex<Option<WatchController>>,
    pub tinymist: Mutex<Option<TinymistProcess>>,
}
