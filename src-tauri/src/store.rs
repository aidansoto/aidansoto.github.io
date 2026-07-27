//! Local SQLite persistence.
//!
//! The campus document is stored as a single JSON blob in a key/value table.
//! That is deliberate: the document schema is expected to change constantly
//! during design work, and migrating a normalised schema on every layout tweak
//! would cost far more than it saves. The frontend already normalises and
//! repairs whatever it reads back, so a stale blob degrades gracefully.
//!
//! Revisions are retained so a bad edit can be recovered.

use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("store is locked")]
    Poisoned,
}

impl serde::Serialize for StoreError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct CampusStore {
    conn: Mutex<Connection>,
}

impl CampusStore {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;

        // WAL keeps the writer from blocking the UI thread's reads.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Last-resort store when the on-disk database cannot be opened (missing
    /// permissions, corrupt file, full disk). The application keeps running;
    /// persistence is sacrificed for the session, never startup.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        Self::init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn init_schema(conn: &Connection) -> Result<(), StoreError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS documents (
                 key        TEXT PRIMARY KEY,
                 value      TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS revisions (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 key        TEXT NOT NULL,
                 value      TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS revisions_key_idx ON revisions (key, id DESC);",
        )?;
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, StoreError> {
        self.conn.lock().map_err(|_| StoreError::Poisoned)
    }

    pub fn load(&self, key: &str) -> Result<Option<String>, StoreError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT value FROM documents WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn save(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let now = now_millis();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;

        tx.execute(
            "INSERT INTO documents (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        tx.execute(
            "INSERT INTO revisions (key, value, created_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
        // Keep the last 20 revisions per key; beyond that the history is noise.
        tx.execute(
            "DELETE FROM revisions
             WHERE key = ?1
               AND id NOT IN (SELECT id FROM revisions WHERE key = ?1 ORDER BY id DESC LIMIT 20)",
            params![key],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn clear(&self, key: &str) -> Result<(), StoreError> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM documents WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn revisions(&self, key: &str, limit: u32) -> Result<Vec<(i64, String)>, StoreError> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT created_at, value FROM revisions WHERE key = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![key, limit], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StoreError::from)
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Tests run in parallel, so the filename needs more entropy than a
    /// millisecond timestamp — two tests starting in the same millisecond
    /// would otherwise share a database.
    fn temp_store() -> (CampusStore, std::path::PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
        let mut path = std::env::temp_dir();
        path.push(format!("campus-test-{}-{}-{}.sqlite", std::process::id(), nanos, seq));
        let store = CampusStore::open(&path).expect("open");
        (store, path)
    }

    #[test]
    fn round_trips_a_document() {
        let (store, path) = temp_store();
        assert_eq!(store.load("campus.document").unwrap(), None);

        store.save("campus.document", r#"{"version":1}"#).unwrap();
        assert_eq!(
            store.load("campus.document").unwrap().as_deref(),
            Some(r#"{"version":1}"#)
        );

        store.save("campus.document", r#"{"version":2}"#).unwrap();
        assert_eq!(
            store.load("campus.document").unwrap().as_deref(),
            Some(r#"{"version":2}"#)
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn retains_revision_history() {
        let (store, path) = temp_store();
        for i in 0..25 {
            store
                .save("campus.document", &format!(r#"{{"n":{i}}}"#))
                .unwrap();
        }
        let revisions = store.revisions("campus.document", 50).unwrap();
        // Capped at 20 by the pruning statement.
        assert_eq!(revisions.len(), 20);
        assert_eq!(revisions[0].1, r#"{"n":24}"#);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn clear_removes_the_document() {
        let (store, path) = temp_store();
        store.save("k", "v").unwrap();
        store.clear("k").unwrap();
        assert_eq!(store.load("k").unwrap(), None);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn in_memory_fallback_round_trips() {
        let store = CampusStore::open_in_memory().expect("open in-memory");
        assert_eq!(store.load("k").unwrap(), None);
        store.save("k", "v").unwrap();
        assert_eq!(store.load("k").unwrap().as_deref(), Some("v"));
    }
}
