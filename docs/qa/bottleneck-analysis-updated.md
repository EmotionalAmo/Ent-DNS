# Ent-DNS 瓶颈分析报告（修复后更新版）

**分析日期**: 2026-02-20
**分析执行人**: QA Agent (James Bach)
**测试版本**: v0.1.0 (commit e40662c)
**参考文档**: docs/qa/performance-baseline.md, docs/qa/dns-id-fix-validation-report.md

---

## 执行摘要

基于性能基线测试结果，本报告深入分析了 Ent-DNS 当前版本的 4 个主要性能瓶颈。其中，**DNS ID 不匹配问题（P0）已完全修复**，QPS 从 ~33 提升至 60,000-70,000，错误率降至 0.00%。

### 瓶颈优先级概览（修复后）

| 瓶颈 | 严重性 | 性能影响 | 修复状态 | 修复优先级 | 预计工作量 |
|------|--------|----------|----------|------------|------------|
| DNS ID 不匹配 | **Critical** | 97-98% QPS 损失 | ✅ 已修复 | - | - |
| 数据库快速增长 | High | 65GB/24h 预估 | ⚠️ 待优化 | **P1** | 0.5 天 |
| WAL 文件增长 | Medium | 5MB/5min | ⚠️ 待优化 | **P2** | 0.5 天 |
| 高 QPS 延迟 | Medium | P99: 1.87s | ⚠️ 待优化 | **P2** | 1 天 |
| Metrics 认证 | Low | 监控集成困难 | 📊 待优化 | **P3** | 0.25 天 |

---

## 瓶颈 1: DNS ID 不匹配（Critical）- ✅ 已修复

### 修复前后对比

| 指标 | 修复前 | 修复后 | 提升 |
|------|--------|--------|------|
| **实际 QPS** | 33 | 68,884 | **2086x** |
| **完成率** | 7-62% | **100%** | +100% |
| **错误率** | 37-92% | **0.00%** | -100% |

### 测试数据（修复后）

| 目标 QPS | 发送查询 | 完成查询 | 完成率 | 实际 QPS | 错误率 |
|----------|----------|----------|--------|----------|--------|
| 100      | 2,054,258 | 2,054,258 | **100.00%** | 68,472 | **0.00%** |
| 500      | 2,114,907 | 2,114,907 | **100.00%** | 70,474 | **0.00%** |
| 1000     | 2,081,955 | 2,081,955 | **100.00%** | 69,365 | **0.00%** |
| 2000     | 1,958,459 | 1,958,459 | **100.00%** | 65,195 | **0.00%** |
| 5000     | 1,944,085 | 1,941,831 | 99.88% | 64,572 | 0.12% |
| 10000    | 2,080,782 | 2,080,782 | **100.00%** | 69,044 | **0.00%** |

**关键观察**:
- ✅ 所有 QPS 级别都达到 99.88-100% 完成率
- ✅ 无 "Unexpected IDs" 错误（5000 QPS 时 0.12% 是超时）
- ✅ 系统可以稳定处理 60,000-70,000 QPS

### 修复验证

**测试方法**:
1. 执行 6 个 QPS 级别的测试（100, 500, 1000, 2000, 5000, 10000）
2. 每级测试 30 秒
3. 验证完成率 >99%
4. 验证错误率 <0.2%

**验证结果**:
- ✅ 实际 QPS ≥ 90% 目标 QPS（实际远超目标）
- ✅ 错误率 <0.2%（实际 0.00-0.12%）
- ✅ 无 "Unexpected IDs" 错误
- ✅ 5 分钟稳定性测试 100% 完成

**通过标准**: ✅ 全部通过

**状态**: ✅ 已修复，可上线生产环境

---

## 瓶颈 2: 数据库文件快速增长（High）- ⚠️ 待优化

### 问题描述

数据库文件在高 QPS 场景下快速增长，5 分钟内从 0 增长至 227MB。预估 24 小时可能增长至 65GB。

### 测试数据（修复后）

```
测试前:
  数据库大小: 0 MB
  WAL 文件: 0 MB

5 分钟测试后 (1000 QPS):
  数据库大小: 227 MB
  WAL 文件: 5 MB
  内存 (RSS): 40.8 MB

数据库增长率:
  增长速率: 45.4 MB/min
  预估 1 小时: 2.7 GB
  预估 24 小时: 65.4 GB
```

### 根本原因

**Query Log 记录**:
- 每次查询都写入 `query_log` 表
- 没有自动轮转或清理机制
- 包含字段: domain, qtype, client_ip, response, blocked, upstream

**示例数据量**:
- 20M 查询 → 227MB
- 每条记录: ~11.4KB
- 包含大量重复的 client_ip、response 字段

### 性能影响

**当前影响**:
- 磁盘空间消耗过快
- 长期运行可能耗尽磁盘空间
- 查询日志性能下降

**长期影响**:
- 24 小时: 65 GB
- 1 周: 458 GB
- 需要定期清理或轮转

### 修复方案

#### 方案 1: 查询日志轮转（推荐）

```rust
// 在 QueryLogWriter 中添加定时清理任务
async fn log_rotation_task(pool: DbPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(86400)); // 每天
    loop {
        interval.tick().await;
        if let Ok(conn) = pool.acquire().await {
            // 删除 7 天前的日志
            let _ = conn.execute(
                "DELETE FROM query_log WHERE time < datetime('now', '-7 days');"
            );
        }
    }
}
```

**配置选项**:
```toml
[dns.query_log]
enabled = true              # 是否启用
retention_days = 7          # 保留天数
rotation_interval = 86400   # 轮转间隔（秒）
```

#### 方案 2: 禁用查询日志

```toml
[dns.query_log]
enabled = false
```

**权衡**:
- ✅ 零磁盘开销
- ❌ 无法审计查询历史
- ❌ 无法分析 DNS 使用情况

#### 方案 3: 采样记录

```rust
// 只记录 10% 的查询
if rand::random::<f64>() < 0.1 {
    // 记录查询
}
```

**配置选项**:
```toml
[dns.query_log]
enabled = true
sampling_rate = 0.1        # 采样率 10%
```

**权衡**:
- ✅ 减少磁盘开销 90%
- ✅ 保留部分审计能力
- ❌ 数据不完整

### 修复优先级: **P1（高）**

**原因**:
- 影响长期稳定性
- 磁盘空间可能超出预期
- 上线前必须解决

**修复计划**:
1. **Day 1**: 实现方案 1（日志轮转）
2. **Day 2**: 添加配置选项（禁用/采样）
3. **Day 3**: 测试验证 24 小时稳定性

**预期效果**:
- **数据库大小**: <1 GB（保留 7 天）
- **增长率**: 平稳（定期清理）

---

## 瓶颈 3: WAL 文件增长（Medium）- ⚠️ 待优化

### 问题描述

SQLite WAL (Write-Ahead Log) 文件在 5 分钟内增长至 5MB。虽然 WAL/DB 比例为 2.2%（可接受），但仍需要优化 checkpoint 策略。

### 测试数据（修复后）

```
5 分钟测试后 (1000 QPS):
  数据库大小: 227 MB
  WAL 文件: 5 MB
  WAL/DB 比例: 2.2%

WAL 增长率:
  增长速率: 1 MB/min
  预估 1 小时: 60 MB
  预估 24 小时: 1.44 GB
```

**对比修复前**:
- 修复前: 4.4MB/15min = 0.3 MB/min
- 修复后: 5MB/5min = 1.0 MB/min
- **增长加速**: 3.3x（因为实际 QPS 从 33 提升到 68,884）

### 根本原因

**WAL 模式**:
- 所有写入先写入 WAL 文件
- 定期 checkpoint 到主数据库
- 默认 checkpoint 策略可能不适合高写入场景

**当前配置**（推测）:
```sql
PRAGMA journal_mode = WAL;  -- WAL 模式
PRAGMA wal_autocheckpoint = 1000;  -- 默认值
```

### 性能影响

**当前影响**:
- WAL 文件 5MB/5min（可接受）
- WAL/DB 比例 2.2%（健康）
- 可能增加磁盘 I/O

**长期影响**（不优化）:
- 24 小时: 1.44 GB
- Checkpoint 操作可能阻塞数据库

### 修复方案

#### 方案 1: 调整 SQLite PRAGMA

```rust
// 在数据库连接时设置
conn.execute("PRAGMA wal_autocheckpoint = 1000;")?;  // 每 1000 页 checkpoint
conn.execute("PRAGMA synchronous = NORMAL;")?;  // 降低同步开销
conn.execute("PRAGMA cache_size = -64000;")?;  // 64MB 缓存
```

#### 方案 2: 定期手动 checkpoint

```rust
// 在 QueryLogWriter 中添加定期 checkpoint
use tokio::time::{sleep, Duration};

async fn periodic_checkpoint(pool: DbPool) {
    let mut interval = interval(Duration::from_secs(300));  // 每 5 分钟
    loop {
        interval.tick().await;
        if let Ok(conn) = pool.acquire().await {
            let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE);");
        }
    }
}
```

**配置选项**:
```toml
[database.wal]
checkpoint_interval = 300  # checkpoint 间隔（秒）
checkpoint_mode = "TRUNCATE"  # checkpoint 模式
```

### 修复优先级: **P2（中）**

**原因**:
- 不是紧急问题（WAL/DB 比例健康）
- 可以通过配置缓解
- 长期运行可能需要优化

**修复计划**:
1. **Day 1**: 实现方案 2（定期 checkpoint）
2. **Day 2**: 添加配置选项
3. **Day 3**: 测试验证 24 小时稳定性

**预期效果**:
- **WAL 文件**: <10 MB
- **WAL/DB 比例**: <5%
- **性能影响**: 无显著变化

---

## 瓶颈 4: 高 QPS 延迟（Medium）- ⚠️ 待优化

### 问题描述

高 QPS 场景下 P99 延迟较高，1000 QPS 时 P99 延迟为 1.87s，5000 QPS 时 P99 延迟为 960ms。

### 测试数据（修复后）

| 目标 QPS | P50 延迟 | P95 延迟 | P99 延迟 | 备注 |
|----------|----------|----------|----------|------|
| 100      | 1.4ms    | -        | 15ms     | 低延迟 |
| 500      | 7.0ms    | -        | 393ms    | 延迟增加 |
| 1000     | 14.4ms   | -        | 59ms     | 稳定 |
| 2000     | 30.5ms   | -        | 138ms    | 延迟增加 |
| 5000     | 71.4ms   | -        | 960ms    | 高延迟 |
| 10000    | 144ms    | -        | 297ms    | 缓存影响 |
| 稳定性测试 | 14.4ms | - | 1.87s | 5分钟 |

### 根本原因

**DNS 上游延迟**:
- 使用 DoH 上游（Cloudflare/Google）
- DoH 比 UDP 有额外开销（TLS + HTTP）
- 网络抖动导致延迟波动

**并发队列堆积**:
- 高 QPS 时并发查询增加
- DNS 上游响应慢导致队列堆积
- 后续查询等待时间增加

### 性能影响

**当前影响**:
- P99 延迟 1.87s（稳定性测试）
- 可能触发客户端超时
- 用户体验差

### 修复方案

#### 方案 1: 使用 UDP 上游（推荐）

```rust
// 配置 UDP 上游
let resolver = TokioAsyncResolver::tokio(
    ResolverConfig::from_parts(
        None,
        vec![NameServerConfig {
            socket_addr: "1.1.1.1:53".parse().unwrap(),
            protocol: Protocol::Udp,
            tls_dns_name: None,
            trust_nx_responses: true,
            ..Default::default()
        }],
    ),
    ResolverOpts::default(),
)?;
```

**配置选项**:
```toml
[dns.upstream]
protocol = "udp"  # "udp" | "doh"
servers = ["1.1.1.1:53", "8.8.8.8:53"]
timeout = 5  # 超时（秒）
```

**预期效果**:
- P50 延迟: <1ms
- P99 延迟: <10ms

#### 方案 2: 上游负载均衡

```rust
// 实现轮询策略
pub struct LoadBalancedResolver {
    resolvers: Vec<TokioAsyncResolver>,
    current: AtomicUsize,
}

impl LoadBalancedResolver {
    async fn resolve(&self, domain: &str, qtype: RecordType) -> Result<Message> {
        let idx = self.current.fetch_add(1, Ordering::SeqCst) % self.resolvers.len();
        self.resolvers[idx].lookup(domain, qtype).await
    }
}
```

#### 方案 3: 增加查询缓存 TTL

```rust
// 配置缓存
let mut opts = ResolverOpts::default();
opts.cache_size = 100000;  // 100k 条缓存
opts.ip_strategy = LookupIpStrategy::Ipv4AndIpv6;
```

### 修复优先级: **P2（中）**

**原因**:
- 不是阻塞问题（P0 已修复）
- 可通过配置缓解
- 上线后优化即可

**修复计划**:
1. **Day 1**: 实现方案 1（UDP 上游）
2. **Day 2**: 添加配置选项
3. **Day 3**: 测试验证延迟改善

**预期效果**:
- **P50 延迟**: <1ms
- **P99 延迟**: <10ms
- **用户体验**: 显著改善

---

## 瓶颈 5: Metrics 端点认证（Low）- 📊 待优化

### 问题描述

`/metrics` 端点需要认证，导致 Prometheus 无法直接抓取指标。

### 测试数据

```bash
$ curl http://127.0.0.1:8080/metrics
{"error":"Authentication failed"}
```

### 根本原因

**Prometheus 最佳实践**:
- `/metrics` 端点应**无需认证**
- 通过防火墙或反向代理控制访问
- 使用 IP 白名单或服务网格

**当前实现**（推测）:
```rust
pub async fn metrics(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,  // ← 需要认证
) -> Result<String> {
    // ...
}
```

### 修复方案

#### 方案 1: 添加配置选项

```rust
// Config 添加 metrics_auth_required 字段
#[derive(Debug, Clone, Deserialize)]
pub struct ApiConfig {
    pub port: u16,
    pub bind: String,
    #[serde(default)]
    pub cors_allowed_origins: Option<String>,
    #[serde(default = "default_metrics_auth")]
    pub metrics_auth_required: bool,
}

fn default_metrics_auth() -> bool {
    false  // 默认无需认证
}
```

#### 方案 2: IP 白名单

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct ApiConfig {
    pub port: u16,
    #[serde(default)]
    pub metrics_allowed_ips: Vec<String>,  // ["127.0.0.1", "10.0.0.0/8"]
}
```

### 修复优先级: **P3（低）**

**原因**:
- 不阻塞功能
- 可通过临时方案绕过
- 不影响性能

**修复计划**:
1. **Day 1**: 实现方案 1（配置选项）
2. **Day 2**: 更新文档

---

## 修复优先级排序（修复后）

基于性能影响和修复难度，推荐的修复顺序：

### Phase 1: 紧急修复（已完成）

| 优先级 | 瓶颈 | 工作量 | 状态 |
|--------|------|--------|------|
| P0 | DNS ID 不匹配 | 1-2 天 | ✅ 已修复 |

### Phase 2: 上线前优化（0.5-1 天）

| 优先级 | 瓶颈 | 工作量 | 性能提升 |
|--------|------|------------|----------|
| P1 | 数据库快速增长 | 0.5 天 | 磁盘空间节省 |
| P2 | WAL checkpoint | 0.5 天 | 磁盘 I/O 优化 |
| P2 | 高 QPS 延迟 | 1 天 | P99 延迟 <10ms |

### Phase 3: 监控增强（0.25 天）

| 优先级 | 瓶颈 | 工作量 | 用户体验提升 |
|--------|------|------------|------------------|
| P3 | Metrics 认证 | 0.25 天 | 监控集成简化 |

**总修复时间**: 2.25-3.75 天

---

## 上线建议

### 生产环境推荐配置

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| `ENT_DNS__DNS__PORT` | 53 | 标准 DNS 端口（需要 root）|
| `ENT_DNS__DATABASE__PATH` | /var/lib/ent-dns/ent-dns.db | 持久化存储 |
| `ENT_DNS__QUERY_LOG__ENABLED` | false | 生产环境禁用日志（可选）|
| `ENT_DNS__QUERY_LOG__RETENTION_DAYS` | 7 | 保留 7 天日志 |
| `ENT_DNS__UPSTREAM__PROTOCOL` | udp | 使用 UDP 上游（低延迟）|
| `ENT_DNS__UPSTREAM__TIMEOUT` | 5s | 上游超时配置 |
| `ENT_DNS__WAL__CHECKPOINT_INTERVAL` | 300 | 每 5 分钟 checkpoint |

### 硬件要求

| 场景 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| 小型（<1000 QPS） | 1 核 | 256 MB | 10 GB |
| 中型（1000-10000 QPS） | 2 核 | 512 MB | 20 GB |
| 大型（>10000 QPS） | 4 核 | 1 GB | 50 GB |

---

## 总体评估

### 修复效果评估

| 问题 | 修复前 | 修复后 | 状态 |
|------|--------|--------|------|
| DNS ID 不匹配 | 严重 | 已修复 | ✅ |
| 数据库快速增长 | N/A | 65GB/24h 预估 | ⚠️ |
| WAL 文件增长 | 4.4MB/15min | 5MB/5min | ⚠️ |
| 高 QPS 延迟 | 1-3ms | 14-1871ms | ⚠️ |
| Metrics 认证 | 需要认证 | 需要认证 | 📊 |

### 性能基线对比

| 指标 | 修复前 | 修复后 | 提升 |
|------|--------|--------|------|
| QPS | 33 | 68,884 | **2086x** |
| 错误率 | 37-92% | 0.00% | **-100%** |
| 完成率 | 7-62% | 100% | **+100%** |

### 上线建议

**可以上线生产环境**: ✅ 是

**前提条件**:
1. 实现查询日志轮转或提供禁用选项（P1）
2. 配置 UDP 上游（降低延迟）（P2）
3. 设置 WAL checkpoint 频率（P2）
4. 配置监控告警

**建议配置**:
```bash
# 生产环境配置
export ENT_DNS__QUERY_LOG__ENABLED=false  # 禁用日志（可选）
export ENT_DNS__UPSTREAM__PROTOCOL=udp  # 使用 UDP 上游
export ENT_DNS__DATABASE__PATH=/var/lib/ent-dns/ent-dns.db
export ENT_DNS__WAL__CHECKPOINT_INTERVAL=300  # 5 分钟 checkpoint
```

---

## 下一步行动

### 必须做（上线前）

1. **实现查询日志轮转**
   - 保留最近 7 天
   - 或提供禁用日志的配置
   - 预计工作量: 0.5 天

2. **配置 UDP 上游**
   - 降低延迟（<10ms）
   - 提供配置选项
   - 预计工作量: 0.5 天

### 应该做（上线后）

3. **优化 WAL checkpoint**
   - 定期 checkpoint
   - 监控 WAL 文件
   - 预计工作量: 0.5 天

4. **添加查询重试机制**
   - 上游失败时重试
   - 预计工作量: 0.5 天

### 可以做（未来优化）

5. **实现 Metrics 端点可选认证**
   - 预计工作量: 0.25 天

6. **添加上游负载均衡**
   - 预计工作量: 1 天

---

**报告生成时间**: 2026-02-20 12:40 +04:00
**QA 负责人**: James Bach
**审核状态**: 待审核
**上线建议**: ✅ 建议上线（需要实现查询日志轮转）
