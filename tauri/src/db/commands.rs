use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use super::{kv, repos, Db};

#[tauri::command]
pub async fn kv_get(db: State<'_, Arc<Db>>, key: String) -> Result<Option<Value>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    kv::get(&c, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kv_set(db: State<'_, Arc<Db>>, key: String, value: Value) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    kv::set(&c, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kv_delete(db: State<'_, Arc<Db>>, key: String) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    kv::delete(&c, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kv_get_prefix(
    db: State<'_, Arc<Db>>,
    prefix: String,
) -> Result<HashMap<String, Value>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    kv::get_prefix(&c, &prefix).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_repo_upsert(db: State<'_, Arc<Db>>, root_path: String) -> Result<i64, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    repos::upsert(&c, &root_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_repo_get(
    db: State<'_, Arc<Db>>,
    root_path: String,
) -> Result<Option<repos::Repo>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    repos::get(&c, &root_path).map_err(|e| e.to_string())
}
