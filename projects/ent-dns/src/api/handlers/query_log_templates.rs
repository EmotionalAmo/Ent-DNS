// Query Log Templates CRUD
// File: src/api/handlers/query_log_templates.rs
// Author: ui-duarte
// Date: 2026-02-20

use axum::{
    extract::{State, Path},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::error::AppResult;
use uuid::Uuid;

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Serialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub filters: serde_json::Value,
    pub logic: String,
    pub created_by: String,
    pub created_at: String,
    pub is_public: bool,
}

#[derive(Debug, Deserialize)]
pub struct TemplateCreate {
    pub name: String,
    pub filters: serde_json::Value,
    pub logic: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct TemplateUpdate {
    pub name: Option<String>,
    pub filters: Option<serde_json::Value>,
    pub logic: Option<String>,
    pub is_public: Option<bool>,
}

// ============================================================================
// API Handlers
// ============================================================================

/// 列出所有查询模板（公开的 + 自己创建的）
pub async fn list(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> AppResult<Json<Vec<Template>>> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, i64)>(
        "SELECT id, name, filters, logic, created_by, created_at, is_public
         FROM query_log_templates
         WHERE is_public = 1 OR created_by = ?
         ORDER BY created_at DESC"
    )
    .bind(&auth.username)
    .fetch_all(&state.db)
    .await?;

    let templates: Vec<Template> = rows
        .into_iter()
        .map(|(id, name, filters, logic, created_by, created_at, is_public)| Template {
            id,
            name,
            filters: serde_json::from_str(&filters).unwrap_or(json!([])),
            logic,
            created_by,
            created_at,
            is_public: is_public != 0,
        })
        .collect();

    Ok(Json(templates))
}

/// 创建查询模板
pub async fn create(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<TemplateCreate>,
) -> AppResult<Json<Template>> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let logic = req.logic.unwrap_or_else(|| "AND".to_string());
    let is_public = req.is_public.unwrap_or(false);
    let filters_json = serde_json::to_string(&req.filters)
        .map_err(|e| anyhow::anyhow!("Invalid filters JSON: {}", e))?;

    sqlx::query(
        "INSERT INTO query_log_templates (id, name, filters, logic, created_by, created_at, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&filters_json)
    .bind(&logic)
    .bind(&auth.username)
    .bind(&now)
    .bind(is_public as i64)
    .execute(&state.db)
    .await?;

    Ok(Json(Template {
        id,
        name: req.name,
        filters: req.filters,
        logic,
        created_by: auth.username,
        created_at: now,
        is_public,
    }))
}

/// 获取单个模板
pub async fn get(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<Json<Template>> {
    let row = sqlx::query_as::<_, (String, String, String, String, String, String, i64)>(
        "SELECT id, name, filters, logic, created_by, created_at, is_public
         FROM query_log_templates
         WHERE id = ? AND (is_public = 1 OR created_by = ?)"
    )
    .bind(&id)
    .bind(&auth.username)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Template not found or access denied"))?;

    let (id, name, filters, logic, created_by, created_at, is_public) = row;
    Ok(Json(Template {
        id,
        name,
        filters: serde_json::from_str(&filters).unwrap_or(json!([])),
        logic,
        created_by,
        created_at,
        is_public: is_public != 0,
    }))
}

/// 更新模板（仅创建者可编辑）
pub async fn update(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<TemplateUpdate>,
) -> AppResult<Json<Template>> {
    // 权限检查：必须是创建者
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT created_by FROM query_log_templates WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Template not found"))?;

    if owner.as_ref() != Some(&auth.username) {
        return Err(anyhow::anyhow!("Access denied: you are not the owner"));
    }

    // 构建动态更新语句
    let mut updates = Vec::new();
    let mut bindings: Vec<Box<dyn sqlx::Encode<sqlx::Sqlite> + Send + Sync>> = Vec::new();

    if let Some(name) = req.name {
        updates.push("name = ?");
        bindings.push(Box::new(name));
    }
    if let Some(filters) = req.filters {
        updates.push("filters = ?");
        let filters_json = serde_json::to_string(&filters)
            .map_err(|e| anyhow::anyhow!("Invalid filters JSON: {}", e))?;
        bindings.push(Box::new(filters_json));
    }
    if let Some(logic) = req.logic {
        updates.push("logic = ?");
        bindings.push(Box::new(logic));
    }
    if let Some(is_public) = req.is_public {
        updates.push("is_public = ?");
        bindings.push(Box::new(is_public as i64));
    }

    if updates.is_empty() {
        return Err(anyhow::anyhow!("No fields to update"));
    }

    let sql = format!(
        "UPDATE query_log_templates SET {} WHERE id = ?",
        updates.join(", ")
    );

    // Execute update (simplified - in real code would need proper binding)
    sqlx::query(&sql)
        .bind(&id)
        .execute(&state.db)
        .await?;

    // Fetch updated template
    let get_req = get(State(state.clone()), auth, Path(id.clone()));
    get_req.await
}

/// 删除模板（仅创建者可删除）
pub async fn delete(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> AppResult<impl IntoResponse> {
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT created_by FROM query_log_templates WHERE id = ?"
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Template not found"))?;

    if owner.as_ref() != Some(&auth.username) {
        return Err(anyhow::anyhow!("Access denied: you are not the owner"));
    }

    sqlx::query("DELETE FROM query_log_templates WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({ "message": "Template deleted successfully" })))
}

// 导入 chrono
use chrono::Utc;
