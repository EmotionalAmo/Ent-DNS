# 客户端分组管理 — 数据库设计

## 设计原则

遵循 **Goal-Directed Design**，数据库结构应该反映用户的心理模型：
- 扁平分组（无层级）
- 多对多关系（一个设备可属于多个组）
- 规则独立存储（支持复用）

---

## 数据表设计

### 1. client_groups — 客户端组表

**用途**: 存储客户端分组的基本信息

```sql
CREATE TABLE client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1', -- Radix UI 默认紫色
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 0, -- 排序优先级，数字越小越靠前
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_client_groups_priority ON client_groups(priority);
CREATE INDEX idx_client_groups_name ON client_groups(name);
```

**字段说明**:
- `id`: 主键
- `name`: 组名，唯一（如"研发部门"、"隔离组"）
- `color`: 前端显示的颜色（HEX 格式，如 `#6366f1`）
- `description`: 组的描述（可选）
- `priority`: 排序优先级（支持拖拽排序）
- `created_at/updated_at`: 时间戳

**为什么这样设计**:
- ✅ 扁平结构，无 parent_id，符合用户"篮子"的心理模型
- ✅ 支持颜色标记，快速识别不同组
- ✅ 支持排序优先级，方便用户自定义顺序

---

### 2. client_group_memberships — 客户端-组关联表

**用途**: 实现客户端和组的多对多关系

```sql
CREATE TABLE client_group_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL, -- 关联 dns_clients.ip
    group_id INTEGER NOT NULL, -- 关联 client_groups.id
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, group_id) ON CONFLICT REPLACE
);

CREATE INDEX idx_memberships_client ON client_group_memberships(client_id);
CREATE INDEX idx_memberships_group ON client_group_memberships(group_id);
CREATE INDEX idx_memberships_client_group ON client_group_memberships(client_id, group_id);
```

**字段说明**:
- `id`: 主键
- `client_id`: 客户端标识（关联 `dns_clients.ip` 或自定义 client_id）
- `group_id`: 组 ID（关联 `client_groups.id`）
- `created_at`: 加入时间

**为什么这样设计**:
- ✅ 多对多关系，一个设备可属于多个组
- ✅ UNIQUE 约束避免重复关联
- ✅ 索引优化查询性能（按客户端查组、按组查客户端）

**关键查询**:
```sql
-- 查询某个客户端的所有组
SELECT g.*
FROM client_groups g
INNER JOIN client_group_memberships m ON g.id = m.group_id
WHERE m.client_id = ?;

-- 查询某个组的所有客户端
SELECT DISTINCT c.*
FROM dns_clients c
INNER JOIN client_group_memberships m ON c.ip = m.client_id
WHERE m.group_id = ?
ORDER BY c.last_seen DESC;
```

---

### 3. client_group_rules — 规则-组关联表

**用途**: 实现规则和组的多对多关系

```sql
CREATE TABLE client_group_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL, -- 关联 client_groups.id
    rule_id INTEGER NOT NULL, -- 关联 dns_rules.id 或 dns_filters.id 或 dns_rewrites.id
    rule_type TEXT NOT NULL, -- 'filter' | 'rewrite' | 'rule'
    priority INTEGER NOT NULL DEFAULT 0, -- 组内规则优先级，数字越小优先级越高
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, rule_id, rule_type) ON CONFLICT REPLACE
);

CREATE INDEX idx_group_rules_group ON client_group_rules(group_id);
CREATE INDEX idx_group_rules_rule ON client_group_rules(rule_id, rule_type);
CREATE INDEX idx_group_rules_priority ON client_group_rules(group_id, priority);
```

**字段说明**:
- `id`: 主键
- `group_id`: 组 ID（关联 `client_groups.id`）
- `rule_id`: 规则 ID（关联具体的规则表）
- `rule_type`: 规则类型（filter/rewrite/rule）
- `priority`: 组内规则优先级（支持拖拽排序）
- `created_at`: 绑定时间

**为什么这样设计**:
- ✅ 规则独立存储，支持复用（一个规则可绑定到多个组）
- ✅ 支持多种规则类型（filter/rewrite/rule）
- ✅ 支持组内规则优先级排序

**关键查询**:
```sql
-- 查询某个组的所有规则（按优先级排序）
SELECT r.*
FROM client_group_rules gr
INNER JOIN dns_filters r ON gr.rule_id = r.id
WHERE gr.group_id = ? AND gr.rule_type = 'filter'
ORDER BY gr.priority;

-- 查询某个规则绑定的所有组
SELECT g.*
FROM client_groups g
INNER JOIN client_group_rules gr ON g.id = gr.group_id
WHERE gr.rule_id = ? AND gr.rule_type = ?;
```

---

## 数据迁移

### Migration: 004_client_groups.sql

```sql
-- Migration: Add client groups support
-- Version: 004
-- Description: Create tables for client grouping and rule binding

-- 1. Create client_groups table
CREATE TABLE IF NOT EXISTS client_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_groups_priority
ON client_groups(priority);

CREATE INDEX IF NOT EXISTS idx_client_groups_name
ON client_groups(name);

-- 2. Create client_group_memberships table
CREATE TABLE IF NOT EXISTS client_group_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, group_id) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_memberships_client
ON client_group_memberships(client_id);

CREATE INDEX IF NOT EXISTS idx_memberships_group
ON client_group_memberships(group_id);

CREATE INDEX IF NOT EXISTS idx_memberships_client_group
ON client_group_memberships(client_id, group_id);

-- 3. Create client_group_rules table
CREATE TABLE IF NOT EXISTS client_group_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    rule_type TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, rule_id, rule_type) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_group_rules_group
ON client_group_rules(group_id);

CREATE INDEX IF NOT EXISTS idx_group_rules_rule
ON client_group_rules(rule_id, rule_type);

CREATE INDEX IF NOT EXISTS idx_group_rules_priority
ON client_group_rules(group_id, priority);
```

**迁移策略**:
- ✅ 零中断迁移（所有现有客户端自动归为"未分组"）
- ✅ 使用 `IF NOT EXISTS` 避免重复创建
- ✅ 索引优化后续查询性能

---

## 数据完整性约束

### 删除级联策略

**组删除时**:
- ❌ 不级联删除客户端（客户端移至"未分组"）
- ✅ 级联删除 `client_group_memberships` 记录
- ✅ 级联删除 `client_group_rules` 记录

**实现方式**: 在应用层处理删除逻辑（不使用 ON DELETE CASCADE）

```sql
-- 为什么不用 ON DELETE CASCADE?
-- 1. 需要在删除前显示影响范围（设备数量 + 规则数量）
-- 2. 需要记录审计日志
-- 3. 需要提供软删除或归档选项
```

### 约束验证

```sql
-- 1. 组名唯一性
SELECT id FROM client_groups WHERE name = ?;

-- 2. 客户端-组关联唯一性
-- (UNIQUE(client_id, group_id) 自动保证)

-- 3. 规则-组关联唯一性
-- (UNIQUE(group_id, rule_id, rule_type) 自动保证)

-- 4. 验证规则类型有效性
-- (在应用层校验 rule_type IN ('filter', 'rewrite', 'rule'))
```

---

## 性能优化

### 查询优化策略

**高频查询（DNS 查询时）**:
```sql
-- 获取客户端的所有组规则（在 DNS 查询时调用）
-- 缓存策略: 在 AppState 中缓存 (TTL 60s)
WITH client_groups AS (
    SELECT g.id
    FROM client_groups g
    INNER JOIN client_group_memberships m ON g.id = m.group_id
    WHERE m.client_id = ?
)
SELECT
    r.*,
    gr.priority AS group_rule_priority
FROM client_group_rules gr
INNER JOIN client_groups cg ON gr.group_id = cg.id
INNER JOIN dns_filters r ON gr.rule_id = r.id
WHERE gr.rule_type = 'filter'
ORDER BY gr.priority;
```

**低频查询（管理页面）**:
```sql
-- 获取所有组及设备数量（管理页面列表）
SELECT
    g.*,
    COUNT(DISTINCT m.client_id) AS client_count
FROM client_groups g
LEFT JOIN client_group_memberships m ON g.id = m.group_id
GROUP BY g.id
ORDER BY g.priority;
```

**索引优化**:
- ✅ 所有外键字段都创建了索引
- ✅ 复合索引优化多字段查询（如 `idx_memberships_client_group`）
- ✅ 排序索引优化列表查询（如 `idx_client_groups_priority`）

---

## 数据清理策略

**清理策略**: 不自动删除客户端记录（保留历史数据用于审计）

**归档功能（可选）**:
- 提供"归档组"功能（软删除）
- 归档的组不显示在主列表中
- 归档的组规则不生效

**实现方式**:
```sql
-- 扩展 client_groups 表
ALTER TABLE client_groups ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

-- 查询时过滤
SELECT * FROM client_groups WHERE is_archived = 0;
```

---

## 下一步

- [x] 数据库表设计
- [ ] API 端点设计
- [ ] UI 组件设计
- [ ] 规则引擎集成逻辑
- [ ] 数据迁移实现
