use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{kv, Db};

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

pub fn load_from_db(store: &SyncedStateStore, db: &Db) -> anyhow::Result<()> {
    let c = db.conn()?;
    let entries_kv = kv::get_prefix(&c, "persist:")?;
    let mut entries = store.entries.lock().unwrap();
    for (key, value) in entries_kv {
        entries.insert(
            key,
            StoreEntry {
                state: value,
                source: "main".into(),
            },
        );
    }
    Ok(())
}

pub fn persist_to_db(store: &SyncedStateStore, db: &Db) -> anyhow::Result<()> {
    let c = db.conn()?;
    let dirty: Vec<String> = {
        let mut d = store.dirty.lock().unwrap();
        let v = d.iter().cloned().collect();
        d.clear();
        v
    };
    let entries = store.entries.lock().unwrap();
    for key in dirty {
        if let Some(e) = entries.get(&key) {
            kv::set(&c, &key, &e.state)?;
        }
    }
    Ok(())
}

pub fn load_all(app: &AppHandle) {
    let db = app.state::<Arc<Db>>();
    let store = app.state::<SyncedStateStore>();
    if let Err(e) = load_from_db(&store, &db) {
        eprintln!("[synced_state] load failed: {}", e);
    }
}

pub fn persist_all(app: &AppHandle) {
    let db = app.state::<Arc<Db>>();
    let store = app.state::<SyncedStateStore>();
    if let Err(e) = persist_to_db(&store, &db) {
        eprintln!("[synced_state] persist failed: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{kv, Db};
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn persist_writes_to_kv_table() {
        let dir = tempdir().unwrap();
        let db = std::sync::Arc::new(Db::open(&dir.path().join("t.db")).unwrap());
        let store = SyncedStateStore::new();
        store.entries.lock().unwrap().insert(
            "persist:global".into(),
            StoreEntry {
                state: json!({"x": 1}),
                source: "main".into(),
            },
        );
        store.dirty.lock().unwrap().insert("persist:global".into());
        persist_to_db(&store, &db).unwrap();

        let c = db.conn().unwrap();
        let v = kv::get(&c, "persist:global").unwrap();
        assert_eq!(v, Some(json!({"x": 1})));
    }

    #[test]
    fn load_reads_from_kv_table() {
        let dir = tempdir().unwrap();
        let db = std::sync::Arc::new(Db::open(&dir.path().join("t.db")).unwrap());
        {
            let c = db.conn().unwrap();
            kv::set(&c, "persist:global", &json!({"y": 2})).unwrap();
        }
        let store = SyncedStateStore::new();
        load_from_db(&store, &db).unwrap();
        let entries = store.entries.lock().unwrap();
        let entry = entries.get("persist:global").unwrap();
        assert_eq!(entry.state, json!({"y": 2}));
    }
}

