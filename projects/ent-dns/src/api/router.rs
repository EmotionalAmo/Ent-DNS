use axum::{routing::{get, post, put, delete}, Router};
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use super::AppState;
use super::handlers;

pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        // Health (public)
        .route("/health", get(handlers::health::health_check))
        // Auth (public)
        .route("/api/v1/auth/login", post(handlers::auth::login))
        .route("/api/v1/auth/logout", post(handlers::auth::logout))
        // Change Password (protected)
        .route("/api/v1/auth/change-password", post(handlers::auth::change_password))
        // Dashboard (protected)
        .route("/api/v1/dashboard/stats", get(handlers::dashboard::get_stats))
        .route("/api/v1/dashboard/query-trend", get(handlers::dashboard::get_query_trend))
        // Query log (protected)
        .route("/api/v1/query-log", get(handlers::query_log::list))
        .route("/api/v1/query-log/export", get(handlers::query_log::export))
        // Filters (protected)
        .route("/api/v1/filters", get(handlers::filters::list).post(handlers::filters::create))
        .route("/api/v1/filters/{id}", put(handlers::filters::update).delete(handlers::filters::delete))
        .route("/api/v1/filters/{id}/refresh", post(handlers::filters::refresh))
        // Rules (protected)
        .route("/api/v1/rules", get(handlers::rules::list).post(handlers::rules::create))
        .route("/api/v1/rules/{id}", delete(handlers::rules::delete))
        // DNS Rewrites (protected)
        .route("/api/v1/rewrites", get(handlers::rewrites::list).post(handlers::rewrites::create))
        .route("/api/v1/rewrites/{id}", put(handlers::rewrites::update).delete(handlers::rewrites::delete))
        // Clients (protected)
        .route("/api/v1/clients", get(handlers::clients::list).post(handlers::clients::create))
        .route("/api/v1/clients/{id}", put(handlers::clients::update).delete(handlers::clients::delete))
        // Upstreams (protected)
        .route("/api/v1/settings/upstreams", get(handlers::upstreams::list).post(handlers::upstreams::create))
        .route("/api/v1/settings/upstreams/{id}", get(handlers::upstreams::get))
        .route("/api/v1/settings/upstreams/{id}", put(handlers::upstreams::update).delete(handlers::upstreams::delete))
        .route("/api/v1/settings/upstreams/{id}/test", post(handlers::upstreams::test))
        .route("/api/v1/settings/upstreams/failover", post(handlers::upstreams::trigger_failover))
        // Settings (protected)
        .route("/api/v1/settings/dns", get(handlers::settings::get_dns).put(handlers::settings::update_dns))
        // Users (admin only)
        .route("/api/v1/users", get(handlers::users::list).post(handlers::users::create))
        .route("/api/v1/users/{id}/role", put(handlers::users::update_role))
        // Audit log (admin only)
        .route("/api/v1/audit-log", get(handlers::audit_log::list))
        .route("/api/v1/settings/upstreams/failover-log", get(handlers::upstreams::failover_log))
        // Prometheus metrics (admin only - security fix)
        .route("/metrics", get(handlers::metrics::prometheus_metrics))
        // Backup (admin only)
        .route("/api/v1/admin/backup", get(handlers::backup::create_backup))
        // WebSocket: issue one-time ticket (authenticated), then connect via ticket
        .route("/api/v1/ws/ticket", post(handlers::ws::issue_ticket))
        .route("/api/v1/ws/query-log", get(handlers::ws::query_log_ws))
        // DNS-over-HTTPS (RFC 8484) — public endpoint, no auth required
        .route("/dns-query", get(handlers::doh::get_query).post(handlers::doh::post_query))
        .with_state(state)
        // 前端静态文件 + SPA fallback（必须在 with_state 之后）
        // ENT_DNS_STATIC_DIR overrides the default relative path (fixes L-2)
        .fallback_service({
            let static_dir = std::env::var("ENT_DNS_STATIC_DIR")
                .unwrap_or_else(|_| "frontend/dist".to_string());
            let fallback = format!("{}/index.html", static_dir);
            ServeDir::new(static_dir)
                .fallback(ServeFile::new(fallback))
        })
}
