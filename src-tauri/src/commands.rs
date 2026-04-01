use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct FSEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[tauri::command]
pub fn read_directory(dir_path: String) -> Result<Vec<FSEntry>, String> {
    let path = Path::new(&dir_path);
    let mut entries: Vec<FSEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "." || name == ".." {
                return None;
            }
            let is_directory = entry.file_type().ok()?.is_dir();
            Some(FSEntry {
                path: entry.path().to_string_lossy().to_string(),
                name,
                is_directory,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}
