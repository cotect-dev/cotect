use std::fs;
use std::path::Path;

/// On first launch with the new build, delete the legacy app-state.json file.
/// Safe to call repeatedly: no-op if the file is already gone.
pub fn drop_legacy_app_state_json(app_dir: &Path) {
    let legacy = app_dir.join("app-state.json");
    if legacy.exists() {
        if let Err(e) = fs::remove_file(&legacy) {
            eprintln!("[cleanup] failed to remove legacy app-state.json: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn deletes_legacy_file_when_present() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("app-state.json");
        fs::write(&path, b"{}").unwrap();
        assert!(path.exists());
        drop_legacy_app_state_json(dir.path());
        assert!(!path.exists());
    }

    #[test]
    fn noop_when_absent() {
        let dir = tempdir().unwrap();
        drop_legacy_app_state_json(dir.path());
        // doesn't panic — that's the whole assertion
    }
}
