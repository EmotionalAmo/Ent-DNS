use axum::{
    extract::{State, Path, Query},
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

#[derive(Deserialize)]
pub struct ListParams {
    page: Option<u32>,
    per_page: Option<u32>,
    search: Option<String>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListParams>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    let page = params.page.unwrap_or(1).max(1);
    let per_page = params.per_page.unwrap_or(50).min(200) as i64;
    let offset = ((page as i64 - 1) * per_page) as i64;
    let search = params.search.as_deref().unwrap_or("").trim().to_string();
    let has_search = !search.is_empty();
    let search_pattern = format!("%{}%", search);

    // 只显示用户手动创建的规则，过滤掉订阅列表导入的规则（created_by LIKE 'filter:%'）
    let where_clause = if has_search {
        "WHERE created_by NOT LIKE 'filter:%' AND (rule LIKE ? OR comment LIKE ?)"
    } else {
        "WHERE created_by NOT LIKE 'filter:%'"
    };

    let count_sql = format!("SELECT COUNT(*) FROM custom_rules {}", where_clause);
    let data_sql = format!(
        "SELECT id, rule, comment, is_enabled, created_by, created_at \
         FROM custom_rules {} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        where_clause
    );

    let total: i64 = if has_search {
        sqlx::query_scalar(&count_sql)
            .bind(&search_pattern)
            .bind(&search_pattern)
            .fetch_one(&state.db)
            .await?
    } else {
        sqlx::query_scalar(&count_sql)
            .fetch_one(&state.db)
            .await?
    };

    let rows: Vec<(String, String, Option<String>, i64, String, String)> = if has_search {
        sqlx::query_as(&data_sql)
            .bind(&search_pattern)
            .bind(&search_pattern)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
    } else {
        sqlx::query_as(&data_sql)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.db)
            .await?
    };

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

    Ok(Json(json!({
        "data": data,
        "total": total,
        "page": page,
        "per_page": per_page,
    })))
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

    state.filter.reload().await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({"success": true})))
}
