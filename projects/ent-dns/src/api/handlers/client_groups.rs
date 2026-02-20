use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

use crate::api::middleware::auth::AuthUser;
use crate::api::middleware::rbac::AdminUser;
use crate::api::AppState;
use crate::db::models::client_group::*;
use crate::error::{AppError, AppResult};

/// List all client groups (with client_count and rule_count via JOIN)
pub async fn list_groups(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    let groups: Vec<(i64, String, String, Option<String>, i32, String, String, i64, i64)> =
        sqlx::query_as(
            r#"
            SELECT
                g.id, g.name, g.color, g.description, g.priority,
                g.created_at, g.updated_at,
                COUNT(DISTINCT m.client_id) AS client_count,
                COUNT(DISTINCT r.id) AS rule_count
            FROM client_groups g
            LEFT JOIN client_group_memberships m ON g.id = m.group_id
            LEFT JOIN client_group_rules r ON g.id = r.group_id
            GROUP BY g.id
            ORDER BY g.priority ASC
            "#,
        )
        .fetch_all(&state.db)
        .await?;

    let data: Vec<Value> = groups
        .into_iter()
        .map(
            |(id, name, color, description, priority, created_at, updated_at, client_count, rule_count)| {
                json!({
                    "id": id,
                    "name": name,
                    "color": color,
                    "description": description,
                    "priority": priority,
                    "client_count": client_count,
                    "rule_count": rule_count,
                    "created_at": created_at,
                    "updated_at": updated_at,
                })
            },
        )
        .collect();
    let total = data.len();

    Ok(Json(json!({ "data": data, "total": total })))
}

/// Create a new client group
pub async fn create_group(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Json(body): Json<CreateClientGroupRequest>,
) -> AppResult<Json<Value>> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Group name cannot be empty".to_string()));
    }

    // Check if group name already exists
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM client_groups WHERE name = ?")
        .bind(&name)
        .fetch_optional(&state.db)
        .await?;

    if existing.is_some() {
        return Err(AppError::Conflict(format!(
            "Group name '{}' already exists",
            name
        )));
    }

    let color = body.color.unwrap_or_else(|| "#6366f1".to_string());
    let description = body.description;
    let priority = body.priority.unwrap_or(0);
    let now = Utc::now().to_rfc3339();

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO client_groups (name, color, description, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(&name)
    .bind(&color)
    .bind(&description)
    .bind(priority)
    .bind(&now)
    .bind(&now)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(json!({
        "id": id,
        "name": name,
        "color": color,
        "description": description,
        "priority": priority,
        "client_count": 0,
        "rule_count": 0,
        "created_at": now,
        "updated_at": now,
    })))
}

/// Update a client group
pub async fn update_group(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdateClientGroupRequest>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(i64, String, String, Option<String>, i32, String)> =
        sqlx::query_as(
            "SELECT id, name, color, description, priority, created_at FROM client_groups WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

    let (_, old_name, old_color, old_description, old_priority, created_at) = existing
        .ok_or_else(|| AppError::NotFound(format!("Client group {} not found", id)))?;

    let name = if let Some(new_name) = body.name {
        let new_name = new_name.trim().to_string();
        if new_name.is_empty() {
            return Err(AppError::Validation("Group name cannot be empty".to_string()));
        }

        // Check if new name already exists (excluding current group)
        if new_name != old_name {
            let existing: Option<i64> =
                sqlx::query_scalar("SELECT id FROM client_groups WHERE name = ? AND id != ?")
                    .bind(&new_name)
                    .bind(id)
                    .fetch_optional(&state.db)
                    .await?;

            if existing.is_some() {
                return Err(AppError::Conflict(format!(
                    "Group name '{}' already exists",
                    new_name
                )));
            }
        }
        new_name
    } else {
        old_name
    };

    let color = body.color.unwrap_or(old_color);
    let description = body.description.or(old_description);
    let priority = body.priority.unwrap_or(old_priority);
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "UPDATE client_groups SET name = ?, color = ?, description = ?, priority = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(&color)
    .bind(&description)
    .bind(priority)
    .bind(&now)
    .bind(id)
    .execute(&state.db)
    .await?;

    // Invalidate cache for all clients in this group
    let client_ids: Vec<String> = sqlx::query_scalar(
        "SELECT client_id FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    for client_id in client_ids {
        if let Some(cache) = state.client_config_cache.as_ref() {
            cache.invalidate(&client_id).await;
        }
    }

    // Get updated counts
    let client_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT client_id) FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let rule_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM client_group_rules WHERE group_id = ?")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    Ok(Json(json!({
        "id": id,
        "name": name,
        "color": color,
        "description": description,
        "priority": priority,
        "client_count": client_count,
        "rule_count": rule_count,
        "created_at": created_at,
        "updated_at": now,
    })))
}

/// Delete a client group
pub async fn delete_group(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    let (name,) = existing
        .ok_or_else(|| AppError::NotFound(format!("Client group {} not found", id)))?;

    // Get affected counts before deletion
    let client_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT client_id) FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let rule_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM client_group_rules WHERE group_id = ?")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    // Invalidate cache for all clients in this group before deletion
    let client_ids: Vec<String> = sqlx::query_scalar(
        "SELECT client_id FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    for client_id in client_ids {
        if let Some(cache) = state.client_config_cache.as_ref() {
            cache.invalidate(&client_id).await;
        }
    }

    // Delete memberships first
    sqlx::query("DELETE FROM client_group_memberships WHERE group_id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    // Delete rules
    sqlx::query("DELETE FROM client_group_rules WHERE group_id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    // Delete group
    sqlx::query("DELETE FROM client_groups WHERE id = ?")
        .bind(id)
        .execute(&state.db)
        .await?;

    Ok(Json(json!({
        "message": format!("Group '{}' deleted successfully", name),
        "affected_clients": client_count,
        "affected_rules": rule_count,
    })))
}

/// Get members of a group
pub async fn get_group_members(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<i64>,
    Query(params): Query<PageParams>,
) -> AppResult<Json<Value>> {
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).min(100);
    let offset = (page - 1) * page_size;

    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    // Single query to get members with their group info
    let rows: Vec<(String, Option<String>, String, Option<String>, Option<String>, i64)> =
        sqlx::query_as(
            r#"
            SELECT DISTINCT
                c.id,
                c.name,
                c.ip,
                c.mac,
                c.last_seen,
                c.query_count
            FROM dns_clients c
            INNER JOIN client_group_memberships m ON c.id = m.client_id
            WHERE m.group_id = ?
            ORDER BY c.last_seen DESC
            LIMIT ? OFFSET ?
            "#,
        )
        .bind(id)
        .bind(page_size)
        .bind(offset)
        .fetch_all(&state.db)
        .await?;

    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT c.id)
        FROM dns_clients c
        INNER JOIN client_group_memberships m ON c.id = m.client_id
        WHERE m.group_id = ?
        "#,
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(client_id, name, ip, mac, last_seen, query_count)| {
            json!({
                "id": client_id,
                "name": name,
                "ip": ip,
                "mac": mac,
                "last_seen": last_seen,
                "query_count": query_count,
            })
        })
        .collect();

    Ok(Json(json!({
        "data": data,
        "total": total,
        "page": page,
        "page_size": page_size,
    })))
}

#[derive(Debug, Deserialize)]
pub struct PageParams {
    page: Option<i64>,
    page_size: Option<i64>,
}

/// Batch add clients to a group
pub async fn batch_add_clients(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<BatchAddClientsRequest>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    let mut added_count = 0i64;
    let mut skipped_count = 0i64;
    let mut skipped_clients: Vec<String> = Vec::new();
    let now = Utc::now().to_rfc3339();

    for client_id in &body.client_ids {
        // Check if client exists
        let client_exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM dns_clients WHERE id = ?")
                .bind(client_id)
                .fetch_optional(&state.db)
                .await?;

        if client_exists.is_none() {
            skipped_clients.push(client_id.clone());
            skipped_count += 1;
            continue;
        }

        // Check if already in group
        let membership_exists: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM client_group_memberships WHERE client_id = ? AND group_id = ?",
        )
        .bind(client_id)
        .bind(id)
        .fetch_optional(&state.db)
        .await?;

        if membership_exists.is_some() {
            skipped_clients.push(client_id.clone());
            skipped_count += 1;
            continue;
        }

        // Add membership
        sqlx::query(
            "INSERT INTO client_group_memberships (client_id, group_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(client_id)
        .bind(id)
        .bind(&now)
        .execute(&state.db)
        .await?;

        added_count += 1;

        // Invalidate cache
        if let Some(cache) = state.client_config_cache.as_ref() {
            cache.invalidate(client_id).await;
        }
    }

    Ok(Json(json!({
        "message": format!("Added {} clients to group", added_count),
        "added_count": added_count,
        "skipped_count": skipped_count,
        "skipped_clients": skipped_clients,
    })))
}

/// Batch remove clients from a group
pub async fn batch_remove_clients(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<BatchRemoveClientsRequest>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    let mut removed_count = 0i64;

    for client_id in &body.client_ids {
        let result = sqlx::query(
            "DELETE FROM client_group_memberships WHERE client_id = ? AND group_id = ?",
        )
        .bind(client_id)
        .bind(id)
        .execute(&state.db)
        .await?;

        if result.rows_affected() > 0 {
            removed_count += 1;

            // Invalidate cache
            if let Some(cache) = state.client_config_cache.as_ref() {
                cache.invalidate(client_id).await;
            }
        }
    }

    Ok(Json(json!({
        "message": format!("Removed {} clients from group", removed_count),
        "removed_count": removed_count,
    })))
}

/// Batch move clients to a group
pub async fn batch_move_clients(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Json(body): Json<BatchMoveClientsRequest>,
) -> AppResult<Json<Value>> {
    let mut moved_count = 0i64;
    let mut applied_rules: Vec<Value> = Vec::new();
    let now = Utc::now().to_rfc3339();

    for client_id in &body.client_ids {
        // Check if client exists
        let client_exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM dns_clients WHERE id = ?")
                .bind(client_id)
                .fetch_optional(&state.db)
                .await?;

        if client_exists.is_none() {
            continue;
        }

        // Remove from source group if specified
        if let Some(from_group_id) = body.from_group_id {
            sqlx::query(
                "DELETE FROM client_group_memberships WHERE client_id = ? AND group_id = ?",
            )
            .bind(client_id)
            .bind(from_group_id)
            .execute(&state.db)
            .await?;
        }

        // Add to target group if specified
        if let Some(to_group_id) = body.to_group_id {
            // Check if group exists
            let group_exists: Option<(String,)> =
                sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
                    .bind(to_group_id)
                    .fetch_optional(&state.db)
                    .await?;

            if group_exists.is_some() {
                sqlx::query(
                    "INSERT OR REPLACE INTO client_group_memberships (client_id, group_id, created_at) VALUES (?, ?, ?)",
                )
                .bind(client_id)
                .bind(to_group_id)
                .bind(&now)
                .execute(&state.db)
                .await?;

                moved_count += 1;

                // Invalidate cache
                if let Some(cache) = state.client_config_cache.as_ref() {
                    cache.invalidate(client_id).await;
                }

                // Get applied rules for this group
                let rules: Vec<(i64, String, String)> = sqlx::query_as(
                    r#"
                    SELECT f.id, f.name, f.action
                    FROM dns_filters f
                    INNER JOIN client_group_rules gr ON f.id = gr.rule_id
                    WHERE gr.group_id = ? AND gr.rule_type = 'filter'
                    "#,
                )
                .bind(to_group_id)
                .fetch_all(&state.db)
                .await?;

                applied_rules.extend(rules.into_iter().map(|(rule_id, name, action)| {
                    json!({
                        "rule_id": rule_id,
                        "rule_type": "filter",
                        "name": name,
                        "action": action,
                    })
                }));
            }
        }
    }

    Ok(Json(json!({
        "message": format!("Moved {} clients to group", moved_count),
        "moved_count": moved_count,
        "affected_rules_count": applied_rules.len(),
        "applied_rules": applied_rules,
    })))
}

/// Get rules for a group
pub async fn get_group_rules(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Path(id): Path<i64>,
    Query(params): Query<RuleFilterParams>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    let rule_type = params.rule_type.as_deref().unwrap_or("all");

    let data: Vec<Value> = if rule_type == "filter" {
        let rules: Vec<(i64, String, String, String, i32, String)> = sqlx::query_as(
            r#"
            SELECT f.id, f.name, f.pattern, f.action, gr.priority, f.created_at
            FROM dns_filters f
            INNER JOIN client_group_rules gr ON f.id = gr.rule_id
            WHERE gr.group_id = ? AND gr.rule_type = 'filter'
            ORDER BY gr.priority ASC
            "#,
        )
        .bind(id)
        .fetch_all(&state.db)
        .await?;

        rules
            .into_iter()
            .map(|(rule_id, name, pattern, action, priority, created_at)| {
                json!({
                    "rule_id": rule_id,
                    "rule_type": "filter",
                    "name": name,
                    "pattern": pattern,
                    "action": action,
                    "priority": priority,
                    "created_at": created_at,
                })
            })
            .collect()
    } else if rule_type == "rewrite" {
        let rules: Vec<(i64, String, String, Option<String>, String, i32, String)> =
            sqlx::query_as(
                r#"
            SELECT r.id, r.domain, r.replacement, r.description, r.action, gr.priority, r.created_at
            FROM dns_rewrites r
            INNER JOIN client_group_rules gr ON r.id = gr.rule_id
            WHERE gr.group_id = ? AND gr.rule_type = 'rewrite'
            ORDER BY gr.priority ASC
            "#,
            )
            .bind(id)
            .fetch_all(&state.db)
            .await?;

        rules
            .into_iter()
            .map(
                |(rule_id, domain, replacement, description, action, priority, created_at)| {
                    json!({
                        "rule_id": rule_id,
                        "rule_type": "rewrite",
                        "name": description.unwrap_or_else(|| domain.clone()),
                        "domain": domain,
                        "replacement": replacement,
                        "action": action,
                        "priority": priority,
                        "created_at": created_at,
                    })
                },
            )
            .collect()
    } else {
        Vec::new()
    };

    let total = data.len();

    Ok(Json(json!({ "data": data, "total": total })))
}

#[derive(Debug, Deserialize)]
pub struct RuleFilterParams {
    rule_type: Option<String>,
}

/// Batch bind rules to a group
pub async fn batch_bind_rules(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<BatchBindRulesRequest>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    let mut bound_count = 0i64;
    let mut skipped_count = 0i64;
    let mut skipped_rules: Vec<Value> = Vec::new();
    let now = Utc::now().to_rfc3339();

    for rule in &body.rules {
        // Validate rule type
        if rule.rule_type != "filter" && rule.rule_type != "rewrite" {
            return Err(AppError::Validation(format!(
                "Invalid rule type: {}",
                rule.rule_type
            )));
        }

        // Check if rule exists
        let rule_exists: Option<(i64,)> = if rule.rule_type == "filter" {
            sqlx::query_as("SELECT id FROM dns_filters WHERE id = ?")
                .bind(rule.rule_id)
                .fetch_optional(&state.db)
                .await?
        } else {
            sqlx::query_as("SELECT id FROM dns_rewrites WHERE id = ?")
                .bind(rule.rule_id)
                .fetch_optional(&state.db)
                .await?
        };

        if rule_exists.is_none() {
            skipped_rules.push(json!({
                "rule_id": rule.rule_id,
                "rule_type": rule.rule_type,
                "reason": "Rule not found",
            }));
            skipped_count += 1;
            continue;
        }

        // Check if already bound
        let binding_exists: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM client_group_rules WHERE group_id = ? AND rule_id = ? AND rule_type = ?",
        )
        .bind(id)
        .bind(rule.rule_id)
        .bind(&rule.rule_type)
        .fetch_optional(&state.db)
        .await?;

        if binding_exists.is_some() {
            skipped_rules.push(json!({
                "rule_id": rule.rule_id,
                "rule_type": rule.rule_type,
                "reason": "Already bound",
            }));
            skipped_count += 1;
            continue;
        }

        // Bind rule
        let priority = rule.priority.unwrap_or(0);
        sqlx::query(
            "INSERT INTO client_group_rules (group_id, rule_id, rule_type, priority, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(rule.rule_id)
        .bind(&rule.rule_type)
        .bind(priority)
        .bind(&now)
        .execute(&state.db)
        .await?;

        bound_count += 1;
    }

    // Invalidate cache for all clients in this group
    let client_ids: Vec<String> = sqlx::query_scalar(
        "SELECT client_id FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    for client_id in client_ids {
        if let Some(cache) = state.client_config_cache.as_ref() {
            cache.invalidate(&client_id).await;
        }
    }

    Ok(Json(json!({
        "message": format!("Bound {} rules to group", bound_count),
        "bound_count": bound_count,
        "skipped_count": skipped_count,
        "skipped_rules": skipped_rules,
    })))
}

/// Batch unbind rules from a group
pub async fn batch_unbind_rules(
    State(state): State<Arc<AppState>>,
    _auth: AdminUser,
    Path(id): Path<i64>,
    Query(params): Query<RuleFilterParams>,
    Json(body): Json<BatchUnbindRulesRequest>,
) -> AppResult<Json<Value>> {
    // Check if group exists
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT name FROM client_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;

    if existing.is_none() {
        return Err(AppError::NotFound(format!("Client group {} not found", id)));
    }

    let rule_type = params
        .rule_type
        .as_deref()
        .unwrap_or("filter")
        .to_string();
    let mut unbound_count = 0i64;

    for rule_id in &body.rule_ids {
        let result = sqlx::query(
            "DELETE FROM client_group_rules WHERE group_id = ? AND rule_id = ? AND rule_type = ?",
        )
        .bind(id)
        .bind(rule_id)
        .bind(&rule_type)
        .execute(&state.db)
        .await?;

        if result.rows_affected() > 0 {
            unbound_count += 1;
        }
    }

    // Invalidate cache for all clients in this group
    let client_ids: Vec<String> = sqlx::query_scalar(
        "SELECT client_id FROM client_group_memberships WHERE group_id = ?",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    for client_id in client_ids {
        if let Some(cache) = state.client_config_cache.as_ref() {
            cache.invalidate(&client_id).await;
        }
    }

    Ok(Json(json!({
        "message": format!("Unbound {} rules from group", unbound_count),
        "unbound_count": unbound_count,
    })))
}

