#![cfg(test)]
#![allow(dead_code)]

use super::ToolState;
use std::io::Write;
use std::sync::Arc;
use tempfile::NamedTempFile;

pub fn make_state() -> Arc<ToolState> {
    ToolState::new("/tmp".into())
}

pub fn make_state_with_root(root: &str) -> Arc<ToolState> {
    ToolState::new(root.into())
}

pub fn make_temp_file(content: &str) -> NamedTempFile {
    let mut f = NamedTempFile::new().unwrap();
    f.write_all(content.as_bytes()).unwrap();
    f.flush().unwrap();
    f
}

/// Helper to mark a file as "read" via the fs_read tool (for write/patch enforcement).
pub async fn read_file(state: &Arc<ToolState>, path: &str) {
    let input = super::fs_read::FSReadInput {
        file_path: path.into(),
        start_line: None,
        end_line: None,
    };
    super::fs_read::execute(&input, state).await.unwrap();
}
