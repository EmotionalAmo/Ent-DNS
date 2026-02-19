# ADR-001: Web 框架与核心组件选型

> 作者：cto-vogels
> 日期：2026-02-19
> 状态：已决策

---

## 背景

Ent-DNS Enterprise 需要选定以下核心技术组件：
1. Rust Web 框架（管理 API）
2. DNS 协议库
3. 数据存储方案
4. TLS 实现

约束条件：**严禁 `unsafe` 代码**（包括传递依赖中的 unsafe 使用尽量最小化）。

---

## 决策一：Web 框架 → **Axum**

### 结论
**选 Axum，不选 Actix-web。**

### 理由

| 维度 | Axum | Actix-web | 决策权重 |
|------|------|-----------|----------|
| 性能 | 极高（略低于 Actix ~10-15%） | 最高 | 低（管理 API 非热路径） |
| unsafe 代码 | 框架本身 safe，依赖 tokio | 历史有 unsafe，现已减少但仍存在 | 高 |
| 生态系统 | Tokio 官方出品，Tower 中间件 | 独立生态，与 tokio 生态部分割裂 | 高 |
| 中间件 | Tower/tower-http，标准化 | 自有中间件体系 | 中 |
| 可维护性 | 类型系统友好，错误信息清晰 | 宏魔法较多，调试复杂 | 高 |
| 社区趋势 | 2024-2026 增长最快 | 成熟稳定但增长放缓 | 中 |

**核心逻辑**：管理 API 的 QPS 远低于 DNS 解析层（DNS 是热路径，不经过 Axum）。Axum 的性能对我们的场景已经绝对够用（万级 RPS），而其 Tower 生态提供的 auth、rate-limiting、tracing 中间件是企业级 API 必需的，且全部 safe。

### 使用的关键中间件
```toml
axum = "0.8"
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "trace", "compression-gzip", "auth"] }
```

---

## 决策二：DNS 协议库 → **hickory-proto + hickory-resolver**

### 结论
使用 `hickory-proto`（协议解析/序列化）+ `hickory-resolver`（上游递归解析），**不使用 hickory-server**（未生产就绪）。

### 理由

| 选项 | 状态 | 说明 |
|------|------|------|
| hickory-server | ⚠️ 不推荐生产 | TCP/AXFR 有 DoS 风险，官方不建议生产部署 |
| hickory-proto | ✅ 生产可用 | DNS 包解析/序列化，Ferrous Systems 审计通过 |
| hickory-resolver | ✅ 生产可用 | 上游 DNS 递归解析，DoH/DoT 支持 |
| 手写 DNS 解析 | ❌ 不推荐 | 协议细节多、容易出安全漏洞 |

**架构决策**：自建 DNS 服务器核心（tokio UDP/TCP listener + 请求路由），使用 `hickory-proto` 处理 DNS 包的编解码，使用 `hickory-resolver` 进行上游解析。这样既避免了 hickory-server 的安全问题，又不需要从零实现 DNS 协议。

```toml
hickory-proto = "0.24"
hickory-resolver = { version = "0.24", features = ["tokio-runtime", "dns-over-https-rustls", "dns-over-tls"] }
```

---

## 决策三：数据存储 → **SQLite（开发/单节点）+ PostgreSQL（生产/集群）**

### 结论
**SQLite 作为默认存储，PostgreSQL 作为可选生产存储**，通过 `sqlx` 抽象层统一访问。

### 数据分类

| 数据类型 | 存储方式 | 理由 |
|----------|----------|------|
| 配置数据（规则、设置、用户） | SQLite/PostgreSQL | 结构化，读多写少 |
| 查询日志（DNS Query Log） | SQLite WAL 模式 | 写入频繁，分区归档 |
| 审计日志（Audit Log） | SQLite WAL 模式 | 追加写入，不可修改 |
| DNS 解析缓存 | 内存（moka crate） | 低延迟需求，重启可重建 |

**为什么不上 Redis**：缓存用 `moka`（高性能内存 cache，支持 TTL + LRU），避免引入额外的基础设施依赖。等真正需要多实例共享缓存时再引入。

```toml
sqlx = { version = "0.8", features = ["sqlite", "postgres", "runtime-tokio-rustls", "migrate", "chrono", "uuid"] }
moka = { version = "0.12", features = ["future"] }
```

---

## 决策四：TLS 实现 → **rustls（不用 OpenSSL）**

### 结论
**全面使用 rustls**，拒绝 OpenSSL 依赖。

### 理由
- 纯 Rust 实现，无 unsafe FFI
- 不依赖系统 OpenSSL 版本（部署更简单）
- 安全审计记录更好（OpenSSL 历史 CVE 众多）
- `tokio-rustls` + `rustls` 生态完整

```toml
rustls = "0.23"
tokio-rustls = "0.26"
rustls-pemfile = "2"
```

---

## 完整 Cargo.toml 依赖清单

```toml
[dependencies]
# 异步运行时
tokio = { version = "1", features = ["full"] }

# Web 框架
axum = { version = "0.8", features = ["multipart", "ws"] }
tower = { version = "0.5", features = ["full"] }
tower-http = { version = "0.6", features = ["cors", "trace", "compression-gzip"] }

# DNS 协议
hickory-proto = "0.24"
hickory-resolver = { version = "0.24", features = ["tokio-runtime", "dns-over-https-rustls", "dns-over-tls"] }

# 数据库
sqlx = { version = "0.8", features = ["sqlite", "postgres", "runtime-tokio-rustls", "migrate", "chrono", "uuid"] }

# 缓存
moka = { version = "0.12", features = ["future"] }

# TLS
rustls = "0.23"
tokio-rustls = "0.26"
rustls-pemfile = "2"

# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# 认证与安全
jsonwebtoken = "9"
argon2 = "0.5"
rand = "0.8"

# 日志与追踪
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# 错误处理
thiserror = "2"
anyhow = "1"

# 工具类
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4", features = ["derive", "env"] }
config = "0.14"
regex = "1"
ipnet = { version = "2", features = ["serde"] }
bytes = "1"
```
