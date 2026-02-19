use axum::{
    extract::{Path, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::api::middleware::auth::AuthUser;
use crate::api::AppState;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
pub struct CreateFilterRequest {
    pub name: String,
    pub url: Option<String>,
    #[serde(default = "default_enabled")]
    pub is_enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct UpdateFilterRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub is_enabled: Option<bool>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    let rows: Vec<(String, String, Option<String>, i64, i64, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, url, is_enabled, rule_count, last_updated, created_at
         FROM filter_lists ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, url, is_enabled, rule_count, last_updated, created_at)| {
            json!({
                "id": id,
                "name": name,
                "url": url,
                "is_enabled": is_enabled == 1,
                "rule_count": rule_count,
                "last_updated": last_updated,
                "created_at": created_at,
            })
        })
        .collect();
    let count = data.len();
    Ok(Json(json!({ "data": data, "total": count })))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Json(body): Json<CreateFilterRequest>,
) -> AppResult<Json<Value>> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Filter name cannot be empty".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let is_enabled = if body.is_enabled { 1 } else { 0 };

    sqlx::query(
        "INSERT INTO filter_lists (id, name, url, is_enabled, rule_count, last_updated, created_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?)"
    )
    .bind(&id)
    .bind(&name)
    .bind(&body.url)
    .bind(is_enabled)
    .bind(&now)
    .execute(&state.db)
    .await?;

    // If URL provided, trigger initial sync (async, non-blocking)
    let rule_count = if let Some(ref url) = body.url {
        match crate::dns::subscription::sync_filter_list(&state.db, &id, url).await {
            Ok(count) => count,
            Err(e) => {
                tracing::warn!("Failed to sync filter list {}: {}", id, e);
                0
            }
        }
    } else {
        0
    };

    // Get updated last_updated
    let last_updated: Option<String> = sqlx::query_scalar(
        "SELECT last_updated FROM filter_lists WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    // Hot-reload filter engine
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "id": id,
        "name": name,
        "url": body.url,
        "is_enabled": body.is_enabled,
        "rule_count": rule_count,
        "last_updated": last_updated,
        "created_at": now,
    })))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<String>,
    Json(body): Json<UpdateFilterRequest>,
) -> AppResult<Json<Value>> {
    // Check if filter exists
    let existing: Option<(String, String, Option<String>, i64, i64, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, url, is_enabled, rule_count, last_updated, created_at
         FROM filter_lists WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;

    let (_, old_name, old_url, old_enabled, old_rule_count, old_last_updated, created_at) = existing
        .ok_or_else(|| AppError::NotFound(format!("Filter list {} not found", id)))?;

    let name = body.name.unwrap_or(old_name);
    let url = body.url.or(old_url);
    let is_enabled = body.is_enabled.map(|b| if b { 1 } else { 0 }).unwrap_or(old_enabled);

    sqlx::query(
        "UPDATE filter_lists SET name = ?, url = ?, is_enabled = ? WHERE id = ?"
    )
    .bind(&name)
    .bind(&url)
    .bind(is_enabled)
    .bind(&id)
    .execute(&state.db)
    .await?;

    // Hot-reload filter engine
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "id": id,
        "name": name,
        "url": url,
        "is_enabled": is_enabled == 1,
        "rule_count": old_rule_count,
        "last_updated": old_last_updated,
        "created_at": created_at,
    })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    // Delete associated rules first
    sqlx::query("DELETE FROM custom_rules WHERE created_by = ?")
        .bind(format!("filter:{}", id))
        .execute(&state.db)
        .await?;

    let result = sqlx::query("DELETE FROM filter_lists WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Filter list {} not found", id)));
    }

    // Hot-reload filter engine
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({"success": true})))
}

/// Manually refresh a remote filter list
pub async fn refresh(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    // Get filter list info
    let filter: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT name, url FROM filter_lists WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;

    let (name, url) = filter
        .ok_or_else(|| AppError::NotFound(format!("Filter list {} not found", id)))?;

    let url = url.ok_or_else(|| AppError::Validation(
        "Cannot refresh local filter list (no URL configured)".to_string()
    ))?;

    // Sync the filter list
    let rule_count = crate::dns::subscription::sync_filter_list(&state.db, &id, &url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to sync filter list: {}", e)))?;

    // Hot-reload filter engine
    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    // Get updated last_updated
    let last_updated: (Option<String>,) = sqlx::query_as(
        "SELECT last_updated FROM filter_lists WHERE id = ?"
    )
    .bind(&id)
    .fetch_one(&state.db)
    .await?;

    let last_updated = last_updated.0.unwrap_or_else(|| Utc::now().to_rfc3339());

    Ok(Json(json!({
        "id": id,
        "name": name,
        "rule_count": rule_count,
        "last_updated": last_updated,
        "success": true
    })))
}
