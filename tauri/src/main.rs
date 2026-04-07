#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod commands;
mod git;
mod synced_state;
mod watcher;

use std::fs;
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

    let Ok(app_dir) = window.app_handle().path().app_data_dir() else {
        return;
    };
    let store_path = app_dir.join("app-state.json");
    let content = fs::read_to_string(&store_path).unwrap_or_else(|_| "{}".into());
    let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    if let Some(obj) = json.as_object_mut() {
        obj.insert("wm-children".into(), serde_json::json!(children));
        let stale_keys: Vec<String> = obj
            .keys()
            .filter(|k| {
                for prefix in ["wm-layout-", "wm-geometry-", "wm-zones-"] {
                    if let Some(id) = k.strip_prefix(prefix) {
                        if id != "main" && !children.contains(&id.to_string()) {
                            return true;
                        }
                    }
                }
                false
            })
            .cloned()
            .collect();
        for key in stale_keys {
            obj.remove(&key);
        }

        if let Ok(new_content) = serde_json::to_string(obj) {
            let _ = fs::write(&store_path, new_content);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(watcher::WatcherState::new())
        .manage(synced_state::SyncedStateStore::new())
        .manage(Arc::new(agent::AgentState::new()))
        .invoke_handler(tauri::generate_handler![
            commands::read_directory,
            commands::read_file_content,
            commands::read_file_head,
            commands::read_binary_file,
            commands::is_wayland,
            commands::get_cursor_window,
            commands::get_window_monitor,
            commands::set_window_on_monitor,
            commands::get_monitors,
            watcher::watch_path,
            watcher::unwatch_path,
            git::git_status,
            git::git_log,
            git::git_branch,
            git::git_last_commit_time,
            git::git_init,
            synced_state::set_synced_state,
            synced_state::get_synced_state,
            synced_state::clear_synced_state,
            agent::commands::agent_start_task,
            agent::commands::agent_abort,
            agent::commands::agent_get_config,
            agent::commands::agent_set_config,
            agent::commands::agent_test_connection,
        ])
        .setup(|app| {
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
