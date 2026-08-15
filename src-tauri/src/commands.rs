use crate::engine;
use crate::model::{
    AppState, BuildSnapshot, BuildStatus, PresentationState, Session, WatchController,
};
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

#[tauri::command]
pub fn typst_status() -> Result<String, String> {
    engine::typst_version()
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
    let initial = engine::build_deck(&source_path, &root);
    let snapshot = initial.snapshot.clone();
    let output_path = initial.output_path;

    *state.session.lock().map_err(lock_error)? = Some(Session {
        source_path: source_path.clone(),
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
pub fn open_audience(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("audience") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
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
