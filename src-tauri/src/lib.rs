//! Obsidian Campus — Tauri backend.
//!
//! The backend's entire job in this phase is durable local storage. It holds no
//! opinion about agents, buildings or workflows; those live in the frontend
//! configuration and, later, in a real agent runtime.

mod store;

use store::{CampusStore, StoreError};
use tauri::Manager;

/// Whether persistence is running on the real on-disk database or the
/// in-memory fallback. Exposed to the frontend for the diagnostics panel.
struct StoreHealth(&'static str);

#[tauri::command]
fn store_status(health: tauri::State<'_, StoreHealth>) -> &'static str {
    health.0
}

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
            // A database that cannot be opened (permissions, corruption, full
            // disk) must degrade the app, never prevent it from starting: fall
            // back to an in-memory store and tell the frontend.
            let (store, health) = match app.path().app_data_dir() {
                Ok(dir) => match CampusStore::open(&dir.join("campus.sqlite")) {
                    Ok(s) => (s, "sqlite"),
                    Err(err) => {
                        eprintln!(
                            "obsidian-campus: could not open the campus database ({err}); \
                             continuing with in-memory storage for this session"
                        );
                        (CampusStore::open_in_memory()?, "memory")
                    }
                },
                Err(err) => {
                    eprintln!(
                        "obsidian-campus: could not resolve the application data directory \
                         ({err}); continuing with in-memory storage for this session"
                    );
                    (CampusStore::open_in_memory()?, "memory")
                }
            };
            app.manage(store);
            app.manage(StoreHealth(health));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_document,
            save_document,
            clear_document,
            list_revisions,
            store_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Obsidian Campus");
}
