# Ent-DNS Enterprise

企业级 DNS 过滤服务器，支持 AdGuard/hosts 规则、订阅列表、DNS 重写、实时查询日志和 Web 管理界面。

## 技术栈

- **后端**：Rust · Axum 0.8 · hickory-resolver 0.24 · SQLite (sqlx) · tokio
- **认证**：JWT (jsonwebtoken 9) · Argon2 密码哈希 · RBAC 角色控制
- **前端**：React 18 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui
- **协议**：DNS over UDP + TCP (RFC 1035) · WebSocket 实时推送

## 功能状态

| 功能 | 状态 |
|------|------|
| DNS UDP + TCP 服务器 | ✅ |
| AdGuard / hosts 规则过滤 | ✅ |
| 过滤列表订阅（远程 URL，后台同步） | ✅ |
| DNS Rewrites（本地域名覆盖） | ✅ |
| 自定义客户端上游 DNS（含 CIDR 匹配） | ✅ |
| Web 管理界面（单端口，前后端合一） | ✅ |
| JWT 登录 · RBAC 角色权限 | ✅ |
| 实时查询日志（WebSocket + 一次性 ticket） | ✅ |
| Dashboard 趋势图（5 秒自动刷新） | ✅ |
| Dashboard Top 10 被拦截域名 & 活跃客户端 | ✅ |
| 拦截率周环比趋势 | ✅ |
| Prometheus 指标 `/metrics` | ✅ |
| 查询日志 CSV / JSON 导出 | ✅ |
| 查询日志自动清理（可配置保留天数） | ✅ |
| 过滤列表定时自动刷新 | ✅ |
| 规则批量启用 / 禁用 | ✅ |
| 首次登录强制改密保护 | ✅ |
| 安全加固（CORS 白名单、登录限速、WS 防重放等） | ✅ |
| 完整测试套件 | ✅ |
| Docker 一键部署 | ✅ |

---

## 快速开始

### 方式一：Docker Compose（推荐生产）

```bash
# 1. 克隆仓库
git clone https://github.com/EmotionalAmo/Ent-DNS.git
cd Ent-DNS/projects/ent-dns

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少修改 ENT_DNS__AUTH__JWT_SECRET：
#   openssl rand -hex 32

# 3. 启动
docker compose up -d

# 访问 Web UI：http://your-server:8080
# 默认账号：admin / admin（首次登录强制改密）
```

**docker-compose.yml** 已内置：数据持久化卷、DNS 端口 53/UDP+TCP、管理 API 8080。

---

### 方式二：systemd 自动安装脚本

```bash
cd projects/ent-dns
sudo bash install.sh
```

脚本会自动：构建二进制 → 创建系统用户 → 安装 systemd service → 启动服务。

---

### 方式三：本地开发

**前置要求**：Rust 1.75+、Node.js 18+

```bash
cd projects/ent-dns

# 1. 构建前端
cd frontend && npm install && npm run build && cd ..

# 2. 启动后端（前端 dist/ 由后端同端口 serve）
ENT_DNS__DNS__PORT=15353 \
ENT_DNS__DATABASE__PATH=/tmp/ent-dns-test.db \
ENT_DNS__AUTH__JWT_SECRET=dev-local-secret-for-development-only \
cargo run

# 访问：http://localhost:8080
```

**开发模式（热重载，推荐）**：

```bash
# 终端 1：后端
ENT_DNS__DNS__PORT=15353 \
ENT_DNS__DATABASE__PATH=/tmp/ent-dns-test.db \
ENT_DNS__AUTH__JWT_SECRET=dev-local-secret-for-development-only \
cargo run

# 终端 2：前端（Vite 自动代理 /api/* 到后端 :8080）
cd frontend && npm run dev

# 访问：http://localhost:5173
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENT_DNS__DATABASE__PATH` | `./ent-dns.db` | SQLite 数据库路径 |
| `ENT_DNS__DNS__BIND` | `0.0.0.0` | DNS 监听地址 |
| `ENT_DNS__DNS__PORT` | `53` | DNS 端口（开发用 15353 避免 macOS 冲突） |
| `ENT_DNS__API__BIND` | `0.0.0.0` | HTTP API 监听地址 |
| `ENT_DNS__API__PORT` | `8080` | HTTP API 端口（同时 serve 前端） |
| `ENT_DNS__AUTH__JWT_SECRET` | ❌ 必填 | JWT 签名密钥，≥32 字符，用 `openssl rand -hex 32` 生成 |
| `ENT_DNS__AUTH__JWT_EXPIRY_HOURS` | `24` | Token 有效期（小时） |
| `ENT_DNS__API__CORS_ALLOWED_ORIGINS` | `*`（不推荐） | 生产环境设置为实际域名，如 `https://dns.example.com` |
| `ENT_DNS_BACKUP_DIR` | `/tmp` | 数据库备份目录，生产建议设为安全路径 |
| `ENT_DNS_STATIC_DIR` | `frontend/dist` | 前端静态文件目录，生产建议设为绝对路径 |

> **安全注意**：`JWT_SECRET` 使用默认值或长度 < 32 字符时，服务会拒绝启动。

---

## 项目结构

```
projects/ent-dns/
├── src/
│   ├── main.rs              # 入口：启动 DNS + HTTP，后台定时任务
│   ├── config.rs            # 配置（ENV / TOML 双支持）
│   ├── dns/
│   │   ├── server.rs        # UDP + TCP DNS 服务器（EDNS0 4096B）
│   │   ├── handler.rs       # 请求处理：过滤 → 重写 → 缓存 → 解析
│   │   ├── filter.rs        # FilterEngine（AdGuard/hosts 规则引擎）
│   │   ├── resolver.rs      # 上游 DNS 解析器（含自定义 upstream）
│   │   ├── cache.rs         # DNS 缓存
│   │   └── subscription.rs  # 远程过滤列表同步
│   ├── api/
│   │   ├── router.rs        # 路由注册（含前端静态文件 fallback）
│   │   ├── middleware/      # JWT 认证 · RBAC · 审计日志
│   │   └── handlers/        # rules / filters / rewrites / clients /
│   │                        # query_log / dashboard / users / ws / ...
│   ├── db/                  # SQLite 迁移 · 连接池 · 审计写入
│   ├── metrics.rs           # Prometheus AtomicU64 计数器
│   └── error.rs             # 统一错误类型
├── frontend/                # React + Vite（构建产物由后端 serve）
│   ├── src/
│   │   ├── pages/           # Dashboard / Rules / Filters / Rewrites /
│   │   │                    # Clients / Upstreams / QueryLogs / Settings
│   │   ├── api/             # axios client + 各模块 API 封装
│   │   ├── hooks/           # useQueryLogWebSocket（实时日志）
│   │   └── stores/          # Zustand 状态管理（auth）
│   └── vite.config.ts       # 开发时 proxy /api/* → :8080
├── Dockerfile               # 多阶段构建（前端 + 后端）
├── docker-compose.yml       # 生产编排
├── install.sh               # systemd 自动安装脚本
└── .env.example             # 环境变量模板
```

---

## API 一览

### 认证
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/auth/login` | POST | 登录，返回 JWT |
| `/api/v1/auth/logout` | POST | 登出 |
| `/api/v1/auth/change-password` | POST | 修改密码 |

### 核心管理
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/rules` | GET/POST | 自定义规则（分页 + 搜索） |
| `/api/v1/rules/{id}` | PUT/DELETE | 更新/删除 |
| `/api/v1/rules/bulk` | POST | 批量启用 / 禁用规则 |
| `/api/v1/filters` | GET/POST | 过滤列表 |
| `/api/v1/filters/{id}` | PUT/DELETE | 更新/删除 |
| `/api/v1/filters/{id}/refresh` | POST | 手动同步远程列表 |
| `/api/v1/rewrites` | GET/POST | DNS 重写规则 |
| `/api/v1/rewrites/{id}` | PUT/DELETE | 更新/删除 |
| `/api/v1/clients` | GET/POST | 客户端配置（含 CIDR） |
| `/api/v1/clients/{id}` | PUT/DELETE | 更新/删除 |
| `/api/v1/settings/upstreams` | GET/POST | 上游 DNS 管理 |
| `/api/v1/settings/upstreams/{id}` | GET/PUT/DELETE | 更新/删除 |
| `/api/v1/settings/upstreams/{id}/test` | POST | 测试上游连通性 |
| `/api/v1/settings/upstreams/failover` | POST | 配置故障转移 |
| `/api/v1/settings/upstreams/failover-log` | GET | 故障转移日志 |

### 监控 & 日志
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/dashboard/stats` | GET | 统计数据（含周环比拦截率趋势） |
| `/api/v1/dashboard/query-trend` | GET | 查询趋势（?hours=N） |
| `/api/v1/dashboard/top-blocked-domains` | GET | Top 10 被拦截域名 |
| `/api/v1/dashboard/top-clients` | GET | Top 10 活跃客户端 |
| `/api/v1/query-log` | GET | 查询日志（分页/过滤） |
| `/api/v1/query-log/export` | GET | 导出日志（?format=csv\|json） |
| `/api/v1/ws/ticket` | POST | 获取一次性 WebSocket ticket |
| `/api/v1/ws/query-log?ticket=TICKET` | WS | 实时查询日志推送 |
| `/metrics` | GET | Prometheus 指标 |

### 管理员
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/users` | GET/POST | 用户管理 |
| `/api/v1/users/{id}/role` | PUT | 修改角色 |
| `/api/v1/audit-log` | GET | 审计日志 |
| `/api/v1/admin/backup` | GET | 数据库备份 |

---

## 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| `admin` | `admin` | super_admin |

> 首次登录后系统会强制要求修改密码，修改前无法访问其他页面。

---

## 安全特性

- **登录限速**：同一 IP 15 分钟内失败 5 次后锁定
- **CORS 白名单**：生产环境通过 `ENT_DNS__API__CORS_ALLOWED_ORIGINS` 限制来源
- **WebSocket 防重放**：WS 连接使用一次性 ticket（30 秒有效），避免 JWT 暴露在 URL 历史
- **过滤列表事务**：订阅同步使用显式 SQLite 事务（DELETE + INSERT 原子操作）
- **内容长度检查**：订阅下载前校验 Content-Length，防止超大响应攻击
- **客户端配置缓存**：moka 缓存（60s TTL，4096 容量）防止 DNS 热路径 DB 击穿

---

## 构建 Docker 镜像

```bash
cd projects/ent-dns
docker build -t ent-dns:latest .
```

多阶段构建：Stage 1 编译前端（Node.js），Stage 2 编译 Rust 后端，Stage 3 最终镜像仅包含二进制和前端产物，体积最小化。
