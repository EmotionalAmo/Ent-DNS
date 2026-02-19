use anyhow::Result;
use chrono::Utc;
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{RData, Record, RecordType, rdata::{A, AAAA}};
use std::net::IpAddr;
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

        // Normalize domain (remove trailing dot)
        let domain_normalized = domain.trim_end_matches('.');

        // Check DNS rewrite first
        if let Some(answer) = self.filter.check_rewrite(domain_normalized).await {
            tracing::debug!("Rewrite: {} -> {}", domain, answer);
            let elapsed = start.elapsed().as_millis() as i64;

            // Only respond if query type matches (A or AAAA)
            if matches!(qtype, RecordType::A | RecordType::AAAA) {
                if let Ok(response) = self.rewrite_response(&request, &answer, qtype) {
                    self.log_query(client_ip, &domain, &qtype_str, "allowed", Some("rewrite"), elapsed);
                    return Ok(response);
                }
            }
            // If rewrite IP doesn't match query type, fall through to normal resolution
        }

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

    /// Build a response for DNS rewrite
    fn rewrite_response(&self, request: &Message, answer: &str, qtype: RecordType) -> Result<Vec<u8>> {
        let ip: IpAddr = answer.parse()
            .map_err(|_| anyhow::anyhow!("Invalid IP address: {}", answer))?;

        // Check if IP type matches query type
        let rdata = match (ip, qtype) {
            (IpAddr::V4(ipv4), RecordType::A) => RData::A(A(ipv4)),
            (IpAddr::V6(ipv6), RecordType::AAAA) => RData::AAAA(AAAA(ipv6)),
            _ => anyhow::bail!("IP type doesn't match query type"),
        };

        let query = request.queries().first().unwrap();

        let mut record = Record::new();
        record.set_name(query.name().clone());
        record.set_record_type(qtype);
        record.set_ttl(300);
        record.set_data(Some(rdata));

        let mut response = Message::new();
        response.set_id(request.id());
        response.set_message_type(MessageType::Response);
        response.set_response_code(ResponseCode::NoError);
        response.set_recursion_desired(request.recursion_desired());
        response.set_recursion_available(true);
        response.add_query(query.clone());
        response.add_answer(record);

        Ok(response.to_vec()?)
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
