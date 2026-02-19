use hickory_proto::rr::RecordType;
use moka::future::Cache;
use std::time::Duration;

pub struct DnsCache {
    inner: Cache<String, Vec<u8>>,
}

impl DnsCache {
    pub fn new() -> Self {
        let inner = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(300))
            .build();
        Self { inner }
    }

    fn cache_key(domain: &str, qtype: RecordType) -> String {
        format!("{}:{:?}", domain.to_lowercase(), qtype)
    }

    pub async fn get(&self, domain: &str, qtype: RecordType) -> Option<Vec<u8>> {
        self.inner.get(&Self::cache_key(domain, qtype)).await
    }

    pub async fn set(&self, domain: &str, qtype: RecordType, data: Vec<u8>) {
        self.inner.insert(Self::cache_key(domain, qtype), data).await;
    }
}
