use axum::{extract::State, Json};
use serde_json::{json, Value};
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::error::AppResult;

pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    // Counts over the last 24 hours
    let (total,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM query_log WHERE time >= datetime('now', '-24 hours')"
    )
    .fetch_one(&state.db)
    .await?;

    let (blocked,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM query_log WHERE status = 'blocked' AND time >= datetime('now', '-24 hours')"
    )
    .fetch_one(&state.db)
    .await?;

    let (cached,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM query_log WHERE status = 'cached' AND time >= datetime('now', '-24 hours')"
    )
    .fetch_one(&state.db)
    .await?;

    let allowed = total - blocked - cached;
    let block_rate = if total > 0 {
        blocked as f64 / total as f64 * 100.0
    } else {
        0.0
    };

    let (filter_rules,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM custom_rules WHERE is_enabled = 1"
    )
    .fetch_one(&state.db)
    .await?;

    let (filter_lists,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM filter_lists WHERE is_enabled = 1"
    )
    .fetch_one(&state.db)
    .await?;

    let (clients,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM clients")
        .fetch_one(&state.db)
        .await?;

    Ok(Json(json!({
        "total_queries": total,
        "blocked_queries": blocked,
        "allowed_queries": allowed,
        "cached_queries": cached,
        "block_rate": (block_rate * 10.0).round() / 10.0,
        "filter_rules": filter_rules,
        "filter_lists": filter_lists,
        "clients": clients,
    })))
}
