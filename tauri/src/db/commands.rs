use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use super::{kv, providers, repos, usage, Db};

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
pub async fn providers_list(db: State<'_, Arc<Db>>) -> Result<Vec<providers::Provider>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    providers::list(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn providers_upsert(
    db: State<'_, Arc<Db>>,
    provider: providers::Provider,
) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    providers::upsert(&c, &provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn providers_remove(db: State<'_, Arc<Db>>, id: String) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    providers::remove(&c, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assignment_get(db: State<'_, Arc<Db>>) -> Result<providers::ActiveAssignment, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    providers::get_assignment(&c).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn assignment_set(
    db: State<'_, Arc<Db>>,
    assignment: providers::ActiveAssignment,
) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    providers::set_assignment(&c, &assignment).map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn usage_record(
    db: State<'_, Arc<Db>>,
    record: usage::UsageRecord,
) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    usage::record(&c, &record).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn usage_query(
    db: State<'_, Arc<Db>>,
    filter: usage::UsageFilter,
) -> Result<Vec<usage::UsageRecord>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    usage::query(&c, &filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn usage_aggregate(
    db: State<'_, Arc<Db>>,
    filter: usage::UsageFilter,
    group_by: usage::GroupBy,
) -> Result<Vec<usage::AggregateRow>, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    usage::aggregate(&c, &filter, group_by).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn usage_purge(db: State<'_, Arc<Db>>, before_ts: i64) -> Result<u64, String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    usage::purge(&c, before_ts).map_err(|e| e.to_string())
}
