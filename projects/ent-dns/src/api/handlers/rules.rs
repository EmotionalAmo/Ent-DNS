use axum::{
    extract::{State, Path},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use chrono::Utc;
use uuid::Uuid;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
pub struct CreateRuleRequest {
    rule: String,
    #[serde(default)]
    comment: Option<String>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, Option<String>, i64, String, String)> = sqlx::query_as(
        "SELECT id, rule, comment, is_enabled, created_by, created_at
         FROM custom_rules ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, rule, comment, is_enabled, created_by, created_at)| {
            json!({
                "id": id,
                "rule": rule,
                "comment": comment,
                "is_enabled": is_enabled == 1,
                "created_by": created_by,
                "created_at": created_at,
            })
        })
        .collect();
    let count = data.len();
    Ok(Json(json!({ "data": data, "total": count })))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(body): Json<CreateRuleRequest>,
) -> AppResult<Json<Value>> {
    let rule = body.rule.trim().to_string();
    if rule.is_empty() {
        return Err(AppError::Validation("Rule cannot be empty".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO custom_rules (id, rule, comment, is_enabled, created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?)"
    )
    .bind(&id)
    .bind(&rule)
    .bind(&body.comment)
    .bind(&auth.0.username)
    .bind(&now)
    .execute(&state.db)
    .await?;

    // Hot-reload the filter engine so the new rule takes effect immediately.
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "id": id,
        "rule": rule,
        "comment": body.comment,
        "is_enabled": true,
        "created_by": auth.0.username,
        "created_at": now,
    })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let result = sqlx::query("DELETE FROM custom_rules WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Rule {} not found", id)));
    }

    // Hot-reload so the deleted rule stops blocking immediately.
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({"success": true})))
}
