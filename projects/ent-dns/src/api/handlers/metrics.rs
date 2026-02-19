use axum::{extract::State, response::IntoResponse};
use axum::http::header;
use std::sync::Arc;
use crate::api::{AppState, middleware::rbac::AdminUser};

pub async fn prometheus_metrics(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser, // Require admin role to access metrics
) -> impl IntoResponse {
    let body = state.metrics.to_prometheus_text();
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}
