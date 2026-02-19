use axum::{Json, extract::Path};
use serde_json::{json, Value};
use crate::error::AppResult;

pub async fn list() -> AppResult<Json<Value>> {
    Ok(Json(json!({"data": [], "total": 0})))
}

pub async fn create(Json(_body): Json<Value>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"id": "placeholder", "success": true})))
}

pub async fn update(Path(_id): Path<String>, Json(_body): Json<Value>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"success": true})))
}

pub async fn delete(Path(_id): Path<String>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"success": true})))
}

pub async fn update_role(Path(_id): Path<String>, Json(_body): Json<Value>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"success": true})))
}
