use anyhow::Result;
use chrono::Utc;
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use std::sync::Arc;
use std::time::Instant;
use crate::config::Config;
use crate::db::DbPool;
use super::{filter::FilterEngine, resolver::DnsResolver, cache::DnsCache};

pub struct DnsHandler {
    filter: Arc<FilterEngine>,
    resolver: Arc<DnsResolver>,
    cache: Arc<DnsCache>,
    db: DbPool,
}

impl DnsHandler {
    pub async fn new(cfg: Config, db: DbPool, filter: Arc<FilterEngine>) -> Result<Self> {
        let resolver = Arc::new(DnsResolver::new(&cfg).await?);
        let cache = Arc::new(DnsCache::new());
        Ok(Self { filter, resolver, cache, db })
    }

    pub async fn handle_udp(&self, data: Vec<u8>, client_ip: String) -> Result<Vec<u8>> {
        let request = Message::from_vec(&data)?;

        if request.message_type() != MessageType::Query || request.op_code() != OpCode::Query {
            return self.servfail(&request);
        }

        let query = match request.queries().first() {
            Some(q) => q,
            None => return self.servfail(&request),
        };

        let domain = query.name().to_string();
        let qtype = query.query_type();
        let qtype_str = format!("{:?}", qtype);
        let start = Instant::now();

        tracing::debug!("Query: {} {:?} from {}", domain, qtype, client_ip);

        // Check filter
        if self.filter.is_blocked(&domain).await {
            tracing::debug!("Blocked: {}", domain);
            let elapsed = start.elapsed().as_millis() as i64;
            self.log_query(client_ip, &domain, &qtype_str, "blocked", Some("filter_rule"), elapsed);
            return self.nxdomain(&request);
        }

        // Check cache
        if let Some(cached) = self.cache.get(&domain, qtype).await {
            let elapsed = start.elapsed().as_millis() as i64;
            self.log_query(client_ip, &domain, &qtype_str, "cached", None, elapsed);
            return Ok(cached);
        }

        // Resolve upstream
        let response = self.resolver.resolve(&domain, qtype, &request).await?;
        let elapsed = start.elapsed().as_millis() as i64;

        // Cache and log
        self.cache.set(&domain, qtype, response.clone()).await;
        self.log_query(client_ip, &domain, &qtype_str, "allowed", None, elapsed);

        Ok(response)
    }

    /// Fire-and-forget async query log write.
    fn log_query(&self, client_ip: String, domain: &str, qtype: &str, status: &str, reason: Option<&str>, elapsed_ms: i64) {
        let db = self.db.clone();
        let domain = domain.to_string();
        let qtype = qtype.to_string();
        let status = status.to_string();
        let reason = reason.map(|s| s.to_string());
        let now = Utc::now().to_rfc3339();

        tokio::spawn(async move {
            let _ = sqlx::query(
                "INSERT INTO query_log (time, client_ip, question, qtype, status, reason, elapsed_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&now)
            .bind(&client_ip)
            .bind(&domain)
            .bind(&qtype)
            .bind(&status)
            .bind(&reason)
            .bind(elapsed_ms)
            .execute(&db)
            .await;
        });
    }

    fn nxdomain(&self, request: &Message) -> Result<Vec<u8>> {
        let mut response = Message::new();
        response.set_id(request.id());
        response.set_message_type(MessageType::Response);
        response.set_response_code(ResponseCode::NXDomain);
        response.set_recursion_desired(request.recursion_desired());
        response.set_recursion_available(true);
        for query in request.queries() {
            response.add_query(query.clone());
        }
        Ok(response.to_vec()?)
    }

    fn servfail(&self, request: &Message) -> Result<Vec<u8>> {
        let mut response = Message::new();
        response.set_id(request.id());
        response.set_message_type(MessageType::Response);
        response.set_response_code(ResponseCode::ServFail);
        Ok(response.to_vec()?)
    }
}
