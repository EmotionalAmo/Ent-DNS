# Ent-DNS 安全代码审计报告

**审计日期**: 2026-02-20
**审计范围**: `projects/ent-dns/src/`
**审计工具**: qa-bach (Code Review Agent) — 47 次代码扫描，83K tokens

---

## 综合评价

| 严重级别 | 数量 | 代表问题 |
|---------|------|---------|
| 🔴 Critical | 2 | failover_log 无认证、backup SQL 拼接 |
| 🟠 High | 5 | CORS 放开、WS token 泄露、无暴破防护、无事务同步、IP 伪造 |
| 🟡 Medium | 5 | unwrap panic、内存炸弹、全表扫描、导出无角色限制 |
| 🟢 Low | 3 | UNIQUE 约束缺失、相对路径、默认密码常量 |

**良好实践（未发现问题）**：所有 sqlx 查询均参数化无 SQL 注入 ✅ · argon2 密码哈希正确 ✅ · JWT secret 启动校验 ✅ · RBAC extractor 实现正确 ✅ · DNS TCP/UDP 并发架构健全 ✅

---

## 🔴 Critical — 需立即修复

### C-1: `failover_log` 端点完全无认证
**信心：100/100**
**文件**：`src/api/handlers/upstreams.rs:395` · `src/api/router.rs:48`

```rust
// 当前（有问题）
pub async fn failover_log(
    State(state): State<Arc<AppState>>,  // 无认证参数
) -> AppResult<Json<Value>> {

// 修复
pub async fn failover_log(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,  // 或 _admin: AdminUser
) -> AppResult<Json<Value>> {
```

任何未认证用户可通过 `GET /api/v1/settings/upstreams/failover-log` 获取完整 failover 操作日志，泄露内部基础设施信息。

---

### C-2: `backup.rs` 中 `VACUUM INTO` 使用字符串拼接 SQL
**信心：85/100**
**文件**：`src/api/handlers/backup.rs:26`

```rust
// 当前（有问题）
sqlx::query(&format!("VACUUM INTO '{}'", backup_filename))

// SQLite 不支持 VACUUM INTO 参数绑定，应固定路径到受保护目录并严格验证文件名
```

备份文件含所有敏感数据（密码哈希、审计日志），写入 cwd 且无访问控制保护。

---

## 🟠 High — 尽快修复

### H-1: CORS 完全开放，允许任意来源
**信心：100/100**
**文件**：`src/api/mod.rs:47`

```rust
// 当前
.layer(CorsLayer::permissive())

// 修复
.layer(CorsLayer::new()
    .allow_origin(["http://localhost:5173".parse::<HeaderValue>().unwrap()])
    .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
    .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]))
```

`permissive()` 允许任意网站向管理 API 发送跨域请求，是 CSRF 直接入口。

---

### H-2: WebSocket JWT Token 通过 URL Query 传递
**信心：100/100**
**文件**：`src/api/handlers/ws.rs:13`

`?token=<jwt>` 形式会导致 JWT 出现在：TraceLayer 日志、Nginx/Cloudflare 访问日志、浏览器历史记录、HTTP Referer 头。
**建议**：改用短期一次性 WebSocket ticket（正常 API 端点颁发，仅用一次），避免长期 JWT 出现在 URL 中。

---

### H-3: `X-Forwarded-For` 可被客户端伪造，污染审计日志
**信心：95/100**
**文件**：`src/api/handlers/auth.rs:65`

```rust
let ip = headers.get("x-forwarded-for")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("unknown").to_string();
```

攻击者设置 `X-Forwarded-For: 127.0.0.1` 即可在审计日志中伪装为本地回环地址。
**修复**：通过配置声明是否在反向代理后；若否，使用 `ConnectInfo<SocketAddr>` extractor 获取 TCP peer IP。

---

### H-4: 过滤列表同步无数据库事务，中断后规则清空
**信心：90/100**
**文件**：`src/dns/subscription.rs:162`

```rust
// 先删除旧规则
sqlx::query("DELETE FROM custom_rules WHERE created_by = ?").execute(pool).await?;
// 逐条插入（无事务）— 若此时进程崩溃，filter 规则为零，所有恶意域名放行
for rule in block_rules { ... }
```

**修复**：将 DELETE + INSERT 包裹在显式 SQLite 事务中。

---

### H-5: 登录端点无速率限制，可暴力破解
**信心：95/100**
**文件**：`src/api/handlers/auth.rs:24`（全局无速率限制中间件）

`POST /api/v1/auth/login` 无任何限流、失败计数、账户锁定。Argon2 的 ~100ms 验证成本不足以阻止分布式暴力破解。
**修复**：引入 `tower-governor` 对登录端点限流；维护失败计数，超过阈值临时锁定。

---

## 🟡 Medium — 计划修复

### M-1: `handler.rs:193` `.unwrap()` 潜在 panic
**信心：88/100** · `src/dns/handler.rs:193`

```rust
let query = request.queries().first().unwrap(); // 依赖隐式上下文保证
```

虽然当前调用路径中不会触发，应改为 `ok_or_else(|| anyhow!("no queries"))?`。

---

### M-2: `upstreams.rs:220` `.unwrap()` 可 panic
**信心：85/100** · `src/api/handlers/upstreams.rs:220`

```rust
let addresses = body.addresses.map(|a| serde_json::to_string(&a).unwrap())...
// 应改为 .map_err(|e| AppError::Internal(...))?
```

---

### M-3: HTTP 响应大小检查在完整读取 body 后（内存炸弹）
**信心：80/100** · `src/dns/subscription.rs:46`

```rust
let content = response.text().await?;   // 先全量读入内存
if content.len() > MAX_RESPONSE_SIZE {  // 再检查 —— 为时已晚
```

**修复**：使用 `response.bytes_stream()` + `take()` 进行流式限制。

---

### M-4: `get_client_config` 每次 DNS 查询全表扫描
**信心：85/100** · `src/dns/handler.rs:117`

```rust
sqlx::query_as("SELECT identifiers, filter_enabled, upstreams FROM clients") // 全表，每次查询
```

高 QPS 下严重数据库 I/O 压力。客户端配置变化频率极低，应加 TTL 缓存（60s）。

---

### M-5: query_log 导出无角色限制，任意认证用户可导出全部 DNS 历史
**信心：82/100** · `src/api/handlers/query_log.rs:115`

```rust
pub async fn export(
    _auth: AuthUser,  // 仅需任意认证用户，无角色要求
```

`read_only` 角色用户可导出最多 10000 条含客户端 IP 的 DNS 查询历史，违反最小权限原则。

---

## 🟢 Low — 技术债

### L-1: `dns_rewrites` 表缺少 `UNIQUE(domain)` 约束
`src/db/migrations/001_initial.sql:34` — 同一域名可并发创建多条 rewrite，行为不确定。

### L-2: 静态文件服务使用相对路径
`src/api/router.rs:57` — `ServeDir::new("frontend/dist")` 依赖 cwd，systemd `WorkingDirectory` 必须严格匹配。

### L-3: 默认密码常量硬编码在源码
`src/api/handlers/auth.rs:10` — `const DEFAULT_ADMIN_PASSWORD: &str = "admin"` 永久出现在版本历史中。

---

## 修复优先级建议

```
立即（生产前必修）：C-1, C-2, H-1, H-5
近期（2周内）：H-2, H-3, H-4, M-3, M-4, M-5
计划（下个迭代）：M-1, M-2, L-1, L-2, L-3
```
