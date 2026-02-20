# 客户端分组管理 — 实现进度

## 项目信息
- **任务 ID**: #12
- **开始时间**: 2026-02-20
- **负责人**: interaction-cooper (Alan Cooper)

---

## 已完成的工作

### Phase 1: 设计文档（100%）

- [x] **Persona 与场景** (`docs/interaction/client-groups-persona.md`)
  - 定义 Primary Persona: 系统管理员 Alex
  - 设计 4 个关键场景（新员工入职、安全审计、规则冲突排查、删除组）
  - 定义 Anti-Persona: 完美主义者 Paul

- [x] **数据库设计** (`docs/interaction/client-groups-database.md`)
  - 3 个新表：`client_groups`、`client_group_memberships`、`client_group_rules`
  - 索引和约束设计
  - 迁移策略：零中断、事务安全、可回滚

- [x] **API 设计** (`docs/interaction/client-groups-api.md`)
  - 11 个 RESTful 端点
  - 批量操作支持（批量移动、批量绑定）
  - 错误代码规范和审计日志

- [x] **UI 设计** (`docs/interaction/client-groups-ui.md`)
  - 5 个核心组件：GroupTree、ClientList、GroupRulesPanel、CreateGroupDialog、DeleteGroupDialog
  - 响应式设计（桌面端/平板端/移动端）
  - 动效设计（拖拽排序、批量选择）

- [x] **规则引擎集成** (`docs/interaction/client-groups-rules.md`)
  - 三级优先级体系（客户端专属 > 组规则 > 全局规则）
  - 规则合并逻辑
  - 性能优化：缓存策略

- [x] **数据迁移** (`docs/interaction/client-groups-migration.md`)
  - Migration 006: `006_client_groups.sql`
  - 回滚脚本: `rollback_006_client_groups.sql`
  - 验证脚本和测试用例

### Phase 2: 后端实现（60%）

- [x] **数据库迁移文件**
  - `src/db/migrations/006_client_groups.sql`
  - `src/db/migrations/rollback_006_client_groups.sql`

- [x] **Model 定义**
  - `src/db/models/client_group.rs`
  - 12 个结构体：ClientGroup、ClientGroupWithStats、ClientGroupMembership 等

- [x] **API Handlers**
  - `src/api/handlers/client_groups.rs`
  - 11 个 handler 函数：list_groups、create_group、update_group、delete_group 等
  - 错误处理和审计日志
  - 缓存失效逻辑

- [x] **路由集成**
  - `src/api/router.rs`: 11 个路由注册
  - 认证和授权：AuthUser / AdminUser

- [x] **AppState 扩展**
  - 添加 `client_config_cache: Option<Arc<Cache<String, Vec<DnsRuleWithSource>>>>`
  - TTL 60s，容量 4096

### Phase 3: 前端实现（0%）

- [ ] **API 封装** (`src/api/clientGroups.ts`)
- [ ] **GroupTree 组件** (`src/components/GroupTree.tsx`)
- [ ] **ClientList 组件** (`src/components/ClientList.tsx`)
- [ ] **GroupRulesPanel 组件** (`src/components/GroupRulesPanel.tsx`)
- [ ] **ClientGroupsPage 主页面** (`src/pages/ClientGroupsPage.tsx`)

### Phase 4: 规则引擎集成（0%）

- [ ] 扩展 `get_client_config` 函数
- [ ] 实现规则合并逻辑
- [ ] 测试验证

### Phase 5: 测试（0%）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 前端测试
- [ ] 端到端测试

---

## 技术决策

### 已确认的设计决策
- ✅ 扁平分组（无层级）
- ✅ 多对多关系（一个设备可属于多个组）
- ✅ 规则独立存储（支持复用）
- ✅ 简单优先级：客户端专属 > 组规则（创建时间倒序）> 全局规则
- ✅ 批量操作优先（批量移动、批量绑定）

### 数据库表结构
```sql
-- client_groups: 分组表
CREATE TABLE client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- client_group_memberships: 客户端-组关联表
CREATE TABLE client_group_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, group_id) ON CONFLICT REPLACE
);

-- client_group_rules: 规则-组关联表
CREATE TABLE client_group_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, rule_id, rule_type) ON CONFLICT REPLACE
);
```

### API 端点
```
GET    /api/v1/client-groups                          # 获取所有分组
POST   /api/v1/client-groups                          # 创建新分组
PUT    /api/v1/client-groups/{id}                      # 更新分组
DELETE /api/v1/client-groups/{id}                      # 删除分组
GET    /api/v1/client-groups/{id}/members              # 获取分组的客户端
POST   /api/v1/client-groups/{id}/members              # 批量添加客户端
DELETE /api/v1/client-groups/{id}/members              # 批量移除客户端
POST   /api/v1/clients/batch-move                      # 批量移动客户端
GET    /api/v1/client-groups/{id}/rules                # 获取分组规则
POST   /api/v1/client-groups/{id}/rules                # 批量绑定规则
DELETE /api/v1/client-groups/{id}/rules                # 批量解绑规则
```

---

## 待完成的工作

### 立即需要（阻塞编译）
1. 修复 `client_groups.rs` 的编译错误（需要运行迁移）
2. 修复 `query_log_advanced.rs` 的临时值借用错误（已部分修复）

### 短期目标（1-2 天）
1. 运行数据库迁移
2. 完成前端 API 封装
3. 实现 GroupTree 组件
4. 实现 ClientList 组件

### 中期目标（3-5 天）
1. 实现 GroupRulesPanel 组件
2. 实现 ClientGroupsPage 主页面
3. 扩展规则引擎 `get_client_config`
4. 实现缓存机制

### 长期目标（6-10 天）
1. 编写单元测试和集成测试
2. 端到端测试和手动验证
3. 性能优化和文档更新

---

## 风险和挑战

### 技术风险
1. **缓存一致性**: 分组规则变更时需要及时失效客户端缓存
2. **性能影响**: 大量客户端时，规则合并可能成为瓶颈
3. **并发控制**: 批量操作时需要处理并发冲突

### 用户体验风险
1. **复杂度**: 用户可能不理解多对多关系和优先级
2. **错误处理**: 批量操作失败时需要清晰的错误提示
3. **性能**: 拖拽排序在大量分组时可能卡顿

### 缓解措施
1. **缓存一致性**: 在所有分组/规则变更时失效相关客户端缓存
2. **性能影响**: 使用 moka 缓存（TTL 60s），减少数据库查询
3. **并发控制**: 使用 SQLite 事务和 UNIQUE 约束
4. **用户体验**: 提供详细的错误提示和操作预览

---

## 下一步行动

1. **运行数据库迁移**
   ```bash
   sqlite3 ent-dns.db < src/db/migrations/006_client_groups.sql
   ```

2. **修复编译错误**
   - 确保 `client_groups.rs` 正确编译
   - 修复 `query_log_advanced.rs` 的剩余错误

3. **验证后端功能**
   - 测试所有 API 端点
   - 验证缓存失效逻辑

4. **开始前端开发**
   - 实现 API 封装
   - 实现 GroupTree 组件

---

## 参考资料

- **设计文档**: `docs/interaction/client-groups-*.md`
- **数据库迁移**: `src/db/migrations/006_client_groups.sql`
- **Model 定义**: `src/db/models/client_group.rs`
- **API Handlers**: `src/api/handlers/client_groups.rs`
- **路由定义**: `src/api/router.rs`

---

## 备注

- 遵循 **Goal-Directed Design** 原则
- 所有设计文档已完成
- 后端基础架构已搭建（60% 完成）
- 前端开发待开始

**更新时间**: 2026-02-20
