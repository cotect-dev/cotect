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
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
        && std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v == "wayland")
}

// ---------------------------------------------------------------------------
// GDK-based cursor and monitor tracking (works on both X11 and Wayland)
// ---------------------------------------------------------------------------

/// Returns (window_label, local_x, local_y) for the Tauri window the cursor
/// is currently over, or None if the cursor is outside all app windows.
/// Uses GDK's pointer tracking which works on Wayland (surface-local coords).
#[derive(Serialize)]
pub struct CursorWindowInfo {
    pub label: String,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub fn get_cursor_window(app: tauri::AppHandle) -> Option<CursorWindowInfo> {
    use gdk::prelude::*;
    use gtk::prelude::{GtkWindowExt, WidgetExt};

    let display = gdk::Display::default()?;
    let seat = display.default_seat()?;
    let pointer = seat.pointer()?;

    // window_at_position returns the deepest GdkWindow under the cursor + local coords
    let (gdk_win, child_x, child_y) = pointer.window_at_position();
    let gdk_win = gdk_win?;

    // Translate from the deepest child up to root coords, then back to
    // each toplevel to find which window the cursor is in.
    let (root_x, root_y) = gdk_win.root_coords(child_x, child_y);

    // Build a map of Tauri window labels to titles for matching
    let tauri_windows = app.webview_windows();

    // Check each GTK toplevel
    for widget in gtk::Window::list_toplevels() {
        let gtk_win: gtk::Window = match widget.downcast() {
            Ok(w) => w,
            Err(_) => continue,
        };
        let Some(gw) = gtk_win.window() else { continue };
        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };

        // Translate root coords to this window's local coords
        let (win_origin_x, win_origin_y) = gw.root_coords(0, 0);
        let local_x = root_x - win_origin_x;
        let local_y = root_y - win_origin_y;

        let (_, _, geo_w, geo_h) = gw.geometry();
        if local_x < 0 || local_y < 0 || local_x >= geo_w || local_y >= geo_h {
            continue;
        }

        // Match to a Tauri window by title
        for (label, tauri_win) in &tauri_windows {
            if let Ok(tauri_title) = tauri_win.title() {
                if gtk_title == tauri_title {
                    return Some(CursorWindowInfo {
                        label: label.clone(),
                        x: local_x as f64,
                        y: local_y as f64,
                    });
                }
            }
        }
    }
    None
}

/// Returns the monitor name/connector for the monitor a given window is on.
#[derive(Serialize)]
pub struct WindowMonitorInfo {
    pub monitor_model: Option<String>,
    pub monitor_manufacturer: Option<String>,
    /// Monitor geometry in GDK coords (logical)
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: i32,
    pub monitor_height: i32,
    pub scale_factor: i32,
}

#[tauri::command]
pub fn get_window_monitor(app: tauri::AppHandle, label: String) -> Option<WindowMonitorInfo> {
    use gdk::prelude::*;
    use gtk::prelude::{GtkWindowExt, WidgetExt};

    let display = gdk::Display::default()?;
    let tauri_win = app.webview_windows().get(&label)?.clone();
    let tauri_title = tauri_win.title().ok()?;

    for widget in gtk::Window::list_toplevels() {
        let gtk_win: gtk::Window = match widget.downcast() {
            Ok(w) => w,
            Err(_) => continue,
        };
        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };
        if gtk_title != tauri_title {
            continue;
        }
        let Some(gdk_win) = gtk_win.window() else {
            continue;
        };

        let monitor = display.monitor_at_window(&gdk_win)?;
        let geo = monitor.geometry();
        return Some(WindowMonitorInfo {
            monitor_model: monitor.model().map(|s| s.to_string()),
            monitor_manufacturer: monitor.manufacturer().map(|s| s.to_string()),
            monitor_x: geo.x(),
            monitor_y: geo.y(),
            monitor_width: geo.width(),
            monitor_height: geo.height(),
            scale_factor: monitor.scale_factor(),
        });
    }
    None
}

/// Places the current window on a specific monitor by its index.
/// Returns true if successful.
#[tauri::command]
pub fn set_window_on_monitor(app: tauri::AppHandle, label: String, monitor_index: i32) -> bool {
    use gdk::prelude::*;
    use gtk::prelude::GtkWindowExt;

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

    let Ok(tauri_title) = tauri_win.title() else {
        return false;
    };

    for widget in gtk::Window::list_toplevels() {
        let gtk_win: gtk::Window = match widget.downcast() {
            Ok(w) => w,
            Err(_) => continue,
        };

        let Some(gtk_title) = gtk_win.title() else {
            continue;
        };

        if gtk_title != tauri_title {
            continue;
        }

        let size = gtk_win.size();
        let win_width = size.0 / scale;
        let win_height = size.1 / scale;

        let x = geo.x() + (geo.width() - win_width) / 2;
        let y = geo.y() + (geo.height() - win_height) / 2;

        let _ = tauri_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));

        return true;
    }
    false
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
    use gdk::prelude::*;

    let display = match gdk::Display::default() {
        Some(d) => d,
        None => return vec![],
    };

    let mut monitors = Vec::new();
    let n = display.n_monitors();

    for i in 0..n {
        if let Some(monitor) = display.monitor(i) {
            let geo = monitor.geometry();
            monitors.push(MonitorInfo {
                index: i,
                model: monitor.model().map(|s| s.to_string()),
                manufacturer: monitor.manufacturer().map(|s| s.to_string()),
                x: geo.x(),
                y: geo.y(),
                width: geo.width(),
                height: geo.height(),
                scale_factor: monitor.scale_factor(),
            });
        }
    }

    monitors
}
