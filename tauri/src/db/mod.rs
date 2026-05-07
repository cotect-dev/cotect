use anyhow::{Context, Result};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

pub type Conn = r2d2::PooledConnection<SqliteConnectionManager>;

pub mod kv;
pub mod providers;
pub mod repos;
pub mod usage;

pub struct Db {
    pool: Pool<SqliteConnectionManager>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let manager = SqliteConnectionManager::file(path)
            .with_init(|c| {
                c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            });
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .context("build sqlite pool")?;
        let db = Self { pool };
        db.migrate()?;
        Ok(db)
    }

    pub fn conn(&self) -> Result<Conn> {
        self.pool.get().context("get sqlite connection")
    }

    fn migrate(&self) -> Result<()> {
        let mut c = self.conn()?;
        let version: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 1 {
            let tx = c.transaction()?;
            tx.execute_batch(include_str!("schema_v1.sql"))?;
            tx.pragma_update(None, "user_version", 1)?;
            tx.commit()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn open_creates_schema_v1() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("test.db")).unwrap();
        let c = db.conn().unwrap();
        let v: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
        for t in &["providers", "active_assignment", "kv", "repos", "structure_notes", "agent_usage"] {
            let n: i32 = c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t], |r| r.get(0),
            ).unwrap();
            assert_eq!(n, 1, "table {} missing", t);
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        let _db1 = Db::open(&path).unwrap();
        let db2 = Db::open(&path).unwrap();
        let c = db2.conn().unwrap();
        let v: i32 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
    }
}
