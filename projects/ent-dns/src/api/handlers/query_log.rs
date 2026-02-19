use axum::{
    extract::{State, Query},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::error::AppResult;

#[derive(Deserialize)]
pub struct QueryLogParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    status: Option<String>,
    client: Option<String>,
    domain: Option<String>,
}

fn default_limit() -> i64 {
    100
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<QueryLogParams>,
) -> AppResult<Json<Value>> {
    let limit = params.limit.clamp(1, 1000);

    // Simple approach: fetch all rows matching filters and paginate in SQL.
    // Future: build dynamic WHERE clause. For now, status filter is most common.
    let rows: Vec<(i64, String, String, Option<String>, String, String, Option<String>, String, Option<String>, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms
             FROM query_log
             ORDER BY time DESC
             LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(params.offset)
        .fetch_all(&state.db)
        .await?;

    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM query_log")
        .fetch_one(&state.db)
        .await?;

    // Apply optional in-memory filters (fast enough for typical usage)
    let data: Vec<Value> = rows
        .into_iter()
        .filter(|(_, _, client_ip, _, question, _, _, status, _, _)| {
            if let Some(ref f) = params.status {
                if status != f {
                    return false;
                }
            }
            if let Some(ref f) = params.client {
                if !client_ip.contains(f.as_str()) {
                    return false;
                }
            }
            if let Some(ref f) = params.domain {
                if !question.contains(f.as_str()) {
                    return false;
                }
            }
            true
        })
        .map(|(id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms)| {
            json!({
                "id": id,
                "time": time,
                "client_ip": client_ip,
                "client_name": client_name,
                "question": question,
                "qtype": qtype,
                "answer": answer,
                "status": status,
                "reason": reason,
                "elapsed_ms": elapsed_ms,
            })
        })
        .collect();

    let returned = data.len();
    Ok(Json(json!({
        "data": data,
        "total": total,
        "returned": returned,
        "offset": params.offset,
        "limit": limit,
    })))
}
