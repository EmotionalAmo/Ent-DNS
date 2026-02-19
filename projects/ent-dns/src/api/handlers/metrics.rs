use axum::{extract::State, response::IntoResponse};
use axum::http::header;
use std::sync::Arc;
use crate::api::AppState;

pub async fn prometheus_metrics(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let body = state.metrics.to_prometheus_text();
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}
