# Pre-Mortem: Ent-DNS 项目失败分析

**分析日期：** 2026-02-20
**分析方法：** Munger 逆向思维 + 代码审计
**总体判断：** 反对按当前路线继续推进新功能，必须先解决三个结构性炸弹

---

## 总体判断（一句话）

这个项目两年后失败的原因，不会是因为你没做 DoH/DoT，而是因为你在一个摇摇欲坠的地基上盖楼，而且你自己都没发现地基已经裂了。

---

## 一、产品层面的致命缺陷

### 缺陷 1：Client-specific upstream 是空架子

数据库里的 `clients` 表有 `upstreams` 字段，`clients.rs` handler 也能 CRUD 数据——但 `dns/handler.rs` 里的 `handle_udp()` 函数根本不读这个字段。

```rust
// handler.rs 第 86 行——它永远用全局 resolver
let response = self.resolver.resolve(&domain, qtype, &request).await?;
```

`DnsHandler` 结构体里压根没有 clients 相关的字段。换句话说，你的 UI 让用户配置了 per-client upstream，但实际 DNS 处理完全忽视了这个配置。用户发现这件事的那一刻，信任就崩了。这不是 bug，这是功能性谎言。

### 缺陷 2：Filter list 有名无实

`filter/filter.rs` 的 `reload()` 函数：它从 `custom_rules` 里加载规则，但对 `filter_lists` 里的订阅列表只是数了个数（`list_count`）。`subscription.rs` 里的 `sync_filter_list()` 确实能同步规则到 `custom_rules` 表，但这个同步是手动触发的，没有任何自动调度机制。没有 cron，没有定时器，重启后也不自动刷新。用户以为他们订阅了 AdGuard 列表，实际上除非手动点刷新，规则永远是第一次同步时的快照。

### 缺陷 3：查询日志过滤是假的

`query_log.rs` 第 44-47 行先用 `LIMIT ? OFFSET ?` 从数据库取数据，然后在内存里做过滤。注释里写得很清楚："Apply optional in-memory filters"。这意味着：

- 用户搜索 "blocked" 状态，接口先取前 100 条，再在内存里过滤，可能返回 3 条——但实际有 5000 条 blocked 记录用户看不到
- `total` 字段返回的是所有记录总数，不是过滤后的总数

这会让用户觉得数据丢失或系统有问题，然后提 issue，然后你花两天解释这是"设计如此"。

---

## 二、技术层面的定时炸弹

### 炸弹 1：SQLite 的 query_log 表是个时间炸弹

每次 DNS 查询都会写一行到 `query_log`。一个中等规模企业网络，DNS 查询量轻松达到每天 100 万次。30 天保留期 = 3000 万行。SQLite 不是为这种写入模式设计的，WAL 模式下高并发写入会出现锁争用，而且你现在的写入是 `fire-and-forget` 的 `tokio::spawn`，意味着失败是静默的：

```rust
// handler.rs 第 139-165 行
tokio::spawn(async move {
    let _ = sqlx::query(...).execute(&db).await;  // 错误被丢弃
    let _ = tx.send(event);  // 错误再次被丢弃
});
```

三个月后，你的 `ent-dns.db` 文件变成 20GB，磁盘满了，DNS 服务还在跑但日志全丢了，没有任何告警。

### 炸弹 2：UDP buffer 固定 512 字节

```rust
// server.rs 第 20 行
let mut buf = vec![0u8; 512];
```

DNS over UDP 的标准最大响应是 4096 字节（EDNS0）。固定 512 字节 buffer 意味着任何超过 512 字节的 DNS 响应都会被截断，导致解析失败。这在现代网络里不是边缘情况——DKIM 记录、复杂 TXT 记录、多 A 记录响应都会超过这个限制。当某个关键内部服务解析失败时，没人会第一时间想到是 DNS buffer 的问题，你会追查半天网络故障。

### 炸弹 3：DNS cache 完全不遵守 TTL

```rust
// cache.rs 第 12-13 行
Cache::builder()
    .max_capacity(10_000)
    .time_to_live(Duration::from_secs(300))  // 所有记录统一 5 分钟
    .build()
```

DNS 缓存应该遵守每条记录的 TTL。固定 5 分钟 TTL 意味着：
- 某些记录（TTL 60 秒）会被缓存过长，导致 DNS 变更传播延迟
- 某些记录（TTL 3600 秒）被过早淘汰，浪费上游查询
- 用户修改了某个域名的 IP，期望 1 分钟后生效，但你的系统缓存了 5 分钟

对企业用户来说，这意味着内部服务切换时会有不可预测的失效窗口。

### 炸弹 4：DoH/DoT 配置项存在但未实现

```rust
// config.rs 第 21-23 行
#[allow(dead_code)]
pub doh_enabled: bool,
#[allow(dead_code)]
pub dot_enabled: bool,
```

`#[allow(dead_code)]` 是诚实的标注，但它说明这两个功能是装饰性配置。如果你把这些展示给潜在用户，这就是虚假宣传。

---

## 三、竞争层面的盲点

团队最危险的假设是：**"我们用 Rust 写，所以性能更好。"**

Pi-hole 和 AdGuard Home 的护城河不是性能，是生态。

- **AdGuard Home** 有几十万用户贡献的过滤规则、社区经验、Docker 镜像、Home Assistant 集成、大量的调试文档
- **Pi-hole** 有 Pi-hole FTL（用 C 写的，性能够用），更重要的是它有十年积累的教程、Reddit 社区、和家庭路由器生态

你的 Rust 后端在性能上比 AdGuard Home 快多少？根据代码看，你的 DNS 处理链是：
UDP 接收 → filter 检查（RwLock 加读锁）→ cache 检查（moka 异步查询）→ 上游解析 → 写日志（spawn）

AdGuard Home 的相同路径经过了多年优化。在实际网络条件下，上游 DNS 延迟（50-200ms）完全掩盖了你的 Rust 性能优势。用户感受不到差距。

**你被低估的真正竞争优势是什么？** 目前从代码里看不出来。"Rust 写的"不是差异化，是实现细节。

---

## 四、被过度乐观估计的假设

### 假设 1："企业级"定位但缺少企业级必需品

"企业级"意味着：
- HA（高可用）：单点 SQLite，挂了就全挂
- 审计合规：`audit_log` 有，但 `query_log` 没有数据保留策略的实际执行（`settings` 表里有 `query_log_retention_days` 但没有任何地方在执行清理）
- 备份恢复：`backup.rs` 里是什么？没看，但如果不是可靠的热备份，就是装饰品

### 假设 2："RBAC 已完成"

RBAC 在 API 层做了 `AdminUser` extractor，但 RBAC 的核心不是鉴权，是授权矩阵。`operator` 角色和 `read_only` 角色有什么具体的权限差异？代码里只有 `AuthUser`（登录用户）和 `AdminUser`（admin/super_admin）两层，中间的粒度是缺失的。

### 假设 3："SQLite 够用"

对于家庭/小团队场景，够。对于企业场景，SQLite 的单写者模型在高并发日志写入下是瓶颈。你没有做任何测试来验证这个假设。

---

## 五、逆向建议：下个 Milestone 前必须做到的 2-3 件事

### 第一：不要做新功能。先让现有功能诚实地工作。

- 要么把 client-specific upstream 在 DNS 处理层实现（修改 `DnsHandler` 读取 clients 配置），要么从 UI 上移除这个功能。现在是承诺了但没兑现。
- 把 query_log 的过滤逻辑移到 SQL 层，不要在内存里过滤之后再分页
- 把 filter list 的自动刷新调度实现了（tokio 定时器，每 24 小时），否则这个功能是假的

### 第二：修复 UDP 512 字节 buffer 和 TTL 不一致的问题。

这两个是会在生产环境里造成真实故障的技术炸弹。在真实企业环境里，任何一个都可能导致关键服务解析失败，进而让你的产品被下线。

### 第三：在搭建任何多租户/DoH/DoT 之前，先定义一个真实用户场景并验证。

"有人愿意把 Ent-DNS 替换掉他们已经在用的 AdGuard Home/Pi-hole" 这个假设——你有没有真实用户验证过？如果没有，你正在为一个想象中的客户构建功能。

---

## 结论

这个项目的代码质量不差，Rust 选型合理，基础架构思路清晰。但它现在是一个 **前端骗人的状态**：UI 上有漂亮的功能列表，但背后有三处"声称能做但实际不做"的功能（client upstream、filter list 自动更新、query log 过滤），加上两个会在生产环境炸掉的技术缺陷（UDP buffer、cache TTL）。

在你把这个展示给任何企业用户之前，先把现有功能的谎言修掉。

*Munger 的教训：复杂不是深度，掩盖不是功能。如果你不能清楚说出"这件事在哪行代码里实现了"，那件事就没实现。*
