//! Obsidian Campus — Tauri backend.
//!
//! The backend's entire job in this phase is durable local storage. It holds no
//! opinion about agents, buildings or workflows; those live in the frontend
//! configuration and, later, in a real agent runtime.

mod store;

use store::{CampusStore, StoreError};
use tauri::Manager;

#[tauri::command]
fn load_document(
    state: tauri::State<'_, CampusStore>,
    key: String,
) -> Result<Option<String>, StoreError> {
    state.load(&key)
}

#[tauri::command]
fn save_document(
    state: tauri::State<'_, CampusStore>,
    key: String,
    value: String,
) -> Result<(), StoreError> {
    state.save(&key, &value)
}

#[tauri::command]
fn clear_document(state: tauri::State<'_, CampusStore>, key: String) -> Result<(), StoreError> {
    state.clear(&key)
}

#[tauri::command]
fn list_revisions(
    state: tauri::State<'_, CampusStore>,
    key: String,
    limit: Option<u32>,
) -> Result<Vec<(i64, String)>, StoreError> {
    state.revisions(&key, limit.unwrap_or(20))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // ~/Library/Application Support/<bundle-id>/campus.sqlite on macOS.
            let dir = app
                .path()
                .app_data_dir()
                .expect("resolve application data directory");
            let store = CampusStore::open(&dir.join("campus.sqlite"))?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_document,
            save_document,
            clear_document,
            list_revisions
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Campus");
}
