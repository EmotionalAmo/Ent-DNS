# ADR: Ent-DNS 架构评估备忘录

**日期**: 2026-02-20
**作者**: CTO (Werner Vogels 思维模型)
**状态**: 已批准
**版本**: v1.0

---

## 背景

基于对 Ent-DNS 完整源代码的审查（约 4,547 行 Rust + React 前端），本备忘录给出当前架构的客观评估，并提出接下来的技术投资优先级。

---

## 1. 当前架构评分

### 可靠性：7/10

**优点：**
- DNS 查询路径完全异步（`tokio::spawn` per-packet），单包阻塞不影响整体吞吐
- `broadcast::Sender` 实现 DNS 引擎与 API 层解耦，WebSocket 广播无阻塞
- `log_query` 采用 fire-and-forget 模式，DB 写入不在 DNS 关键路径上
- 配置验证在启动时强制检查 JWT secret，拒绝默认值

**扣分项：**
- UDP 缓冲区固定 512 字节（`buf = vec![0u8; 512]`），超出的 DNS 响应被静默截断，没有 TCP fallback
- `DnsCache` TTL 硬编码 300 秒，未遵循上游响应的真实 TTL 值，可能缓存过期数据
- `FilterEngine::reload()` 期间持有写锁，规则数万条时会造成 DNS 处理短暂停顿（写锁阻塞所有读）
- 没有上游故障转移逻辑：resolver 挂了直接返回错误，没有 retry/fallback

### 可扩展性：5/10

**优点：**
- 无状态 HTTP API 层，理论上可以多实例
- `Arc<FilterEngine>` + `Arc<DnsCache>` 内存共享结构合理

**扣分项：**
- SQLite 是单一写入点，query_log 高频写入（每次 DNS 查询都写一条）会成为第一个瓶颈
- `subscription.rs` 同步远程规则时逐条 INSERT，10 万规则的列表会产生 10 万次 DB 操作
- DNS 缓存是进程内的（moka），多实例无法共享缓存，缓存命中率线性下降
- metrics 是进程内 AtomicU64，重启即清零，多实例数据无法聚合

### 可维护性：8/10

**优点：**
- 模块边界清晰：`api/`、`dns/`、`auth/`、`db/`、`metrics/` 各司其职
- RuleSet、FilterEngine、DnsHandler 三层分离，业务逻辑独立可测
- 单元测试覆盖核心规则解析（rules.rs、subscription.rs 各有 test 模块）
- 配置通过环境变量注入，12-Factor 兼容

**扣分项：**
- `dns/handler.rs` 的 `log_query` 同时承担 DB 写入和 WebSocket 广播两个职责，违反 SRP
- `filter.rs` 中远程规则列表的 rule count 仅统计本 list，`is_blocked` 路径不区分命中来源
- 前端 API 类型定义与后端 Response 结构依赖人工对齐，没有代码生成保障

---

## 2. 最紧迫的技术投资（接下来 2-3 个 Sprint）

### Sprint 1：修复两个隐性可靠性炸弹

**P0: DNS TCP Fallback**

当前 `server.rs` 只监听 UDP，缓冲区固定 512 字节。RFC 1035 规定：当响应超过 512 字节时，服务端应在响应中设置 TC (TruncateD) 标志，客户端必须切换到 TCP 重试。DNSSEC 响应、MX 记录等场景必然超限。

行动：增加 TCP 监听器，复用同一个 `DnsHandler`。Tokio 的 `TcpListener` + 2 字节长度前缀帧解析，改动量约 80 行。

**P1: 缓存 TTL 来自上游响应**

`DnsCache::set()` 当前忽略上游返回的 TTL，硬编码 300 秒。这会导致缓存结果比实际 DNS 记录更新慢，影响动态 DNS 场景的正确性。

行动：解析上游 `Message` 中 answer records 的 TTL，取最小值作为 cache TTL 上限。

### Sprint 2：query_log 写入降压

**P1: 批量写入 + 异步队列**

当前每次 DNS 查询触发一次 SQLite INSERT，1000 QPS 场景下产生 1000 TPS 的 DB 写入，SQLite WAL 模式下约 2000-3000 TPS 触顶。

行动：在 `DnsHandler` 内引入 `tokio::sync::mpsc` channel，聚合 100 条或 100ms（取先到者）批量 INSERT。这个改动把写入压力降低约 100x，且对查询路径零影响。

### Sprint 3：rate limiting（安全优先级 P0）

当前 DNS server 对来源 IP 没有任何流量限制，单个客户端可以任意 QPS 查询，存在：
- DDoS amplification 风险（DNS 是经典的 amplification 攻击向量）
- 规则引擎 CPU 耗尽风险

行动：引入 per-source-IP 的令牌桶（`governor` crate），在 `server.rs` 的 recv 循环中前置检查。默认限制：1000 QPS/IP，可配置。

---

## 3. 架构演进路径（面向 100 节点部署）

### 阶段一：单机优化（当前 - 3 个月）

目标：单实例能抗住 5000+ QPS，支持 50 并发管理员。

关键动作：
- query_log 批量写入（Sprint 2）
- SQLite 开启 WAL 模式 + `PRAGMA synchronous = NORMAL`（改动 1 行，吞吐 3x）
- query_log 表增加按时间分区的定期清理（超过 7 天自动删除）

### 阶段二：多节点协同（3-12 个月，真正需要时）

100 个节点部署意味着 100 个独立的 Ent-DNS 实例，不是一个集群。这是 DNS 的天然特性——每个节点独立解析、独立缓存。

架构调整：
- 引入中央配置存储（PostgreSQL 或 Cloudflare KV），规则/黑名单从中央拉取
- 各节点仍用本地 SQLite 存 query_log，中央聚合层（ClickHouse 或 Loki）收集日志
- Prometheus 各节点暴露 `/metrics`，Grafana 联邦聚合
- 配置变更通过 webhook/polling 推送到各节点（现有 reload() 机制已可用）

### 阶段三：禁止提前做的事

- 不要把 SQLite 换成 PostgreSQL，除非真正遇到写入瓶颈
- 不要做 DNS 集群（DNS 天然分布式，不需要共享状态）
- 不要引入 Redis 缓存层，进程内 moka 对单节点已经足够
- 不要拆分微服务，DNS 引擎 + 管理 API 合并一个进程是正确的架构

---

## 4. 技术风险矩阵

### 安全维度

| 风险 | 严重度 | 当前状态 | 缓解措施 |
|------|--------|----------|----------|
| DNS Amplification 攻击 | 高 | 无防护 | rate limiting（Sprint 3 P0） |
| 远程规则列表 SSRF | 中 | 未检查 IP 范围 | 过滤私有 IP 目标 URL |
| JWT secret 默认值 | 高 | 已在 config.rs 强制校验 | 已缓解 |
| query_log 信息泄露 | 中 | 所有 admin 可见全部日志 | 考虑按 client 过滤 RBAC |

最高优先级安全风险：**DNS Amplification**。Ent-DNS 作为开放 DNS resolver，如果部署在公网且无 ACL，任何人都可以利用它放大 DDoS 流量。`dns/acl.rs` 文件存在但当前为 36 行骨架代码，需要补全 source IP 白名单逻辑。

### 性能维度

| 风险 | 触发阈值 | 症状 |
|------|----------|------|
| SQLite 写入瓶颈 | ~500 QPS 持续 | query_log 写入积压，tokio task 堆积 |
| FilterEngine 写锁 | 规则重载时 | DNS 查询 p99 延迟 spike |
| DnsCache 内存 | 10,000 条容量满 | moka 自动淘汰，缓存命中率下降 |

### 可靠性维度

- **上游 DoH 故障**：当前 resolver 未实现多 upstream 轮询，Cloudflare 或 Google DoH 宕机时所有查询失败。这是当前最高可靠性风险。需要在 `resolver.rs` 实现 primary/fallback 机制。

---

## 决策结论

当前架构选型正确：Rust 的零成本抽象使得 DNS 关键路径性能优秀，Axum + tokio 异步模型架构合理，SQLite 对于目标场景（企业内网 DNS）在单机 500 QPS 以内是完全够用的 boring technology 选择。

**不要重构，要补全。** 架构骨架健康，缺失的是：TCP fallback、TTL 正确性、rate limiting、上游故障转移。这四件事把可靠性从 7 分推到 9 分。

**下一步行动**：由 `fullstack-dhh` 在 Sprint 1 实现 TCP fallback + TTL 修复，Sprint 2 实现 query_log 批量写入。
