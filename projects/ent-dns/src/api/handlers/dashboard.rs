use axum::{extract::{Query, State}, Json};
use serde::Deserialize;
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

#[derive(Deserialize)]
pub struct TrendParams {
    pub hours: Option<i64>,
}

pub async fn get_query_trend(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<TrendParams>,
) -> AppResult<Json<Value>> {
    let hours = params.hours.unwrap_or(24).clamp(1, 168);

    // Aggregate query_log by hour over the requested window
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT
            strftime('%H:00', time) as hour,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
            SUM(CASE WHEN status = 'allowed' THEN 1 ELSE 0 END) as allowed
         FROM query_log
         WHERE time >= datetime('now', printf('-%d hours', ?))
         GROUP BY strftime('%Y-%m-%d %H', time)
         ORDER BY time ASC"
    )
    .bind(hours)
    .fetch_all(&state.db)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(hour, total, blocked, allowed)| {
            json!({
                "time": hour,
                "total": total,
                "blocked": blocked,
                "allowed": allowed,
            })
        })
        .collect();

    Ok(Json(json!(data)))
}
