use anyhow::Result;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::info;

// Re-use modules from the library crate
use ent_dns::api;
use ent_dns::config;
use ent_dns::db;
use ent_dns::dns;
use ent_dns::metrics;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ent_dns=debug".parse()?)
                .add_directive("hickory_resolver=debug".parse()?)
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
    // Rotates logs daily to prevent database from growing indefinitely
    {
        let db = db_pool.clone();
        let cfg_clone = cfg.clone();
        tokio::spawn(async move {
            let retention_days = cfg_clone.database.query_log_retention_days;

            // Run daily at 3 AM (24h interval)
            let mut ticker = tokio::time::interval(tokio::time::Duration::from_secs(86400));

            tracing::info!(
                "Query log rotation enabled: retaining {} days, running daily",
                retention_days
            );

            ticker.tick().await; // skip immediate first tick
            loop {
                ticker.tick().await;

                match sqlx::query(
                    "DELETE FROM query_log WHERE time < datetime('now', '-' || ? || ' days')"
                )
                .bind(retention_days as i64)
                .execute(&db)
                .await {
                    Ok(r) if r.rows_affected() > 0 =>
                        tracing::info!(
                            "Query log rotation: deleted {} entries older than {} days",
                            r.rows_affected(),
                            retention_days
                        ),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("Query log rotation error: {}", e),
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
