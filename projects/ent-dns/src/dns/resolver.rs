use anyhow::Result;
use hickory_proto::op::{Message, MessageType, OpCode, ResponseCode};
use hickory_proto::rr::RecordType;
use hickory_resolver::TokioAsyncResolver;
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use hickory_resolver::error::ResolveErrorKind;
use crate::config::Config;

pub struct DnsResolver {
    inner: TokioAsyncResolver,
}

impl DnsResolver {
    pub async fn new(cfg: &Config) -> Result<Self> {
        let mut opts = ResolverOpts::default();
        opts.cache_size = 0; // We handle caching ourselves
        opts.use_hosts_file = false;

        // Use Cloudflare plain DNS by default; TODO: parse cfg.dns.upstreams into config
        let resolver = TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), opts);

        tracing::info!(
            "DNS resolver initialized, upstreams: {:?}",
            cfg.dns.upstreams
        );
        Ok(Self { inner: resolver })
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
