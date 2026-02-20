# Ent-DNS 性能压力测试方案

> **文档版本**: 1.0
> **创建日期**: 2026-02-20
> **负责人**: QA Agent (James Bach)
> **状态**: 待评审

---

## 1. 测试目标

### 1.1 核心目标
1. **验证系统容量上限** — 确定 Ent-DNS 在不同负载下的实际 QPS 处理能力
2. **识别性能瓶颈** — 定位 SQLite 单点写入瓶颈、连接池配置问题、内存泄漏风险
3. **建立性能基线** — 记录 P50/P95/P99 延迟、错误率、资源消耗等关键指标
4. **验证稳定性** — 24 小时持续负载下的系统稳定性（内存增长、连接泄漏、数据一致性）

### 1.2 风险驱动测试
根据 **James Bach 的 Rapid Software Testing** 哲学，测试聚焦于高风险场景：

| 风险场景 | 影响等级 | 测试优先级 |
|---------|---------|-----------|
| SQLite WAL 写入竞争导致 DNS 查询阻塞 | **Critical** | P0 |
| 高并发下内存溢出（未释放的查询日志缓冲） | **Critical** | P0 |
| 连接池耗尽导致 API 不可用 | **Major** | P1 |
| 缓存失效风暴导致上游 DoH 服务过载 | **Major** | P1 |
| 24 小时运行后磁盘空间耗尽（日志无轮转） | **Major** | P1 |

---

## 2. 当前架构分析

### 2.1 已有优化
从代码审查发现，Ent-DNS 已实现以下优化：

1. **查询日志异步批量写入** (`query_log_writer.rs`)
   - 使用 `tokio::sync::mpsc::UnboundedChannel` 将日志写入从 DNS 热路径解耦
   - 批量写入：每 100 条或 1 秒触发一次 flush
   - 单事务批量插入，减少 WAL 锁竞争

2. **SQLite WAL 模式** (`db/mod.rs`)
   ```rust
   sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await?;
   ```

3. **多层缓存**
   - DNS 响应缓存（`DnsCache`，基于 Moka）
   - 客户端配置缓存（`client_config_cache`，60s TTL）
   - Per-client resolver 缓存（避免重复创建）

### 2.2 潜在瓶颈

#### 瓶颈 1：SQLite WAL 写入竞争
**问题**：
- 虽然使用了批量写入，但每次 flush 仍然获取 WAL 锁
- 在极高 QPS（>5000 QPS）场景下，每秒可能有 50+ 次事务（假设每批 100 条）
- SQLite 的 WAL 模式允许多读并发，但写操作仍然串行

**验证方法**：
```bash
# 监控 SQLite 锁等待时间
sqlite3 ent-dns.db "PRAGMA lock_status"
# 或查询 PRAGMA wal_checkpoint(PASSIVE) 的阻塞时间
```

#### 瓶颈 2：连接池配置未调优
**问题**：
- 当前代码未显式设置 `SqlitePool` 最大连接数（默认为 CPU 核心数）
- 对于 DNS 这种高并发读场景，默认值可能不足

**验证方法**：
```rust
// 建议配置
let pool = SqlitePool::connect_with(
    SqliteConnectOptions::new()
        .filename(&cfg.database.path)
        .create_if_missing(true)
        .journal_mode(SqlJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5))
        .max_connections(20) // 显式设置
).await?;
```

#### 瓶颈 3：未设置查询日志轮转
**问题**：
- `query_log` 表无自动清理机制
- 24 小时 1000 QPS = 8640 万条记录 ≈ 8.64 GB（假设每条 100B）
- 可能导致磁盘耗尽或查询变慢

#### 瓶颈 4：Prometheus metrics 暴露不完整
**问题**：
- 当前只有计数器（`queries_total`），没有直方图（`query_latency_seconds`）
- 无法收集 P50/P95/P99 延迟指标

---

## 3. 测试工具链

### 3.1 工具选择

| 场景 | 推荐工具 | 理由 |
|------|---------|------|
| **DNS QPS 压测** | `dnsperf` + `queryperf` | 行业标准工具，支持 UDP/TCP/DoH |
| **API 并发写入** | `k6` (JavaScript) | 现代化压测工具，支持 WebSocket，性能开销低 |
| **长时间稳定性** | `k6` + Grafana | 长时间运行 + 实时监控 |
| **资源监控** | `prometheus` + `node_exporter` | 已有 metrics endpoint，无缝集成 |
| **瓶颈定位** | `perf` + `flamegraph` + `sqlite3 PRAGMA` | Rust 性能分析 + SQLite 内置工具 |

### 3.2 工具安装

```bash
# DNS 压测工具（macOS）
brew install dnsperf

# k6（跨平台）
brew install k6

# Prometheus（可选，已有 metrics endpoint）
brew install prometheus

# 性能分析工具
brew install flamegraph
```

### 3.3 测试环境准备

```bash
# 1. 创建测试数据库（独立于开发环境）
export ENT_DNS__DATABASE__PATH=/tmp/ent-dns-loadtest.db

# 2. 启动 Ent-DNS（释放模式编译）
cd /Users/emotionalamo/Developer/Ent-DNS/projects/ent-dns
cargo build --release
./target/release/ent-dns &
DNS_PID=$!

# 3. 验证服务健康
dig @127.0.0.1 -p 5353 example.com A +short
curl http://127.0.0.1:8080/metrics
```

---

## 4. 测试场景定义

### 4.1 场景 1：DNS QPS 容量测试（逐步加压）

**目标**：确定系统能稳定处理的最大 QPS

**测试步骤**：
1. 初始 QPS = 100，持续时间 = 5 分钟
2. 递增：100 → 500 → 1000 → 2000 → 5000 → 10000
3. 每个阶段收集：
   - P50/P95/P99 延迟（通过 `dnsperf -s 127.0.0.1 -p 5353 -l 300 -q <qps> -d queryfile.txt`）
   - 错误率（超时、SERVFAIL）
   - CPU/内存/磁盘 IO（通过 `top` 或 `htop`）
   - Prometheus metrics（通过 `curl http://127.0.0.1:8080/metrics`）

**成功标准**：
- P95 延迟 < 100ms
- 错误率 < 0.1%
- 无内存泄漏（24 小时内存增长 < 10%）

**失败条件**：
- 错误率 > 5%
- 平均延迟 > 500ms
- 进程崩溃或 OOM

**测试脚本**：
```bash
#!/usr/bin/env bash
# tests/loadtest/dns-qps-test.sh

QPS_LEVELS=(100 500 1000 2000 5000 10000)
DURATION=300  # 5 分钟
DNS_SERVER="127.0.0.1"
DNS_PORT=5353
QUERY_FILE="tests/loadtest/domains.txt"  # 1000 个随机域名

mkdir -p results

for qps in "${QPS_LEVELS[@]}"; do
    echo "Testing QPS=$qps..."
    dnsperf -s $DNS_SERVER -p $DNS_PORT -d $QUERY_FILE -l $DURATION -q $qps \
        -s 1000 -W 2> results/dnsperf_${qps}qps.log

    # 收集 metrics
    curl -s http://127.0.0.1:8080/metrics > results/metrics_${qps}qps.log

    # 等待系统恢复
    sleep 60
done
```

**域名列表生成** (`domains.txt`)：
```bash
# 1000 个真实域名（避免 DNS 缓存）
curl -s https://raw.githubusercontent.com/curl/curl/master/docs/examples/html-list.html | \
    grep -oP 'href="https?://[^"]+' | \
    sed 's|https://||g' | \
    sed 's|/.*||g' | \
    sort -u | \
    head -1000 > tests/loadtest/domains.txt
```

---

### 4.2 场景 2：并发写入测试（模拟高负载管理操作）

**目标**：验证 SQLite 写入瓶颈是否影响 API 响应

**测试步骤**：
1. 使用 k6 模拟多个管理员同时创建规则
2. 并发级别：10 → 50 → 100 → 200 个虚拟用户（VU）
3. 每个用户循环执行：
   - 创建 DNS 规则（POST /api/v1/rules）
   - 查询规则列表（GET /api/v1/rules）
   - 删除规则（DELETE /api/v1/rules/{id}）

**成功标准**：
- API P95 延迟 < 500ms
- 无事务冲突（"database is locked" 错误 < 1%）

**k6 测试脚本** (`tests/loadtest/api-write-test.js`)：
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 自定义指标
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '2m', target: 10 },   // 预热
    { duration: '5m', target: 50 },   // 正常负载
    { duration: '2m', target: 100 },  // 峰值
    { duration: '2m', target: 200 },  // 压力测试
    { duration: '2m', target: 0 },   // 冷却
  ],
  thresholds: {
    'errors': ['rate<0.05'],        // 错误率 < 5%
    'http_req_duration': ['p(95)<500'], // P95 < 500ms
  },
};

const BASE_URL = 'http://127.0.0.1:8080/api/v1';
const AUTH_TOKEN = 'YOUR_JWT_TOKEN_HERE'; // 从登录获取

export default function () {
  // 创建规则
  const payload = JSON.stringify({
    domain: `test-${Math.random().toString(36).substring(7)}.example.com`,
    action: 'block',
    enabled: true,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
  };

  // POST /api/v1/rules
  const createRes = http.post(`${BASE_URL}/rules`, payload, params);
  errorRate.add(!check(createRes, {
    'status is 201': (r) => r.status === 201,
  }));
  apiLatency.add(createRes.timings.duration);

  if (createRes.status === 201) {
    const ruleId = createRes.json('id');

    // GET /api/v1/rules
    const listRes = http.get(`${BASE_URL}/rules`, params);
    apiLatency.add(listRes.timings.duration);

    // DELETE /api/v1/rules/{id}
    const deleteRes = http.del(`${BASE_URL}/rules/${ruleId}`, null, params);
    errorRate.add(!check(deleteRes, {
      'status is 204': (r) => r.status === 204,
    }));
  }

  sleep(1); // 每个 VU 每秒执行 1 次操作
}
```

**执行测试**：
```bash
# 获取 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.token')

# 替换脚本中的 AUTH_TOKEN
sed -i '' "s/YOUR_JWT_TOKEN_HERE/$TOKEN/" tests/loadtest/api-write-test.js

# 运行测试
k6 run tests/loadtest/api-write-test.js --out json=results/k6-write-test.json
```

---

### 4.3 场景 3：长时间稳定性测试（24 小时持续负载）

**目标**：验证系统长时间运行的稳定性

**测试步骤**：
1. 持续 DNS 查询负载：1000 QPS（模拟中等规模企业内网）
2. 持续 API 操作：10 VU（日常管理操作）
3. 并发运行 24 小时
4. 每小时采集一次快照：
   - 内存占用（`ps aux | grep ent-dns | awk '{print $6}'`）
   - 磁盘使用（`du -sh ent-dns.db`）
   - SQLite 锁状态（`sqlite3 ent-dns.db "PRAGMA lock_status"`）
   - Prometheus metrics

**成功标准**：
- 无内存泄漏（24 小时内存增长 < 20%）
- 无崩溃或 panic
- 磁盘增长线性且可控（< 10GB/天）

**测试脚本** (`tests/loadtest/stability-test.sh`)：
```bash
#!/usr/bin/env bash
# tests/loadtest/stability-test.sh

DURATION=86400  # 24 小时
DNS_QPS=1000
API_VUS=10
RESULTS_DIR="results/stability-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$RESULTS_DIR"

# 启动 DNS 负载
echo "Starting DNS load ($DNS_QPS QPS for ${DURATION}s)..."
dnsperf -s 127.0.0.1 -p 5353 -d tests/loadtest/domains.txt \
  -l $DURATION -q $DNS_QPS -s 1000 \
  > "$RESULTS_DIR/dnsperf.log" 2>&1 &
DNS_PID=$!

# 启动 API 负载
echo "Starting API load ($API_VUS VUs for ${DURATION}s)..."
k6 run tests/loadtest/api-write-test.js \
  --duration ${DURATION}s \
  --vus $API_VUS \
  --out json="$RESULTS_DIR/k6-api.json" \
  > "$RESULTS_DIR/k6-api.log" 2>&1 &
K6_PID=$!

# 定期采集指标
for i in $(seq 0 24); do
  sleep 3600  # 每小时

  echo "Collecting metrics at hour $i..."
  {
    echo "=== Memory ==="
    ps aux | grep ent-dns | grep -v grep | awk '{print "RSS:", $6, "KB", "VSZ:", $5, "KB"}'

    echo -e "\n=== Disk ==="
    du -sh ent-dns.db

    echo -e "\n=== SQLite Lock Status ==="
    sqlite3 ent-dns.db "PRAGMA lock_status"

    echo -e "\n=== Prometheus Metrics ==="
    curl -s http://127.0.0.1:8080/metrics

    echo -e "\n=== Time ==="
    date
  } >> "$RESULTS_DIR/snapshot_$i.txt"
done

# 等待测试结束
wait $DNS_PID $K6_PID

echo "Stability test completed. Results in $RESULTS_DIR"
```

---

### 4.4 场景 4：混合场景（读多写少 vs 写多读少）

**目标**：验证不同读写比例下的性能表现

**场景 4A：读多写少（90% 读 / 10% 写）**
- 模拟生产环境典型场景（DNS 查询为主，偶发规则更新）
- DNS QPS = 5000，API VU = 5

**场景 4B：写多读少（50% 读 / 50% 写）**
- 模拟极端场景（大量规则同步/批量导入）
- DNS QPS = 1000，API VU = 50

**对比指标**：
- P95 延迟差异
- 错误率差异
- SQLite 锁等待时间差异

---

## 5. 性能指标收集

### 5.1 核心指标

| 指标类别 | 指标名称 | 工具 | 目标值 |
|---------|---------|------|--------|
| **DNS 性能** | P50 延迟 | `dnsperf` | < 10ms |
| | P95 延迟 | `dnsperf` | < 100ms |
| | P99 延迟 | `dnsperf` | < 500ms |
| | 错误率 | `dnsperf` | < 0.1% |
| | QPS | `dnsperf` | > 5000 |
| **API 性能** | P95 延迟 | `k6` | < 500ms |
| | 错误率 | `k6` | < 1% |
| **资源消耗** | CPU 使用率 | `top` / `node_exporter` | < 80% |
| | 内存使用 | `ps` | < 2GB |
| | 磁盘 IO | `iostat` | < 50 MB/s |
| **SQLite 性能** | 锁等待时间 | `sqlite3 PRAGMA lock_status` | < 10ms |
| | 事务延迟 | 自定义 SQL | < 50ms |
| | WAL 文件大小 | `ls -lh ent-dns.db-wal` | < 100MB |

### 5.2 数据采集方案

#### 方案 1：Prometheus + Grafana（推荐）
**优点**：已有 metrics endpoint，无缝集成，可视化强大

**实现步骤**：
1. **增强 metrics 模块**（添加直方图）：
   ```rust
   // 在 src/metrics.rs 中添加
   use prometheus::{Histogram, HistogramOpts, Registry};

   pub struct DnsMetrics {
       // ... 现有字段 ...
       pub query_latency: Histogram,
   }

   impl DnsMetrics {
       pub fn new() -> Self {
           let query_latency = Histogram::with_opts(
               HistogramOpts::new("ent_dns_query_latency_seconds", "DNS query latency")
                   .buckets(vec![0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0])
           ).unwrap();

           Self { /* ... */ query_latency }
       }

       pub fn observe_latency(&self, duration: Duration) {
           self.query_latency.observe(duration.as_secs_f64());
       }
   }
   ```

2. **部署 Prometheus**：
   ```yaml
   # prometheus.yml
   global:
     scrape_interval: 15s
   scrape_configs:
     - job_name: 'ent-dns'
       static_configs:
         - targets: ['127.0.0.1:8080']
   ```

3. **启动 Prometheus**：
   ```bash
   prometheus --config.file=prometheus.yml &
   ```

#### 方案 2：手动采集（轻量级）
**优点**：无需额外依赖，适合快速验证

**脚本** (`tests/loadtest/collect-metrics.sh`)：
```bash
#!/usr/bin/env bash
# tests/loadtest/collect-metrics.sh

RESULTS_DIR="results/metrics-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

while true; do
  {
    echo "=== Timestamp ==="
    date -Iseconds

    echo -e "\n=== System Resources ==="
    top -l 1 | head -n 10

    echo -e "\n=== Process Info ==="
    ps aux | grep ent-dns | grep -v grep

    echo -e "\n=== SQLite ==="
    sqlite3 ent-dns.db <<EOF
SELECT "Query Count:" || COUNT(*) FROM query_log;
SELECT "Disk Size:" || (SELECT page_count * page_size FROM pragma_page_count, pragma_page_size) || " bytes";
PRAGMA lock_status;
EOF

    echo -e "\n=== Metrics ==="
    curl -s http://127.0.0.1:8080/metrics
  } >> "$RESULTS_DIR/metrics-$(date +%Y%m%d-%H%M%S).log"

  sleep 10
done
```

---

## 6. 瓶颈定位与修复预案

### 6.1 瓶颈定位流程

```
高 QPS 场景下 P95 延迟飙升
    ↓
检查错误率
    ├─ 错误率 > 1% → 检查日志（panic? OOM? 连接拒绝?）
    └─ 错误率 < 1% → 延迟问题
        ↓
    检查 SQLite 锁状态
        ├─ lock_status 显示 "pending" 或 "locked" → 写入瓶颈
        └─ 锁状态正常 → 其他瓶颈
            ↓
        检查 CPU/内存/IO
            ├─ CPU 100% → 计算密集型瓶颈（DNS 解析?）
            ├─ 内存接近上限 → 内存泄漏
            └─ IO 瓶颈 → 磁盘性能问题
```

### 6.2 SQLite 写入瓶颈修复预案

#### 修复 1：优化 SQLite 配置（第一优先级）
**实施方案**：
```rust
// 在 src/db/mod.rs 中增强 PRAGMA 设置
pub async fn init(cfg: &Config) -> Result<DbPool> {
    let db_url = format!("sqlite://{}?mode=rwc", cfg.database.path);
    let pool = SqlitePool::connect(&db_url).await?;

    sqlx::migrate!("./src/db/migrations").run(&pool).await?;

    // 性能优化 PRAGMA
    sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await?;
    sqlx::query("PRAGMA synchronous=NORMAL").execute(&pool).await?; // 牺牲一点安全性换取性能
    sqlx::query("PRAGMA cache_size=-64000").execute(&pool).await?; // 64MB 缓存
    sqlx::query("PRAGMA temp_store=MEMORY").execute(&pool).await?; // 临时表放内存
    sqlx::query("PRAGMA mmap_size=268435456").execute(&pool).await?; // 256MB 内存映射

    tracing::info!("Database connected: {}", cfg.database.path);
    Ok(pool)
}
```

**预期效果**：
- P95 延迟降低 30-50%
- 锁等待时间减少 40-60%

#### 修复 2：调整批量写入参数
**实施方案**：
```rust
// 在 src/db/query_log_writer.rs 中调整
const BATCH_SIZE: usize = 500;  // 从 100 提升到 500
const FLUSH_INTERVAL: Duration = Duration::from_secs(2); // 从 1s 提升到 2s
```

**预期效果**：
- 事务频率降低 80%
- P95 延迟进一步降低

#### 修复 3：实现查询日志自动轮转
**实施方案**：
```rust
// 新增 src/db/cleanup/mod.rs
pub async fn cleanup_old_logs(db: &DbPool, retain_days: i32) -> Result<u64> {
    let cutoff = Utc::now() - chrono::Duration::days(retain_days);

    let result = sqlx::query("DELETE FROM query_log WHERE time < ?")
        .bind(cutoff.to_rfc3339())
        .execute(db)
        .await?;

    Ok(result.rows_affected())
}

// 在 src/main.rs 中启动定时任务
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(3600)); // 每小时
    loop {
        interval.tick().await;
        if let Err(e) = cleanup_old_logs(&db, 7).await { // 保留 7 天
            tracing::error!("Failed to cleanup old logs: {}", e);
        }
    }
});
```

#### 修复 4：SQLite 不可行时迁移到 PostgreSQL（最后手段）
**触发条件**：
- SQLite 优化后 QPS 仍 < 2000
- 锁等待时间持续 > 50ms
- 需要支持高并发写入（> 1000 TPS）

**迁移成本**：
- 配置管理：2 人天
- 数据迁移：1 人天
- 测试验证：3 人天

**决策矩阵**：
| 方案 | 成本 | 收益 | 风险 |
|------|------|------|------|
| SQLite 优化 | 低 | 中 | 低 |
| 迁移 PostgreSQL | 高 | 高 | 中 |

---

## 7. CI/CD 集成方案

### 7.1 GitHub Actions 自动化性能测试

**场景**：每次 PR 或合并到 main 分支时运行快速压力测试

**工作流文件** (`.github/workflows/performance-test.yml`)：
```yaml
name: Performance Test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点运行完整测试

jobs:
  quick-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install dnsperf
        run: sudo apt-get update && sudo apt-get install -y dnsperf

      - name: Build Ent-DNS
        run: cargo build --release

      - name: Start Ent-DNS
        env:
          ENT_DNS__DATABASE__PATH: /tmp/ent-dns-test.db
          ENT_DNS__AUTH__JWT_SECRET: ${{ secrets.JWT_SECRET }}
        run: |
          ./target/release/ent-dns &
          echo $! > dns.pid
          sleep 10  # 等待启动

      - name: Run DNS Load Test (100 QPS)
        run: |
          dnsperf -s 127.0.0.1 -p 5353 -d tests/loadtest/domains.txt \
            -l 60 -q 100 -s 1000 > dnsperf-100qps.log

      - name: Run DNS Load Test (1000 QPS)
        run: |
          dnsperf -s 127.0.0.1 -p 5353 -d tests/loadtest/domains.txt \
            -l 60 -q 1000 -s 1000 > dnsperf-1000qps.log

      - name: Parse Results
        run: |
          echo "DNS Performance Results:"
          echo "100 QPS:"
          grep "Queries sent" dnsperf-100qps.log
          echo "1000 QPS:"
          grep "Queries sent" dnsperf-1000qps.log

      - name: Stop Ent-DNS
        run: kill $(cat dns.pid) || true

      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: performance-results
          path: dnsperf*.log

  full-test:
    if: github.event_name == 'schedule'  # 仅定时任务运行
    runs-on: ubuntu-latest
    steps:
      # ... 类似 quick-test，但包含 24 小时稳定性测试
```

### 7.2 性能回归检测

**策略**：
1. 在 `main` 分支记录性能基线（`results/baseline.json`）
2. 每次测试对比当前结果与基线
3. 如果 P95 延迟退化 > 20%，标记为失败

**基线示例** (`results/baseline.json`)：
```json
{
  "dns_100qps": {
    "p95_latency_ms": 5,
    "p99_latency_ms": 12,
    "error_rate": 0.0001
  },
  "dns_1000qps": {
    "p95_latency_ms": 45,
    "p99_latency_ms": 120,
    "error_rate": 0.0005
  },
  "api_write_10vu": {
    "p95_latency_ms": 120,
    "error_rate": 0.001
  }
}
```

---

## 8. 测试执行计划

### 8.1 阶段 1：基线建立（1 天）
- [ ] 部署测试环境
- [ ] 执行场景 1（DNS QPS 容量）
- [ ] 记录性能基线（100/1000/5000 QPS）
- [ ] 文档化当前瓶颈

### 8.2 阶段 2：瓶颈验证（2 天）
- [ ] 执行场景 2（并发写入）
- [ ] 验证 SQLite 锁竞争问题
- [ ] 执行场景 3（6 小时简化版稳定性测试）
- [ ] 生成瓶颈分析报告

### 8.3 阶段 3：优化实施（3 天）
- [ ] 实施 SQLite 优化（PRAGMA 调优）
- [ ] 实施查询日志轮转
- [ ] 重新执行测试验证效果
- [ ] 记录优化前后对比

### 8.4 阶段 4：最终验证（2 天）
- [ ] 24 小时完整稳定性测试
- [ ] 混合场景测试
- [ ] 生成最终性能报告
- [ ] 更新 CI/CD 集成

### 8.5 里程碑

| 阶段 | 交付物 | 时间 |
|------|--------|------|
| 阶段 1 | 性能基线报告 | Day 1 |
| 阶段 2 | 瓶颈分析报告 | Day 3 |
| 阶段 3 | 优化效果对比 | Day 6 |
| 阶段 4 | 最终性能报告 + CI 集成 | Day 8 |

---

## 9. 风险与应对

### 9.1 风险识别

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 测试环境与生产环境差异大 | 高 | 中 | 在生产类似的硬件上测试（云服务器） |
| 压测工具自身成为瓶颈 | 中 | 低 | 确保测试机器性能远超被测系统 |
| 数据库损坏导致测试中断 | 中 | 低 | 每次测试前备份，使用独立测试数据库 |
| 结果误判（如缓存命中掩盖问题） | 高 | 中 | 清空缓存、使用真实域名、长时间测试 |

### 9.2 风险应对策略

**策略 1：多环境验证**
- 开发环境：快速验证
- 预生产环境：模拟真实硬件
- 生产环境：灰度验证（可选）

**策略 2：渐进式加压**
- 从低 QPS 开始，逐步增加
- 发现异常立即停止并分析

**策略 3：自动化告警**
- 配置 Prometheus Alertmanager
- P95 延迟 > 200ms 时告警
- 错误率 > 1% 时告警

---

## 10. 附录

### 10.1 参考资料
- [SQLite Performance Considerations](https://www.sqlite.org/performance.html)
- [dnsperf Manual](https://dns-oarc.net/tools/dnsperf)
- [k6 Documentation](https://k6.io/docs/)
- [Rust Performance Book](https://nnethercote.github.io/perf-book/intro.html)

### 10.2 测试数据样本

#### 示例 1：dnsperf 输出
```
DNS Performance Testing Tool
Version 2.11.0

[Status] Command line: dnsperf -s 127.0.0.1 -p 5353 -d domains.txt -l 300 -q 1000
[Status] Sending queries (to 127.0.0.1)
[Status] Started at: Wed Feb 20 12:00:00 2026
[Status] Stopping after 300.00 seconds

Statistics:

  Queries sent:         300000
  Queries completed:    299998
  Queries lost:         2
  Response codes:       NOERROR 280000, NXDOMAIN 19998
  Run time (s):         299.99
  Queries per second:   1000.01

Average Latency (ms):
  All queries:          15.23
  NOERROR:              12.45
  NXDOMAIN:             8.90

Latency Distribution (ms):
  0-10:     150000 (50.0%)
  10-50:    120000 (40.0%)
  50-100:   25000 (8.3%)
  100-500:  4998 (1.7%)
  500+:     0 (0.0%)

Retransmissions:         2 (0.0007%)
  Timeouts:              0
```

#### 示例 2：k6 输出摘要
```
     ✓ status is 201
     ✓ status is 204

     checks.........................: 98.50% ✓ 1969/2000
     data_received..................: 230 kB 1.9 kB/s
     data_sent......................: 560 kB 4.7 kB/s
     http_req_blocked...............: avg=1.2ms  min=0.5µs  med=1µs    max=45ms   p(95)=2ms   p(99)=5ms
     http_req_connecting............: avg=10µs   min=0s     med=0s     max=5ms    p(95)=0s    p(99)=1ms
     http_req_duration..............: avg=120ms  min=15ms   med=95ms   max=850ms  p(95)=250ms p(99)=500ms
       { expected_response:true }...: avg=118ms  min=15ms   med=93ms   max=750ms  p(95)=240ms p(99)=450ms
     http_req_failed................: 1.50%  ✓ 30/2000
     http_req_receiving.............: avg=2.1ms  min=12µs   med=1.2ms  max=85ms   p(95)=4ms   p(99)=10ms
     http_req_sending...............: avg=0.3ms  min=6µs    med=200µs  max=15ms   p(95)=1ms   p(99)=2ms
     http_req_tls_handshaking.......: avg=0s     min=0s     med=0s     max=0s     p(95)=0s    p(99)=0s
     http_req_waiting...............: avg=117ms  min=14ms   med=93ms   max=820ms  p(95)=245ms p(99)=490ms
     http_reqs......................: 2000    16.66/s
     iteration_duration.............: avg=1001ms min=1013ms med=1001ms max=1050ms p(95)=1015ms p(99)=1020ms
     iterations.....................: 2000    16.66/s
     vus............................: 10      min=10   max=10
     vus_max........................: 10      min=10   max=10
```

### 10.3 常见问题 FAQ

**Q: SQLite 在 10000 QPS 下一定会崩溃吗？**
A: 不一定。如果查询日志写入完全异步（批量缓冲 + 定时 flush），SQLite 只负责批量写入，理论上能支撑更高 QPS。关键在于批量大小和 flush 间隔的平衡。

**Q: 为什么不一开始就用 PostgreSQL？**
A: 根据 **James Bach 的 Context-Driven Testing** 哲学，没有"最佳实践"，只有在特定上下文中的好实践。SQLite 部署简单、零运维、成本极低，如果优化后能满足需求（如 < 5000 QPS），无需过度设计。

**Q: k6 的 UnboundedChannel 会导致内存泄漏吗？**
A: 不会。`UnboundedChannel` 的内存限制是系统可用内存。但在极端场景（写入速度 >> 消费速度）下，可能导致 OOM。建议添加背压机制（`bounded_channel`）。

**Q: 测试结果如何转化为生产容量规划？**
A: 根据测试结果，结合安全系数（如 70% 利用率原则），计算实际可用容量。例如：测试通过 5000 QPS，生产建议部署在 3500 QPS 以下。

---

**文档结束**

**Next Actions**:
1. 评审此测试方案
2. 审批测试环境资源
3. 开始阶段 1 执行
