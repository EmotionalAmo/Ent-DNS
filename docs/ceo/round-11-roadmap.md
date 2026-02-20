# Ent-DNS Round 11 战略路线图

**日期：** 2026-02-20
**作者：** CEO (Jeff Bezos)

---

## 产品定位

企业局域网自托管 DNS 网关 — 比 Pi-hole 更强的分组策略，比 AdGuard Home 更轻的运维负担。

---

## 当前可交付状态评估

**v1.0 尚未 Ready。** 核心障碍不是功能缺失，是已有功能不闭环：

- 客户端分组 UI 完整，但 DNS 引擎完全忽略分组规则 — 用户建了分组，一点效果没有，这是产品欺骗。
- 迁移文件版本号冲突（两个 `006_`），导致 sqlx 拒绝启动 — 新部署零成功率。
- Dockerfile 用 rust:1.82，实际需要 1.93 — Docker 部署构建必然失败。

上述三条任何一条单独存在，都是 launch blocker。三条同时存在，意味着当前 main branch 无法被任何新用户成功部署和使用。

---

## 优先级任务列表（2 周内）

### P0 — 修复硬阻塞，让产品能跑起来

**P0-1：迁移冲突修复**
将 `006_default_query_log_templates.sql` 重命名为 `007_`，验证 `sqlx migrate run` 全量通过。1 小时内可完成。

**P0-2：Dockerfile rust 版本对齐**
`rust:1.82-slim` → `rust:1.93-slim`，构建验证。30 分钟内可完成。

**P0-3：客户端分组规则引擎集成（核心）**
DNS handler 的 `get_client_config()` 当前只查 `clients` 表。需要：
1. 按客户端 IP 查 `client_group_memberships` → 找到所属分组
2. 按分组 `priority` 排序，取最高优先级分组的规则
3. 将分组规则（allow/block list）注入过滤逻辑

这是 Round 11 的主体工作，预计 3-4 天。

### P1 — 让已有功能可信赖

**P1-1：DoH 启用**
`doh.rs.disabled` 已写好，修复编译错误后启用。AdGuard Home 的核心差异化之一，现代浏览器默认走 DoH。预计 1 天。

**P1-2：端到端集成测试**
分组规则生效后，补充测试：创建分组 → 绑定客户端 → 绑定 block rule → dig 验证被拦截。防止下一轮又回归。

### P2 — 后续迭代

- DNS-over-TLS（DoT）支持
- 分组规则的继承/覆盖模型（子分组）
- 性能压测（>10k clients 场景）

---

## Round 11 成功标准

1. `docker compose up` 在全新环境一次成功，访问 UI 正常
2. 创建客户端分组、绑定 IP、设置 block rule 后，`dig` 验证该 IP 的请求确实被拦截
3. DoH 端点 `https://<host>/dns-query` 可用，通过 Firefox DoH 测试
4. 无迁移版本冲突，`sqlx migrate` 幂等运行无报错

**一句话标准：Round 11 结束时，一个运维工程师能在 10 分钟内从零部署并验证客户端分组策略生效。**
