# 技术评审报告 — Ent-DNS CTO Review

**日期：** 2026-02-20
**评审人：** Werner Vogels (CTO Agent)
**状态：** P0 阻断项存在，禁止生产部署

---

## 一、技术风险排序

### P0 — 生产直接崩溃

**Migration 006 版本号冲突**

`006_client_groups.sql` 和 `006_default_query_log_templates.sql` 同时存在。`sqlx::migrate!` 按文件名字典序处理，遇到重复版本号会在启动时 panic。这是确定性崩溃，不是潜在风险。任何新环境（CI、容器、生产部署）都无法启动。

修复：将 `006_default_query_log_templates.sql` 重命名为 `007_default_query_log_templates.sql`。
注意：该文件内容与 `005_query_log_templates.sql` 末尾的 `INSERT OR IGNORE` 存在重复数据，需确认 `INSERT` 使用 `OR IGNORE` 策略，否则主键冲突会让 migration 失败。

---

### P1 — 功能性完全失效

**客户端分组规则引擎未集成到 DNS handler**

`handler.rs` 的 `resolve_client_config()` 函数当前实现：

```rust
// 只查 clients 表，完全忽略分组逻辑
"SELECT identifiers, filter_enabled, upstreams FROM clients"
```

`client_group_memberships` 和 `client_group_rules` 两张表从未被查询。这意味着：
- 前端 ClientGroups 页面的所有配置对 DNS 解析无效
- 所有分组 API 端点的数据在解析层是死数据
- 用户配置的组规则不会影响任何实际查询行为

这不是 Bug，是架构层的功能缺失。

---

### P2 — 运维风险

**Dockerfile Rust 版本不匹配**

`Dockerfile` 使用 `rust:1.82-slim`，但 `MEMORY.md` 声明项目需要 Rust 1.93+。不一致的构建环境会在 Docker 构建时暴露编译失败，且本地开发环境无法复现，排查成本高。

修复：`FROM rust:1.82-slim AS builder` 改为 `FROM rust:1.93-slim AS builder`。

---

### P3 — 功能待激活

**DoH 端点被禁用**

`doh.rs.disabled` 的实现质量合格（边界检查、RFC 8484 Content-Type、65535 字节限制均正确实现），仅需挂载路由即可激活。属于功能特性，不影响核心 DNS 运行。

---

## 二、架构决策：分组规则合并逻辑

### 设计原则

三级优先级：客户端专属配置 > 所属分组规则 > 全局默认。

### 推荐方案：单次 JOIN + 现有 moka cache

不引入新依赖。利用现有 `client_config_cache`（4096 容量，60s TTL）覆盖性能需求。

**分组查询 SQL（扩展到 `resolve_client_config()` 中）：**

```sql
SELECT cgr.rule_id, cgr.rule_type, cg.priority, c.filter_enabled, c.upstreams
FROM client_group_memberships m
JOIN client_group_rules cgr ON m.group_id = cgr.group_id
JOIN client_groups cg ON cg.id = m.group_id
WHERE m.client_id = ?
ORDER BY cg.priority ASC, cgr.priority ASC
```

**合并逻辑（优先级从高到低）：**

1. `filter_enabled`：取客户端专属配置（如存在）；否则取所属最高优先级分组的配置
2. `upstreams`：取客户端专属 upstream（如存在）；否则取所属最高优先级分组的 upstream
3. 规则集：取所有匹配分组规则的并集（MVP 阶段）

**不推荐**在 DNS hot path 中做内存规则集合并计算。60s cache TTL 已经足够，避免过早优化。

**MVP 范围（建议 Round 11）：** 只集成 `filter_enabled` 和 `upstreams` 的分组继承，规则集细粒度控制放第二个 iteration。

---

## 三、具体修改步骤

| 步骤 | 文件 | 改动内容 | 优先级 | 工时估算 |
|------|------|----------|--------|----------|
| 1 | `src/db/migrations/006_default_query_log_templates.sql` | 重命名为 `007_*.sql` | P0 | 5 分钟 |
| 2 | `src/dns/handler.rs` → `resolve_client_config()` | 追加分组查询逻辑，合并 filter_enabled + upstreams | P1 | 2-3 小时 |
| 3 | `Dockerfile` 第 2 行 | `rust:1.82-slim` → `rust:1.93-slim` | P2 | 1 分钟 |
| 4 | `handlers/mod.rs` + `router.rs` + 重命名 `doh.rs.disabled` | 取消 DoH 路由注释，激活端点 | P3 | 15 分钟 |

---

## 四、核心结论

按 "Everything Fails, All the Time" 原则评估：

- Migration 冲突在生产部署第一分钟触发，属于确定性故障
- 分组规则引擎缺失是对用户的功能承诺违约，当前系统对用户展示了分组管理 UI，但在 DNS 层完全无效
- Dockerfile 版本不一致是定时炸弹，在 CI 构建时才会暴露

**行动顺序：** Migration 修复 → handler.rs 分组集成 → Dockerfile 修复 → DoH 激活

---

*CTO Agent — Werner Vogels*
*输出路径：`docs/cto/tech-review-2026-02-20.md`*
