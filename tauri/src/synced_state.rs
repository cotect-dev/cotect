use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct SyncedStatePayload {
    state: serde_json::Value,
    source: String,
}

struct StoreEntry {
    state: serde_json::Value,
    source: String,
}

pub struct SyncedStateStore {
    entries: Mutex<HashMap<String, StoreEntry>>,
    dirty: Mutex<HashSet<String>>,
}

impl SyncedStateStore {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            dirty: Mutex::new(HashSet::new()),
        }
    }
}

#[tauri::command]
pub fn set_synced_state(
    name: String,
    state: serde_json::Value,
    source: String,
    app_state: tauri::State<'_, SyncedStateStore>,
) -> Result<(), String> {
    {
        let mut entries = app_state.entries.lock().map_err(|e| e.to_string())?;
        entries.insert(
            name.clone(),
            StoreEntry {
                state,
                source,
            },
        );
    }
    {
        let mut dirty = app_state.dirty.lock().map_err(|e| e.to_string())?;
        dirty.insert(name);
    }
    Ok(())
}

#[tauri::command]
pub fn get_synced_state(
    name: String,
    app_state: tauri::State<'_, SyncedStateStore>,
) -> Result<Option<serde_json::Value>, String> {
    let entries = app_state.entries.lock().map_err(|e| e.to_string())?;
    Ok(entries.get(&name).map(|e| e.state.clone()))
}

#[tauri::command]
pub fn clear_synced_state(
    name: String,
    app_state: tauri::State<'_, SyncedStateStore>,
) -> Result<(), String> {
    {
        let mut entries = app_state.entries.lock().map_err(|e| e.to_string())?;
        entries.remove(&name);
    }
    {
        let mut dirty = app_state.dirty.lock().map_err(|e| e.to_string())?;
        dirty.remove(&name);
    }
    Ok(())
}

pub fn start_batch_broadcaster(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));

        let state = app.state::<SyncedStateStore>();

        let dirty_names: Vec<String> = {
            let mut dirty = match state.dirty.lock() {
                Ok(d) => d,
                Err(_) => continue,
            };
            dirty.drain().collect()
        };

        if dirty_names.is_empty() {
            continue;
        }

        let entries = match state.entries.lock() {
            Ok(e) => e,
            Err(_) => continue,
        };

        for name in dirty_names {
            if let Some(entry) = entries.get(&name) {
                let payload = SyncedStatePayload {
                    state: entry.state.clone(),
                    source: entry.source.clone(),
                };
                let event_name = format!("synced-state-update:{}", name);
                let _ = app.emit(&event_name, payload);
            }
        }
    });
}

pub fn load_all(app: &AppHandle) {
    let Ok(app_dir) = app.path().app_data_dir() else {
        return;
    };
    let store_path = app_dir.join("app-state.json");
    let content = match std::fs::read_to_string(&store_path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    let Some(obj) = json.as_object() else {
        return;
    };

    let state = app.state::<SyncedStateStore>();
    let mut entries = match state.entries.lock() {
        Ok(e) => e,
        Err(_) => return,
    };

    let prefix = "panel-";
    for (key, value) in obj {
        if let Some(name) = key.strip_prefix(prefix) {
            entries.insert(
                name.to_string(),
                StoreEntry {
                    state: value.clone(),
                    source: String::new(),
                },
            );
        }
    }
}

pub fn persist_all(app: &AppHandle) {
    let state = app.state::<SyncedStateStore>();
    let entries = match state.entries.lock() {
        Ok(e) => e,
        Err(_) => return,
    };

    if entries.is_empty() {
        return;
    }

    let Ok(app_dir) = app.path().app_data_dir() else {
        return;
    };
    let store_path = app_dir.join("app-state.json");
    let content = std::fs::read_to_string(&store_path).unwrap_or_else(|_| "{}".into());
    let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };

    if let Some(obj) = json.as_object_mut() {
        for (name, entry) in entries.iter() {
            obj.insert(format!("panel-{}", name), entry.state.clone());
        }
        if let Ok(new_content) = serde_json::to_string(obj) {
            let _ = std::fs::write(&store_path, new_content);
        }
    }
}

