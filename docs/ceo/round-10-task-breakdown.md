# Ent-DNS Round 10 任务拆分

## 📋 任务概述

基于用户指令，Round 10 的 6 个核心任务已完成拆分。以下是完整的任务清单、优先级排序和执行计划。

---

## 🎯 任务清单

### 1. DoH/DoT 支持 (DoH/DoT Support)
**负责人**: `cto-vogels`
**工作量**: 36 天（5 周）
**优先级**: **P0**（安全与合规需求）

#### 交付物
- ✅ ADR-001: DoH/DoT Support Design (`docs/cto/ADR-001-doh-dot-support.md`)
- ✅ Implementation Roadmap (`docs/cto/doh-dot-implementation-roadmap.md`)
- ✅ DoH API Specification (`docs/cto/doh-api-specification.md`)
- ✅ DoT Architecture Design (`docs/cto/dot-architecture.md`)
- ✅ Security Considerations (`docs/cto/doh-dot-security.md`)
- ✅ Performance Analysis (`docs/cto/doh-dot-performance.md`)

#### 核心决策
- DoH: Axum Handler + RFC 8484 + JWT Bearer Token
- DoT: TCP 853 + rustls + mTLS（企业级）
- 无需新增依赖（现有 crate 已支持）
- 复用 DnsHandler，零新增依赖

#### 风险
- TLS 握手性能开销（首次 15-20ms，会话恢复 2-5ms）
- 证书管理复杂度
- RFC 8484/7858 合规性

#### 阶段划分
- Phase 1: DoH Basic（5.5 天）
- Phase 2: DoH Auth（5 天）
- Phase 3: DoT Core（8.5 天）
- Phase 4: DoT mTLS（9 天）
- Phase 5: Production Readiness（8 天）

---

### 2. 性能压力测试 (Performance Load Testing)
**负责人**: `qa-bach`
**工作量**: 8 天
**优先级**: **P0**（稳定性风险）

#### 交付物
- ✅ 完整测试方案 (`docs/qa/performance-load-test-plan.md`)
- ✅ 快速启动指南 (`projects/ent-dns/tests/loadtest/README.md`)
- ✅ 测试脚本（4 个）
  - `dns-qps-test.sh` — DNS QPS 测试
  - `api-write-test.js` — API 并发测试
  - `stability-test.sh` — 24 小时稳定性测试
  - `collect-metrics.sh` — 指标采集
- ✅ GitHub Actions (`.github/workflows/performance-test.yml`)

#### 核心瓶颈
1. **SQLite WAL 写入竞争** — 高 QPS 下触发 WAL 锁竞争
2. **批量写入参数未调优** — 批量大小 100 条 / 1 秒不够
3. **查询日志无轮转** — 24 小时 1000 QPS ≈ 8640 万条记录
4. **连接池配置未调优** — 默认连接池大小为 CPU 核心数

#### 修复预案
- PRAGMA 优化（synchronous=NORMAL、cache_size=-64000、mmap_size=256MB）
- 批量大小调整为 500 条 / 2 秒
- 实现自动轮转（保留 7 天）
- 连接池显式设置为 20

#### 工具链
- `dnsperf` — DNS QPS 压测
- `k6` — API 并发测试
- `Prometheus` — 性能监控

#### 阶段划分
- 阶段 1: 基线建立（1 天）
- 阶段 2: 瓶颈验证（2 天）
- 阶段 3: 优化实施（3 天）
- 阶段 4: 最终验证（2 天）

---

### 3. 规则语法实时验证 (Rule Validation)
**负责人**: `fullstack-dhh`
**工作量**: 6 天
**优先级**: **P1**（用户体验提升）

#### 交付物
- ✅ 完整设计文档 (`docs/fullstack/rule-validation-design.md`)
- ✅ API 端点设计 (`POST /api/v1/rules/validate`)
- ✅ 前端组件设计（防抖、实时反馈）
- ✅ 测试覆盖清单

#### 核心功能
- 实时语法验证 API
- 详细错误定位（行号、列号、修复建议）
- 前端防抖（500ms）+ React Query 缓存
- 域名/IP/通配符/正则验证

#### 性能优化
- Moka 缓存（1000 条，5 分钟 TTL）
- 单体 API 端点（不拆分）
- 简单防抖实现（不用外部库）

#### 阶段划分
- 核心逻辑（2 天）
- API 实现（1 天）
- 前端集成（2 天）
- 测试优化（1 天）

---

### 4. 客户端分组管理 (Client Groups)
**负责人**: `interaction-cooper`
**工作量**: 预估 10-14 天
**优先级**: **P1**（批量管理需求）

#### 交付物
- ✅ Persona 定义 (`docs/interaction/client-groups-persona.md`)
- ✅ 数据库 schema (`docs/interaction/client-groups-database.md`)
- ✅ API 端点设计 (`docs/interaction/client-groups-api.md`)
- ✅ 前端页面流程 (`docs/interaction/client-groups-ui.md`)
- ✅ 规则引擎集成 (`docs/interaction/client-groups-rules.md`)
- ✅ 数据迁移计划 (`docs/interaction/client-groups-migration.md`)

#### 核心决策
- **不实现层级分组** — 扁平分组 + 多对多关系满足 90% 场景
- **规则独立存储** — 支持规则复用和多组共享
- **批量操作优先** — 批量移动客户端、批量绑定规则
- **简单优先级** — 客户端专属 > 组规则（创建时间倒序）> 全局规则

#### 核心功能
- CRUD 操作：创建/编辑/删除组
- 客户端分配：多对多关系
- 规则绑定：规则应用到组
- 前端：拖拽排序、批量操作

#### 数据库变更
- 新增表：`client_groups`、`client_group_memberships`、`client_group_rules`
- 索引优化：3 个复合索引
- 迁移策略：现有客户端自动加入"未分组"组

---

### 5. 高级过滤规则 (Advanced Filtering Rules)
**负责人**: `product-norman`
**工作量**: 34.5 天（7 周）
**优先级**: **P2**（产品增强）

#### 交付物
- ✅ 核心设计文档 (`docs/product/advanced-filtering-rules-design.md`)
- ✅ DSL 语法手册 (`docs/product/advanced-rules-dsl-manual.md`)
- ✅ 执行引擎设计 (`docs/product/advanced-rules-engine-design.md`)
- ✅ 编辑器设计 (`docs/product/advanced-rules-editor-design.md`)

#### 核心功能
1. **正则表达式** — 通配符匹配（`.*\.ads\.com$`）
2. **时间规则** — 按时间段/星期生效
3. **条件规则** — IF-THEN-ELSE 逻辑 + 多条件组合
4. **规则优先级** — 支持禁用/启用、拖拽排序
5. **规则模板** — 常用规则模板库

#### DSL 示例
```yaml
# 基础规则
rewrite:
  domain: myapp.example.org
  ip: 192.168.1.100

# 正则规则
block:
  pattern: ".*\\.ads\\.com$"

# 时间规则
block:
  pattern: ".*\\.video\\.com$"
  schedule:
    time_range: "22:00-06:00"
    days: ["mon", "tue", "wed", "thu", "sun"]

# 条件规则
if:
  condition: "client.group == 'kids'"
then:
  block:
    pattern: ".*\\.game\\.com$"
else:
  allow:
    pattern: ".*\\."
```

#### 性能与安全
- 分层索引：精确匹配 → 后缀匹配 → 正则匹配 → 条件评估
- ReDoS 防护：复杂度限制 + 100ms 超时
- 内存保护：规则数量上限（100k）、正则规则上限（10k）

#### 阶段划分
- Phase 1: MVP（7.5 天） — 正则规则 + 简单时间限制
- Phase 2: 条件规则（7.5 天） — IF-THEN-ELSE + 多条件组合
- Phase 3: 规则管理（7 天） — 优先级排序 + 模板库
- Phase 4: UX 优化（5.5 天） — DSL 编辑器 + 引导提示
- Phase 5: 性能与安全（7 天） — 规则索引 + 压力测试

---

### 6. 查询日志高级过滤 (Query Log Advanced Filters)
**负责人**: `ui-duarte`
**工作量**: 10-14 天
**优先级**: **P1**（运营效率提升）

#### 交付物
- ✅ 完整设计文档 (`docs/ui/query-log-advanced-filter-design.md`)
- ✅ 性能基准测试 (`docs/ui/query-log-performance-benchmark.md`)
- ✅ 实施路线图 (`docs/ui/query-log-implementation-roadmap.md`)
- ✅ 数据库索引优化 (`src/db/migrations/004_query_log_indexes.sql`)
- ✅ 查询模板表 (`src/db/migrations/005_query_log_templates.sql`)
- ✅ 后端代码（3 个文件）
- ✅ 前端代码（3 个文件）

#### 核心功能
1. **高级过滤条件** — 时间、客户端、域名、查询类型、响应码、响应时间、上游、规则匹配
2. **组合查询** — AND/OR 逻辑、括号分组
3. **查询模板** — 保存/加载常用过滤条件
4. **聚合统计** — GROUP BY、时间序列、Top N 排行
5. **智能提示** — 域名/IP 自动补全

#### API 端点
```
GET  /api/v1/query-log/advanced            # 高级查询
GET  /api/v1/query-log/aggregate           # 聚合统计
GET  /api/v1/query-log/top-n               # Top N 排行
GET  /api/v1/query-log/suggestions        # 智能提示
GET  /api/v1/query-log/templates           # 模板列表
POST /api/v1/query-log/templates           # 创建模板
PUT  /api/v1/query-log/templates/{id}      # 更新模板
DELETE /api/v1/query-log/templates/{id}    # 删除模板
GET  /api/v1/query-log/export              # 高级导出
```

#### 性能预期
| 查询类型 | 优化前 | 优化后 | 提升 |
|---------|--------|--------|------|
| 简单查询 | 120 ms | 20 ms | 6x |
| 复杂查询 | 1500 ms | 100 ms | 15x |
| 聚合查询 | 312 ms | 300 ms | 1x |
| Top N 查询 | 新功能 | 200 ms | - |

#### 阶段划分
- Phase 1: 核心过滤（2-3 天）
- Phase 2: 智能提示 + 模板（2-3 天）
- Phase 3: 聚合分析（3-4 天）
- Phase 4: 性能优化（2-3 天）
- Phase 5: 文档 + 部署（1 天）

---

## 📊 任务优先级与依赖关系

### 优先级排序

| 优先级 | 任务 | 理由 |
|--------|------|------|
| **P0** | 性能压力测试 | 稳定性风险，可能阻塞其他任务 |
| **P0** | DoH/DoT 支持 | 安全与合规需求，企业级场景必需 |
| **P1** | 规则语法实时验证 | 用户体验提升，工作量小（6 天） |
| **P1** | 查询日志高级过滤 | 运营效率提升，工作量适中（10-14 天） |
| **P1** | 客户端分组管理 | 批量管理需求，但依赖规则语法验证 |
| **P2** | 高级过滤规则 | 产品增强，工作量大（34.5 天） |

### 依赖关系图

```
性能压力测试 (8 天)
    ↓ (确认 SQLite 瓶颈修复)
    ↓
    ├→ 规则语法实时验证 (6 天)
    │   ↓ (无依赖)
    │   ↓
    │   └→ 客户端分组管理 (10-14 天)
    │       ↓ (规则引擎增强)
    │       ↓
    │       └→ 高级过滤规则 (34.5 天)
    │
    └→ 查询日志高级过滤 (10-14 天)
        ↓ (无依赖)
        ↓
        └→ 高级过滤规则 (34.5 天)

DoH/DoT 支持 (36 天，可并行)
```

---

## 🚀 执行计划

### 第 1-2 周：稳定性基线 + 快速胜利

**Week 1**:
- [ ] 执行性能压力测试（阶段 1-2，3 天）
- [ ] 修复 SQLite 瓶颈（阶段 3，3 天）
- [ ] 最终验证（阶段 4，1 天）

**Week 2**:
- [ ] 规则语法实时验证（6 天）

### 第 3-4 周：功能增强

**Week 3**:
- [ ] 查询日志高级过滤（Phase 1-2，5 天）
- [ ] 客户端分组管理（启动，2 天）

**Week 4**:
- [ ] 查询日志高级过滤（Phase 3-5，3 天）
- [ ] 客户端分组管理（完成，2 天）

### 第 5-9 周：DoH/DoT 支持

**Week 5-6**:
- [ ] DoH Basic + DoH Auth（10.5 天）

**Week 7-8**:
- [ ] DoT Core + DoT mTLS（17.5 天）

**Week 9**:
- [ ] Production Readiness（8 天）

### 第 10-16 周：高级过滤规则

**Week 10-16**:
- [ ] 高级过滤规则（34.5 天，分阶段）

---

## 🎯 关键里程碑

| 里程碑 | 时间 | 交付物 |
|--------|------|--------|
| **M1: 稳定性基线** | Week 2 | 性能压力测试报告 + SQLite 修复 |
| **M2: 快速胜利** | Week 2 | 规则语法实时验证 |
| **M3: 运营效率** | Week 4 | 查询日志高级过滤 + 客户端分组 |
| **M4: 安全合规** | Week 9 | DoH/DoT 支持 |
| **M5: 产品增强** | Week 16 | 高级过滤规则 |

---

## 📋 文档清单

所有设计文档已保存到对应目录：

### CTO 文档
- `docs/cto/ADR-001-doh-dot-support.md`
- `docs/cto/doh-dot-implementation-roadmap.md`
- `docs/cto/doh-api-specification.md`
- `docs/cto/dot-architecture.md`
- `docs/cto/doh-dot-security.md`
- `docs/cto/doh-dot-performance.md`

### QA 文档
- `docs/qa/performance-load-test-plan.md`
- `docs/qa/performance-load-test-summary.md`
- `docs/qa/performance-baseline.md`
- `projects/ent-dns/tests/loadtest/README.md`
- `.github/workflows/performance-test.yml`

### Fullstack 文档
- `docs/fullstack/rule-validation-design.md`

### Interaction 文档
- `docs/interaction/client-groups-persona.md`
- `docs/interaction/client-groups-database.md`
- `docs/interaction/client-groups-api.md`
- `docs/interaction/client-groups-ui.md`
- `docs/interaction/client-groups-rules.md`
- `docs/interaction/client-groups-migration.md`

### Product 文档
- `docs/product/advanced-filtering-rules-design.md`
- `docs/product/advanced-rules-dsl-manual.md`
- `docs/product/advanced-rules-engine-design.md`
- `docs/product/advanced-rules-editor-design.md`

### UI 文档
- `docs/ui/query-log-advanced-filter-design.md`
- `docs/ui/query-log-performance-benchmark.md`
- `docs/ui/query-log-implementation-roadmap.md`

### 数据库迁移
- `src/db/migrations/004_query_log_indexes.sql`
- `src/db/migrations/005_query_log_templates.sql`

### 后端代码
- `src/api/handlers/query_log_advanced.rs`
- `src/api/handlers/query_log_templates.rs`
- `src/api/routes/query_log.rs`

### 前端代码
- `frontend/src/components/query-log/FilterRow.tsx`
- `frontend/src/components/query-log/FilterBuilder.tsx`
- `frontend/src/api/queryLogAdvanced.ts`

### 测试脚本
- `projects/ent-dns/tests/loadtest/dns-qps-test.sh`
- `projects/ent-dns/tests/loadtest/api-write-test.js`
- `projects/ent-dns/tests/loadtest/stability-test.sh`
- `projects/ent-dns/tests/loadtest/collect-metrics.sh`

---

## ⚠️ 风险与缓解

### 风险 1: SQLite 瓶颈修复效果不达预期
**影响**: 高并发场景仍可能崩溃
**缓解**:
- 提前测试修复方案
- 准备备选方案：迁移到 PostgreSQL

### 风险 2: DoH/DoT 工作量超预期
**影响**: 延期其他任务
**缓解**:
- Phase 1-2（DoH Basic）可独立交付
- DoT mTLS 可选，非 MVP 必需

### 风险 3: 高级过滤规则复杂度高
**影响**: 延期或质量不达标
**缓解**:
- Phase 1 MVP（正则 + 简单时间）可独立交付
- 迭代开发，逐步增强

### 风险 4: 客户端分组与规则引擎冲突
**影响**: 优先级逻辑混乱
**缓解**:
- 明确优先级：客户端专属 > 组规则 > 全局规则
- 提供规则冲突检测工具

---

## 🚦 下一步行动

1. **CEO 审查** — 确认优先级排序和执行计划
2. **Munger 风控** — Pre-Mortem 分析，识别隐藏风险
3. **启动 Week 1** — 执行性能压力测试
4. **建立周同步机制** — 每周审查进度和里程碑

---

**生成时间**: 2026-02-20
**负责人**: `ceo-bezos`
**文档版本**: v1.0
