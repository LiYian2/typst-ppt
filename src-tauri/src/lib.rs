#[cfg(feature = "desktop")]
mod commands;
mod engine;
mod model;
mod tinymist;

#[cfg(feature = "desktop")]
use model::AppState;
#[cfg(feature = "desktop")]
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::typst_status,
            commands::load_deck,
            commands::rebuild,
            commands::session_snapshot,
            commands::presentation_state,
            commands::set_current_page,
            commands::pdf_bytes,
            commands::open_current_pdf,
            commands::source_document,
            commands::save_source,
            commands::tinymist_status,
            commands::start_tinymist,
            commands::send_tinymist_message,
            commands::stop_tinymist,
            commands::audience_open,
            commands::open_audience,
            commands::toggle_audience_fullscreen,
        ])
        .on_window_event(|window, event| {
            if window.label() == "audience" && matches!(event, WindowEvent::Destroyed) {
                let _ = window.app_handle().emit(commands::AUDIENCE_EVENT, false);
            }
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                let state = window.app_handle().state::<AppState>();
                tinymist::stop_process(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Typst Presenter");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("Typst Presenter was built without the `desktop` feature");
}
