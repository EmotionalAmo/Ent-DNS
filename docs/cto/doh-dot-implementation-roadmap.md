# DoH/DoT Implementation Roadmap

**Project**: Ent-DNS Round 10
**Status**: Design Phase
**Last Updated**: 2026-02-20

## Overview

本路线图将 ADR-001 的设计转化为可执行的开发任务。预计 5 周完成，从基础 DoH 端点到生产级 DoT mTLS。

## Phase 1: DoH Basic (Week 1)

### Goal
实现符合 RFC 8484 的 DoH 端点，支持 GET 和 POST 方法。

### Tasks

#### Task 1.1: DoH Configuration
**File**: `src/config.rs`

**Changes**:
```rust
#[derive(Debug, Clone, Deserialize)]
pub struct DnsConfig {
    // ...existing fields...

    // DoH settings
    #[serde(default)]
    pub doh_enabled: bool,
    #[serde(default = "default_doh_bind")]
    pub doh_bind: String,
    #[serde(default = "default_doh_port")]
    pub doh_port: u16,
}

fn default_doh_bind() -> String { "0.0.0.0".to_string() }
fn default_doh_port() -> u16 { 8443 }
```

**Env Vars**:
- `ENT_DNS__DNS__DOH_ENABLED` (default: false)
- `ENT_DNS__DNS__DOH_BIND` (default: 0.0.0.0)
- `ENT_DNS__DNS__DOH_PORT` (default: 8443)

**Effort**: 0.5 day

---

#### Task 1.2: DoH Handler Module
**New File**: `src/api/handlers/doh.rs`

**Responsibilities**:
- Parse base64url encoded DNS query (GET `/dns-query?dns=...`)
- Parse binary DNS query (POST `/dns-query` with `application/dns-message`)
- Call `state.dns_handler.handle(wire_bytes, client_ip).await`
- Return `application/dns-message` response
- Extract client IP from `ConnectInfo<SocketAddr>` or `X-Forwarded-For`

**API Endpoint**:
```
GET  /dns-query?dns=AAAAAA...    (base64url)
POST /dns-query                   (binary, Content-Type: application/dns-message)
```

**Response Headers**:
```
Content-Type: application/dns-message
Content-Length: <response size>
Cache-Control: max-age=<TTL>
```

**Effort**: 1.5 days

---

#### Task 1.3: DoH Router Integration
**File**: `src/api/router.rs`

**Changes**:
```rust
use crate::api::handlers::doh::doh_handler;

pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        // ...existing routes...

        // DoH endpoint
        .route("/dns-query", get(doh_handler).post(doh_handler))
        // ...other routes...
}
```

**Effort**: 0.5 day

---

#### Task 1.4: DoH Metrics
**File**: `src/metrics.rs`

**New Fields**:
```rust
pub struct DnsMetrics {
    // ...existing fields...

    // DoH metrics
    pub doh_queries_total: AtomicU64,
    pub doh_queries_get: AtomicU64,
    pub doh_queries_post: AtomicU64,
    pub doh_errors_total: AtomicU64,
}

impl DnsMetrics {
    pub fn inc_doh_query(&self, method: &str) {
        self.doh_queries_total.fetch_add(1, Ordering::Relaxed);
        match method {
            "GET" => self.doh_queries_get.fetch_add(1, Ordering::Relaxed),
            "POST" => self.doh_queries_post.fetch_add(1, Ordering::Relaxed),
            _ => {}
        };
    }

    pub fn inc_doh_error(&self) {
        self.doh_errors_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn to_prometheus_text(&self) -> String {
        // ...existing metrics...

        // DoH metrics
        let doh_total = self.doh_queries_total.load(Ordering::Relaxed);
        let doh_get = self.doh_queries_get.load(Ordering::Relaxed);
        let doh_post = self.doh_queries_post.load(Ordering::Relaxed);
        let doh_errors = self.doh_errors_total.load(Ordering::Relaxed);

        format!(
            // ...existing format...

            "# HELP ent_dns_doh_queries_total Total DoH queries\n\
             # TYPE ent_dns_doh_queries_total counter\n\
             ent_dns_doh_queries_total{{method=\"get\"}} {doh_get}\n\
             ent_dns_doh_queries_total{{method=\"post\"}} {doh_post}\n\
             ent_dns_doh_errors_total {doh_errors}\n"
        )
    }
}
```

**Effort**: 1 day

---

#### Task 1.5: DoH Server Launch
**File**: `src/main.rs`

**Changes**:
```rust
async fn main() -> Result<()> {
    // ...existing setup...

    // Conditionally start DoH server
    if cfg.dns.doh_enabled {
        let doh_bind = format!("{}:{}", cfg.dns.doh_bind, cfg.dns.doh_port);
        let api_state_for_doh = api_state.clone();
        tokio::spawn(async move {
            let app = build_app(api_state_for_doh, cors);
            let listener = tokio::net::TcpListener::bind(&doh_bind).await?;
            tracing::info!("DoH endpoint listening on https://{}", doh_bind);
            axum::serve(listener, app).await
        });
    }

    // ...existing run...
}
```

**Effort**: 0.5 day

---

#### Task 1.6: Unit Tests
**New File**: `src/api/handlers/doh_test.rs`

**Test Cases**:
1. GET `/dns-query?dns=...` parses base64url correctly
2. POST `/dns-query` handles binary payload
3. Malformed DNS query returns 400 Bad Request
4. Client IP extraction (direct vs X-Forwarded-For)
5. Metrics increment correctly

**Effort**: 1.5 days

---

### Phase 1 Deliverables
- [ ] DoH GET/POST handler working
- [ ] Metrics exported to `/metrics`
- [ ] Unit tests passing (>80% coverage)
- [ ] Manual test with `curl`:
```bash
curl -v "https://localhost:8443/dns-query?dns=AAABAAABAAAAAABAAdleGFtcGxlA2NvbQAAAQAB"
curl -v -X POST -H "Content-Type: application/dns-message" \
  --data-binary @query.bin https://localhost:8443/dns-query
```

---

## Phase 2: DoH Authentication (Week 2)

### Goal
为 DoH 添加可选 JWT 认证，区分公开用户和内部用户。

### Tasks

#### Task 2.1: DoH Auth Middleware
**New File**: `src/api/middleware/doh_auth.rs`

**Logic**:
- If `doh_require_auth == false`: Allow all, extract client IP for ACL
- If `doh_require_auth == true`:
  - Check `Authorization: Bearer <token>` header
  - Validate JWT token
  - Extract user ID and IP from token claims
  - Use client IP for ACL matching

**Env Var**:
- `ENT_DNS__DNS__DOH_REQUIRE_AUTH` (default: false)

**Effort**: 2 days

---

#### Task 2.2: DoH Auth Metrics
**File**: `src/metrics.rs`

**New Fields**:
```rust
pub struct DnsMetrics {
    // ...existing fields...

    // DoH auth metrics
    pub doh_auth_success: AtomicU64,
    pub doh_auth_failure: AtomicU64,
}
```

**Prometheus**:
```
ent_dns_doh_auth_total{{status="success|failure"}} <value>
```

**Effort**: 0.5 day

---

#### Task 2.3: Integration Tests
**New File**: `tests/doh_auth_test.rs`

**Test Cases**:
1. Public mode: No token required
2. Private mode: Valid token allowed
3. Private mode: Invalid token returns 401
4. Private mode: Expired token returns 401

**Effort**: 1.5 days

---

#### Task 2.4: Documentation
**New File**: `docs/devops/doh-deployment.md`

**Contents**:
- How to configure DoH (env vars)
- How to generate JWT tokens for DoH
- How to test DoH endpoint (curl examples)
- Troubleshooting common issues

**Effort**: 1 day

---

### Phase 2 Deliverables
- [ ] DoH JWT auth working
- [ ] Auth metrics exported
- [ ] Integration tests passing
- [ ] Deployment documentation complete

---

## Phase 3: DoT Core (Week 3)

### Goal
实现基本 DoT 服务（TLS 加密，匿名模式）。

### Tasks

#### Task 3.1: DoT Configuration
**File**: `src/config.rs`

**Changes**:
```rust
#[derive(Debug, Clone, Deserialize)]
pub struct DnsConfig {
    // ...existing fields...

    // DoT settings
    #[serde(default)]
    pub dot_enabled: bool,
    #[serde(default = "default_dot_bind")]
    pub dot_bind: String,
    #[serde(default = "default_dot_port")]
    pub dot_port: u16,
    #[serde(default = "default_dot_cert_path")]
    pub dot_cert_path: String,
    #[serde(default = "default_dot_key_path")]
    pub dot_key_path: String,
}

fn default_dot_bind() -> String { "0.0.0.0".to_string() }
fn default_dot_port() -> u16 { 853 }
fn default_dot_cert_path() -> String { "./certs/server.crt".to_string() }
fn default_dot_key_path() -> String { "./certs/server.key".to_string() }
```

**Env Vars**:
- `ENT_DNS__DNS__DOT_ENABLED` (default: false)
- `ENT_DNS__DNS__DOT_BIND` (default: 0.0.0.0)
- `ENT_DNS__DNS__DOT_PORT` (default: 853)
- `ENT_DNS__DNS__DOT_CERT_PATH` (default: ./certs/server.crt)
- `ENT_DNS__DNS__DOT_KEY_PATH` (default: ./certs/server.key)

**Effort**: 0.5 day

---

#### Task 3.2: TLS Configuration Loader
**New File**: `src/tls/mod.rs`

**Responsibilities**:
- Load PEM-encoded certificate and private key
- Build `rustls::ServerConfig`
- Support TLS 1.3 only (default)
- Configure session ticket for resumption

**API**:
```rust
pub fn load_server_config(cert_path: &str, key_path: &str) -> Result<ServerConfig>
```

**Effort**: 2 days

---

#### Task 3.3: DoT Listener
**New File**: `src/dns/dot.rs`

**Responsibilities**:
- TCP listener on port 853
- TLS accepter (rustls)
- Parse DNS wire format (2-byte length prefix + message)
- Call `DnsHandler::handle()`
- Send response with length prefix
- Connection keep-alive

**Pseudo-code**:
```rust
pub async fn run_dot_listener(
    handler: Arc<DnsHandler>,
    tls_config: ServerConfig,
    bind_addr: String,
) -> Result<()> {
    let listener = TcpListener::bind(&bind_addr).await?;
    let acceptor = TlsAcceptor::from(tls_config);

    loop {
        let (stream, peer) = listener.accept().await?;
        let acceptor = acceptor.clone();
        let handler = handler.clone();

        tokio::spawn(async move {
            match acceptor.accept(stream).await {
                Ok(tls_stream) => handle_dot_connection(tls_stream, handler, peer).await,
                Err(e) => tracing::warn!("TLS handshake failed: {}", e),
            }
        });
    }
}

async fn handle_dot_connection(
    mut stream: TlsStream<TcpStream>,
    handler: Arc<DnsHandler>,
    peer: SocketAddr,
) {
    // Read 2-byte length prefix + DNS message
    // Parse and handle with DnsHandler
    // Write response with length prefix
    // Loop until connection closed
}
```

**Effort**: 2 days

---

#### Task 3.4: DoT Metrics
**File**: `src/metrics.rs`

**New Fields**:
```rust
pub struct DnsMetrics {
    // ...existing fields...

    // DoT metrics
    pub dot_queries_total: AtomicU64,
    pub dot_connections_active: AtomicU64,
    pub dot_handshake_errors: AtomicU64,
}
```

**Prometheus**:
```
ent_dns_dot_queries_total <value>
ent_dns_dot_connections_active <value>
ent_dns_dot_handshake_errors_total <value>
```

**Effort**: 0.5 day

---

#### Task 3.5: DoT Server Launch
**File**: `src/main.rs`

**Changes**:
```rust
async fn main() -> Result<()> {
    // ...existing setup...

    // Conditionally start DoT server
    if cfg.dns.dot_enabled {
        let tls_config = load_server_config(&cfg.dns.dot_cert_path, &cfg.dns.dot_key_path)?;
        let handler = dns_handler.clone();
        let bind_addr = format!("{}:{}", cfg.dns.dot_bind, cfg.dns.dot_port);
        tokio::spawn(async move {
            run_dot_listener(handler, tls_config, bind_addr).await
        });
    }

    // ...existing run...
}
```

**Effort**: 0.5 day

---

#### Task 3.6: Unit Tests
**New File**: `src/dns/dot_test.rs`

**Test Cases**:
1. TLS config loads valid PEM cert
2. TLS config rejects invalid cert
3. DNS message parsing with length prefix
4. Response formatting with length prefix
5. Connection keep-alive

**Effort**: 1.5 days

---

#### Task 3.7: Manual Test Script
**New File**: `scripts/test-dot.sh`

**Contents**:
- Generate self-signed cert for testing
- Test with `kdig` (Knot DNS) or `dig +tls`
- Test with `openssl s_client`
- Verify metrics endpoint

**Effort**: 1 day

---

### Phase 3 Deliverables
- [ ] DoT anonymous mode working
- [ ] TLS config loader functional
- [ ] DoT metrics exported
- [ ] Unit tests passing
- [ ] Manual test script verified

---

## Phase 4: DoT mTLS (Week 4)

### Goal
实现 DoT mutual TLS 认证，验证客户端证书。

### Tasks

#### Task 4.1: DoT mTLS Configuration
**File**: `src/config.rs`

**Changes**:
```rust
#[derive(Debug, Clone, Deserialize)]
pub struct DnsConfig {
    // ...existing fields...

    // DoT mTLS settings
    #[serde(default)]
    pub dot_require_client_cert: bool,
    #[serde(default = "default_dot_ca_path")]
    pub dot_ca_path: Option<String>,
}

fn default_dot_ca_path() -> Option<String> { None }
```

**Env Vars**:
- `ENT_DNS__DNS__DOT_REQUIRE_CLIENT_CERT` (default: false)
- `ENT_DNS__DNS__DOT_CA_PATH` (default: none, mTLS disabled)

**Effort**: 0.5 day

---

#### Task 4.2: Client CA Validation
**File**: `src/tls/mod.rs`

**Changes**:
- Load client CA certificate (PEM)
- Add to `ServerConfig::client_ca_verifier`
- Extract client certificate SAN (Subject Alternative Name)
- Return SAN string for ACL matching

**API**:
```rust
pub fn load_server_config_with_ca(
    cert_path: &str,
    key_path: &str,
    ca_path: Option<&str>,
) -> Result<ServerConfig>
```

**Effort**: 2 days

---

#### Task 4.3: SAN to Identifiers Mapping
**File**: `src/dns/dot.rs`

**Logic**:
- Extract SAN from client certificate
- Parse SAN as:
  - IP address (e.g., `192.168.1.10`)
  - DNS name (e.g., `client1.internal`)
  - Email address (e.g., `user1@internal`)
- Pass identifier to `DnsHandler::handle()` as client_ip
- Allow ACL to match SAN (e.g., `client1.internal` as identifier)

**Effort**: 1.5 days

---

#### Task 4.4: Client Certificate Generation Script
**New File**: `scripts/gen-client-cert.sh`

**Usage**:
```bash
./scripts/gen-client-cert.sh \
  --ca ./certs/ca.crt \
  --ca-key ./certs/ca.key \
  --san "192.168.1.10" \
  --san "client1.internal" \
  --output ./certs/client1.p12
```

**Output**: PKCS#12 certificate (compatible with Windows/macOS)

**Effort**: 1 day

---

#### Task 4.5: Management UI Certificate Upload
**New File**: `src/api/handlers/certificates.rs`

**Endpoints**:
```
GET    /api/v1/certificates/ca          # Get CA cert fingerprint
POST   /api/v1/certificates/client      # Upload client cert
DELETE /api/v1/certificates/client/{id}  # Revoke client cert
```

**Frontend**: New page at `/certificates`

**Effort**: 3 days

---

#### Task 4.6: E2E Tests
**New File**: `tests/dot_mtls_test.rs`

**Test Cases**:
1. Valid client cert allowed
2. Invalid client cert rejected
3. No client cert (if required) rejected
4. SAN extraction and ACL matching
5. Certificate revocation

**Effort**: 1.5 days

---

#### Task 4.7: Documentation
**New File**: `docs/devops/dot-mtls-deployment.md`

**Contents**:
- How to generate CA and server cert
- How to generate client certificates
- How to configure SAN for ACL
- How to upload client certs via UI
- Troubleshooting common issues

**Effort**: 1 day

---

### Phase 4 Deliverables
- [ ] DoT mTLS working
- [ ] Client cert generation script
- [ ] Management UI certificate upload
- [ ] E2E tests passing
- [ ] Deployment documentation complete

---

## Phase 5: Production Readiness (Week 5)

### Goal
优化性能、监控和文档，准备生产部署。

### Tasks

#### Task 5.1: TLS Session Resumption
**File**: `src/tls/mod.rs`

**Changes**:
- Enable TLS session tickets
- Cache session tickets (in-memory or Redis)
- Reduce handshake overhead from ~15ms to ~2ms

**Effort**: 1.5 days

---

#### Task 5.2: Certificate Rotation Automation
**New File**: `scripts/rotate-certs.sh`

**Features**:
- Check cert expiration (warn if <30 days)
- Generate new cert
- Reload TLS config (hot reload without restart)
- Backup old cert

**Integration**: Cron job or systemd timer

**Effort**: 2 days

---

#### Task 5.3: Alerting Rules
**New File**: `docs/devops/prometheus-alerts.yml`

**Alerts**:
```yaml
- alert: DoHTLSCertExpiringSoon
  expr: ent_dns_tls_cert_expiry_days < 30
  annotations:
    summary: "DoH/DoT certificate expires in <30 days"

- alert: DoTHandshakeErrorRateHigh
  expr: rate(ent_dns_dot_handshake_errors_total[5m]) > 0.1
  annotations:
    summary: "DoT handshake error rate >10%"

- alert: DoHResponseLatencyHigh
  expr: histogram_quantile(0.95, ent_dns_query_latency_seconds_bucket{transport="doh"}) > 0.1
  annotations:
    summary: "DoH P95 latency >100ms"
```

**Effort**: 1 day

---

#### Task 5.4: Performance Testing
**New File**: `tests/load_test_doh_dot.rs`

**Scenarios**:
- 100 QPS DoH baseline (JWT disabled)
- 100 QPS DoH with JWT auth
- 100 QPS DoT anonymous
- 100 QPS DoT mTLS
- TLS session resumption impact

**Metrics**:
- Latency (P50/P95/P99)
- CPU usage
- Memory usage
- Handshake time

**Tools**: `wrk`, `hey`, `loadtest`

**Effort**: 1.5 days

---

#### Task 5.5: Troubleshooting Guide
**New File**: `docs/devops/troubleshooting.md`

**Sections**:
1. DoH endpoint returns 401 → Check JWT token
2. DoT handshake failed → Check cert validity
3. DoH latency high → Check TLS session resumption
4. Client cert rejected → Check SAN mapping
5. Cert rotation failed → Check file permissions

**Effort**: 1 day

---

#### Task 5.6: Security Audit
**New File**: `docs/qa/security-audit-doh-dot.md`

**Items**:
1. TLS 1.3 only (no fallback to 1.2)
2. Strong cipher suites
3. Certificate validation
4. JWT token expiration
5. Rate limiting (DoH endpoint)
6. IP spoofing protection (X-Forwarded-For)

**Effort**: 1 day

---

### Phase 5 Deliverables
- [ ] TLS session resumption enabled
- [ ] Cert rotation automation script
- [ ] Prometheus alerting rules
- [ ] Performance test report
- [ ] Troubleshooting guide
- [ ] Security audit report

---

## File Changes Summary

### New Files
```
src/
├── api/handlers/
│   ├── doh.rs              # DoH handler (GET/POST)
│   └── certificates.rs    # Client cert management API
├── api/middleware/
│   └── doh_auth.rs         # DoH JWT auth middleware
├── dns/
│   ├── dot.rs              # DoT listener
│   └── dot_test.rs         # DoT unit tests
├── tls/
│   └── mod.rs              # TLS config loader
├── api/handlers/doh_test.rs
└── tests/
    ├── doh_auth_test.rs
    └── dot_mtls_test.rs

scripts/
├── gen-client-cert.sh
├── rotate-certs.sh
└── test-dot.sh

docs/devops/
├── doh-deployment.md
├── dot-mtls-deployment.md
├── troubleshooting.md
└── prometheus-alerts.yml

docs/qa/
└── security-audit-doh-dot.md

tests/
└── load_test_doh_dot.rs
```

### Modified Files
```
src/config.rs              # DoH/DoT config
src/metrics.rs             # DoH/DoT metrics
src/api/router.rs          # DoH route
src/main.rs                # DoH/DoT server launch
src/dns/mod.rs             # Export dot module
```

---

## Total Estimated Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1: DoH Basic | 6 tasks | 5.5 days |
| Phase 2: DoH Auth | 4 tasks | 5 days |
| Phase 3: DoT Core | 7 tasks | 8.5 days |
| Phase 4: DoT mTLS | 7 tasks | 9 days |
| Phase 5: Production | 6 tasks | 8 days |
| **Total** | **30 tasks** | **36 days (5 weeks)** |

---

## Dependencies & Blockers

### External Dependencies
None (all crates already in Cargo.toml)

### Internal Dependencies
- **Phase 1** → **Phase 2**: DoH basic must work before auth
- **Phase 3** → **Phase 4**: DoT anonymous must work before mTLS
- **All Phases** → **Phase 5**: Production tasks depend on all features

### Blockers
- **TLS Certificates**: Phase 3/4 require valid cert files (can use self-signed for dev)
- **ACME Integration** (Optional): If using Let's Encrypt, need HTTP-01 or DNS-01 challenge

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| TLS handshake performance | High latency | Session resumption, connection pool |
| Cert expiry in production | Service disruption | Alert 30 days early, automate rotation |
| mTLS config error | Legitimate clients blocked | E2E tests, dry-run mode |
| DoH auth bypass | Unauthorized access | Security audit, penetration test |
| DoH/DoT RFC compliance | Compatibility issues | Follow RFC 8484/7858, test with Cloudflare |

---

## Acceptance Criteria

### Phase 1: DoH Basic
- [ ] DoH GET/POST returns valid DNS response
- [ ] curl test succeeds with base64url and binary payload
- [ ] Unit test coverage >80%
- [ ] No regression in UDP/TCP DNS

### Phase 2: DoH Auth
- [ ] DoH with valid JWT token allowed
- [ ] DoH with invalid token returns 401
- [ ] Auth metrics exported
- [ ] Integration tests passing

### Phase 3: DoT Core
- [ ] DoT with kdig returns valid DNS response
- [ ] TLS handshake succeeds with valid cert
- [ ] DoT metrics exported
- [ ] Unit tests passing

### Phase 4: DoT mTLS
- [ ] DoT with valid client cert allowed
- [ ] DoT with invalid cert rejected
- [ ] SAN extraction and ACL matching working
- [ ] Management UI certificate upload functional

### Phase 5: Production
- [ ] TLS session resumption reduces handshake time to <5ms
- [ ] Cert rotation script works (hot reload)
- [ ] Prometheus alerts trigger correctly
- [ ] Load test: 100 QPS with <100ms P95 latency
- [ ] Security audit passes (no critical issues)
- [ ] Troubleshooting guide complete

---

## Next Actions

1. **Review**: CEO and QA review this roadmap (1 day)
2. **Prioritize**: Determine if all phases are needed (mTLS may be optional)
3. **Kickoff**: Start Phase 1 (DoH Basic)
4. **Weekly Sync**: Review progress at end of each phase

---

**Last Updated**: 2026-02-20
**Maintainer**: CTO Agent (Werner Vogels)
