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
            let names: Vec<String> = dirty.drain().collect();
            names
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> SyncedStateStore {
        SyncedStateStore::new()
    }

    #[test]
    fn new_store_is_empty() {
        let store = make_store();
        let entries = store.entries.lock().unwrap();
        let dirty = store.dirty.lock().unwrap();
        assert!(entries.is_empty());
        assert!(dirty.is_empty());
    }

    #[test]
    fn set_inserts_entry_and_marks_dirty() {
        let store = make_store();
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert(
                "chat".to_string(),
                StoreEntry {
                    state: serde_json::json!({"messages": []}),
                    source: "window-a".to_string(),
                },
            );
        }
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.insert("chat".to_string());
        }

        let entries = store.entries.lock().unwrap();
        assert!(entries.contains_key("chat"));
        assert_eq!(entries["chat"].state, serde_json::json!({"messages": []}));
        assert_eq!(entries["chat"].source, "window-a");

        let dirty = store.dirty.lock().unwrap();
        assert!(dirty.contains("chat"));
    }

    #[test]
    fn get_returns_none_for_missing_key() {
        let store = make_store();
        let entries = store.entries.lock().unwrap();
        assert!(entries.get("nonexistent").is_none());
    }

    #[test]
    fn get_returns_state_for_existing_key() {
        let store = make_store();
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert(
                "chat".to_string(),
                StoreEntry {
                    state: serde_json::json!(42),
                    source: "w1".to_string(),
                },
            );
        }
        let entries = store.entries.lock().unwrap();
        assert_eq!(entries.get("chat").map(|e| e.state.clone()), Some(serde_json::json!(42)));
    }

    #[test]
    fn clear_removes_entry_and_dirty_flag() {
        let store = make_store();
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert(
                "chat".to_string(),
                StoreEntry {
                    state: serde_json::json!(null),
                    source: "w1".to_string(),
                },
            );
        }
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.insert("chat".to_string());
        }

        // Clear
        {
            let mut entries = store.entries.lock().unwrap();
            entries.remove("chat");
        }
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.remove("chat");
        }

        let entries = store.entries.lock().unwrap();
        assert!(!entries.contains_key("chat"));
        let dirty = store.dirty.lock().unwrap();
        assert!(!dirty.contains("chat"));
    }

    #[test]
    fn overwrite_existing_entry() {
        let store = make_store();
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert(
                "chat".to_string(),
                StoreEntry {
                    state: serde_json::json!({"v": 1}),
                    source: "w1".to_string(),
                },
            );
        }
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert(
                "chat".to_string(),
                StoreEntry {
                    state: serde_json::json!({"v": 2}),
                    source: "w2".to_string(),
                },
            );
        }
        let entries = store.entries.lock().unwrap();
        assert_eq!(entries["chat"].state, serde_json::json!({"v": 2}));
        assert_eq!(entries["chat"].source, "w2");
    }

    #[test]
    fn multiple_stores_independent() {
        let store = make_store();
        {
            let mut entries = store.entries.lock().unwrap();
            entries.insert("a".to_string(), StoreEntry { state: serde_json::json!(1), source: "w1".to_string() });
            entries.insert("b".to_string(), StoreEntry { state: serde_json::json!(2), source: "w1".to_string() });
        }
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.insert("a".to_string());
            dirty.insert("b".to_string());
        }

        // Clear only "a"
        {
            let mut entries = store.entries.lock().unwrap();
            entries.remove("a");
        }
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.remove("a");
        }

        let entries = store.entries.lock().unwrap();
        assert!(!entries.contains_key("a"));
        assert!(entries.contains_key("b"));
        assert_eq!(entries["b"].state, serde_json::json!(2));
    }

    #[test]
    fn dirty_set_drain_clears() {
        let store = make_store();
        {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.insert("a".to_string());
            dirty.insert("b".to_string());
        }

        let drained: Vec<String> = {
            let mut dirty = store.dirty.lock().unwrap();
            dirty.drain().collect()
        };

        assert_eq!(drained.len(), 2);
        let dirty = store.dirty.lock().unwrap();
        assert!(dirty.is_empty());
    }

    #[test]
    fn payload_serialization() {
        let payload = SyncedStatePayload {
            state: serde_json::json!({"key": "value"}),
            source: "window-1".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"source\":\"window-1\""));
        assert!(json.contains("\"key\":\"value\""));
    }
}
