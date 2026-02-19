use anyhow::Result;
use std::sync::Arc;
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

    tokio::try_join!(
        dns::serve(cfg.clone(), db_pool.clone(), filter.clone(), metrics.clone()),
        api::serve(cfg.clone(), db_pool.clone(), filter.clone(), metrics.clone()),
    )?;

    Ok(())
}
