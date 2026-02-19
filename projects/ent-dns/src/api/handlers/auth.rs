use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::api::AppState;
use crate::error::{AppError, AppResult};

#[derive(Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
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

    let token = crate::auth::jwt::generate(
        &user_id,
        &req.username,
        &role,
        &state.jwt_secret,
        state.jwt_expiry_hours,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "token": token,
        "expires_in": state.jwt_expiry_hours * 3600,
        "role": role,
    })))
}

pub async fn logout() -> AppResult<Json<Value>> {
    // JWT is stateless; client just discards the token.
    Ok(Json(json!({"success": true})))
}
