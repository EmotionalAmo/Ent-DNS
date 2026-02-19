use axum::Json;
use serde_json::{json, Value};
use crate::error::AppResult;

pub async fn get_dns() -> AppResult<Json<Value>> {
    Ok(Json(json!({"upstreams": [], "cache_ttl": 300})))
}

pub async fn update_dns(Json(_body): Json<Value>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"success": true})))
}
