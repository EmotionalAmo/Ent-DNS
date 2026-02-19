# Ent-DNS Enterprise

企业级 DNS 过滤服务器，支持 AdGuard 规则语法、JWT 认证管理 API 和实时查询日志。

## 技术栈

- **后端**：Rust · Axum 0.8 · hickory-resolver 0.24 · SQLite (sqlx)
- **认证**：JWT (jsonwebtoken 9) · Argon2 密码哈希
- **前端**：React · TypeScript · Vite · shadcn/ui（开发中）

## 核心功能

| 功能 | 状态 |
|------|------|
| UDP DNS 服务器（AdGuard 规则过滤） | ✅ 完成 |
| 白名单 / 拦截 / 子域名匹配 | ✅ 完成 |
| JWT 登录认证 | ✅ 完成 |
| 过滤规则 CRUD + 热重载 | ✅ 完成 |
| 实时查询日志（分页/过滤） | ✅ 完成 |
| Dashboard 统计（24h block rate） | ✅ 完成 |
| 过滤列表订阅（远程 hosts/AdGuard） | 🚧 开发中 |
| DNS Rewrites（本地域名覆盖） | 🚧 开发中 |
| 前端管理 UI | 🚧 开发中 |

## 快速开始

### 环境要求

- Rust 1.75+
- SQLite

### 构建 & 运行

```bash
cd projects/ent-dns
cargo build

# 开发环境（避免 macOS mDNS 占用 5353）
ENT_DNS__DNS__PORT=15353 ENT_DNS__DATABASE__PATH=/tmp/ent-dns.db ./target/debug/ent-dns
```

### 测试 DNS 过滤

```bash
# 添加拦截规则（需先登录获取 JWT token）
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# 使用 token 添加规则
curl -X POST http://localhost:8080/api/v1/rules \
  -H 'Authorization: Bearer <TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"rule":"||ads.example.com^","comment":"block ads"}'

# 验证 DNS 拦截
dig @127.0.0.1 -p 15353 ads.example.com
```

## 项目结构

```
projects/ent-dns/
├── src/
│   ├── main.rs          # 入口，启动 DNS + HTTP 服务
│   ├── config.rs        # 配置（支持 ENV / TOML）
│   ├── dns/             # DNS 引擎（UDP server + AdGuard parser + resolver）
│   ├── api/             # Axum REST API（rules / filters / rewrites / logs）
│   ├── auth/            # JWT + Argon2 认证
│   ├── db/              # SQLite 数据访问层（sqlx）
│   └── metrics.rs       # 统计指标
├── frontend/            # React + Vite（开发中）
└── deploy/              # 部署配置
```

## API 一览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/auth/login` | POST | 登录，返回 JWT token |
| `/api/v1/rules` | GET/POST/DELETE | 过滤规则管理 |
| `/api/v1/query-log` | GET | 查询日志（分页/过滤） |
| `/api/v1/stats` | GET | 24h 统计（total/blocked/block_rate） |

## AI 团队架构

本项目由 14 个 AI Agent 协作构建（详见 `.claude/agents/`），基于各领域顶尖专家思维模型，包括工程、产品、设计、商业等层面的自主协作。
