# Ent-DNS Enterprise — 系统架构设计

> 作者：cto-vogels
> 日期：2026-02-19
> 版本：v0.1（初稿）

---

## 一、系统概览

Ent-DNS Enterprise 是一款企业级 DNS 过滤服务器，采用**单进程 Monolith 架构**，DNS 解析引擎与管理 API 共享同一进程，但逻辑上完全分离。

```
┌─────────────────────────────────────────────────────────────┐
│                    Ent-DNS Enterprise Process                │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │    DNS Engine        │    │    Management API         │   │
│  │                     │    │       (Axum)              │   │
│  │  ┌───────────────┐  │    │                          │   │
│  │  │ UDP Listener  │  │    │  ┌────────────────────┐  │   │
│  │  │  port 53      │  │    │  │ REST API / port 8080│  │   │
│  │  └───────┬───────┘  │    │  └────────────────────┘  │   │
│  │          │          │    │                          │   │
│  │  ┌───────▼───────┐  │    │  ┌────────────────────┐  │   │
│  │  │ TCP Listener  │  │    │  │ Web UI / port 8080  │  │   │
│  │  │  port 53      │  │    │  │  (serve static)    │  │   │
│  │  └───────┬───────┘  │    │  └────────────────────┘  │   │
│  │          │          │    │                          │   │
│  │  ┌───────▼───────┐  │    └──────────────────────────┘   │
│  │  │  DoH Server   │  │                                    │
│  │  │  port 8443    │  │    ┌──────────────────────────┐   │
│  │  └───────┬───────┘  │    │      Shared State         │   │
│  │          │          │    │                          │   │
│  │  ┌───────▼───────┐  │    │  ┌────────┐ ┌─────────┐ │   │
│  │  │  DoT Server   │  │◄───┼──┤ Filter │ │  Cache  │ │   │
│  │  │  port 853     │  │    │  │ Engine │ │ (moka)  │ │   │
│  │  └───────┬───────┘  │    │  └────────┘ └─────────┘ │   │
│  │          │          │    │                          │   │
│  │  ┌───────▼───────┐  │    │  ┌────────────────────┐  │   │
│  │  │   Resolver    │  │    │  │  SQLite / Database  │  │   │
│  │  │  (hickory)    │  │    │  └────────────────────┘  │   │
│  │  └───────────────┘  │    └──────────────────────────┘   │
│  └─────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、端口规划

| 端口 | 协议 | 用途 |
|------|------|------|
| 53/UDP | DNS | 标准 DNS 查询（主要）|
| 53/TCP | DNS | 标准 DNS 查询（大包/zone transfer）|
| 853/TCP | TLS | DNS-over-TLS (DoT) |
| 8080/TCP | HTTP | 管理 API + Web UI（开发）|
| 8443/TCP | HTTPS | 管理 API + Web UI + DoH（生产）|

> DoH 路径：`https://host:8443/dns-query`
> 管理 API 路径：`https://host:8443/api/v1/...`

---

## 三、核心模块设计

### 3.1 DNS Engine（核心热路径）

```
Client → UDP/TCP Listener → DNS Packet Parser (hickory-proto)
       → ACL Check（客户端访问控制）
       → Cache Lookup（moka，内存 LRU + TTL）
       → Filter Engine（黑白名单 + 规则匹配）
           ├── Blocked → NXDOMAIN / REFUSED / 0.0.0.0
           └── Allowed → Resolver（hickory-resolver，上游查询）
                       → Cache Write
                       → Response
```

**性能目标**：
- 缓存命中：< 1ms p99
- 上游查询：< 50ms p99（受上游 DNS 影响）
- 目标 QPS：10,000+ RPS（单节点）

### 3.2 Filter Engine

```rust
// 过滤器优先级（从高到低）
1. 客户端白名单（per-client allowlist）
2. 全局白名单（global allowlist）
3. 客户端黑名单（per-client blocklist）
4. 全局黑名单规则（custom rules）
5. 订阅拦截列表（blocklists）
6. 安全浏览数据库
7. 默认放行
```

### 3.3 Management API（Axum）

REST API，基于 JWT 认证 + RBAC 授权。

**API 路径规划**：
```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh

GET    /api/v1/dashboard/stats
GET    /api/v1/query-log
GET    /api/v1/audit-log

GET    /api/v1/filters
POST   /api/v1/filters
PUT    /api/v1/filters/:id
DELETE /api/v1/filters/:id

GET    /api/v1/rules
POST   /api/v1/rules
DELETE /api/v1/rules/:id

GET    /api/v1/clients
POST   /api/v1/clients
PUT    /api/v1/clients/:id

GET    /api/v1/settings/dns
PUT    /api/v1/settings/dns
GET    /api/v1/settings/encryption
PUT    /api/v1/settings/encryption

GET    /api/v1/users           (Admin only)
POST   /api/v1/users           (Admin only)
PUT    /api/v1/users/:id/role  (Admin only)

GET    /metrics                (Prometheus)
GET    /health
```

### 3.4 RBAC 设计

```
角色层级（从高到低）：
SuperAdmin  → 所有操作 + 用户管理 + 系统设置
Admin       → 所有操作（除用户角色管理）
Operator    → 规则管理 + 客户端管理 + 查看日志
ReadOnly    → 仅查看仪表盘、日志、统计
```

---

## 四、数据库 Schema（概要）

```sql
-- 用户表
CREATE TABLE users (
    id          TEXT PRIMARY KEY,  -- UUID
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,     -- argon2 hash
    role        TEXT NOT NULL,     -- SuperAdmin/Admin/Operator/ReadOnly
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT 1
);

-- 过滤列表
CREATE TABLE filter_lists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT,              -- 订阅 URL（为空则是自定义）
    is_enabled  BOOLEAN NOT NULL DEFAULT 1,
    rule_count  INTEGER NOT NULL DEFAULT 0,
    last_updated DATETIME,
    created_at  DATETIME NOT NULL
);

-- 自定义规则
CREATE TABLE custom_rules (
    id          TEXT PRIMARY KEY,
    rule        TEXT NOT NULL,     -- AdGuard 语法规则
    comment     TEXT,
    is_enabled  BOOLEAN NOT NULL DEFAULT 1,
    created_by  TEXT NOT NULL,     -- user_id
    created_at  DATETIME NOT NULL
);

-- DNS 重写
CREATE TABLE dns_rewrites (
    id          TEXT PRIMARY KEY,
    domain      TEXT NOT NULL,     -- 支持通配符 *.example.com
    answer      TEXT NOT NULL,     -- IP 或域名
    created_by  TEXT NOT NULL,
    created_at  DATETIME NOT NULL
);

-- 客户端配置
CREATE TABLE clients (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    identifiers     TEXT NOT NULL,  -- JSON: ["192.168.1.10", "AA:BB:CC:DD:EE:FF"]
    upstreams       TEXT,           -- JSON: ["tls://1.1.1.1"]
    filter_enabled  BOOLEAN NOT NULL DEFAULT 1,
    tags            TEXT,           -- JSON array
    created_at      DATETIME NOT NULL,
    updated_at      DATETIME NOT NULL
);

-- 查询日志（DNS Query Log）
CREATE TABLE query_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    time        DATETIME NOT NULL,
    client_ip   TEXT NOT NULL,
    client_name TEXT,
    question    TEXT NOT NULL,     -- 查询域名
    qtype       TEXT NOT NULL,     -- A/AAAA/CNAME/etc.
    answer      TEXT,              -- 响应 IP 或 CNAME
    status      TEXT NOT NULL,     -- allowed/blocked/cached
    reason      TEXT,              -- 拦截原因
    upstream    TEXT,              -- 使用的上游 DNS
    elapsed_ms  INTEGER            -- 响应时间(ms)
) WITHOUT ROWID;

CREATE INDEX idx_query_log_time ON query_log(time DESC);
CREATE INDEX idx_query_log_client ON query_log(client_ip, time DESC);

-- 审计日志（操作记录，不可删除）
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    time        DATETIME NOT NULL,
    user_id     TEXT NOT NULL,
    username    TEXT NOT NULL,
    action      TEXT NOT NULL,     -- CREATE/UPDATE/DELETE/LOGIN/etc.
    resource    TEXT NOT NULL,     -- filters/rules/clients/users/etc.
    resource_id TEXT,
    detail      TEXT,              -- JSON，变更详情
    ip          TEXT NOT NULL      -- 操作者 IP
);

-- 系统设置（KV 存储）
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL            -- JSON
);
```

---

## 五、项目目录结构

```
ent-dns/
├── Cargo.toml                    # Workspace 根配置
├── Cargo.lock
├── .env.example
├── .gitignore
│
├── backend/                      # Rust 后端
│   ├── Cargo.toml
│   ├── build.rs                  # 编译时嵌入前端静态文件
│   └── src/
│       ├── main.rs               # 入口：初始化并启动所有服务
│       ├── config.rs             # 配置加载（TOML + 环境变量）
│       ├── error.rs              # 统一错误类型
│       │
│       ├── dns/                  # DNS 引擎（热路径）
│       │   ├── mod.rs
│       │   ├── server.rs         # UDP/TCP/DoT/DoH listener
│       │   ├── handler.rs        # DNS 请求处理主逻辑
│       │   ├── resolver.rs       # 上游 DNS 解析（hickory-resolver）
│       │   ├── filter.rs         # 过滤引擎（规则匹配）
│       │   ├── cache.rs          # DNS 缓存（moka）
│       │   └── acl.rs            # 客户端访问控制
│       │
│       ├── api/                  # 管理 API（Axum）
│       │   ├── mod.rs
│       │   ├── router.rs         # 路由注册
│       │   ├── middleware/       # Tower 中间件
│       │   │   ├── auth.rs       # JWT 验证
│       │   │   ├── rbac.rs       # 权限检查
│       │   │   └── audit.rs      # 操作审计
│       │   └── handlers/         # 路由处理器
│       │       ├── auth.rs
│       │       ├── dashboard.rs
│       │       ├── filters.rs
│       │       ├── rules.rs
│       │       ├── clients.rs
│       │       ├── query_log.rs
│       │       ├── audit_log.rs
│       │       ├── settings.rs
│       │       └── users.rs
│       │
│       ├── db/                   # 数据库层
│       │   ├── mod.rs
│       │   ├── pool.rs           # 连接池初始化
│       │   ├── migrations/       # SQLx 迁移文件
│       │   │   └── 001_initial.sql
│       │   └── models/           # 数据模型
│       │       ├── user.rs
│       │       ├── filter.rs
│       │       ├── rule.rs
│       │       ├── client.rs
│       │       └── log.rs
│       │
│       ├── auth/                 # 认证授权
│       │   ├── mod.rs
│       │   ├── jwt.rs            # JWT 生成/验证
│       │   ├── password.rs       # argon2 哈希
│       │   └── rbac.rs           # 角色权限定义
│       │
│       └── metrics.rs            # Prometheus 指标
│
├── frontend/                     # React 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                  # API 客户端（自动生成 or 手写）
│       ├── components/           # 可复用组件
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── QueryLog.tsx
│       │   ├── Filters.tsx
│       │   ├── Rules.tsx
│       │   ├── Clients.tsx
│       │   ├── Settings.tsx
│       │   ├── Users.tsx         # 仅 Admin 可见
│       │   └── AuditLog.tsx      # 仅 Admin 可见
│       └── stores/               # Zustand 状态管理
│
├── docs/                         # 文档
│   ├── cto/
│   ├── research/
│   └── ...
│
└── deploy/                       # 部署配置
    ├── docker/
    │   ├── Dockerfile
    │   └── docker-compose.yml
    └── config.example.toml
```

---

## 六、关键架构决策说明

### 为什么单进程？
- 简单性优先（DHH 原则）
- DNS 引擎和 API 共享过滤规则数据，单进程避免 IPC 开销
- 等真正需要时（多核 DNS、分布式部署），再拆分

### 为什么不用 HTMX/SSR？
- 目标用户是企业 IT 管理员，需要数据可视化（图表、实时日志）
- React 更适合这类 Admin Dashboard 场景
- 前端 build 后嵌入 Rust 二进制（`include_dir!`），部署仍是单文件

### DNS 引擎与 API 的隔离
- DNS 查询走独立的 tokio task pool，优先级高
- API 请求走普通 tokio 线程池
- 共享数据（过滤规则、客户端配置）通过 `Arc<RwLock<...>>` 或 `DashMap` 访问

---

## 七、阶段计划

| 阶段 | 目标 | 预期功能 |
|------|------|---------|
| Phase 1 (MVP) | 可用的 DNS 服务器 + 基础管理 | DNS 53/DoH/DoT + 黑名单 + 查询日志 + RBAC + REST API |
| Phase 2 | 企业增强 | 多租户 + LDAP/SSO + Prometheus + 审计合规 + DoQ |
| Phase 3 | 高可用 | 多节点管理 + 集群 + SIEM 集成 |
