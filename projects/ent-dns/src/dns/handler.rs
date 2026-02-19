use anyhow::Result;
use chrono::Utc;
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::{RData, Record, RecordType, rdata::{A, AAAA}};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{broadcast, RwLock};
use crate::config::Config;
use crate::db::DbPool;
use crate::metrics::DnsMetrics;
use super::{filter::FilterEngine, resolver::DnsResolver, cache::DnsCache};

pub struct DnsHandler {
    filter: Arc<FilterEngine>,
    resolver: Arc<DnsResolver>,
    /// Per-client resolvers keyed by sorted upstream list (e.g. "1.1.1.1,8.8.8.8")
    client_resolvers: RwLock<HashMap<String, Arc<DnsResolver>>>,
    cache: Arc<DnsCache>,
    db: DbPool,
    metrics: Arc<DnsMetrics>,
    query_log_tx: broadcast::Sender<serde_json::Value>,
}

impl DnsHandler {
    pub async fn new(cfg: Config, db: DbPool, filter: Arc<FilterEngine>, metrics: Arc<DnsMetrics>, query_log_tx: broadcast::Sender<serde_json::Value>) -> Result<Self> {
        let resolver = Arc::new(DnsResolver::new(&cfg).await?);
        let cache = Arc::new(DnsCache::new());
        Ok(Self {
            filter,
            resolver,
            client_resolvers: RwLock::new(HashMap::new()),
            cache,
            db,
            metrics,
            query_log_tx,
        })
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

        // Look up client-specific config (filter override + custom upstreams)
        let (client_filter_enabled, client_upstream_urls) =
            self.get_client_config(&client_ip).await;

        // Check DNS rewrite first (always, regardless of client config)
        if let Some(answer) = self.filter.check_rewrite(domain_normalized).await {
            tracing::debug!("Rewrite: {} -> {}", domain, answer);
            let elapsed = start.elapsed().as_millis() as i64;

            if matches!(qtype, RecordType::A | RecordType::AAAA) {
                if let Ok(response) = self.rewrite_response(&request, &answer, qtype) {
                    self.metrics.inc_allowed();
                    self.log_query(client_ip, &domain, &qtype_str, "allowed", Some("rewrite"), elapsed);
                    return Ok(response);
                }
            }
        }

        // Check filter (use client's filter_enabled setting if configured, else default true)
        if client_filter_enabled && self.filter.is_blocked(&domain).await {
            tracing::debug!("Blocked: {}", domain);
            let elapsed = start.elapsed().as_millis() as i64;
            self.metrics.inc_blocked();
            self.log_query(client_ip, &domain, &qtype_str, "blocked", Some("filter_rule"), elapsed);
            return self.nxdomain(&request);
        }

        // Check cache
        if let Some(cached) = self.cache.get(&domain, qtype).await {
            let elapsed = start.elapsed().as_millis() as i64;
            self.metrics.inc_cached();
            self.log_query(client_ip, &domain, &qtype_str, "cached", None, elapsed);
            return Ok(cached);
        }

        // Resolve: use client-specific upstream if configured, else global resolver
        let response = if let Some(ref upstreams) = client_upstream_urls {
            let resolver = self.get_or_create_client_resolver(upstreams).await?;
            resolver.resolve(&domain, qtype, &request).await?
        } else {
            self.resolver.resolve(&domain, qtype, &request).await?
        };

        let elapsed = start.elapsed().as_millis() as i64;
        self.cache.set(&domain, qtype, response.clone()).await;
        self.metrics.inc_allowed();
        self.log_query(client_ip, &domain, &qtype_str, "allowed", None, elapsed);

        Ok(response)
    }

    /// Look up client configuration by source IP.
    /// Returns (filter_enabled, Option<Vec<upstream_urls>>).
    /// Matches client identifiers that are plain IP addresses.
    async fn get_client_config(&self, client_ip: &str) -> (bool, Option<Vec<String>>) {
        let full_rows: Vec<(String, i64, Option<String>)> = match sqlx::query_as(
            "SELECT identifiers, filter_enabled, upstreams FROM clients"
        )
        .fetch_all(&self.db)
        .await {
            Ok(r) => r,
            Err(_) => return (true, None),
        };

        for (identifiers_json, filter_enabled, upstreams_json) in full_rows {
            // Parse identifiers array (["192.168.1.10", "192.168.1.11", ...])
            if let Ok(identifiers) = serde_json::from_str::<Vec<serde_json::Value>>(&identifiers_json) {
                let matched = identifiers.iter().any(|id| {
                    let id_str = id.as_str().unwrap_or("");
                    // Exact IP match
                    if id_str == client_ip { return true; }
                    // CIDR match
                    if let Ok(network) = id_str.parse::<ipnet::IpNet>() {
                        if let Ok(ip) = client_ip.parse::<IpAddr>() {
                            return network.contains(&ip);
                        }
                    }
                    false
                });

                if matched {
                    let filter_on = filter_enabled == 1;
                    let upstreams = upstreams_json.and_then(|s| {
                        serde_json::from_str::<Vec<String>>(&s).ok()
                    }).filter(|v| !v.is_empty());
                    return (filter_on, upstreams);
                }
            }
        }

        (true, None) // default: filter enabled, global resolver
    }

    /// Get or create a cached per-client resolver for the given upstream list.
    async fn get_or_create_client_resolver(&self, upstreams: &[String]) -> Result<Arc<DnsResolver>> {
        let key = {
            let mut sorted = upstreams.to_vec();
            sorted.sort();
            sorted.join(",")
        };

        // Fast path: already cached
        {
            let cache = self.client_resolvers.read().await;
            if let Some(r) = cache.get(&key) {
                return Ok(r.clone());
            }
        }

        // Slow path: create new resolver
        let resolver = Arc::new(DnsResolver::with_upstreams(upstreams)?);
        {
            let mut cache = self.client_resolvers.write().await;
            cache.insert(key, resolver.clone());
        }
        tracing::info!("Created client resolver for upstreams: {:?}", upstreams);
        Ok(resolver)
    }

    /// Build a response for DNS rewrite
    fn rewrite_response(&self, request: &Message, answer: &str, qtype: RecordType) -> Result<Vec<u8>> {
        let ip: IpAddr = answer.parse()
            .map_err(|_| anyhow::anyhow!("Invalid IP address: {}", answer))?;

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

    /// Fire-and-forget async query log write + WebSocket broadcast.
    fn log_query(&self, client_ip: String, domain: &str, qtype: &str, status: &str, reason: Option<&str>, elapsed_ms: i64) {
        let db = self.db.clone();
        let domain = domain.to_string();
        let qtype = qtype.to_string();
        let status = status.to_string();
        let reason = reason.map(|s| s.to_string());
        let now = Utc::now().to_rfc3339();
        let tx = self.query_log_tx.clone();

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

            let event = serde_json::json!({
                "time": now,
                "client_ip": client_ip,
                "question": domain,
                "qtype": qtype,
                "status": status,
                "reason": reason,
                "elapsed_ms": elapsed_ms,
            });
            let _ = tx.send(event);
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
