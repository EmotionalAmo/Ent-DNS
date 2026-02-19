use anyhow::Result;
use std::sync::Arc;
use crate::config::Config;
use crate::db::DbPool;
use filter::FilterEngine;

pub mod server;
pub mod handler;
pub mod resolver;
pub mod filter;
pub mod rules;
pub mod cache;
pub mod acl;

pub async fn serve(cfg: Config, db: DbPool, filter: Arc<FilterEngine>) -> Result<()> {
    tracing::info!("DNS server starting on {}:{}", cfg.dns.bind, cfg.dns.port);
    server::run(cfg, db, filter).await
}
