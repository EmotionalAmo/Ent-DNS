# Ent-DNS 性能压力测试方案总结

> **文档版本**: 1.0
> **创建日期**: 2026-02-20
> **负责人**: QA Agent (James Bach)

---

## 📋 执行摘要

为 Ent-DNS 项目设计了完整的性能压力测试方案，聚焦于验证 SQLite 单点写入瓶颈和系统容量上限。方案包含 4 大测试场景、完整的工具链、CI/CD 集成和修复预案。

### 核心成果

1. **测试工具链**: `dnsperf` + `k6` + `Prometheus`（行业标准 + 现代化工具）
2. **测试脚本**: 4 个可执行脚本，覆盖 QPS 测试、并发写入、稳定性、指标采集
3. **CI/CD 集成**: GitHub Actions 自动化性能回归检测
4. **修复预案**: 4 层修复方案（从 SQLite 优化到 PostgreSQL 迁移）

---

## 📊 测试场景概览

### 场景 1: DNS QPS 容量测试（逐步加压）
**目标**: 确定系统最大 QPS 处理能力

| 阶段 | QPS | 持续时间 | 成功标准 |
|------|-----|---------|---------|
| 1 | 100 | 5 分钟 | P95 < 10ms |
| 2 | 500 | 5 分钟 | P95 < 50ms |
| 3 | 1000 | 5 分钟 | P95 < 100ms |
| 4 | 2000 | 5 分钟 | P95 < 200ms |
| 5 | 5000 | 5 分钟 | P95 < 500ms |
| 6 | 10000 | 5 分钟 | P95 < 1000ms |

**脚本**: `tests/loadtest/dns-qps-test.sh`

---

### 场景 2: 并发写入测试（API 压力）
**目标**: 验证 SQLite 写入瓶颈是否影响 API 响应

| 并发级别 | VUs | 持续时间 | 成功标准 |
|---------|-----|---------|---------|
| 预热 | 10 | 2 分钟 | P95 < 200ms |
| 正常 | 50 | 5 分钟 | P95 < 300ms |
| 峰值 | 100 | 2 分钟 | P95 < 500ms |
| 压力 | 200 | 2 分钟 | P95 < 800ms |

**脚本**: `tests/loadtest/api-write-test.js`

---

### 场景 3: 长时间稳定性测试（24 小时）
**目标**: 验证系统长时间运行的稳定性

| 指标 | 警告阈值 | 失败阈值 |
|------|---------|---------|
| 内存增长 | > 10% (24h) | > 20% (24h) |
| 磁盘增长 | > 10GB/天 | > 20GB/天 |
| 崩溃次数 | 0 | > 0 |

**负载配置**:
- DNS: 1000 QPS（持续）
- API: 10 VUs（持续）

**脚本**: `tests/loadtest/stability-test.sh`

---

### 场景 4: 混合场景（读多写少 vs 写多读少）

**场景 4A: 读多写少（90% 读 / 10% 写）**
- DNS QPS = 5000
- API VU = 5
- 模拟生产环境典型场景

**场景 4B: 写多读少（50% 读 / 50% 写）**
- DNS QPS = 1000
- API VU = 50
- 模拟极端场景（批量导入）

---

## 🔧 测试工具链

### 工具选择

| 场景 | 工具 | 版本 | 安装命令 |
|------|------|------|---------|
| DNS QPS 压测 | dnsperf | 2.11.0+ | `brew install dnsperf` |
| API 并发测试 | k6 | 0.51.0+ | `brew install k6` |
| 性能监控 | Prometheus | 2.45+ | `brew install prometheus` |
| 资源监控 | node_exporter | 1.6+ | `brew install node_exporter` |

### 工具优势

1. **dnsperf**: 行业标准，支持 UDP/TCP/DoH，精确测量 DNS 延迟
2. **k6**: 现代化压测工具，JavaScript 编写，支持 WebSocket，性能开销低
3. **Prometheus**: 已有 metrics endpoint，无缝集成，可视化强大

---

## 🚀 快速启动

### 1. 安装工具（macOS）

```bash
brew install dnsperf k6 prometheus
```

### 2. 启动 Ent-DNS

```bash
cd /Users/emotionalamo/Developer/Ent-DNS/projects/ent-dns
cargo build --release
export ENT_DNS__AUTH__JWT_SECRET="test-secret-32-characters-min"
./target/release/ent-dns &
```

### 3. 执行测试

```bash
cd tests/loadtest

# DNS QPS 测试（快速）
./dns-qps-test.sh

# API 并发测试
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.token')
export AUTH_TOKEN=$TOKEN
k6 run api-write-test.js --duration 10m --vus 50

# 稳定性测试（1 小时）
export DURATION=3600
./stability-test.sh
```

### 4. 查看结果

```bash
# DNS 性能
cat results/qps-test-*/comparison.txt

# API 性能
cat k6-summary.json | jq '.metrics.http_req_duration.values'

# 稳定性对比
cat results/stability-*/comparison.txt
```

---

## 🔍 瓶颈诊断与修复

### 已识别瓶颈

#### 瓶颈 1: SQLite WAL 写入竞争
**问题**: 高 QPS 场景下，批量写入仍可能触发 WAL 锁竞争

**优先级**: **Critical**

**修复方案**:
```rust
// 在 src/db/mod.rs 中添加 PRAGMA 优化
sqlx::query("PRAGMA synchronous=NORMAL").execute(&pool).await?;
sqlx::query("PRAGMA cache_size=-64000").execute(&pool).await?; // 64MB
sqlx::query("PRAGMA temp_store=MEMORY").execute(&pool).await?;
sqlx::query("PRAGMA mmap_size=268435456").execute(&pool).await?; // 256MB
```

**预期效果**: P95 延迟降低 30-50%，锁等待时间减少 40-60%

---

#### 瓶颈 2: 批量写入参数未调优
**问题**: 当前批量大小 100 条 / 1 秒，可能在高 QPS 下不够

**优先级**: **Major**

**修复方案**:
```rust
// 在 src/db/query_log_writer.rs 中调整
const BATCH_SIZE: usize = 500;  // 从 100 提升到 500
const FLUSH_INTERVAL: Duration = Duration::from_secs(2); // 从 1s 提升到 2s
```

**预期效果**: 事务频率降低 80%

---

#### 瓶颈 3: 查询日志无轮转
**问题**: 24 小时 1000 QPS ≈ 8640 万条记录，可能耗尽磁盘

**优先级**: **Major**

**修复方案**: 实现自动轮转（参考 `performance-load-test-plan.md` 第 6.2 节）

**预期效果**: 磁盘使用可控，查询性能稳定

---

#### 瓶颈 4: 连接池配置未调优
**问题**: 默认连接池大小为 CPU 核心数，可能不足

**优先级**: **Minor**

**修复方案**:
```rust
let pool = SqlitePool::connect_with(
    SqliteConnectOptions::new()
        .filename(&cfg.database.path)
        .max_connections(20) // 显式设置
).await?;
```

**预期效果**: 并发读性能提升 20-30%

---

### 修复优先级矩阵

| 修复方案 | 成本 | 收益 | 风险 | 优先级 |
|---------|------|------|------|--------|
| SQLite PRAGMA 优化 | 低 | 高 | 低 | **P0** |
| 批量写入参数调整 | 低 | 中 | 低 | **P1** |
| 查询日志轮转 | 中 | 高 | 中 | **P1** |
| 连接池调优 | 低 | 中 | 低 | **P2** |

---

## 🔄 CI/CD 集成

### GitHub Actions 自动化测试

**工作流**: `.github/workflows/performance-test.yml`

**触发条件**:
- PR 到 main 分支（快速测试）
- Push 到 main 分支（快速测试）
- 每天凌晨 2 点（完整测试）
- 手动触发（workflow_dispatch）

**测试内容**:
- DNS QPS 测试（100, 1000 QPS）
- API 并发测试（10 VU）
- 性能回归检测（P95 > 500ms 失败）

**结果输出**:
- GitHub Actions Artifacts（日志和 JSON 结果）
- 失败时自动阻止合并

---

## 📈 性能基线管理

**基线文档**: `docs/qa/performance-baseline.md`

**基线内容**:
- DNS 性能（100-10000 QPS）
- API 性能（10-200 VUs）
- 资源消耗（CPU/内存/IO）
- 测试环境（硬件/软件配置）

**回归检测**:
- 警告: P95 增加 20-50%
- 失败: P95 增加 > 50%

---

## 🎯 测试执行计划

### 阶段 1: 基线建立（1 天）
- [x] 设计测试方案
- [ ] 部署测试环境
- [ ] 执行场景 1（DNS QPS 容量）
- [ ] 记录性能基线

### 阶段 2: 瓶颈验证（2 天）
- [ ] 执行场景 2（并发写入）
- [ ] 验证 SQLite 锁竞争
- [ ] 执行场景 3（6 小时简化版）

### 阶段 3: 优化实施（3 天）
- [ ] 实施 SQLite PRAGMA 优化
- [ ] 实施查询日志轮转
- [ ] 重新测试验证

### 阶段 4: 最终验证（2 天）
- [ ] 24 小时完整稳定性测试
- [ ] 混合场景测试
- [ ] 生成最终报告

**总耗时**: 8 个工作日

---

## 📁 交付物清单

### 文档
1. ✅ `docs/qa/performance-load-test-plan.md` — 完整测试方案（10 章节，200+ 行）
2. ✅ `docs/qa/performance-baseline.md` — 性能基线记录
3. ✅ `tests/loadtest/README.md` — 快速启动指南

### 测试脚本
1. ✅ `tests/loadtest/dns-qps-test.sh` — DNS QPS 测试
2. ✅ `tests/loadtest/api-write-test.js` — API 并发测试
3. ✅ `tests/loadtest/stability-test.sh` — 稳定性测试
4. ✅ `tests/loadtest/collect-metrics.sh` — 指标采集

### CI/CD
1. ✅ `.github/workflows/performance-test.yml` — GitHub Actions

---

## 🔬 测试哲学（James Bach）

### Testing ≠ Checking
- **Checking**: 验证已知预期（自动化擅长）
- **Testing**: 探索未知、发现意外（人类擅长）

本方案平衡两者：
- 自动化检查：QPS 基准、错误率、资源消耗
- 探索性测试：异常场景、边界条件、长时间稳定性

### Context-Driven Testing
没有"最佳实践"，只有在特定上下文中的好实践。

本方案的上下文：
- **产品类型**: DNS 过滤服务器（延迟敏感）
- **用户群体**: 企业内网（高并发、高可用）
- **技术栈**: Rust + SQLite（轻量级、易部署）
- **风险承受度**: DNS 服务中断影响业务 → **高影响**

### Rapid Software Testing
测试是为了提供信息，不是为了"通过"。

本方案提供的信息：
1. 系统容量上限（能支撑多少 QPS？）
2. 瓶颈位置（SQLite 写入？CPU？内存？）
3. 修复优先级（哪些优化收益最大？）

---

## ⚠️ 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 测试环境与生产环境差异大 | 高 | 中 | 在生产类似的硬件上测试 |
| 压测工具成为瓶颈 | 中 | 低 | 确保测试机性能远超被测系统 |
| 结果误判（缓存掩盖问题） | 高 | 中 | 清空缓存、真实域名、长时间测试 |
| SQLite 瓶颈确认后迁移困难 | 高 | 低 | 优先尝试 SQLite 优化，迁移是最后手段 |

---

## 📚 参考资料

### 官方文档
- [SQLite Performance Considerations](https://www.sqlite.org/performance.html)
- [dnsperf Manual](https://dns-oarc.net/tools/dnsperf)
- [k6 Documentation](https://k6.io/docs/)
- [Rust Performance Book](https://nnethercote.github.io/perf-book/intro.html)

### 测试方法论
- James Bach: Rapid Software Testing
- Context-Driven Testing Community

---

## 🎓 学习资源

### 如何阅读测试结果
1. **dnsperf 输出**: 查看 `Queries per second`、`Average Latency`、`Latency Distribution`
2. **k6 输出**: 查看 `http_req_duration`、`errors`、`vus`
3. **Prometheus metrics**: 查看 `ent_dns_queries_total`、CPU/内存/IO

### 如何诊断瓶颈
1. P95 延迟飙升 → 检查 CPU、SQLite 锁、上游响应时间
2. 错误率过高 → 检查 `database is locked`、timeout、panic
3. 内存持续增长 → 检查查询日志、缓存泄漏、连接泄漏

### 如何优化性能
1. **SQLite 优化**: PRAGMA 调优、批量写入、连接池
2. **应用层优化**: 缓存策略、异步处理、批量操作
3. **架构优化**: 必要时迁移到 PostgreSQL

---

## 🚀 Next Actions

1. **评审测试方案** — 确认测试场景、工具选择、修复预案
2. **审批测试环境** — 确保资源充足（CPU、内存、磁盘）
3. **执行阶段 1** — 部署测试环境，建立性能基线
4. **持续监控** — 定期执行测试，追踪性能变化

---

**文档结束**

**联系方式**: QA Agent (James Bach)
**反馈渠道**: GitHub Issues / Team Meeting
