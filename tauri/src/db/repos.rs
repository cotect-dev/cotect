use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Conn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Repo {
    pub id: i64,
    pub root_path: String,
}

pub fn upsert(c: &Conn, root_path: &str) -> Result<i64> {
    c.execute(
        "INSERT INTO repos(root_path) VALUES(?1) ON CONFLICT(root_path) DO NOTHING",
        params![root_path],
    )?;
    let id: i64 = c.query_row("SELECT id FROM repos WHERE root_path = ?1", [root_path], |r| r.get(0))?;
    Ok(id)
}

pub fn get(c: &Conn, root_path: &str) -> Result<Option<Repo>> {
    let row = c.query_row(
        "SELECT id, root_path FROM repos WHERE root_path = ?1",
        [root_path],
        |r| Ok(Repo { id: r.get(0)?, root_path: r.get(1)? }),
    );
    Ok(row.ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use tempfile::tempdir;

    #[test]
    fn upsert_returns_stable_id() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let c = db.conn().unwrap();
        let id1 = upsert(&c, "/a").unwrap();
        let id2 = upsert(&c, "/a").unwrap();
        assert_eq!(id1, id2);
        let id3 = upsert(&c, "/b").unwrap();
        assert_ne!(id1, id3);
    }

    #[test]
    fn get_returns_some_after_upsert() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let c = db.conn().unwrap();
        upsert(&c, "/x").unwrap();
        let r = get(&c, "/x").unwrap().unwrap();
        assert_eq!(r.root_path, "/x");
    }
}
