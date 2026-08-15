#[cfg(feature = "desktop")]
mod commands;
mod engine;
mod model;

#[cfg(feature = "desktop")]
use model::AppState;

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
            commands::open_audience,
            commands::toggle_audience_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Typst Presenter");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {
    panic!("Typst Presenter was built without the `desktop` feature");
}
