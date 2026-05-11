use anyhow::Result;
use rusqlite::params;
use serde_json::Value;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use super::Conn;

pub fn get(c: &Conn, key: &str) -> Result<Option<Value>> {
    let row: Option<String> = c
        .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .ok();
    row.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}

pub fn set(c: &Conn, key: &str, value: &Value) -> Result<()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
    c.execute(
        "INSERT INTO kv(key, value, updated_at) VALUES(?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        params![key, value.to_string(), now],
    )?;
    Ok(())
}

pub fn delete(c: &Conn, key: &str) -> Result<()> {
    c.execute("DELETE FROM kv WHERE key = ?1", [key])?;
    Ok(())
}

pub fn get_prefix(c: &Conn, prefix: &str) -> Result<HashMap<String, Value>> {
    let mut stmt = c.prepare("SELECT key, value FROM kv WHERE key LIKE ?1")?;
    let rows = stmt.query_map([format!("{}%", prefix)], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut out = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        out.insert(k, serde_json::from_str(&v)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use serde_json::json;
    use tempfile::tempdir;

    fn db() -> Db {
        let dir = tempdir().unwrap();
        Db::open(&dir.path().join("test.db")).unwrap()
    }

    #[test]
    fn set_and_get_roundtrip() {
        let db = db();
        let c = db.conn().unwrap();
        set(&c, "foo", &json!({"x": 1})).unwrap();
        assert_eq!(get(&c, "foo").unwrap(), Some(json!({"x": 1})));
    }

    #[test]
    fn get_missing_returns_none() {
        let db = db();
        let c = db.conn().unwrap();
        assert!(get(&c, "missing").unwrap().is_none());
    }

    #[test]
    fn set_upserts_existing_key() {
        let db = db();
        let c = db.conn().unwrap();
        set(&c, "k", &json!(1)).unwrap();
        set(&c, "k", &json!(2)).unwrap();
        assert_eq!(get(&c, "k").unwrap(), Some(json!(2)));
    }

    #[test]
    fn delete_removes_key() {
        let db = db();
        let c = db.conn().unwrap();
        set(&c, "k", &json!(1)).unwrap();
        delete(&c, "k").unwrap();
        assert!(get(&c, "k").unwrap().is_none());
    }

    #[test]
    fn get_prefix_filters() {
        let db = db();
        let c = db.conn().unwrap();
        set(&c, "agent.x", &json!(1)).unwrap();
        set(&c, "agent.y", &json!(2)).unwrap();
        set(&c, "editor.x", &json!(3)).unwrap();
        let m = get_prefix(&c, "agent.").unwrap();
        assert_eq!(m.len(), 2);
        assert!(m.contains_key("agent.x"));
        assert!(m.contains_key("agent.y"));
    }
}
