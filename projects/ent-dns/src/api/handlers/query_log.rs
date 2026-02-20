use axum::{
    extract::{State, Query},
    response::IntoResponse,
    http::header,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::api::middleware::rbac::AdminUser;
use crate::error::AppResult;

#[derive(Deserialize)]
pub struct QueryLogParams {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    status: Option<String>,
    client: Option<String>,
    domain: Option<String>,
}

fn default_limit() -> i64 {
    100
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<QueryLogParams>,
) -> AppResult<Json<Value>> {
    let limit = params.limit.clamp(1, 1000);

    // Build dynamic WHERE clause with SQL-level filtering (fixes fake-pagination bug)
    let mut conditions = Vec::<String>::new();
    if params.status.is_some() {
        conditions.push("status = ?".to_string());
    }
    if params.client.is_some() {
        conditions.push("client_ip LIKE ?".to_string());
    }
    if params.domain.is_some() {
        conditions.push("question LIKE ?".to_string());
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let data_sql = format!(
        "SELECT id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms
         FROM query_log {where_clause} ORDER BY time DESC LIMIT ? OFFSET ?"
    );
    let count_sql = format!("SELECT COUNT(*) FROM query_log {where_clause}");

    // Build and execute queries with dynamic bindings
    let rows = {
        let mut q = sqlx::query_as::<_, (i64, String, String, Option<String>, String, String, Option<String>, String, Option<String>, Option<i64>)>(&data_sql);
        if let Some(ref s) = params.status { q = q.bind(s); }
        if let Some(ref c) = params.client  { q = q.bind(format!("%{c}%")); }
        if let Some(ref d) = params.domain  { q = q.bind(format!("%{d}%")); }
        q.bind(limit).bind(params.offset).fetch_all(&state.db).await?
    };

    let total: i64 = {
        let mut q = sqlx::query_scalar::<_, i64>(&count_sql);
        if let Some(ref s) = params.status { q = q.bind(s); }
        if let Some(ref c) = params.client  { q = q.bind(format!("%{c}%")); }
        if let Some(ref d) = params.domain  { q = q.bind(format!("%{d}%")); }
        q.fetch_one(&state.db).await?
    };

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms)| {
            json!({
                "id": id,
                "time": time,
                "client_ip": client_ip,
                "client_name": client_name,
                "question": question,
                "qtype": qtype,
                "answer": answer,
                "status": status,
                "reason": reason,
                "elapsed_ms": elapsed_ms,
            })
        })
        .collect();

    let returned = data.len();
    Ok(Json(json!({
        "data": data,
        "total": total,
        "returned": returned,
        "offset": params.offset,
        "limit": limit,
    })))
}

#[derive(Deserialize)]
pub struct ExportParams {
    #[serde(default = "default_export_format")]
    format: String,
}

fn default_export_format() -> String {
    "csv".to_string()
}

pub async fn export(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Query(params): Query<ExportParams>,
) -> impl IntoResponse {
    let rows: Vec<(i64, String, String, Option<String>, String, String, Option<String>, String, Option<String>, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms
             FROM query_log ORDER BY time DESC LIMIT 10000"
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    match params.format.as_str() {
        "json" => {
            let data: Vec<Value> = rows.into_iter().map(|(id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms)| {
                json!({ "id": id, "time": time, "client_ip": client_ip, "client_name": client_name,
                         "question": question, "qtype": qtype, "answer": answer, "status": status,
                         "reason": reason, "elapsed_ms": elapsed_ms })
            }).collect();
            let body = serde_json::to_string_pretty(&data).unwrap_or_default();
            (
                [(header::CONTENT_TYPE, "application/json"),
                 (header::CONTENT_DISPOSITION, "attachment; filename=\"query-logs.json\"")],
                body,
            ).into_response()
        }
        _ => {
            let mut csv = String::from("id,time,client_ip,client_name,question,qtype,answer,status,reason,elapsed_ms\n");
            for (id, time, client_ip, client_name, question, qtype, answer, status, reason, elapsed_ms) in rows {
                csv.push_str(&format!(
                    "{},{},{},{},{},{},{},{},{},{}\n",
                    id, time, client_ip,
                    client_name.unwrap_or_default(),
                    question, qtype,
                    answer.unwrap_or_default(),
                    status,
                    reason.unwrap_or_default(),
                    elapsed_ms.map(|v| v.to_string()).unwrap_or_default(),
                ));
            }
            (
                [(header::CONTENT_TYPE, "text/csv; charset=utf-8"),
                 (header::CONTENT_DISPOSITION, "attachment; filename=\"query-logs.csv\"")],
                csv,
            ).into_response()
        }
    }
}
