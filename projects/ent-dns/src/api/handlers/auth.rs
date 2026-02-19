use axum::{extract::State, Json};
use axum::http::HeaderMap;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::error::{AppError, AppResult};

const DEFAULT_ADMIN_PASSWORD: &str = "admin";

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<Value>> {
    let row: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, password, role, is_active FROM users WHERE username = ?"
    )
    .bind(&req.username)
    .fetch_optional(&state.db)
    .await?;

    let (user_id, password_hash, role, is_active) = row.ok_or(AppError::AuthFailed)?;

    if is_active == 0 {
        return Err(AppError::AuthFailed);
    }

    if !crate::auth::password::verify(&req.password, &password_hash) {
        return Err(AppError::AuthFailed);
    }

    // Security warning for default password
    let requires_password_change = req.password == DEFAULT_ADMIN_PASSWORD;
    if requires_password_change {
        tracing::warn!(
            "User {} logged in with default password - force change required",
            req.username
        );
    }

    let token = crate::auth::jwt::generate(
        &user_id,
        &req.username,
        &role,
        &state.jwt_secret,
        state.jwt_expiry_hours,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Audit log: record successful login
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    crate::db::audit::log_action(
        state.db.clone(),
        user_id.clone(),
        req.username.clone(),
        "login",
        "session",
        None,
        None,
        ip,
    );

    Ok(Json(json!({
        "token": token,
        "expires_in": state.jwt_expiry_hours * 3600,
        "role": role,
        "requires_password_change": requires_password_change,
    })))
}

pub async fn logout() -> AppResult<Json<Value>> {
    // JWT is stateless; client just discards the token.
    Ok(Json(json!({"success": true})))
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<Json<Value>> {
    // Access the Claims from AuthUser tuple struct
    let claims = auth.0;

    // Validate new password length
    if req.new_password.len() < 8 {
        return Err(AppError::Validation("New password must be at least 8 characters".to_string()));
    }

    // Validate new password is not the default password
    if req.new_password == DEFAULT_ADMIN_PASSWORD {
        return Err(AppError::Validation("New password cannot be the default password".to_string()));
    }

    // Fetch current user
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, password FROM users WHERE id = ?"
    )
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await?;

    let (user_id, password_hash) = row.ok_or(AppError::NotFound("User not found".to_string()))?;

    // Verify current password
    if !crate::auth::password::verify(&req.current_password, &password_hash) {
        return Err(AppError::Validation("Current password is incorrect".to_string()));
    }

    // Hash new password
    let new_password_hash = crate::auth::password::hash(&req.new_password)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Update password
    sqlx::query(
        "UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(&new_password_hash)
    .bind(&user_id)
    .execute(&state.db)
    .await?;

    // Audit log: record password change
    crate::db::audit::log_action(
        state.db.clone(),
        user_id.clone(),
        claims.username.clone(),
        "password_change",
        "user",
        Some(user_id.clone()),
        None,
        "unknown".to_string(),
    );

    tracing::info!("User {} changed their password", claims.username);

    Ok(Json(json!({
        "success": true,
        "message": "Password changed successfully"
    })))
}
