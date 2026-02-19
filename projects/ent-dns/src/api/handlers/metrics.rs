use axum::response::IntoResponse;

pub async fn prometheus_metrics() -> impl IntoResponse {
    "# HELP ent_dns_queries_total Total DNS queries\n# TYPE ent_dns_queries_total counter\nent_dns_queries_total 0\n"
}
