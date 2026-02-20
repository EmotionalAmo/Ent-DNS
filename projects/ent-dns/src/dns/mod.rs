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

pub use handler::DnsHandler;

/// Build a shared `DnsHandler`.  Call this once in `main`, then pass the Arc
/// both to `serve` (for UDP/TCP DNS) and to `AppState` (for the DoH HTTP endpoint).
pub async fn build_handler(
    cfg: &Config,
    db: DbPool,
    filter: Arc<FilterEngine>,
    metrics: Arc<DnsMetrics>,
    query_log_tx: broadcast::Sender<serde_json::Value>,
) -> Result<Arc<DnsHandler>> {
    Ok(Arc::new(DnsHandler::new(cfg.clone(), db, filter, metrics, query_log_tx).await?))
}

/// Start the DNS server (UDP + TCP) using a previously built handler.
pub async fn serve(handler: Arc<DnsHandler>, cfg: &Config) -> Result<()> {
    let bind_addr = format!("{}:{}", cfg.dns.bind, cfg.dns.port);
    tracing::info!("DNS server starting on {}", bind_addr);
    server::run(handler, bind_addr).await
}
