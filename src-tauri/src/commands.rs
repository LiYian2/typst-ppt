use crate::engine;
use crate::model::{
    AppState, BuildSnapshot, BuildStatus, PresentationState, Session, SourceDocument,
    WatchController,
};
use crate::tinymist::{self, TinymistSessionInfo, TinymistStatus};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const BUILD_EVENT: &str = "deck-build";
const PRESENTATION_EVENT: &str = "presentation-state";
pub const AUDIENCE_EVENT: &str = "audience-state";

#[tauri::command]
pub fn typst_status() -> Result<String, String> {
    engine::typst_version()
}

#[tauri::command]
pub fn tinymist_status() -> TinymistStatus {
    tinymist::tinymist_status()
}

#[tauri::command]
pub fn start_tinymist(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TinymistSessionInfo, String> {
    tinymist::start_tinymist(&state, &app)
}

#[tauri::command]
pub fn send_tinymist_message(
    state: State<'_, AppState>,
    generation: u64,
    message: String,
) -> Result<(), String> {
    tinymist::send_tinymist_message(&state, generation, message)
}

#[tauri::command]
pub fn stop_tinymist(state: State<'_, AppState>, generation: Option<u64>) -> Result<(), String> {
    tinymist::stop_process_generation(&state, generation);
    Ok(())
}

#[tauri::command]
pub fn load_deck(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<BuildSnapshot, String> {
    let source_path = canonical_typ_path(&path)?;
    let root = source_path
        .parent()
        .ok_or_else(|| "The selected Typst file has no parent directory.".to_owned())?
        .to_path_buf();

    stop_watching(&state);
    tinymist::stop_process(&state);
    let initial = engine::build_deck(&source_path, &root);
    let snapshot = initial.snapshot.clone();
    let output_path = initial.output_path;
    let root = initial.root;

    *state.session.lock().map_err(lock_error)? = Some(Session {
        source_path: source_path.clone(),
        source_root: source_path
            .parent()
            .expect("canonical source paths always have a parent")
            .to_path_buf(),
        root: root.clone(),
        output_path,
        snapshot: snapshot.clone(),
        current_page: 0,
    });

    start_watching(app.clone(), &state, root)?;
    let _ = app.emit(BUILD_EVENT, snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub fn rebuild(app: AppHandle, state: State<'_, AppState>) -> Result<BuildSnapshot, String> {
    build_current(&app, &state).ok_or_else(|| "No deck is open.".to_owned())
}

#[tauri::command]
pub fn session_snapshot(state: State<'_, AppState>) -> Result<Option<BuildSnapshot>, String> {
    let session = state.session.lock().map_err(lock_error)?;
    Ok(session.as_ref().map(|session| session.snapshot.clone()))
}

#[tauri::command]
pub fn presentation_state(state: State<'_, AppState>) -> Result<PresentationState, String> {
    let session = state.session.lock().map_err(lock_error)?;
    let session = session
        .as_ref()
        .ok_or_else(|| "No deck is open.".to_owned())?;
    Ok(PresentationState {
        current_page: session.current_page,
        revision: session.snapshot.revision,
    })
}

#[tauri::command]
pub fn set_current_page(
    app: AppHandle,
    state: State<'_, AppState>,
    page: usize,
) -> Result<PresentationState, String> {
    let value = {
        let mut session = state.session.lock().map_err(lock_error)?;
        let session = session
            .as_mut()
            .ok_or_else(|| "No deck is open.".to_owned())?;
        session.current_page = page;
        PresentationState {
            current_page: page,
            revision: session.snapshot.revision,
        }
    };
    app.emit(PRESENTATION_EVENT, value.clone())
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
pub fn pdf_bytes(state: State<'_, AppState>) -> Result<Response, String> {
    let path = {
        let session = state.session.lock().map_err(lock_error)?;
        session
            .as_ref()
            .and_then(|session| session.output_path.clone())
            .ok_or_else(|| "There is no successful PDF build yet.".to_owned())?
    };
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn open_current_pdf(state: State<'_, AppState>) -> Result<(), String> {
    let path = {
        let session = state.session.lock().map_err(lock_error)?;
        session
            .as_ref()
            .and_then(|session| session.output_path.clone())
            .ok_or_else(|| "There is no successful PDF build yet.".to_owned())?
    };
    open::that(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn source_document(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<SourceDocument, String> {
    let package_roots = engine::typst_package_roots();
    let resolved = {
        let session = state.session.lock().map_err(lock_error)?;
        let session = session
            .as_ref()
            .ok_or_else(|| "No deck is open.".to_owned())?;
        resolve_source_path(session, path.as_deref(), SourceAccess::Read, package_roots)?
    };
    let text = fs::read_to_string(&resolved.path).map_err(|error| error.to_string())?;
    Ok(SourceDocument {
        path: resolved.path.to_string_lossy().into_owned(),
        text,
        read_only: resolved.read_only,
    })
}

#[tauri::command]
pub fn save_source(
    state: State<'_, AppState>,
    path: Option<String>,
    text: String,
) -> Result<(), String> {
    let path = {
        let session = state.session.lock().map_err(lock_error)?;
        let session = session
            .as_ref()
            .ok_or_else(|| "No deck is open.".to_owned())?;
        resolve_source_path(session, path.as_deref(), SourceAccess::Write, &[])?.path
    };
    fs::write(path, text).map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceAccess {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSource {
    path: PathBuf,
    read_only: bool,
}

fn resolve_source_path(
    session: &Session,
    requested: Option<&str>,
    access: SourceAccess,
    package_roots: &[PathBuf],
) -> Result<ResolvedSource, String> {
    let candidate = requested
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                session.root.join(path)
            }
        })
        .unwrap_or_else(|| session.source_path.clone());
    let canonical = candidate.canonicalize().map_err(|error| {
        format!(
            "Unable to resolve source file {}: {error}",
            candidate.display()
        )
    })?;
    if canonical.extension().and_then(|value| value.to_str()) != Some("typ") {
        return Err("Source jumps may only open .typ files.".to_owned());
    }
    let project_root = session
        .root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve deck root: {error}"))?;
    let source_root = session
        .source_root
        .canonicalize()
        .map_err(|error| format!("Unable to resolve source root: {error}"))?;
    if canonical.starts_with(&project_root) {
        let read_only = !canonical.starts_with(&source_root);
        if access == SourceAccess::Write && read_only {
            return Err(format!(
                "Source path {} is outside the editable deck root.",
                canonical.display()
            ));
        }
        return Ok(ResolvedSource {
            path: canonical,
            read_only,
        });
    }
    {
        let in_package_root = access == SourceAccess::Read
            && package_roots.iter().any(|package_root| {
                package_root
                    .canonicalize()
                    .is_ok_and(|package_root| canonical.starts_with(package_root))
            });
        if in_package_root {
            return Ok(ResolvedSource {
                path: canonical,
                read_only: true,
            });
        }
        Err(format!(
            "Source path {} is outside the deck root.",
            canonical.display()
        ))
    }
}

#[tauri::command]
pub fn audience_open(app: AppHandle) -> bool {
    app.get_webview_window("audience").is_some()
}

#[tauri::command]
// WebView2 can deadlock when a window is built from a synchronous command on Windows.
pub async fn open_audience(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("audience") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        let _ = app.emit(AUDIENCE_EVENT, true);
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "audience",
        WebviewUrl::App("index.html?mode=audience".into()),
    )
    .title("Typst Presenter — Audience")
    .inner_size(1280.0, 720.0)
    .min_inner_size(640.0, 360.0)
    .decorations(true)
    .build()
    .map_err(|error| error.to_string())?;
    let _ = app.emit(AUDIENCE_EVENT, true);
    Ok(())
}

#[tauri::command]
pub fn toggle_audience_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("audience")
        .ok_or_else(|| "Open the audience window first.".to_owned())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

fn canonical_typ_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if path.extension().and_then(|value| value.to_str()) != Some("typ") {
        return Err("Choose a .typ file.".to_owned());
    }
    if !path.is_file() {
        return Err("The selected Typst file does not exist.".to_owned());
    }
    path.canonicalize().map_err(|error| error.to_string())
}

fn start_watching(
    app: AppHandle,
    state: &State<'_, AppState>,
    root: PathBuf,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<()>();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);

    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.as_ref().is_ok_and(is_relevant_event) {
                let _ = tx.send(());
            }
        })
        .map_err(|error| error.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    std::thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            if rx.recv_timeout(Duration::from_millis(250)).is_err() {
                continue;
            }
            // Re-start the quiet period for every coalesced editor event.
            while rx.recv_timeout(Duration::from_millis(180)).is_ok() {}
            if stop_for_thread.load(Ordering::Relaxed) {
                break;
            }
            let state = app.state::<AppState>();
            let _ = build_current(&app, &state);
        }
    });

    *state.watcher.lock().map_err(lock_error)? = Some(WatchController {
        stop,
        _watcher: watcher,
    });
    Ok(())
}

fn stop_watching(state: &State<'_, AppState>) {
    if let Ok(mut slot) = state.watcher.lock() {
        if let Some(controller) = slot.take() {
            controller.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn build_current(app: &AppHandle, state: &State<'_, AppState>) -> Option<BuildSnapshot> {
    let (source_path, root, previous_output, previous_notes) = {
        let session = state.session.lock().ok()?;
        let session = session.as_ref()?;
        (
            session.source_path.clone(),
            session.root.clone(),
            session.output_path.clone(),
            session.snapshot.notes.clone(),
        )
    };

    let outcome = engine::build_deck(&source_path, &root);
    let mut published = outcome.snapshot.clone();
    {
        let mut session = state.session.lock().ok()?;
        let session = session.as_mut()?;
        session.root = outcome.root;
        if outcome.snapshot.status == BuildStatus::Ready {
            session.output_path = outcome.output_path;
            session.snapshot = outcome.snapshot.clone();
        } else {
            // Preserve last-good assets and notes while publishing fresh diagnostics.
            published.output_path = previous_output
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned());
            published.notes = previous_notes;
            session.snapshot = published.clone();
        }
    }
    let _ = app.emit(BUILD_EVENT, published.clone());
    Some(published)
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("Application state is unavailable: {error}")
}

fn is_relevant_event(event: &notify::Event) -> bool {
    const IGNORED_DIRECTORIES: [&str; 5] = [".git", "node_modules", "target", "dist", ".idea"];
    event.paths.iter().any(|path| {
        !path.components().any(|component| {
            let value = component.as_os_str().to_string_lossy();
            IGNORED_DIRECTORIES.contains(&value.as_ref())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_session(root: &Path, source_path: &Path) -> Session {
        Session {
            source_path: source_path.to_path_buf(),
            source_root: source_path
                .parent()
                .expect("test source has a parent")
                .to_path_buf(),
            root: root.to_path_buf(),
            output_path: None,
            snapshot: BuildSnapshot {
                revision: 1,
                source_path: source_path.to_string_lossy().into_owned(),
                output_path: None,
                status: BuildStatus::Ready,
                diagnostics: Vec::new(),
                notes: Vec::new(),
                elapsed_ms: 0,
                typst_version: "test".to_owned(),
            },
            current_page: 0,
        }
    }

    #[test]
    fn source_path_defaults_to_active_deck_and_stays_inside_root() {
        let project_root = std::env::temp_dir().join(format!(
            "typst-presenter-source-boundary-{}",
            std::process::id()
        ));
        let source_root = project_root.join("slides");
        fs::create_dir_all(&source_root).unwrap();
        let source = source_root.join("main.typ");
        let include = source_root.join("chapter.typ");
        let project_dependency = project_root.join("shared.typ");
        let outside = project_root
            .parent()
            .expect("temporary root has a parent")
            .join("outside.typ");
        let package_root = project_root
            .parent()
            .expect("temporary root has a parent")
            .join(format!("typst-presenter-packages-{}", std::process::id()));
        let package_source = package_root.join("preview/touying/0.7.4/src/utils.typ");
        fs::write(&source, "#import \"chapter.typ\": *").unwrap();
        fs::write(&include, "#let answer = 42").unwrap();
        fs::write(&project_dependency, "#let shared = true").unwrap();
        fs::write(&outside, "#let answer = 0").unwrap();
        fs::create_dir_all(package_source.parent().unwrap()).unwrap();
        fs::write(&package_source, "#let dependency = true").unwrap();
        let session = test_session(&project_root, &source);

        assert_eq!(
            resolve_source_path(&session, None, SourceAccess::Write, &[]).unwrap(),
            ResolvedSource {
                path: source.canonicalize().unwrap(),
                read_only: false
            }
        );
        assert_eq!(
            resolve_source_path(
                &session,
                Some(project_dependency.to_str().unwrap()),
                SourceAccess::Read,
                &[],
            )
            .unwrap(),
            ResolvedSource {
                path: project_dependency.canonicalize().unwrap(),
                read_only: true
            }
        );
        assert!(resolve_source_path(
            &session,
            Some(project_dependency.to_str().unwrap()),
            SourceAccess::Write,
            &[],
        )
        .is_err());
        assert_eq!(
            resolve_source_path(
                &session,
                Some("slides/chapter.typ"),
                SourceAccess::Read,
                &[],
            )
            .unwrap(),
            ResolvedSource {
                path: include.canonicalize().unwrap(),
                read_only: false
            }
        );
        assert_eq!(
            resolve_source_path(
                &session,
                Some(package_source.to_str().unwrap()),
                SourceAccess::Read,
                std::slice::from_ref(&package_root),
            )
            .unwrap(),
            ResolvedSource {
                path: package_source.canonicalize().unwrap(),
                read_only: true
            }
        );
        assert!(resolve_source_path(
            &session,
            Some(package_source.to_str().unwrap()),
            SourceAccess::Write,
            std::slice::from_ref(&package_root),
        )
        .is_err());
        assert!(
            resolve_source_path(&session, Some("../outside.typ"), SourceAccess::Read, &[]).is_err()
        );
        assert!(resolve_source_path(
            &session,
            Some(outside.to_str().unwrap()),
            SourceAccess::Read,
            &[],
        )
        .is_err());

        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(project_root).unwrap();
        fs::remove_dir_all(package_root).unwrap();
    }
}
