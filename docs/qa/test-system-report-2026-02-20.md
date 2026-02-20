# Ent-DNS 测试体系建立报告

**日期**: 2026-02-20
**执行**: qa-bach (James Bach 测试哲学)
**项目**: Ent-DNS Enterprise DNS Filtering Server

---

## 测试体系概览

从零建立三层测试覆盖，共 49 个 Rust 测试全部通过 + 21 个 Playwright E2E 测试用例已配置。

---

## Rust 单元测试

### 文件位置
- `/projects/ent-dns/src/dns/rules.rs` — 测试块在文件末尾 `#[cfg(test)]`
- `/projects/ent-dns/src/auth/jwt.rs` — 测试块在文件末尾
- `/projects/ent-dns/src/auth/password.rs` — 测试块在文件末尾

### 测试数量: 32 个

| 模块 | 测试数 | 覆盖场景 |
|------|--------|----------|
| `dns::rules` | 18 个 | DNS 过滤规则解析与匹配 |
| `dns::subscription` | 2 个 (pre-existing) | AdGuard/Hosts 格式解析 |
| `auth::jwt` | 6 个 | JWT 生成与验证 |
| `auth::password` | 6 个 | Argon2 密码 hash 与验证 |

### dns::rules 覆盖场景 (18 个)
- AdGuard `||domain^` 格式阻止
- 子域名级联阻止（`||example.com^` 阻止 `sub.example.com`）
- 白名单 `@@||domain^` 覆盖黑名单
- Hosts 文件格式 (`0.0.0.0 domain`, `127.0.0.1 domain`, `::1 domain`)
- 普通域名规则
- 通配符规则 (`*.ads.com`)
- 末尾点号 FQDN 标准化 (`example.com.`)
- 大小写不敏感匹配
- 批量规则加载 (`add_rules_from_str`)
- 子域名规则不影响父域名
- 只有白名单无黑名单时不阻止
- `localhost` 和 `.local` 条目跳过
- 正则规则跳过
- 裸 TLD 拒绝
- AdGuard 带选项格式 (`^$third-party`)
- stats 统计正确性
- IPv6 hosts 格式
- 深层子域名匹配

### auth 覆盖场景 (12 个)
- JWT 生成后验证 claims 正确性
- 错误 secret 验证失败
- 格式错误 token 失败
- 空 token 失败
- role 字段正确传递
- 过期时间计算正确
- 密码 hash 后验证正确密码
- 错误密码验证失败
- 同密码两次 hash 结果不同（random salt）
- 空密码的 hash 与验证
- 畸形 hash 字符串返回 false
- hash 输出是 Argon2 PHC 格式

---

## API 集成测试

### 文件位置
- `/projects/ent-dns/tests/api_integration.rs`

### 测试数量: 17 个

| 端点 | 测试场景 |
|------|----------|
| `GET /health` | 健康检查返回 200 |
| `POST /api/v1/auth/login` | 正确凭据返回 token + role |
| `POST /api/v1/auth/login` | 错误密码返回 401 |
| `POST /api/v1/auth/login` | 未知用户返回 401 |
| `POST /api/v1/auth/login` | 5 次失败后触发限速 429 |
| `POST /api/v1/auth/logout` | 总是返回成功 |
| `GET /api/v1/rules` | 无 token 返回 401 |
| `GET /api/v1/rules` | 无效 token 返回 401 |
| `GET /api/v1/rules` | 有效 token 返回规则列表 |
| `POST /api/v1/rules` | 创建规则并在列表中出现 |
| `DELETE /api/v1/rules/{id}` | 删除后从列表消失 |
| `POST /api/v1/rules` | 空规则返回 400 |
| `DELETE /api/v1/rules/{nonexistent}` | 404 响应 |
| `GET /api/v1/query-log` | 无 token 返回 401 |
| `GET /api/v1/query-log` | 有效 token 返回列表 |
| `GET /api/v1/query-log?status=blocked` | status 过滤正确 |
| `GET /api/v1/query-log?limit=2` | 分页 limit 生效 |

### 测试基础设施
- In-memory SQLite + 全量 migration
- 测试 admin 用户自动创建
- 两种模式：`oneshot`（不涉及 ConnectInfo）和 `bound server`（login 等需要真实 TCP peer）
- 生成 JWT token 直接注入，绕过 `ConnectInfo` 限制

---

## 前端 E2E 测试（Playwright）

### 文件位置
- 配置: `/projects/ent-dns/frontend/playwright.config.ts`
- Spec 文件:
  - `/projects/ent-dns/frontend/tests/e2e/auth.spec.ts`
  - `/projects/ent-dns/frontend/tests/e2e/rules.spec.ts`
  - `/projects/ent-dns/frontend/tests/e2e/query-log.spec.ts`

### Spec 文件: 3 个，共 21 个测试用例

#### auth.spec.ts (8 个测试)
- 未登录访问 `/` 重定向到 `/login`
- 未登录访问受保护路由重定向到 `/login`
- 登录页显示正确表单元素
- 错误密码显示错误提示（Sonner toast）
- 正确凭据登录后进入 Dashboard
- 空用户名提交显示提示
- 已登录：侧边栏导航可见
- 已登录：访问 /login 行为观察

#### rules.spec.ts (5 个测试)
- Rules 页面正常加载
- 规则列表区域存在
- 添加一条 AdGuard 格式规则（完整创建流程）
- 分页功能不崩溃
- 搜索过滤框功能

#### query-log.spec.ts (8 个测试)
- Query Logs 页面正常加载
- 数据表格或空状态显示
- Status 过滤器存在
- 通过 status 过滤日志
- 刷新按钮功能（如果存在）
- 无关键 JS 错误（过滤 WebSocket 连接错误）
- WebSocket 连接状态指示器
- 从侧边栏导航到 Query Logs

### 运行命令
```bash
# 需要先启动后端
cd projects/ent-dns
ENT_DNS__DNS__PORT=15353 ENT_DNS__DATABASE__PATH=/tmp/ent-dns-test.db \
ENT_DNS__AUTH__JWT_SECRET=dev-local-secret-for-development-only cargo run

# 运行 E2E 测试（另一个终端）
cd projects/ent-dns/frontend
npm run test:e2e
# 或带界面
npm run test:e2e:headed
```

---

## 发现的问题（测试过程中）

### Bug 1: `subscription.rs` 白名单规则格式错误 [已修复]
**文件**: `src/dns/subscription.rs` 第 96 行
**严重性**: Major

**描述**: `parse_adguard_rules` 函数解析白名单规则（`@@||domain^`）后，格式化输出时遗漏了末尾的 `^`：
```rust
// 修复前（Bug）
allow_rules.push(format!("@@||{}", domain.as_str()));
// 输出: @@||allowed.example.com  (缺少 ^)

// 修复后
allow_rules.push(format!("@@||{}^", domain.as_str()));
// 输出: @@||allowed.example.com^  (正确)
```

**影响**: 从远程过滤列表订阅的白名单规则无法被 `RuleSet::add_rule` 正确解析，导致白名单规则无效——即通过订阅添加的允许规则不会生效，域名仍会被阻止。

**如何发现**: 运行单元测试时，`test_parse_adguard_rules` 断言失败暴露了此 bug。

---

## 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib.rs` | 为集成测试暴露内部模块 |
| `tests/api_integration.rs` | API 集成测试（17 个测试） |
| `frontend/playwright.config.ts` | Playwright 配置 |
| `frontend/tests/e2e/auth.spec.ts` | 认证流程 E2E 测试 |
| `frontend/tests/e2e/rules.spec.ts` | 规则管理 E2E 测试 |
| `frontend/tests/e2e/query-log.spec.ts` | 查询日志 E2E 测试 |

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `Cargo.toml` | 添加 lib crate 配置 + dev-dependencies |
| `src/main.rs` | 改为从 lib crate 引用模块 |
| `src/dns/rules.rs` | 新增 11 个单元测试用例 |
| `src/dns/subscription.rs` | Bug 修复：白名单规则格式 + 已有测试现在通过 |
| `src/auth/jwt.rs` | 新增 6 个单元测试 |
| `src/auth/password.rs` | 新增 6 个单元测试 |
| `frontend/package.json` | 新增 E2E 测试脚本 |

---

## 测试覆盖评估

| 层级 | 数量 | 状态 | 说明 |
|------|------|------|------|
| Rust 单元测试 | 32 | 全部通过 | 覆盖核心业务逻辑 |
| API 集成测试 | 17 | 全部通过 | 覆盖认证 + CRUD + 限速 |
| E2E 测试 | 21 | 配置完成，需后端运行 | 覆盖主要用户流程 |

**总结**: 测试体系从零建立，在测试过程中发现并修复了 1 个 Major 级 bug（白名单规则失效）。Playwright E2E 测试配置完成，可在后端运行时通过 `npm run test:e2e` 执行。
