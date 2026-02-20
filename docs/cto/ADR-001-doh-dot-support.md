# ADR-001: DoH/DoT Support Design

**Status**: Proposed
**Date**: 2026-02-20
**Author**: CTO Agent (Werner Vogels)
**Decision**: Add DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT) transport support to Ent-DNS

## Context

Ent-DNS 目前仅支持传统的 UDP/TCP DNS 协议（端口 5353/53）。对于企业级部署，加密 DNS 传输是硬性需求：

1. **隐私保护**：防止 ISP 或网络中间人嗅探 DNS 查询
2. **绕过审查**：DoH/DoT 可穿透防火墙和 DNS 劫持
3. **合规要求**：GDPR、HIPAA 等法规要求数据传输加密
4. **行业标准**：Chrome、Firefox、Android 11+ 默认支持 DoH/DoT

## Technical Constraints

1. **现有架构**：DnsHandler 已经是共享的 Arc 对象，可在 UDP/TCP/DoH 之间复用
2. **技术栈**：Rust 1.93 + Axum 0.8 + hickory-resolver 0.24 + rustls 0.23
3. **认证系统**：现有 JWT 认证需与 DoH/DoT 集成
4. **性能要求**：TLS 加密不应引入 >10ms 延迟
5. **配置约束**：生产环境可能需要自签名证书（内网部署场景）

## Decision

### 1. DoH Implementation Strategy

**采用 Axum HTTP Handler 模式，复用现有 DnsHandler**

```rust
// GET /dns-query?dns=AAAAAA... (base64url encoded)
// POST /dns-query with application/dns-message body
pub async fn doh_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<DohParams>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    // 1. 提取 DNS wire format（GET: base64url, POST: binary）
    // 2. 可选 JWT 认证（Bearer token 或 Authorization: Bearer）
    // 3. state.dns_handler.handle(wire_bytes, client_ip).await
    // 4. 返回 application/dns-message
}
```

**Rationale**:
- DoH 本质上是 HTTP 端点，与 Axum 框架天然契合
- 复用 DnsHandler → 无需重写 filter/cache/upstream 逻辑
- HTTP/2 支持由 tower-http 层自动提供
- JWT 认证可复用现有 AuthUser extractor

### 2. DoT Implementation Strategy

**独立 Tokio TCP Listener + rustls TLS Accepter**

```rust
pub async fn dot_listener(
    handler: Arc<DnsHandler>,
    tls_config: ServerConfig,
    bind_addr: String,
) -> Result<()> {
    let listener = TcpListener::bind(&bind_addr).await?;
    loop {
        let (stream, peer) = listener.accept().await?;
        let tls_stream = TlsAcceptor::from(tls_config.clone())
            .accept(stream).await?;
        tokio::spawn(async move {
            handle_dot_connection(tls_stream, handler, peer).await
        });
    }
}
```

**认证方案**：
- **Option 1 (推荐)**：TLS Client Certificate Authentication
  - 管理面板生成客户端证书（PKCS#12）
  - 客户端携带证书连接
  - 服务端验证证书 SAN（Subject Alternative Name）
  - 提取 client IP 作为 ACL 匹配依据

- **Option 2 (备选)**：Application-Layer Token
  - TCP 连接建立后，客户端先发 Auth Token
  - 类似 DNS-over-TLS (DoT) 的 "Auth Extension"（非标准）
  - 需定义自定义协议扩展

**Rationale**:
- DoT 是协议层加密，不适合 HTTP 层的 JWT
- TLS Client Cert 是 RFC 6125 标准方案
- 与现有 ACL 系统完全兼容（证书 SAN 映射到 identifiers）

### 3. Crate Selection

| 功能 | 推荐方案 | 理由 |
|------|----------|------|
| TLS | `rustls` 0.23 | 已在 Cargo.toml，无外部依赖，性能优秀 |
| HTTP/2 | Axum 内置 | tower-http 自动处理，无需额外 crate |
| Base64 | `base64` 0.22 | 已在 Cargo.toml（DoH GET 需要） |
| TLS Cert Load | `rustls-pemfile` 2 | 已在 Cargo.toml |
| TLS Acceptor | `tokio-rustls` 0.26 | 已在 Cargo.toml |

**无需新增依赖**：所有必需 crate 已在现有 Cargo.toml 中！

### 4. Configuration Schema

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct DnsConfig {
    pub port: u16,
    pub bind: String,
    pub upstreams: Vec<String>,

    // DoH settings
    #[serde(default)]
    pub doh_enabled: bool,
    #[serde(default = "default_doh_bind")]
    pub doh_bind: String,
    #[serde(default = "default_doh_port")]
    pub doh_port: u16,
    #[serde(default = "default_doh_require_auth")]
    pub doh_require_auth: bool,

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
    #[serde(default = "default_dot_ca_path")]
    pub dot_ca_path: Option<String>, // Client CA for mutual TLS
}
```

### 5. Monitoring & Metrics

**新增 Prometheus Metrics**：

```rust
pub struct DnsMetrics {
    // ...existing fields...

    // DoH metrics
    pub doh_queries_total: AtomicU64,
    pub doh_latency_ms: Histogram, // P50/P95/P99

    // DoT metrics
    pub dot_queries_total: AtomicU64,
    pub dot_connections_active: AtomicU64, // Current TLS connections
    pub dot_handshake_errors: AtomicU64,
}
```

**关键指标**：
- `ent_dns_doh_queries_total{method="get|post",auth="yes|no"}`
- `ent_dns_dot_handshake_duration_seconds`
- `ent_dns_dot_connections_active`
- `ent_dns_query_latency_seconds_bucket{transport="udp|tcp|doh|dot"}`

### 6. Architecture Integration

```
┌─────────────────────────────────────────────────────────────┐
│                         Axum HTTP Server                     │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────────────┐ │
│  │  /api/v1  │  │   /dns-query   │  │  /metrics  │  │
│  │  (Mgmt)   │  │   (DoH GET/POST) │  │  (Prom)   │  │
│  └─────┬─────┘  └─────┬─────────┘  └───────┬──────────┘ │
└────────┼───────────────┼────────────────────┼──────────────┘
         │               │                      │
         │            AppState                  │
         │         ┌─────┴─────┐               │
         │         │ dns_handler│  Arc<DnsHandler>
         │         └─────┬─────┘               │
         └───────────────┼──────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼─────┐   ┌─────▼──────┐   ┌─────▼──────┐
   │  UDP/TCP │   │   DoH      │   │   DoT      │
   │  Server  │   │  Endpoint  │   │  Listener  │
   └────┬─────┘   └─────┬──────┘   └─────┬──────┘
        │               │                │
        └───────────────┴────────────────┘
                        │
                ┌───────▼───────┐
                │   DnsHandler  │
                │  (Filter/     │
                │   Cache/      │
                │   Upstream)   │
                └───────────────┘
```

## Consequences

### Positive

1. **Zero New Dependencies**: 所有必需 crate 已在 Cargo.toml 中
2. **Code Reuse**: DnsHandler 在所有传输层之间共享，无重复逻辑
3. **Performance**: DoH 利用 HTTP/2 多路复用，DoT TLS 握手缓存优化
4. **Security**: rustls 零安全漏洞历史，TLS 1.3 默认
5. **Compliance**: 满足 GDPR/HIPAA 加密要求
6. **Flexibility**: DoH 可选 JWT 认证，DoT 支持 mTLS

### Negative

1. **TLS Certificate Management**: 运维复杂度增加（证书轮换、吊销）
2. **Resource Usage**: TLS 握手增加 CPU 开销（约 +5-10ms 首包延迟）
3. **Testing Complexity**: 需要 TLS 端到端测试（certgen、mutual TLS）
4. **Backward Compatibility**: 老客户端可能不支持 DoH/DoT

### Risks & Mitigations

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| TLS 握手性能瓶颈 | 高延迟 | TLS session resumption (session ticket), 连接池 |
| 证书过期导致服务中断 | 不可用 | 自动证书轮换 (ACME Let's Encrypt) 或提前 30 天告警 |
| DoH JWT Token 泄露 | 未授权访问 | 短期 token（1 小时），IP 白名单 |
| DoT mTLS 配置错误 | 拒绝合法客户端 | 集成测试覆盖 cert validation 逻辑 |
| RFC 8484 合规性 | 兼容性问题 | 参考 Cloudflare DoH 实现，使用 hickory-proto 序列化 |

## Alternatives Considered

### Alternative 1: Use hickory-server's built-in DoH/DoT

**方案**：hickory-resolver 支持 dns-over-https-rustls 特性，可直接启用

**优点**：
- 零代码，配置即用

**缺点**：
- **关键问题**：hickory-server 是纯 DNS 服务器，不支持自定义 filter/cache 逻辑
- 无法与 Ent-DNS 的 FilterEngine 集成
- 无法复用 DnsHandler（rules/rewrites/ACL）
- 丧失业务控制力

**结论**：拒绝，不符合 "Everything Fails" 原则（无法自定义故障处理）

### Alternative 2: Use external reverse proxy (Nginx/Caddy)

**方案**：Nginx terminate TLS → 转发到 Ent-DNS HTTP

**优点**：
- 成熟方案，TLS 证书管理自动化
- Nginx 高性能、稳定

**缺点**：
- 增加基础设施复杂度（多一个组件）
- 运维成本上升（需要管理 Nginx）
- **You Build It, You Run It** 违背：开发团队需要懂 Nginx

**结论**：拒绝，不符合独立开发者场景

### Alternative 3: DoT without Client Cert (Anonymous)

**方案**：DoT 仅加密传输，不验证客户端身份

**优点**：
- 客户端配置简单（无需证书）

**缺点**：
- 丧失 ACL 控制（任何人都可查询）
- **API First** 违背：无法区分用户
- 违背企业级安全要求

**结论**：拒绝，仅开放 DoH（可选 JWT），DoT 强制 mTLS

## Implementation Phases

### Phase 1: DoH Basic (Week 1)
- [ ] DoH GET/POST handler (RFC 8484)
- [ ] base64url 编解码
- [ ] CORS header 配置
- [ ] 基础 metrics（QPS、延迟）
- [ ] 单元测试

### Phase 2: DoH Authentication (Week 2)
- [ ] JWT Bearer token 支持
- [ ] IP 白名单模式（可选）
- [ ] 认证失败 metrics
- [ ] 集成测试

### Phase 3: DoT Core (Week 3)
- [ ] rustls ServerConfig 加载
- [ ] TCP listener + TLS accepter
- [ ] DNS wire format over TLS
- [ ] 连接复用（keep-alive）
- [ ] 基础测试

### Phase 4: DoT mTLS (Week 4)
- [ ] Client CA 验证
- [ ] Certificate SAN → identifiers 映射
- [ ] 客户端证书生成脚本
- [ ] 管理面板证书上传接口
- [ ] E2E 测试

### Phase 5: Production Readiness (Week 5)
- [ ] TLS session resumption
- [ ] 证书轮换自动化（ACME 或手动）
- [ ] 告警（证书过期、TLS 错误率）
- [ ] 文档（部署、故障排查）
- [ ] 性能测试（1K QPS TLS 开销）

## References

1. RFC 8484 - DNS Queries over HTTPS (DoH)
2. RFC 7858 - DNS Queries over TLS (DoT)
3. RFC 6125 - Representation and Verification of Domain-Based Application Service Identity
4. Cloudflare 1.1.1.1 DoH Implementation
5. Quad9 DoT Service Architecture
6. Rustls Security Audit 2024

---

**Next Action**: Review with CEO and QA, create implementation tasks.
