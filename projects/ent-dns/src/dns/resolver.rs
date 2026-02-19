use anyhow::Result;
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::RecordType;
use hickory_resolver::TokioAsyncResolver;
use hickory_resolver::config::{ResolverConfig, ResolverOpts, NameServerConfig, Protocol};
use hickory_resolver::error::ResolveErrorKind;
use std::net::SocketAddr;
use crate::config::Config;

pub struct DnsResolver {
    inner: TokioAsyncResolver,
}

impl DnsResolver {
    /// Default resolver using Cloudflare (plain UDP fallback for dev compatibility).
    pub async fn new(cfg: &Config) -> Result<Self> {
        let mut opts = ResolverOpts::default();
        opts.cache_size = 0; // We handle caching ourselves
        opts.use_hosts_file = false;

        let resolver = TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), opts);

        tracing::info!(
            "DNS resolver initialized, upstreams: {:?}",
            cfg.dns.upstreams
        );
        Ok(Self { inner: resolver })
    }

    /// Create a resolver using custom upstream IPs (plain UDP port 53).
    /// Accepts IP addresses like ["192.168.1.1", "8.8.8.8"].
    pub fn with_upstreams(upstreams: &[String]) -> Result<Self> {
        let mut opts = ResolverOpts::default();
        opts.cache_size = 0;
        opts.use_hosts_file = false;

        let mut config = ResolverConfig::new();
        let mut added = 0;

        for upstream in upstreams {
            let upstream = upstream.trim();
            // Accept "ip" or "ip:port" format
            let addr: Option<SocketAddr> = if let Ok(a) = upstream.parse::<SocketAddr>() {
                Some(a)
            } else if let Ok(ip) = upstream.parse::<std::net::IpAddr>() {
                Some(SocketAddr::new(ip, 53))
            } else {
                tracing::warn!("Invalid upstream address, skipping: {}", upstream);
                None
            };

            if let Some(addr) = addr {
                config.add_name_server(NameServerConfig::new(addr, Protocol::Udp));
                added += 1;
            }
        }

        if added == 0 {
            // Fall back to Cloudflare if no valid upstreams provided
            tracing::warn!("No valid custom upstreams, falling back to Cloudflare");
            return Ok(Self {
                inner: TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), opts),
            });
        }

        Ok(Self {
            inner: TokioAsyncResolver::tokio(config, opts),
        })
    }

    pub async fn resolve(
        &self,
        domain: &str,
        qtype: RecordType,
        request: &Message,
    ) -> Result<Vec<u8>> {
        let mut response = Message::new();
        response.set_id(request.id());
        response.set_message_type(MessageType::Response);
        response.set_op_code(OpCode::Query);
        response.set_recursion_desired(request.recursion_desired());
        response.set_recursion_available(true);
        for query in request.queries() {
            response.add_query(query.clone());
        }

        match self.inner.lookup(domain, qtype).await {
            Ok(lookup) => {
                response.set_response_code(ResponseCode::NoError);
                for record in lookup.records() {
                    response.add_answer(record.clone());
                }
                tracing::debug!(
                    "Resolved {} {:?}: {} records",
                    domain,
                    qtype,
                    response.answer_count()
                );
            }
            Err(e) => match e.kind() {
                ResolveErrorKind::NoRecordsFound { response_code, .. } => {
                    response.set_response_code(*response_code);
                    tracing::debug!("No records for {} {:?}: {:?}", domain, qtype, response_code);
                }
                _ => {
                    tracing::warn!("Upstream resolver error for {} {:?}: {}", domain, qtype, e);
                    response.set_response_code(ResponseCode::ServFail);
                }
            },
        }

        Ok(response.to_vec()?)
    }
}
