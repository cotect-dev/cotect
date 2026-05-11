use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::Conn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageRecord {
    pub ts: i64,
    pub provider_id: String,
    pub model: String,
    pub role: String,
    pub task_id: Option<String>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub first_token_ms: Option<i64>,
    pub total_ms: Option<i64>,
    pub ok: bool,
    pub tokens_estimated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageFilter {
    pub from_ts: Option<i64>,
    pub to_ts: Option<i64>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub role: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum GroupBy {
    Provider,
    Model,
    Role,
    Day,
    ProviderDay,
    RoleDay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateRow {
    pub bucket: String,
    pub tasks: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub p50_total_ms: Option<i64>,
}

pub fn record(c: &Conn, r: &UsageRecord) -> Result<()> {
    c.execute(
        "INSERT INTO agent_usage(ts, provider_id, model, role, task_id, \
            prompt_tokens, completion_tokens, first_token_ms, total_ms, ok, tokens_estimated) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            r.ts, r.provider_id, r.model, r.role, r.task_id,
            r.prompt_tokens, r.completion_tokens,
            r.first_token_ms, r.total_ms,
            if r.ok { 1 } else { 0 },
            if r.tokens_estimated { 1 } else { 0 },
        ],
    )?;
    Ok(())
}

pub fn query(c: &Conn, f: &UsageFilter) -> Result<Vec<UsageRecord>> {
    // Build WHERE clause incrementally — keeping it explicit avoids a query builder dep.
    let mut sql = String::from(
        "SELECT ts, provider_id, model, role, task_id, prompt_tokens, completion_tokens, \
                first_token_ms, total_ms, ok, tokens_estimated \
         FROM agent_usage WHERE 1=1",
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(v) = f.from_ts { sql.push_str(" AND ts >= ?"); params.push(Box::new(v)); }
    if let Some(v) = f.to_ts   { sql.push_str(" AND ts < ?");  params.push(Box::new(v)); }
    if let Some(v) = &f.provider_id { sql.push_str(" AND provider_id = ?"); params.push(Box::new(v.clone())); }
    if let Some(v) = &f.model { sql.push_str(" AND model = ?"); params.push(Box::new(v.clone())); }
    if let Some(v) = &f.role  { sql.push_str(" AND role  = ?"); params.push(Box::new(v.clone())); }
    sql.push_str(" ORDER BY ts DESC");
    if let Some(v) = f.limit  { sql.push_str(&format!(" LIMIT {}", v)); }

    let mut stmt = c.prepare(&sql)?;
    let p_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| &**b).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(p_refs.iter().copied()), |r| {
        Ok(UsageRecord {
            ts: r.get(0)?, provider_id: r.get(1)?, model: r.get(2)?, role: r.get(3)?,
            task_id: r.get(4)?, prompt_tokens: r.get(5)?, completion_tokens: r.get(6)?,
            first_token_ms: r.get(7)?, total_ms: r.get(8)?,
            ok: r.get::<_, i32>(9)? != 0,
            tokens_estimated: r.get::<_, i32>(10)? != 0,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
}

pub fn aggregate(c: &Conn, f: &UsageFilter, group_by: GroupBy) -> Result<Vec<AggregateRow>> {
    let bucket_expr = match group_by {
        GroupBy::Provider    => "'provider:' || provider_id".to_string(),
        GroupBy::Model       => "'model:' || model".to_string(),
        GroupBy::Role        => "'role:' || role".to_string(),
        GroupBy::Day         => "'day:' || date(ts/1000, 'unixepoch')".to_string(),
        GroupBy::ProviderDay => "provider_id || '|' || date(ts/1000, 'unixepoch')".to_string(),
        GroupBy::RoleDay     => "role || '|' || date(ts/1000, 'unixepoch')".to_string(),
    };
    let mut sql = format!(
        "SELECT {bucket} AS bucket, count(*) as tasks, \
                sum(prompt_tokens) as pt, sum(completion_tokens) as ct \
         FROM agent_usage WHERE 1=1",
        bucket = bucket_expr,
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(v) = f.from_ts { sql.push_str(" AND ts >= ?"); params.push(Box::new(v)); }
    if let Some(v) = f.to_ts   { sql.push_str(" AND ts < ?");  params.push(Box::new(v)); }
    if let Some(v) = &f.provider_id { sql.push_str(" AND provider_id = ?"); params.push(Box::new(v.clone())); }
    if let Some(v) = &f.role  { sql.push_str(" AND role = ?"); params.push(Box::new(v.clone())); }
    sql.push_str(" GROUP BY bucket ORDER BY bucket");

    let mut stmt = c.prepare(&sql)?;
    let p_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| &**b).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(p_refs.iter().copied()), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (bucket, tasks, pt, ct) = row?;
        // p50 computed in Rust against same filter — small per-bucket extra query
        let p50 = p50_for_bucket(c, f, group_by, &bucket)?;
        out.push(AggregateRow {
            bucket, tasks, prompt_tokens: pt, completion_tokens: ct, p50_total_ms: p50,
        });
    }
    Ok(out)
}

fn p50_for_bucket(c: &Conn, f: &UsageFilter, group_by: GroupBy, bucket: &str) -> Result<Option<i64>> {
    let (col_filter, value) = match group_by {
        GroupBy::Provider => ("provider_id =", bucket.trim_start_matches("provider:").to_string()),
        GroupBy::Model    => ("model =",       bucket.trim_start_matches("model:").to_string()),
        GroupBy::Role     => ("role =",        bucket.trim_start_matches("role:").to_string()),
        // For *Day buckets, p50 by date isn't worth the cost in v1 — return None.
        _ => return Ok(None),
    };
    let mut sql = format!(
        "SELECT total_ms FROM agent_usage WHERE total_ms IS NOT NULL AND {col} ?",
        col = col_filter,
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(value)];
    if let Some(v) = f.from_ts { sql.push_str(" AND ts >= ?"); params.push(Box::new(v)); }
    if let Some(v) = f.to_ts   { sql.push_str(" AND ts < ?");  params.push(Box::new(v)); }
    sql.push_str(" ORDER BY total_ms ASC");

    let mut stmt = c.prepare(&sql)?;
    let p_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| &**b).collect();
    let times: Vec<i64> = stmt
        .query_map(rusqlite::params_from_iter(p_refs.iter().copied()), |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if times.is_empty() { return Ok(None); }
    // Already sorted by the query's ORDER BY total_ms ASC.
    // Lower-middle median: for [500, 600] -> 500; for [a,b,c] -> b.
    Ok(Some(times[(times.len() - 1) / 2]))
}

pub fn purge(c: &Conn, before_ts: i64) -> Result<u64> {
    let n = c.execute("DELETE FROM agent_usage WHERE ts < ?1", [before_ts])?;
    Ok(n as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use tempfile::tempdir;

    fn rec(ts: i64, provider: &str, model: &str, role: &str, total: i64) -> UsageRecord {
        UsageRecord {
            ts, provider_id: provider.into(), model: model.into(), role: role.into(),
            task_id: None, prompt_tokens: 100, completion_tokens: 50,
            first_token_ms: Some(200), total_ms: Some(total),
            ok: true, tokens_estimated: false,
        }
    }

    fn db_with_rows() -> Db {
        let dir = tempdir().unwrap();
        let db = Db::open(&dir.path().join("t.db")).unwrap();
        let c = db.conn().unwrap();
        record(&c, &rec(1_000, "p1", "llama3", "implement", 500)).unwrap();
        record(&c, &rec(2_000, "p1", "llama3", "implement", 600)).unwrap();
        record(&c, &rec(3_000, "p2", "qwen3",  "research",  300)).unwrap();
        // Box::leak so Db lives for the test (or return tempdir owned)
        std::mem::forget(dir);
        db
    }

    #[test]
    fn record_and_query_all() {
        let db = db_with_rows();
        let xs = query(&db.conn().unwrap(), &UsageFilter {
            from_ts: None, to_ts: None, provider_id: None, model: None, role: None, limit: None,
        }).unwrap();
        assert_eq!(xs.len(), 3);
    }

    #[test]
    fn query_filters_by_provider() {
        let db = db_with_rows();
        let xs = query(&db.conn().unwrap(), &UsageFilter {
            from_ts: None, to_ts: None, provider_id: Some("p1".into()),
            model: None, role: None, limit: None,
        }).unwrap();
        assert_eq!(xs.len(), 2);
    }

    #[test]
    fn aggregate_by_provider() {
        let db = db_with_rows();
        let xs = aggregate(&db.conn().unwrap(), &UsageFilter {
            from_ts: None, to_ts: None, provider_id: None, model: None, role: None, limit: None,
        }, GroupBy::Provider).unwrap();
        assert_eq!(xs.len(), 2);
        let p1 = xs.iter().find(|r| r.bucket == "provider:p1").unwrap();
        assert_eq!(p1.tasks, 2);
        assert_eq!(p1.prompt_tokens, 200);
        assert_eq!(p1.p50_total_ms, Some(500)); // sorted [500,600], median=500
    }

    #[test]
    fn purge_drops_old_rows() {
        let db = db_with_rows();
        let n = purge(&db.conn().unwrap(), 2_500).unwrap();
        assert_eq!(n, 2);
        let xs = query(&db.conn().unwrap(), &UsageFilter {
            from_ts: None, to_ts: None, provider_id: None, model: None, role: None, limit: None,
        }).unwrap();
        assert_eq!(xs.len(), 1);
    }
}
