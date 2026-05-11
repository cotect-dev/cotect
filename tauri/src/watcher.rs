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
    kinds: Vec<String>,
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

/// Aggregate a debounced batch into sorted-unique paths and sorted-unique kind strings.
/// Events whose kind doesn't map to a user-visible label (Any, Other, Access) are skipped.
fn aggregate_events<'a, I>(batch: I) -> (Vec<String>, Vec<String>)
where
    I: IntoIterator<Item = (&'a notify::EventKind, &'a [PathBuf])>,
{
    let mut paths = Vec::new();
    let mut kinds = Vec::new();
    for (kind, event_paths) in batch {
        let Some(k) = event_kind_str(kind) else {
            continue;
        };
        kinds.push(k.to_string());
        for p in event_paths {
            paths.push(p.to_string_lossy().to_string());
        }
    }
    paths.sort();
    paths.dedup();
    kinds.sort();
    kinds.dedup();
    (paths, kinds)
}

#[tauri::command]
pub fn watch_path(app: AppHandle, path: String, id: String, recursive: bool) -> Result<(), String> {
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

            let (paths, kinds) = aggregate_events(
                events
                    .iter()
                    .map(|e| (&e.event.kind, e.event.paths.as_slice())),
            );

            if !paths.is_empty() {
                let _ = app_handle.emit(
                    "fs-changed",
                    FsChangedPayload {
                        id: watch_id.clone(),
                        paths,
                        kinds,
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

    watchers.insert(
        id,
        WatcherEntry {
            _debouncer: debouncer,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn unwatch_path(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut watchers = state.watchers.lock().map_err(|e| e.to_string())?;
    watchers.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    use notify::EventKind;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn aggregate_empty_batch_returns_empty() {
        let batch: Vec<(&EventKind, &[PathBuf])> = vec![];
        let (paths, kinds) = aggregate_events(batch);
        assert!(paths.is_empty());
        assert!(kinds.is_empty());
    }

    #[test]
    fn aggregate_collects_all_event_kinds_not_just_last() {
        let create = EventKind::Create(CreateKind::File);
        let modify = EventKind::Modify(ModifyKind::Any);
        let create_paths = paths(&["/tmp/a"]);
        let modify_paths = paths(&["/tmp/b"]);

        let (out_paths, kinds) = aggregate_events([
            (&create, create_paths.as_slice()),
            (&modify, modify_paths.as_slice()),
        ]);

        assert_eq!(out_paths, vec!["/tmp/a".to_string(), "/tmp/b".to_string()]);
        assert_eq!(kinds, vec!["create".to_string(), "modify".to_string()]);
    }

    #[test]
    fn aggregate_deduplicates_paths_and_kinds() {
        let modify_a = EventKind::Modify(ModifyKind::Any);
        let modify_b = EventKind::Modify(ModifyKind::Any);
        let p1 = paths(&["/tmp/a", "/tmp/b"]);
        let p2 = paths(&["/tmp/a"]);

        let (out_paths, kinds) =
            aggregate_events([(&modify_a, p1.as_slice()), (&modify_b, p2.as_slice())]);

        assert_eq!(out_paths, vec!["/tmp/a".to_string(), "/tmp/b".to_string()]);
        assert_eq!(kinds, vec!["modify".to_string()]);
    }

    #[test]
    fn aggregate_skips_unknown_kinds() {
        let access = EventKind::Access(notify::event::AccessKind::Any);
        let other = EventKind::Other;
        let p = paths(&["/tmp/x"]);

        let (out_paths, kinds) =
            aggregate_events([(&access, p.as_slice()), (&other, p.as_slice())]);

        assert!(
            out_paths.is_empty(),
            "paths from skipped events should not leak"
        );
        assert!(kinds.is_empty());
    }

    #[test]
    fn aggregate_keeps_delete_when_followed_by_create() {
        // Atomic-save style batch: [remove, create] used to collapse to just "create"
        // when only the last kind was kept. Now both kinds survive.
        let remove = EventKind::Remove(RemoveKind::File);
        let create = EventKind::Create(CreateKind::File);
        let p = paths(&["/tmp/file.txt"]);

        let (_, kinds) = aggregate_events([(&remove, p.as_slice()), (&create, p.as_slice())]);

        assert!(kinds.contains(&"create".to_string()));
        assert!(kinds.contains(&"delete".to_string()));
    }
}
