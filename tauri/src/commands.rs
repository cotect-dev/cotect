use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::Manager;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

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
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, String> {
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
pub fn write_file_content(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, &content).map_err(|e| e.to_string())
}

/// At most `max_bytes` from the start of a file as UTF-8 (truncated at a
/// valid char boundary). `total_bytes` lets the caller detect truncation.
#[derive(Serialize)]
pub struct FileHead {
    content: String,
    total_bytes: u64,
}

#[tauri::command]
pub fn read_file_head(file_path: String, max_bytes: u64) -> Result<FileHead, String> {
    use std::io::Read;

    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    let total_bytes = metadata.len();

    let file = fs::File::open(&file_path).map_err(|e| e.to_string())?;
    let limit = std::cmp::min(total_bytes, max_bytes);
    let mut buf = vec![0u8; limit as usize];
    let mut reader = std::io::BufReader::new(file);
    reader.read_exact(&mut buf).map_err(|e| e.to_string())?;

    let content = match std::str::from_utf8(&buf) {
        Ok(s) => s.to_string(),
        Err(e) => {
            let valid_up_to = e.valid_up_to();
            String::from_utf8_lossy(&buf[..valid_up_to]).to_string()
        }
    };

    Ok(FileHead {
        content,
        total_bytes,
    })
}

#[tauri::command]
pub fn read_binary_file(file_path: String) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum supported size is {:.0} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_FILE_SIZE as f64 / (1024.0 * 1024.0),
        ));
    }
    fs::read(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        && std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland")
}

/// System-managed install prefixes: the self-updater cannot write there, and
/// installs under them (deb/rpm/AUR/nix) are updated by the package manager.
fn is_system_install_path(path: &Path) -> bool {
    ["/usr", "/opt", "/nix"]
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

#[tauri::command]
pub fn is_self_updatable() -> bool {
    if cfg!(target_os = "linux") {
        std::env::current_exe()
            .map(|exe| !is_system_install_path(&exe))
            .unwrap_or(false)
    } else {
        true
    }
}

#[cfg(target_os = "linux")]
use gdk::prelude::*;
#[cfg(target_os = "linux")]
use gtk::prelude::{GtkWindowExt, WidgetExt};

#[cfg(target_os = "linux")]
fn find_gtk_window_by_title(
    tauri_windows: &std::collections::HashMap<String, tauri::WebviewWindow>,
    target_title: &str,
) -> Option<gtk::Window> {
    for widget in gtk::Window::list_toplevels() {
        let Ok(gtk_win) = widget.downcast::<gtk::Window>() else {
            continue;
        };
        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };
        if gtk_title == target_title {
            let is_ours = tauri_windows
                .values()
                .any(|tw| tw.title().is_ok_and(|t| t == target_title));
            if is_ours {
                return Some(gtk_win);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn with_matching_gtk_windows<T>(
    app: &tauri::AppHandle,
    mut f: impl FnMut(&gtk::Window, &gdk::Window, &str) -> Option<T>,
) -> Option<T> {
    let tauri_windows = app.webview_windows();
    for widget in gtk::Window::list_toplevels() {
        let Ok(gtk_win) = widget.downcast::<gtk::Window>() else {
            continue;
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

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn set_window_on_monitor(app: tauri::AppHandle, label: String, monitor_index: i32) -> bool {
    let Some(display) = gdk::Display::default() else {
        return false;
    };

    let Some(monitor) = display.monitor(monitor_index) else {
        return false;
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

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn get_monitors() -> Vec<MonitorInfo> {
    let Some(display) = gdk::Display::default() else {
        return vec![];
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

// macOS/Windows variants of the window-manager commands, built on tauri's
// cross-platform monitor and cursor APIs (reliable outside Wayland).

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn get_cursor_window(app: tauri::AppHandle) -> Option<CursorWindowInfo> {
    let pos = app.cursor_position().ok()?;
    for (label, win) in app.webview_windows() {
        let Ok(origin) = win.outer_position() else {
            continue;
        };
        let Ok(size) = win.outer_size() else {
            continue;
        };
        let x = pos.x - origin.x as f64;
        let y = pos.y - origin.y as f64;
        if x >= 0.0 && y >= 0.0 && x < size.width as f64 && y < size.height as f64 {
            return Some(CursorWindowInfo { label, x, y });
        }
    }
    None
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn get_window_monitor(app: tauri::AppHandle, label: String) -> Option<WindowMonitorInfo> {
    let win = app.webview_windows().get(&label)?.clone();
    let monitor = win.current_monitor().ok()??;
    let pos = monitor.position();
    let size = monitor.size();
    Some(WindowMonitorInfo {
        monitor_model: monitor.name().cloned(),
        monitor_manufacturer: None,
        monitor_x: pos.x,
        monitor_y: pos.y,
        monitor_width: size.width as i32,
        monitor_height: size.height as i32,
        scale_factor: monitor.scale_factor().round() as i32,
    })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn set_window_on_monitor(app: tauri::AppHandle, label: String, monitor_index: i32) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    let Some(monitor) = monitors.get(monitor_index.max(0) as usize) else {
        return false;
    };
    let windows = app.webview_windows();
    let Some(win) = windows.get(&label) else {
        return false;
    };
    let Ok(size) = win.outer_size() else {
        return false;
    };
    let mpos = monitor.position();
    let msize = monitor.size();
    let x = mpos.x + (msize.width as i32 - size.width as i32) / 2;
    let y = mpos.y + (msize.height as i32 - size.height as i32) / 2;
    win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )))
    .is_ok()
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn get_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    let Ok(monitors) = app.available_monitors() else {
        return vec![];
    };
    monitors
        .iter()
        .enumerate()
        .map(|(i, monitor)| {
            let pos = monitor.position();
            let size = monitor.size();
            MonitorInfo {
                index: i as i32,
                model: monitor.name().cloned(),
                manufacturer: None,
                x: pos.x,
                y: pos.y,
                width: size.width as i32,
                height: size.height as i32,
                scale_factor: monitor.scale_factor().round() as i32,
            }
        })
        .collect()
}

/// File arguments open the parent directory.
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = if p.is_dir() {
        p.to_path_buf()
    } else {
        p.parent()
            .ok_or_else(|| format!("Cannot determine parent directory of {}", path))?
            .to_path_buf()
    };

    if !dir.exists() {
        return Err(format!("Directory does not exist: {}", dir.display()));
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn system_install_paths_detected() {
        assert!(is_system_install_path(Path::new("/usr/bin/cotect")));
        assert!(is_system_install_path(Path::new("/opt/cotect/cotect")));
        assert!(is_system_install_path(Path::new("/nix/store/abc123/bin/cotect")));
    }

    #[test]
    fn user_paths_are_not_system_installs() {
        assert!(!is_system_install_path(Path::new(
            "/home/user/Applications/cotect.AppImage"
        )));
        // AppImage mount point contains "usr" but not as the root prefix.
        assert!(!is_system_install_path(Path::new(
            "/tmp/.mount_cotect1234/usr/bin/cotect"
        )));
    }

    #[test]
    fn read_file_content_rejects_oversized() {
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
        assert!(result[0].is_directory);
        assert_eq!(result[0].name, "b_dir");
        assert_eq!(result[1].name, "a.txt");
        assert_eq!(result[2].name, "c.txt");

        let _ = fs::remove_dir_all(&dir);
    }
}
