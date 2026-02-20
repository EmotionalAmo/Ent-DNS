use anyhow::Result;
use axum::Router;
use axum::http::{HeaderValue, Method, header};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tokio::sync::broadcast;
use std::sync::Arc;
use std::net::SocketAddr;
use std::time::Instant;
use dashmap::DashMap;
use crate::config::Config;
use crate::db::DbPool;
use crate::dns::filter::FilterEngine;
use crate::dns::DnsHandler;
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
    pub query_log_tx: broadcast::Sender<serde_json::Value>,
    /// One-time WebSocket tickets: ticket_uuid → issued_at (H-2)
    pub ws_tickets: DashMap<String, Instant>,
    /// Login failure tracking: ip → (failure_count, window_start) (H-5)
    pub login_attempts: DashMap<String, (u32, Instant)>,
    /// Shared DNS handler — used by the DoH endpoint (Task 5)
    pub dns_handler: Arc<DnsHandler>,
}

pub async fn serve(
    cfg: Config,
    db: DbPool,
    filter: Arc<FilterEngine>,
    metrics: Arc<DnsMetrics>,
    query_log_tx: broadcast::Sender<serde_json::Value>,
    dns_handler: Arc<DnsHandler>,
) -> Result<()> {
    let bind_addr = format!("{}:{}", cfg.api.bind, cfg.api.port);
    let state = Arc::new(AppState {
        db,
        filter,
        jwt_secret: cfg.auth.jwt_secret.clone(),
        jwt_expiry_hours: cfg.auth.jwt_expiry_hours,
        metrics,
        query_log_tx,
        ws_tickets: DashMap::new(),
        login_attempts: DashMap::new(),
        dns_handler,
    });
    let cors = build_cors_layer(&cfg.api.cors_allowed_origins);
    let app = build_app(state, cors);

    // Use into_make_service_with_connect_info to expose the real TCP peer IP (H-3)
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("Management API listening on http://{}", bind_addr);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    ).await?;
    Ok(())
}

fn build_cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    if origins.is_empty() {
        tracing::warn!("No valid CORS origins configured; CORS will block all cross-origin requests");
        return CorsLayer::new();
    }

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

pub fn build_app(state: Arc<AppState>, cors: CorsLayer) -> Router {
    Router::new()
        .merge(router::routes(state))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}
