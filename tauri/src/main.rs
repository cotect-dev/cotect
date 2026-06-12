#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cleanup;
mod commands;
mod db;
mod git;
mod synced_state;
mod watcher;

use std::sync::Arc;
use tauri::Manager;

/// Synchronously persist the alive child window list before exit —
/// JS-side beforeunload races against process::exit.
fn save_child_window_list(window: &tauri::Window) {
    let children: Vec<String> = window
        .app_handle()
        .webview_windows()
        .keys()
        .filter(|k| k.as_str() != "main")
        .cloned()
        .collect();
    let app = window.app_handle();
    let Some(db) = app.try_state::<std::sync::Arc<crate::db::Db>>() else {
        return;
    };
    let Ok(c) = db.conn() else { return };
    let _ = crate::db::kv::set(&c, "wm-children", &serde_json::json!(children));
    // Also clean up wm-{layout,geometry,zones}-{id} for windows that no longer exist
    if let Ok(prefix_results) = crate::db::kv::get_prefix(&c, "wm-") {
        for (key, _) in prefix_results {
            for prefix in ["wm-layout-", "wm-geometry-", "wm-zones-"] {
                if let Some(id) = key.strip_prefix(prefix) {
                    if id != "main" && !children.contains(&id.to_string()) {
                        let _ = crate::db::kv::delete(&c, &key);
                    }
                }
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(watcher::WatcherState::new())
        .manage(synced_state::SyncedStateStore::new())
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file_content,
            commands::write_file_content,
            commands::read_file_head,
            commands::read_binary_file,
            commands::is_wayland,
            commands::is_self_updatable,
            commands::app_info,
            commands::open_external,
            commands::get_cursor_window,
            commands::get_window_monitor,
            commands::set_window_on_monitor,
            commands::get_monitors,
            commands::show_in_folder,
            watcher::watch_path,
            watcher::unwatch_path,
            git::git_status,
            git::git_log,
            git::git_branch,
            git::git_branches,
            git::git_checkout,
            git::git_last_commit_time,
            git::git_remote_url,
            git::git_init,
            git::git_show_file,
            git::git_show_commit_file,
            git::git_diff_range,
            git::git_diff_working,
            git::git_file_times,
            synced_state::set_synced_state,
            synced_state::get_synced_state,
            synced_state::clear_synced_state,
            db::commands::kv_get,
            db::commands::kv_set,
            db::commands::kv_delete,
            db::commands::kv_get_prefix,
        ])
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            cleanup::drop_legacy_app_state_json(&app_dir);
            let db = Arc::new(db::Db::open(&app_dir.join("cotect.db"))?);
            app.manage(db);
            synced_state::load_all(app.handle());
            synced_state::start_batch_broadcaster(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    synced_state::persist_all(window.app_handle());
                    save_child_window_list(window);
                    for (label, win) in window.app_handle().webview_windows() {
                        if label != "main" {
                            let _ = win.close();
                        }
                    }
                    std::process::exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
