use anyhow::Result;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use std::sync::Arc;
use crate::config::Config;
use crate::db::DbPool;
use crate::dns::filter::FilterEngine;
use crate::metrics::DnsMetrics;

pub mod router;
pub mod middleware;
pub mod handlers;

pub struct AppState {
    pub db: DbPool,
    pub filter: Arc<FilterEngine>,
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,
    pub metrics: Arc<DnsMetrics>,
}

pub async fn serve(cfg: Config, db: DbPool, filter: Arc<FilterEngine>, metrics: Arc<DnsMetrics>) -> Result<()> {
    let bind_addr = format!("{}:{}", cfg.api.bind, cfg.api.port);
    let state = Arc::new(AppState {
        db,
        filter,
        jwt_secret: cfg.auth.jwt_secret.clone(),
        jwt_expiry_hours: cfg.auth.jwt_expiry_hours,
        metrics,
    });
    let app = build_app(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("Management API listening on http://{}", bind_addr);

    axum::serve(listener, app).await?;
    Ok(())
}

pub fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .merge(router::routes(state))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
}
