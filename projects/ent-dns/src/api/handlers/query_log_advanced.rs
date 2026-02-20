// Query Log Advanced Filtering Implementation
// File: src/api/handlers/query_log_advanced.rs
// Author: ui-duarte
// Date: 2026-02-20

use axum::{
    extract::{State, Query},
    response::IntoResponse,
    http::header,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use chrono::{Utc, Duration};
use std::sync::Arc;
use crate::api::AppState;
use crate::api::middleware::auth::AuthUser;
use crate::api::middleware::rbac::AdminUser;
use crate::error::AppResult;

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub field: String,
    pub operator: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
pub struct AdvancedQueryParams {
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default = "default_logic")]
    pub logic: String, // "AND" | "OR"
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

#[derive(Debug, Deserialize)]
pub struct AggregateParams {
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default = "default_metric")]
    pub metric: String, // "count" | "sum_elapsed_ms" | "avg_elapsed_ms"
    #[serde(default)]
    pub time_bucket: Option<String>, // "1m", "5m", "15m", "1h", "1d"
    #[serde(default = "default_top_limit")]
    pub limit: i64,
}

#[derive(Debug, Deserialize)]
pub struct TopParams {
    pub dimension: String, // "domain" | "client" | "qtype" | "upstream"
    #[serde(default = "default_metric")]
    pub metric: String,
    #[serde(default = "default_time_range")]
    pub time_range: String, // "-24h", "-7d", etc.
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default = "default_top_limit")]
    pub limit: i64,
}

#[derive(Debug, Deserialize)]
pub struct SuggestParams {
    pub field: String,
    pub prefix: String,
    #[serde(default = "default_suggest_limit")]
    pub limit: i64,
}

#[derive(Debug, Deserialize)]
pub struct TemplateCreate {
    pub name: String,
    pub filters: Vec<Filter>,
    #[serde(default = "default_logic")]
    pub logic: String,
}

fn default_logic() -> String { "AND".to_string() }
fn default_limit() -> i64 { 100 }
fn default_metric() -> String { "count".to_string() }
fn default_top_limit() -> i64 { 10 }
fn default_time_range() -> String { "-24h".to_string() }
fn default_suggest_limit() -> i64 { 10 }

// ============================================================================
// Query Builder
// ============================================================================

pub struct QueryBuilder {
    conditions: Vec<String>,
    bindings: Vec<Value>,
}

impl QueryBuilder {
    pub fn new() -> Self {
        Self {
            conditions: Vec::new(),
            bindings: Vec::new(),
        }
    }

    pub fn add_filter(&mut self, filter: &Filter) -> AppResult<()> {
        let (condition, values) = match (filter.field.as_str(), filter.operator.as_str()) {
            // 时间范围
            ("time", "between") => {
                let arr = filter.value.as_array()
                    .ok_or_else(|| anyhow::anyhow!("time between requires array"))?;
                if arr.len() != 2 {
                    return Err(anyhow::anyhow!("time between requires exactly 2 values"));
                }
                (
                    "time BETWEEN ? AND ?",
                    vec![arr[0].clone(), arr[1].clone()]
                )
            },
            ("time", op) if matches!(op, "gt" | "lt" | "gte" | "lte") => {
                let sql_op = match op {
                    "gt" => ">",
                    "lt" => "<",
                    "gte" => ">=",
                    "lte" => "<=",
                    _ => unreachable!(),
                };
                (format!("time {sql_op} ?"), vec![filter.value.clone()])
            },

            // 相对时间（转换为绝对时间）
            ("time", "relative") => {
                let duration = filter.value.as_str()
                    .ok_or_else(|| anyhow::anyhow!("relative time is string"))?;
                let (start, end) = parse_relative_time(duration)?;
                (
                    "time BETWEEN ? AND ?",
                    vec![Value::String(start.to_rfc3339()), Value::String(end.to_rfc3339())]
                )
            },

            // 字符串模糊匹配
            ("question" | "answer" | "client_name" | "upstream", "like") => {
                let pattern = format!("%{}%", filter.value.as_str().unwrap_or(""));
                (format!("{} LIKE ?", filter.field), vec![Value::String(pattern)])
            },

            // 枚举值
            ("status" | "qtype", "eq") => (
                format!("{} = ?", filter.field),
                vec![filter.value.clone()]
            ),
            ("status" | "qtype", "in") => {
                let arr = filter.value.as_array()
                    .ok_or_else(|| anyhow::anyhow!("in operator requires array"))?;
                let placeholders = (0..arr.len()).map(|_| "?").collect::<Vec<_>>().join(",");
                let values = arr.to_vec();
                (format!("{} IN ({})", filter.field, placeholders), values)
            },

            // 数值比较
            ("elapsed_ms", op) if matches!(op, "gt" | "lt" | "gte" | "lte" | "eq") => {
                let sql_op = match op {
                    "gt" => ">",
                    "lt" => "<",
                    "gte" => ">=",
                    "lte" => "<=",
                    "eq" => "=",
                    _ => unreachable!(),
                };
                (format!("elapsed_ms {sql_op} ?"), vec![filter.value.clone()])
            },

            // 原因字段
            ("reason", "eq" | "like") => {
                let op = if filter.operator == "eq" { "=" } else { "LIKE" };
                let value = if filter.operator == "like" {
                    format!("%{}%", filter.value.as_str().unwrap_or(""))
                } else {
                    filter.value.as_str().unwrap_or("").to_string()
                };
                (format!("reason {op} ?"), vec![Value::String(value)])
            },

            _ => {
                // 跳过不支持的字段/操作符
                return Ok(());
            }
        };

        self.conditions.push(condition);
        self.bindings.extend(values);
        Ok(())
    }

    pub fn build(self, logic: &str, limit: i64, offset: i64) -> (String, Vec<Value>) {
        let where_clause = if self.conditions.is_empty() {
            String::new()
        } else {
            let connector = if logic.to_uppercase() == "OR" { " OR " } else { " AND " };
            format!("WHERE {}", self.conditions.join(connector))
        };

        let sql = format!(
            "SELECT id, time, client_ip, client_name, question, qtype, answer, status, reason, upstream, elapsed_ms
             FROM query_log {where_clause} ORDER BY time DESC LIMIT ? OFFSET ?"
        );

        let mut bindings = self.bindings;
        bindings.push(json!(limit));
        bindings.push(json!(offset));

        (sql, bindings)
    }
}

fn parse_relative_time(duration: &str) -> AppResult<(chrono::DateTime<Utc>, chrono::DateTime<Utc>)> {
    let num: i64 = duration.chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect::<String>()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid relative time format: {}", duration))?;

    let unit = duration.chars()
        .last()
        .ok_or_else(|| anyhow::anyhow!("Missing time unit"))?;

    let now = Utc::now();
    let start = match unit {
        'h' => now - Duration::hours(num.abs()),
        'd' => now - Duration::days(num.abs()),
        'w' => now - Duration::weeks(num.abs()),
        'M' => now - Duration::days(num.abs() * 30),
        _ => return Err(anyhow::anyhow!("Unsupported time unit: {}", unit)),
    };

    Ok((start, now))
}

// ============================================================================
// API Handlers
// ============================================================================

/// 高级查询日志列表
pub async fn list_advanced(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<AdvancedQueryParams>,
) -> AppResult<Json<Value>> {
    let limit = params.limit.clamp(1, 1000);

    let mut builder = QueryBuilder::new();
    for filter in &params.filters {
        builder.add_filter(filter)?;
    }

    let (sql, bindings) = builder.build(&params.logic, limit, params.offset);
    let count_sql = format!(
        "SELECT COUNT(*) FROM query_log {}",
        if !bindings.is_empty() && bindings.len() > 2 {
            // WHERE clause is everything except LIMIT and OFFSET
            sql.split("ORDER BY")
                .next()
                .map(|s| s.replacen("FROM query_log ", "FROM query_log WHERE ", 1))
                .unwrap_or_default()
        } else {
            String::new()
        }
    );

    // Execute count query
    let total: i64 = {
        let mut q = sqlx::query_scalar::<_, i64>(&count_sql);
        for binding in &bindings[..bindings.len().saturating_sub(2)] {
            // Exclude LIMIT and OFFSET bindings
            match binding {
                Value::String(s) => q = q.bind(s),
                Value::Number(n) => q = q.bind(n.as_i64().unwrap_or(0)),
                _ => {}
            }
        }
        q.fetch_one(&state.db).await?
    };

    // Execute data query
    let rows = {
        let mut q = sqlx::query_as::<_, (i64, String, String, Option<String>, String, String, Option<String>, String, Option<String>, Option<String>, Option<i64>)>(&sql);
        for binding in &bindings {
            match binding {
                Value::String(s) => q = q.bind(s),
                Value::Number(n) => q = q.bind(n.as_i64().unwrap_or(0)),
                _ => {}
            }
        }
        q.fetch_all(&state.db).await?
    };

    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, time, client_ip, client_name, question, qtype, answer, status, reason, upstream, elapsed_ms)| {
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
                "upstream": upstream,
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

/// 聚合统计
pub async fn aggregate(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<AggregateParams>,
) -> AppResult<Json<Value>> {
    let mut builder = QueryBuilder::new();
    for filter in &params.filters {
        builder.add_filter(filter)?;
    }

    let (where_clause, bindings) = {
        let (sql, _) = builder.build(&"AND", 1000, 0);
        if let Some(pos) = sql.find("ORDER BY") {
            (sql[..pos].to_string(), builder.bindings)
        } else {
            (sql, builder.bindings)
        }
    };

    // GROUP BY query
    let group_fields = params.group_by.join(", ");
    let metric_sql = match params.metric.as_str() {
        "sum_elapsed_ms" => "SUM(elapsed_ms) as metric",
        "avg_elapsed_ms" => "AVG(elapsed_ms) as metric",
        _ => "COUNT(*) as count",
    };

    let agg_sql = format!(
        "SELECT {group_fields}, {metric_sql} FROM query_log {where_clause} GROUP BY {group_fields} ORDER BY metric DESC LIMIT ?",
        where_clause = where_clause
    );

    let rows: Vec<Value> = {
        let mut q = sqlx::query(&agg_sql);
        for binding in &bindings {
            match binding {
                Value::String(s) => q = q.bind(s),
                Value::Number(n) => q = q.bind(n.as_i64().unwrap_or(0)),
                _ => {}
            }
        }
        q.bind(params.limit).fetch_all(&state.db).await?
            .into_iter()
            .map(|row| {
                // Generic row handling (simplified)
                json!({})
            })
            .collect()
    };

    Ok(Json(json!({
        "data": rows,
        "group_by": params.group_by,
        "metric": params.metric,
    })))
}

/// Top N 排行
pub async fn top(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<TopParams>,
) -> AppResult<Json<Value>> {
    let (start, end) = parse_relative_time(&params.time_range)?;

    let field = match params.dimension.as_str() {
        "domain" => "question",
        "client" => "client_ip",
        "qtype" => "qtype",
        "upstream" => "upstream",
        _ => return Err(anyhow::anyhow!("Invalid dimension: {}", params.dimension)),
    };

    let sql = format!(
        "SELECT {field} as value, COUNT(*) as count
         FROM query_log
         WHERE time BETWEEN ? AND ?
         GROUP BY {field}
         ORDER BY count DESC
         LIMIT ?",
        field = field
    );

    let rows: Vec<(String, i64)> = sqlx::query_as(&sql)
        .bind(start.to_rfc3339())
        .bind(end.to_rfc3339())
        .bind(params.limit)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(json!({
        "top_{}", params.dimension: rows,
    })))
}

/// 智能提示（自动补全）
pub async fn suggest(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Query(params): Query<SuggestParams>,
) -> AppResult<Json<Value>> {
    let field = match params.field.as_str() {
        "question" | "client_ip" | "client_name" | "upstream" => params.field,
        _ => return Err(anyhow::anyhow!("Invalid field: {}", params.field)),
    };

    let suggestions: Vec<String> = sqlx::query_scalar(
        &format!(
            "SELECT DISTINCT {} FROM query_log WHERE {} LIKE ? LIMIT ?",
            field, field
        )
    )
    .bind(format!("{}%", params.prefix))
    .bind(params.limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({
        "suggestions": suggestions,
    })))
}
