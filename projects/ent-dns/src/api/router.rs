use axum::{routing::{get, post, put, delete}, Router};
use std::sync::Arc;
use super::AppState;
use super::handlers;

pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        // Health (public)
        .route("/health", get(handlers::health::health_check))
        // Auth (public)
        .route("/api/v1/auth/login", post(handlers::auth::login))
        .route("/api/v1/auth/logout", post(handlers::auth::logout))
        // Dashboard (protected)
        .route("/api/v1/dashboard/stats", get(handlers::dashboard::get_stats))
        // Query log (protected)
        .route("/api/v1/query-log", get(handlers::query_log::list))
        // Filters (protected)
        .route("/api/v1/filters", get(handlers::filters::list).post(handlers::filters::create))
        .route("/api/v1/filters/{id}", put(handlers::filters::update).delete(handlers::filters::delete))
        // Rules (protected)
        .route("/api/v1/rules", get(handlers::rules::list).post(handlers::rules::create))
        .route("/api/v1/rules/{id}", delete(handlers::rules::delete))
        // Clients (protected)
        .route("/api/v1/clients", get(handlers::clients::list).post(handlers::clients::create))
        .route("/api/v1/clients/{id}", put(handlers::clients::update).delete(handlers::clients::delete))
        // Settings (protected)
        .route("/api/v1/settings/dns", get(handlers::settings::get_dns).put(handlers::settings::update_dns))
        // Users (admin only)
        .route("/api/v1/users", get(handlers::users::list).post(handlers::users::create))
        .route("/api/v1/users/{id}/role", put(handlers::users::update_role))
        // Audit log (admin only)
        .route("/api/v1/audit-log", get(handlers::audit_log::list))
        // Prometheus metrics (public)
        .route("/metrics", get(handlers::metrics::prometheus_metrics))
        .with_state(state)
}
