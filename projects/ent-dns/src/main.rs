use anyhow::Result;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::info;

mod api;
mod auth;
mod config;
mod db;
mod dns;
mod error;
mod metrics;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ent_dns=info".parse()?)
        )
        .init();

    info!("Starting Ent-DNS Enterprise v{}", env!("CARGO_PKG_VERSION"));

    let cfg = config::load()?;
    info!("Configuration loaded");

    let db_pool = db::init(&cfg).await?;
    info!("Database initialized");

    // Seed initial admin user if none exist
    db::seed_admin(&db_pool, &cfg).await?;

    // Shared DNS metrics between DNS server and API
    let metrics = Arc::new(metrics::DnsMetrics::default());

    // FilterEngine shared between DNS engine and Management API
    let filter = Arc::new(dns::filter::FilterEngine::new(db_pool.clone()).await?);

    // Broadcast channel for real-time query log push (WebSocket)
    let (query_log_tx, _) = broadcast::channel::<serde_json::Value>(256);

    // Background: auto-refresh filter lists based on each list's update_interval_hours
    {
        let db = db_pool.clone();
        let filter_engine = filter.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(tokio::time::Duration::from_secs(3600));
            ticker.tick().await; // skip immediate first tick
            loop {
                ticker.tick().await;
                tracing::info!("Auto-refresh: checking filter lists...");

                let lists: Vec<(String, String, Option<i64>, Option<String>)> = match sqlx::query_as(
                    "SELECT id, url, update_interval_hours, last_updated
                     FROM filter_lists WHERE is_enabled = 1 AND url != '' AND url IS NOT NULL"
                ).fetch_all(&db).await {
                    Ok(r) => r,
                    Err(e) => { tracing::warn!("Auto-refresh DB error: {}", e); continue; }
                };

                let mut refreshed = false;
                for (id, url, interval_hours, last_updated) in lists {
                    let interval_h = interval_hours.unwrap_or(24);
                    let due = last_updated
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|last| {
                            let elapsed = Utc::now().signed_duration_since(last.with_timezone(&Utc));
                            elapsed.num_hours() >= interval_h
                        })
                        .unwrap_or(true);

                    if due {
                        match dns::subscription::sync_filter_list(&db, &id, &url).await {
                            Ok(n) => { tracing::info!("Auto-refreshed filter {}: {} rules", id, n); refreshed = true; }
                            Err(e) => tracing::warn!("Auto-refresh filter {}: {}", id, e),
                        }
                    }
                }

                if refreshed {
                    if let Err(e) = filter_engine.reload().await {
                        tracing::warn!("Filter reload after auto-refresh: {}", e);
                    }
                }
            }
        });
    }

    // Background: auto-cleanup query log based on query_log_retention_days setting
    {
        let db = db_pool.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(tokio::time::Duration::from_secs(6 * 3600));
            ticker.tick().await; // skip immediate first tick
            loop {
                ticker.tick().await;
                let retention: i64 = sqlx::query_scalar(
                    "SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'query_log_retention_days'"
                )
                .fetch_optional(&db)
                .await
                .ok()
                .flatten()
                .unwrap_or(30);

                match sqlx::query(
                    "DELETE FROM query_log WHERE time < datetime('now', ?)"
                )
                .bind(format!("-{} days", retention))
                .execute(&db)
                .await {
                    Ok(r) if r.rows_affected() > 0 =>
                        tracing::info!("Query log cleanup: deleted {} rows older than {} days", r.rows_affected(), retention),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("Query log cleanup error: {}", e),
                }
            }
        });
    }

    // Build a single DnsHandler shared between the DNS server (UDP/TCP) and the
    // API server (DoH endpoint).  Both use the same filter, cache, and log writer.
    let dns_handler = dns::build_handler(&cfg, db_pool.clone(), filter.clone(), metrics.clone(), query_log_tx.clone()).await?;

    tokio::try_join!(
        dns::serve(dns_handler.clone(), &cfg),
        api::serve(cfg.clone(), db_pool.clone(), filter.clone(), metrics.clone(), query_log_tx, dns_handler),
    )?;

    Ok(())
}
