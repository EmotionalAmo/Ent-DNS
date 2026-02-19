use anyhow::Result;
use std::sync::Arc;
use tokio::sync::broadcast;
use crate::config::Config;
use crate::db::DbPool;
use crate::metrics::DnsMetrics;
use filter::FilterEngine;

pub mod server;
pub mod handler;
pub mod resolver;
pub mod filter;
pub mod rules;
pub mod cache;
pub mod acl;
pub mod subscription;

pub async fn serve(cfg: Config, db: DbPool, filter: Arc<FilterEngine>, metrics: Arc<DnsMetrics>, query_log_tx: broadcast::Sender<serde_json::Value>) -> Result<()> {
    tracing::info!("DNS server starting on {}:{}", cfg.dns.bind, cfg.dns.port);
    server::run(cfg, db, filter, metrics, query_log_tx).await
}
