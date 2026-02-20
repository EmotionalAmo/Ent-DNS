/// Async batch writer for query log entries.
///
/// DnsHandler sends log entries via an UnboundedSender (non-blocking, zero latency
/// on the DNS hot path). This background task drains the channel every second or
/// when a batch of 100 entries accumulates, then writes them in a single SQLite
/// transaction — dramatically reducing write amplification.
use crate::db::DbPool;
use tokio::sync::mpsc;
use tokio::time::{Duration, interval};

/// A single query log entry to be persisted.
#[derive(Debug, Clone)]
pub struct QueryLogEntry {
    pub time: String,
    pub client_ip: String,
    pub question: String,
    pub qtype: String,
    pub status: String,
    pub reason: Option<String>,
    pub elapsed_ms: i64,
}

/// How many entries to accumulate before forcing a flush.
const BATCH_SIZE: usize = 100;
/// Maximum time between flushes even when batch is not full.
const FLUSH_INTERVAL: Duration = Duration::from_secs(1);

/// Spawn the background writer task.  Returns the sender end of the channel
/// which DnsHandler uses to enqueue entries (non-blocking).
pub fn spawn(db: DbPool) -> mpsc::UnboundedSender<QueryLogEntry> {
    let (tx, rx) = mpsc::unbounded_channel::<QueryLogEntry>();
    tokio::spawn(run(db, rx));
    tx
}

async fn run(db: DbPool, mut rx: mpsc::UnboundedReceiver<QueryLogEntry>) {
    let mut ticker = interval(FLUSH_INTERVAL);
    let mut batch: Vec<QueryLogEntry> = Vec::with_capacity(BATCH_SIZE);

    loop {
        tokio::select! {
            // New entry arrived
            maybe_entry = rx.recv() => {
                match maybe_entry {
                    Some(entry) => {
                        batch.push(entry);
                        if batch.len() >= BATCH_SIZE {
                            flush(&db, &mut batch).await;
                        }
                    }
                    None => {
                        // Channel closed (process shutting down) — flush remainder
                        if !batch.is_empty() {
                            flush(&db, &mut batch).await;
                        }
                        tracing::info!("QueryLogWriter: channel closed, exiting");
                        return;
                    }
                }
            }
            // Periodic flush tick
            _ = ticker.tick() => {
                if !batch.is_empty() {
                    flush(&db, &mut batch).await;
                }
            }
        }
    }
}

/// Write all entries in `batch` inside a single SQLite transaction, then clear it.
async fn flush(db: &DbPool, batch: &mut Vec<QueryLogEntry>) {
    let count = batch.len();
    match write_batch(db, batch).await {
        Ok(_) => tracing::debug!("QueryLogWriter: flushed {} entries", count),
        Err(e) => tracing::warn!("QueryLogWriter: batch write failed ({} entries): {}", count, e),
    }
    batch.clear();
}

async fn write_batch(db: &DbPool, batch: &[QueryLogEntry]) -> Result<(), sqlx::Error> {
    if batch.is_empty() {
        return Ok(());
    }

    let mut tx = db.begin().await?;

    for entry in batch {
        sqlx::query(
            "INSERT INTO query_log (time, client_ip, question, qtype, status, reason, elapsed_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&entry.time)
        .bind(&entry.client_ip)
        .bind(&entry.question)
        .bind(&entry.qtype)
        .bind(&entry.status)
        .bind(&entry.reason)
        .bind(entry.elapsed_ms)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
