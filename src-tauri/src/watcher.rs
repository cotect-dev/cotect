use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct FsChangedPayload {
    id: String,
    paths: Vec<String>,
    kind: String,
}

struct WatcherEntry {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

pub struct WatcherState {
    watchers: Mutex<HashMap<String, WatcherEntry>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

fn event_kind_str(kind: &notify::EventKind) -> Option<&'static str> {
    use notify::EventKind::*;
    match kind {
        Create(_) => Some("create"),
        Modify(_) => Some("modify"),
        Remove(_) => Some("delete"),
        _ => None,
    }
}

#[tauri::command]
pub fn watch_path(
    app: AppHandle,
    path: String,
    id: String,
    recursive: bool,
) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;

    watchers.remove(&id);

    let watch_id = id.clone();
    let app_handle = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(100),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            let events = match result {
                Ok(events) => events,
                Err(_) => return,
            };

            let mut paths: Vec<String> = Vec::new();
            let mut kind = "modify";

            for event in &events {
                let Some(k) = event_kind_str(&event.event.kind) else {
                    continue;
                };
                kind = k;
                for p in &event.event.paths {
                    paths.push(p.to_string_lossy().to_string());
                }
            }

            paths.sort();
            paths.dedup();

            if !paths.is_empty() {
                let _ = app_handle.emit(
                    "fs-changed",
                    FsChangedPayload {
                        id: watch_id.clone(),
                        paths,
                        kind: kind.to_string(),
                    },
                );
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };

    debouncer
        .watch(PathBuf::from(&path), mode)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    watchers.insert(id, WatcherEntry { _debouncer: debouncer });

    Ok(())
}

#[tauri::command]
pub fn unwatch_path(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    watchers.remove(&id);
    Ok(())
}
