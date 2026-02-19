use axum::{extract::State, Json};
use std::sync::Arc;
use serde_json::json;
use chrono::Utc;
use crate::api::{AppState, middleware::rbac::AdminUser};
use crate::error::AppResult;

pub async fn create_backup(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> AppResult<Json<serde_json::Value>> {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_filename = format!("ent-dns-backup-{}.db", timestamp);

    // Create backup using SQLite's VACUUM INTO command
    // First we need to disable WAL mode temporarily for backup
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("WAL checkpoint failed: {}", e);
            crate::error::AppError::Internal(format!("WAL checkpoint failed: {}", e))
        })?;

    // Execute SQLite backup using VACUUM INTO
    let result = sqlx::query(&format!(
        "VACUUM INTO '{}'",
        backup_filename
    ))
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => {
            tracing::info!("Backup created: {}", backup_filename);
            Ok(Json(json!({
                "success": true,
                "filename": backup_filename,
                "timestamp": timestamp,
            })))
        }
        Err(e) => {
            tracing::error!("Backup failed: {}", e);
            Err(crate::error::AppError::Internal(format!("Backup failed: {}", e)))
        }
    }
}
