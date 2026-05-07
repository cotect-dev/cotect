use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Conn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub detected_json: Option<String>,
    pub health_json: Option<String>,
    pub position: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ActiveAssignment {
    pub default_provider_id: Option<String>,
    pub default_model: Option<String>,
    pub implement_provider_id: Option<String>,
    pub implement_model: Option<String>,
    pub research_provider_id: Option<String>,
    pub research_model: Option<String>,
    pub plan_provider_id: Option<String>,
    pub plan_model: Option<String>,
}

pub fn list(c: &Conn) -> Result<Vec<Provider>> {
    let mut stmt = c.prepare(
        "SELECT id, label, endpoint, api_key, detected_json, health_json, position \
         FROM providers ORDER BY position ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Provider {
            id: r.get(0)?,
            label: r.get(1)?,
            endpoint: r.get(2)?,
            api_key: r.get(3)?,
            detected_json: r.get(4)?,
            health_json: r.get(5)?,
            position: r.get(6)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
}

pub fn upsert(c: &Conn, p: &Provider) -> Result<()> {
    c.execute(
        "INSERT INTO providers(id, label, endpoint, api_key, detected_json, health_json, position) \
         VALUES(?1,?2,?3,?4,?5,?6,?7) \
         ON CONFLICT(id) DO UPDATE SET \
            label=excluded.label, endpoint=excluded.endpoint, api_key=excluded.api_key, \
            detected_json=excluded.detected_json, health_json=excluded.health_json, position=excluded.position",
        params![p.id, p.label, p.endpoint, p.api_key, p.detected_json, p.health_json, p.position],
    )?;
    Ok(())
}

pub fn remove(c: &Conn, id: &str) -> Result<()> {
    c.execute("DELETE FROM providers WHERE id = ?1", [id])?;
    // Also clear assignment fields that referenced the removed provider.
    c.execute(
        "UPDATE active_assignment SET \
            default_provider_id   = CASE WHEN default_provider_id   = ?1 THEN NULL ELSE default_provider_id   END, \
            default_model         = CASE WHEN default_provider_id   = ?1 THEN NULL ELSE default_model         END, \
            implement_provider_id = CASE WHEN implement_provider_id = ?1 THEN NULL ELSE implement_provider_id END, \
            implement_model       = CASE WHEN implement_provider_id = ?1 THEN NULL ELSE implement_model       END, \
            research_provider_id  = CASE WHEN research_provider_id  = ?1 THEN NULL ELSE research_provider_id  END, \
            research_model        = CASE WHEN research_provider_id  = ?1 THEN NULL ELSE research_model        END, \
            plan_provider_id      = CASE WHEN plan_provider_id      = ?1 THEN NULL ELSE plan_provider_id      END, \
            plan_model            = CASE WHEN plan_provider_id      = ?1 THEN NULL ELSE plan_model            END \
         WHERE id = 1",
        [id],
    )?;
    Ok(())
}

pub fn get_assignment(c: &Conn) -> Result<ActiveAssignment> {
    let row = c.query_row(
        "SELECT default_provider_id, default_model, \
                implement_provider_id, implement_model, \
                research_provider_id, research_model, \
                plan_provider_id, plan_model \
         FROM active_assignment WHERE id = 1",
        [],
        |r| {
            Ok(ActiveAssignment {
                default_provider_id: r.get(0)?,
                default_model: r.get(1)?,
                implement_provider_id: r.get(2)?,
                implement_model: r.get(3)?,
                research_provider_id: r.get(4)?,
                research_model: r.get(5)?,
                plan_provider_id: r.get(6)?,
                plan_model: r.get(7)?,
            })
        },
    );
    Ok(row.unwrap_or_default())
}

pub fn set_assignment(c: &Conn, a: &ActiveAssignment) -> Result<()> {
    c.execute(
        "INSERT INTO active_assignment(id, default_provider_id, default_model, \
            implement_provider_id, implement_model, research_provider_id, research_model, \
            plan_provider_id, plan_model) \
         VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8) \
         ON CONFLICT(id) DO UPDATE SET \
            default_provider_id=excluded.default_provider_id, default_model=excluded.default_model, \
            implement_provider_id=excluded.implement_provider_id, implement_model=excluded.implement_model, \
            research_provider_id=excluded.research_provider_id, research_model=excluded.research_model, \
            plan_provider_id=excluded.plan_provider_id, plan_model=excluded.plan_model",
        params![
            a.default_provider_id, a.default_model,
            a.implement_provider_id, a.implement_model,
            a.research_provider_id, a.research_model,
            a.plan_provider_id, a.plan_model,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use tempfile::tempdir;

    fn fixture() -> Provider {
        Provider {
            id: "p1".into(), label: "Local".into(),
            endpoint: "http://localhost:11434/v1".into(),
            api_key: None, detected_json: None, health_json: None, position: 0,
        }
    }

    #[test]
    fn list_empty() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        assert!(list(&db.conn().unwrap()).unwrap().is_empty());
    }

    #[test]
    fn upsert_then_list() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let c = db.conn().unwrap();
        upsert(&c, &fixture()).unwrap();
        let xs = list(&c).unwrap();
        assert_eq!(xs.len(), 1);
        assert_eq!(xs[0].label, "Local");
    }

    #[test]
    fn remove_nulls_assignment_fields() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let c = db.conn().unwrap();
        upsert(&c, &fixture()).unwrap();
        set_assignment(&c, &ActiveAssignment {
            default_provider_id: Some("p1".into()),
            default_model: Some("llama3".into()),
            implement_provider_id: Some("p1".into()),
            implement_model: Some("llama3".into()),
            ..Default::default()
        }).unwrap();
        remove(&c, "p1").unwrap();
        let a = get_assignment(&c).unwrap();
        assert!(a.default_provider_id.is_none());
        assert!(a.default_model.is_none());
        assert!(a.implement_provider_id.is_none());
        assert!(a.implement_model.is_none());
    }

    #[test]
    fn assignment_default_when_unset() {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let a = get_assignment(&db.conn().unwrap()).unwrap();
        assert_eq!(a, ActiveAssignment::default());
    }
}
