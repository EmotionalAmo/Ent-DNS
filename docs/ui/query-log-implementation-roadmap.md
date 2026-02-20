# Ent-DNS 查询日志高级过滤 - 实施路线图

**Author:** ui-duarte (Matías Duarte)
**Date:** 2026-02-20
**Project:** Round 10 - Query Log Advanced Filtering

---

## 概览

本文档为 Ent-DNS 项目设计了一套企业级查询日志高级过滤系统，支持复杂条件查询、聚合分析、模板保存和智能提示。设计遵循 Material Design 原则：**Bold, Graphic, Intentional**。

---

## 已创建的文档和代码

### 文档
1. **完整设计文档**：`docs/ui/query-log-advanced-filter-design.md`
   - API 端点设计
   - SQL 查询生成
   - 前端组件库设计
   - 数据库索引策略

2. **性能基准测试**：`docs/ui/query-log-performance-benchmark.md`
   - 查询性能对比（优化前 vs 优化后）
   - 索引大小分析
   - 压力测试结果
   - 监控指标建议

### 数据库迁移
3. **索引优化迁移**：`src/db/migrations/004_query_log_indexes.sql`
   - 10 个新增索引（复合索引 + 部分索引）
   - 预计查询性能提升 6-70x

4. **查询模板表**：`src/db/migrations/005_query_log_templates.sql`
   - `query_log_templates` 表
   - 6 个默认模板（最近拦截、慢查询、错误查询等）

### 后端代码
5. **高级过滤实现**：`src/api/handlers/query_log_advanced.rs`
   - `QueryBuilder`：动态 SQL 生成
   - `/api/v1/query-log/advanced`：复杂条件查询
   - `/api/v1/query-log/aggregate`：聚合统计
   - `/api/v1/query-log/top`：Top N 排行
   - `/api/v1/query-log/suggest`：智能提示

6. **模板管理 CRUD**：`src/api/handlers/query_log_templates.rs`
   - 模板列表/创建/获取/更新/删除
   - 权限控制（公开 + 私有）

7. **路由配置**：`src/api/routes/query_log.rs`
   - 所有新端点的路由定义

### 前端代码
8. **过滤器组件**：`frontend/src/components/query-log/FilterRow.tsx`
   - `FilterRow`：单个过滤器组件
   - `QuickFilters`：快捷过滤器（最近拦截、慢查询、错误查询、A 记录查询）

9. **过滤器构建器**：`frontend/src/components/query-log/FilterBuilder.tsx`
   - 动态添加/删除过滤器
   - 组合查询支持
   - 最多 10 个过滤器限制

10. **API 客户端**：`frontend/src/api/queryLogAdvanced.ts`
    - TypeScript 类型定义
    - 完整的 API 封装

---

## API 端点总览

### 查询日志
| 方法 | 端点 | 功能 | 权限 |
|------|------|------|------|
| GET | `/api/v1/query-log` | 基础查询（兼容） | AuthUser |
| GET | `/api/v1/query-log/advanced` | 高级过滤查询 | AuthUser |
| GET | `/api/v1/query-log/aggregate` | 聚合统计 | AuthUser |
| GET | `/api/v1/query-log/top` | Top N 排行 | AuthUser |
| GET | `/api/v1/query-log/suggest` | 智能提示 | AuthUser |
| GET | `/api/v1/query-log/export` | 导出（基础） | AdminUser |

### 查询模板
| 方法 | 端点 | 功能 | 权限 |
|------|------|------|------|
| GET | `/api/v1/query-log/templates` | 列出模板 | AuthUser |
| POST | `/api/v1/query-log/templates` | 创建模板 | AuthUser |
| GET | `/api/v1/query-log/templates/:id` | 获取模板 | AuthUser |
| PUT | `/api/v1/query-log/templates/:id` | 更新模板 | Owner |
| DELETE | `/api/v1/query-log/templates/:id` | 删除模板 | Owner |

---

## 核心功能

### 1. 高级过滤条件

| 字段 | 类型 | 支持的操作符 |
|------|------|-------------|
| `time` | ISO8601 | `eq`, `gt`, `lt`, `gte`, `lte`, `between`, `relative` |
| `client_ip` | CIDR/IP | `eq`, `contains`, `like` |
| `client_name` | String | `eq`, `contains`, `like` |
| `question` | String | `eq`, `contains`, `like`, `regex` |
| `qtype` | Enum | `eq`, `in` |
| `answer` | String | `eq`, `contains`, `like` |
| `status` | Enum | `eq`, `in` |
| `reason` | String | `eq`, `contains`, `like` |
| `upstream` | String | `eq`, `contains`, `like` |
| `elapsed_ms` | Integer | `eq`, `gt`, `lt`, `gte`, `lte` |

### 2. 快捷过滤器（预设）
- 最近拦截（24 小时）
- 慢查询（>100ms）
- 错误查询
- A 记录查询（1 小时）

### 3. 聚合统计
- **维度**：按 `status`, `qtype`, `client`, `upstream` 等
- **指标**：`count`, `sum_elapsed_ms`, `avg_elapsed_ms`
- **时间桶**：1 分钟 / 5 分钟 / 15 分钟 / 1 小时 / 1 天

### 4. Top N 排行
- **维度**：`domain`, `client`, `qtype`, `upstream`
- **指标**：`count`, `sum_elapsed`, `avg_elapsed`
- **时间范围**：相对时间（`-1h`, `-24h`, `-7d` 等）

### 5. 查询模板
- 保存常用过滤条件
- 公开模板（全员可见）
- 私有模板（仅创建者）

---

## 实施优先级（按阶段）

### Phase 1：核心功能（2-3 天）

**后端任务：**
- [ ] 运行迁移 004：应用索引优化
- [ ] 运行迁移 005：创建查询模板表
- [ ] 实现 `query_log_advanced.rs`（核心查询逻辑）
- [ ] 实现 `query_log_templates.rs`（模板 CRUD）
- [ ] 在 `api/mod.rs` 中注册新路由

**前端任务：**
- [ ] 复制 `FilterRow.tsx` 到项目
- [ ] 复制 `FilterBuilder.tsx` 到项目
- [ ] 复制 `queryLogAdvanced.ts` 到项目
- [ ] 修改 `QueryLogs.tsx`：集成 `FilterBuilder` 组件

**测试任务：**
- [ ] 单元测试：`QueryBuilder.add_filter()`
- [ ] 集成测试：`GET /api/v1/query-log/advanced`
- [ ] 前端测试：过滤条件组合

**验收标准：**
- 复杂查询响应时间 < 100 ms
- 支持 5+ 个过滤器组合
- 快捷过滤器可用

---

### Phase 2：用户体验优化（2-3 天）

**后端任务：**
- [ ] 实现智能提示端点：`/api/v1/query-log/suggest`
- [ ] 优化错误消息（不支持的字段/操作符）

**前端任务：**
- [ ] 实现智能提示组件（`AutocompleteInput`）
- [ ] 实现模板管理对话框（`TemplateManager`）
- [ ] 列可见性切换组件
- [ ] 导出对话框（自定义字段选择）

**测试任务：**
- [ ] 智能提示延迟测试（< 50 ms）
- [ ] 模板保存/加载测试

**验收标准：**
- 智能提示可用（域名/IP 自动补全）
- 可保存/加载 5+ 个模板
- 可导出自定义字段

---

### Phase 3：聚合分析（3-4 天）

**后端任务：**
- [ ] 实现聚合端点：`/api/v1/query-log/aggregate`
- [ ] 实现 Top N 端点：`/api/v1/query-log/top`
- [ ] 添加查询缓存（moka）
- [ ] 性能优化：时间桶聚合预计算

**前端任务：**
- [ ] 安装 `recharts` 依赖
- [ ] 实现聚合面板组件（`AggregatePanel`）
- [ ] 实现 `AggregateChart` 组件（柱状图 + 折线图）
- [ ] 实现 `TopList` 组件（排行榜）

**测试任务：**
- [ ] 聚合查询性能测试（< 300 ms）
- [ ] 图表渲染性能测试

**验收标准：**
- 可按维度聚合统计
- 可展示时间序列图表
- 可查看 Top 10 排行

---

### Phase 4：性能优化（2-3 天）

**数据库任务：**
- [ ] 添加 FTS5 全文索引（域名模糊匹配）
- [ ] 配置 WAL mode + 增大 cache_size
- [ ] 定期 VACUUM（每月一次）

**后端任务：**
- [ ] 实现查询缓存（moka，60 秒 TTL）
- [ ] 实现Cursor-based 分页（替换 OFFSET）
- [ ] 添加性能监控（查询耗时统计）

**前端任务：**
- [ ] 实现虚拟滚动（`react-window`）
- [ ] 添加加载骨架屏
- [ ] 优化重渲染（`useMemo` / `useCallback`）

**测试任务：**
- [ ] 性能基准测试（对比 Phase 1）
- [ ] 压力测试（10 并发）
- [ ] 内存泄漏检测

**验收标准：**
- 简单查询 < 20 ms
- 复杂查询 < 100 ms
- 聚合查询 < 300 ms
- 10 并发稳定无崩溃

---

### Phase 5：文档与部署（1 天）

**文档任务：**
- [ ] 更新 `README.md`（新增功能说明）
- [ ] 更新 API 文档
- [ ] 编写用户指南（如何使用高级过滤）

**部署任务：**
- [ ] 灰度发布（先在测试环境验证）
- [ ] 数据库迁移脚本测试
- [ ] 回滚预案准备

**验收标准：**
- 文档完整清晰
- 生产环境稳定运行

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解方案 |
|------|------|------|---------|
| 索引过多导致写入变慢 | 中 | 低 | 部分索引仅索引高频字段 |
| 复杂查询性能不达标 | 高 | 中 | 查询缓存 + FTS5 全文索引 |
| 前端组件复杂度高 | 中 | 中 | 分阶段实施，充分测试 |
| 数据迁移失败 | 高 | 低 | 备份数据库 + 灰度发布 |
| 用户学习成本高 | 低 | 高 | 快捷过滤器 + 预设模板 |

---

## 预期收益

### 性能提升
- **简单查询**：120 ms → **20 ms**（6x）
- **复杂查询**：1500 ms → **100 ms**（15x）
- **聚合查询**：312 ms → **300 ms**（略微优化）
- **Top N 查询**：156 ms → **200 ms**（功能新增）

### 功能增强
- ✅ 10+ 种过滤条件组合
- ✅ 快捷过滤器（一键应用）
- ✅ 查询模板（保存常用查询）
- ✅ 智能提示（自动补全）
- ✅ 聚合统计（按维度分析）
- ✅ Top N 排行（热门域名/客户端）
- ✅ 自定义导出（选择字段）

### 用户体验
- **信息密度**：从 3 个基础条件 → 10+ 个高级条件
- **查询效率**：从手动筛选 → 快捷过滤器 + 模板
- **洞察发现**：从查看列表 → 聚合分析 + 图表
- **学习成本**：从复杂查询 → 预设模板引导

---

## 下一步行动

### 立即开始（今天）
1. **Review 设计文档**：`docs/ui/query-log-advanced-filter-design.md`
2. **Review 性能基准**：`docs/ui/query-log-performance-benchmark.md`
3. **确认技术栈**：确认是否安装 `recharts`、`moka` 等依赖

### 本周完成
1. **运行数据库迁移**：`src/db/migrations/004_query_log_indexes.sql`
2. **复制后端代码**：`query_log_advanced.rs`、`query_log_templates.rs`
3. **复制前端组件**：`FilterRow.tsx`、`FilterBuilder.tsx`
4. **集成测试**：验证基础功能可用

### 下周完成
1. **智能提示**：实现 `AutocompleteInput` 组件
2. **模板管理**：实现 `TemplateManager` 组件
3. **聚合分析**：实现 `AggregatePanel` + Recharts

---

## 联系方式

如有疑问或需要进一步讨论，请联系：
- **UI 设计**：ui-duarte (Matías Duarte)
- **文档位置**：`/Users/emotionalamo/Developer/Ent-DNS/docs/ui/`
- **代码位置**：见本文档"已创建的文档和代码"章节

---

**Design by ui-duarte (Matías Duarte)**
**遵循原则：Bold, Graphic, Intentional**
