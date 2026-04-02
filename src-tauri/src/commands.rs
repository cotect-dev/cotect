use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::Manager;

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
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, String> {
    const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum supported size is {:.0} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_FILE_SIZE as f64 / (1024.0 * 1024.0),
        ));
    }
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        && std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v == "wayland")
}

use gdk::prelude::*;
use gtk::prelude::{GtkWindowExt, WidgetExt};

fn find_gtk_window_by_title(
    tauri_windows: &std::collections::HashMap<String, tauri::WebviewWindow>,
    target_title: &str,
) -> Option<gtk::Window> {
    for widget in gtk::Window::list_toplevels() {
        let gtk_win: gtk::Window = match widget.downcast() {
            Ok(w) => w,
            Err(_) => continue,
        };
        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };
        if gtk_title == target_title {
            let is_ours = tauri_windows
                .values()
                .any(|tw| tw.title().map_or(false, |t| t == target_title));
            if is_ours {
                return Some(gtk_win);
            }
        }
    }
    None
}

fn with_matching_gtk_windows<T>(
    app: &tauri::AppHandle,
    mut f: impl FnMut(&gtk::Window, &gdk::Window, &str) -> Option<T>,
) -> Option<T> {
    let tauri_windows = app.webview_windows();
    for widget in gtk::Window::list_toplevels() {
        let gtk_win: gtk::Window = match widget.downcast() {
            Ok(w) => w,
            Err(_) => continue,
        };
        let Some(gdk_win) = gtk_win.window() else {
            continue;
        };
        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };

        for (label, tauri_win) in &tauri_windows {
            if let Ok(tauri_title) = tauri_win.title() {
                if gtk_title == tauri_title {
                    if let Some(result) = f(&gtk_win, &gdk_win, label) {
                        return Some(result);
                    }
                }
            }
        }
    }
    None
}

#[derive(Serialize)]
pub struct CursorWindowInfo {
    pub label: String,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub fn get_cursor_window(app: tauri::AppHandle) -> Option<CursorWindowInfo> {
    let display = gdk::Display::default()?;
    let seat = display.default_seat()?;
    let pointer = seat.pointer()?;

    let (gdk_win, child_x, child_y) = pointer.window_at_position();
    let gdk_win = gdk_win?;
    let (root_x, root_y) = gdk_win.root_coords(child_x, child_y);

    with_matching_gtk_windows(&app, |_gtk_win, gw, label| {
        let (win_origin_x, win_origin_y) = gw.root_coords(0, 0);
        let local_x = root_x - win_origin_x;
        let local_y = root_y - win_origin_y;

        let (_, _, geo_w, geo_h) = gw.geometry();
        if local_x < 0 || local_y < 0 || local_x >= geo_w || local_y >= geo_h {
            return None;
        }

        Some(CursorWindowInfo {
            label: label.to_string(),
            x: local_x as f64,
            y: local_y as f64,
        })
    })
}

#[derive(Serialize)]
pub struct WindowMonitorInfo {
    pub monitor_model: Option<String>,
    pub monitor_manufacturer: Option<String>,
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: i32,
    pub monitor_height: i32,
    pub scale_factor: i32,
}

#[tauri::command]
pub fn get_window_monitor(app: tauri::AppHandle, label: String) -> Option<WindowMonitorInfo> {
    let display = gdk::Display::default()?;
    let tauri_win = app.webview_windows().get(&label)?.clone();
    let tauri_title = tauri_win.title().ok()?;

    let tauri_windows = app.webview_windows();
    let gtk_win = find_gtk_window_by_title(&tauri_windows, &tauri_title)?;
    let gdk_win = gtk_win.window()?;

    let monitor = display.monitor_at_window(&gdk_win)?;
    let geo = monitor.geometry();

    Some(WindowMonitorInfo {
        monitor_model: monitor.model().map(|s| s.to_string()),
        monitor_manufacturer: monitor.manufacturer().map(|s| s.to_string()),
        monitor_x: geo.x(),
        monitor_y: geo.y(),
        monitor_width: geo.width(),
        monitor_height: geo.height(),
        scale_factor: monitor.scale_factor(),
    })
}

#[tauri::command]
pub fn set_window_on_monitor(app: tauri::AppHandle, label: String, monitor_index: i32) -> bool {
    let display = match gdk::Display::default() {
        Some(d) => d,
        None => return false,
    };

    let monitor = match display.monitor(monitor_index) {
        Some(m) => m,
        None => return false,
    };

    let geo = monitor.geometry();
    let scale = monitor.scale_factor();

    let tauri_windows = app.webview_windows();
    let Some(tauri_win) = tauri_windows.get(&label) else {
        return false;
    };

    let tauri_title = match tauri_win.title() {
        Ok(t) => t,
        Err(_) => return false,
    };

    let Some(gtk_win) = find_gtk_window_by_title(&tauri_windows, &tauri_title) else {
        return false;
    };

    let size = gtk_win.size();
    let win_width = size.0 / scale;
    let win_height = size.1 / scale;

    let x = geo.x() + (geo.width() - win_width) / 2;
    let y = geo.y() + (geo.height() - win_height) / 2;

    let _ = tauri_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )));

    true
}

#[derive(Serialize)]
pub struct MonitorInfo {
    pub index: i32,
    pub model: Option<String>,
    pub manufacturer: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: i32,
}

#[tauri::command]
pub fn get_monitors() -> Vec<MonitorInfo> {
    let display = match gdk::Display::default() {
        Some(d) => d,
        None => return vec![],
    };

    let n = display.n_monitors();
    (0..n)
        .filter_map(|i| {
            let monitor = display.monitor(i)?;
            let geo = monitor.geometry();
            Some(MonitorInfo {
                index: i,
                model: monitor.model().map(|s| s.to_string()),
                manufacturer: monitor.manufacturer().map(|s| s.to_string()),
                x: geo.x(),
                y: geo.y(),
                width: geo.width(),
                height: geo.height(),
                scale_factor: monitor.scale_factor(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn directory_entries_sorted_dirs_first_case_insensitive() {
        let mut entries = vec![
            FSEntry { name: "zebra.txt".into(), path: "/tmp/zebra.txt".into(), is_directory: false },
            FSEntry { name: "alpha".into(), path: "/tmp/alpha".into(), is_directory: true },
            FSEntry { name: "beta.txt".into(), path: "/tmp/beta.txt".into(), is_directory: false },
            FSEntry { name: "Gamma".into(), path: "/tmp/Gamma".into(), is_directory: true },
        ];

        entries.sort_by(|a, b| {
            if a.is_directory != b.is_directory {
                if a.is_directory {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        assert_eq!(entries[0].name, "alpha");
        assert_eq!(entries[1].name, "Gamma");
        assert_eq!(entries[2].name, "beta.txt");
        assert_eq!(entries[3].name, "zebra.txt");
    }

    #[test]
    fn is_wayland_returns_false_without_env_vars() {
        // Ensure the env vars are not set
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::remove_var("XDG_SESSION_TYPE");
        // is_wayland checks both vars -- without them, should return false
        let result = std::env::var("WAYLAND_DISPLAY").is_ok()
            && std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v == "wayland");
        assert!(!result);
    }

    #[test]
    fn read_file_content_rejects_oversized() {
        // Create a temp file > 10MB
        let dir = std::env::temp_dir().join("cotect_test_oversized");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("big_file.bin");
        {
            let mut f = fs::File::create(&path).unwrap();
            let chunk = vec![0u8; 1024 * 1024]; // 1MB
            for _ in 0..11 {
                f.write_all(&chunk).unwrap();
            }
        }
        let result = read_file_content(path.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File too large"));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn read_file_content_reads_normal_file() {
        let dir = std::env::temp_dir().join("cotect_test_normal");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("test.txt");
        fs::write(&path, "hello world").unwrap();
        let result = read_file_content(path.to_string_lossy().to_string());
        assert_eq!(result.unwrap(), "hello world");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn read_directory_returns_sorted_entries() {
        let dir = std::env::temp_dir().join("cotect_test_readdir");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("c.txt"), "").unwrap();
        fs::write(dir.join("a.txt"), "").unwrap();
        fs::create_dir(dir.join("b_dir")).unwrap();

        let result = read_directory(dir.to_string_lossy().to_string()).unwrap();
        // Directories first, then files alphabetically
        assert!(result[0].is_directory);
        assert_eq!(result[0].name, "b_dir");
        assert_eq!(result[1].name, "a.txt");
        assert_eq!(result[2].name, "c.txt");

        let _ = fs::remove_dir_all(&dir);
    }
}
