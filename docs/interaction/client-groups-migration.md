# 客户端分组管理 — 数据迁移

## 设计原则

遵循 **零中断迁移** 原则，确保现有数据和功能不受影响：
- 向后兼容（所有现有客户端自动归为"未分组"）
- 事务安全（迁移失败时回滚）
- 可回滚（提供回滚脚本）

---

## 迁移策略

### 迁移步骤

1. **创建新表**（零中断）
   - 创建 `client_groups` 表
   - 创建 `client_group_memberships` 表
   - 创建 `client_group_rules` 表
   - 创建索引

2. **验证迁移**
   - 检查表结构
   - 检查索引
   - 检查约束

3. **回滚计划**
   - 提供回滚脚本
   - 记录迁移版本

---

## Migration: 004_client_groups.sql

```sql
-- Migration: Add client groups support
-- Version: 004
-- Date: 2026-02-20
-- Author: interaction-cooper (Alan Cooper)
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

-- Indexes for client_groups
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

-- Indexes for client_group_memberships
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

-- Indexes for client_group_rules
CREATE INDEX IF NOT EXISTS idx_group_rules_group
ON client_group_rules(group_id);

CREATE INDEX IF NOT EXISTS idx_group_rules_rule
ON client_group_rules(rule_id, rule_type);

CREATE INDEX IF NOT EXISTS idx_group_rules_priority
ON client_group_rules(group_id, priority);

-- 4. Insert default groups (optional)
INSERT OR IGNORE INTO client_groups (name, color, description, priority)
VALUES
    ('未分组', '#94a3b8', '未分组的客户端', 9999);

-- 5. Record migration version
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version)
VALUES (4);
```

---

## 回滚脚本: rollback_004_client_groups.sql

```sql
-- Rollback: Remove client groups support
-- Version: 004
-- Date: 2026-02-20
-- Description: Drop tables for client grouping and rule binding

-- 1. Drop tables (order matters due to foreign keys)
DROP TABLE IF EXISTS client_group_rules;
DROP TABLE IF EXISTS client_group_memberships;
DROP TABLE IF EXISTS client_groups;

-- 2. Remove migration version
DELETE FROM schema_migrations WHERE version = 4;
```

---

## 迁移验证

### 验证脚本

```sql
-- Verify migration 004

-- 1. Check tables exist
SELECT
    name,
    type
FROM sqlite_master
WHERE name IN ('client_groups', 'client_group_memberships', 'client_group_rules')
ORDER BY name;

-- Expected output:
-- | client_groups                | table    |
-- | client_group_memberships     | table    |
-- | client_group_rules           | table    |

-- 2. Check indexes
SELECT
    tbl_name,
    name
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name IN ('client_groups', 'client_group_memberships', 'client_group_rules')
ORDER BY tbl_name, name;

-- Expected output:
-- | client_groups                | idx_client_groups_name          |
-- | client_groups                | idx_client_groups_priority       |
-- | client_group_memberships     | idx_memberships_client          |
-- | client_group_memberships     | idx_memberships_client_group    |
-- | client_group_memberships     | idx_memberships_group           |
-- | client_group_rules           | idx_group_rules_group           |
-- | client_group_rules           | idx_group_rules_priority        |
-- | client_group_rules           | idx_group_rules_rule            |

-- 3. Check constraints
PRAGMA index_list('client_groups');
-- Expected: UNIQUE index on 'name'

PRAGMA index_list('client_group_memberships');
-- Expected: UNIQUE index on ('client_id', 'group_id')

PRAGMA index_list('client_group_rules');
-- Expected: UNIQUE index on ('group_id', 'rule_id', 'rule_type')

-- 4. Check migration version
SELECT * FROM schema_migrations WHERE version = 4;
-- Expected: version=4, applied_at=<timestamp>
```

---

## Rust 迁移实现

### Migration Runner

```rust
use sqlx::{Pool, Sqlite};

pub async fn run_migration(pool: &Pool<Sqlite>, version: i32) -> Result<(), anyhow::Error> {
    match version {
        4 => run_migration_004(pool).await,
        _ => Err(anyhow::anyhow!("Unknown migration version: {}", version)),
    }
}

async fn run_migration_004(pool: &Pool<Sqlite>) -> Result<(), anyhow::Error> {
    let migration_sql = include_str!("migrations/004_client_groups.sql");

    let mut tx = pool.begin().await?;

    sqlx::query(migration_sql)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    log::info!("Migration 004 (client groups) applied successfully");

    Ok(())
}

pub async fn rollback_migration(pool: &Pool<Sqlite>, version: i32) -> Result<(), anyhow::Error> {
    match version {
        4 => rollback_migration_004(pool).await,
        _ => Err(anyhow::anyhow!("Unknown migration version: {}", version)),
    }
}

async fn rollback_migration_004(pool: &Pool<Sqlite>) -> Result<(), anyhow::Error> {
    let rollback_sql = include_str!("migrations/rollback_004_client_groups.sql");

    let mut tx = pool.begin().await?;

    sqlx::query(rollback_sql)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    log::info!("Migration 004 (client groups) rolled back successfully");

    Ok(())
}

pub async fn get_current_version(pool: &Pool<Sqlite>) -> Result<Option<i32>, anyhow::Error> {
    let version = sqlx::query_scalar::<_, i32>(
        r#"
        SELECT MAX(version) FROM schema_migrations
        "#
    )
    .fetch_optional(pool)
    .await?;

    Ok(version)
}
```

### 自动迁移（启动时）

```rust
pub async fn ensure_migrations(pool: &Pool<Sqlite>) -> Result<(), anyhow::Error> {
    let current_version = get_current_version(pool).await?.unwrap_or(0);

    let required_version = 4; // Latest migration version

    if current_version < required_version {
        log::info!("Running migrations: {} -> {}", current_version, required_version);

        for version in (current_version + 1)..=required_version {
            run_migration(pool, version).await?;
        }

        log::info!("All migrations applied successfully");
    } else if current_version > required_version {
        log::warn!("Database version ({}) is newer than required ({})", current_version, required_version);
    }

    Ok(())
}
```

---

## 测试迁移

### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_migration_004() {
        let pool = create_test_pool().await;

        // Run migration
        run_migration_004(&pool).await.unwrap();

        // Verify tables exist
        let tables = sqlx::query::<_, (String,)>(
            r#"
            SELECT name
            FROM sqlite_master
            WHERE name IN ('client_groups', 'client_group_memberships', 'client_group_rules')
            ORDER BY name
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(tables.len(), 3);
        assert_eq!(tables[0].0, "client_groups");
        assert_eq!(tables[1].0, "client_group_memberships");
        assert_eq!(tables[2].0, "client_group_rules");

        // Rollback
        rollback_migration_004(&pool).await.unwrap();

        // Verify tables dropped
        let tables = sqlx::query::<_, (String,)>(
            r#"
            SELECT name
            FROM sqlite_master
            WHERE name IN ('client_groups', 'client_group_memberships', 'client_group_rules')
            ORDER BY name
            "#
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(tables.len(), 0);
    }
}
```

### 集成测试

```rust
#[tokio::test]
async fn test_migration_with_existing_data() {
    let pool = create_test_pool().await;

    // Insert test data (existing clients)
    sqlx::query(
        r#"
        INSERT INTO dns_clients (ip, name, mac, last_seen)
        VALUES ('192.168.1.100', 'Test Client', '00:11:22:33:44:55', datetime('now'))
        "#
    )
    .execute(&pool)
    .await
    .unwrap();

    // Run migration
    ensure_migrations(&pool).await.unwrap();

    // Verify existing data is not affected
    let client = sqlx::query::<_, (String,)>(
        r#"
        SELECT name FROM dns_clients WHERE ip = '192.168.1.100'
        "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(client.0, "Test Client");
}
```

---

## 生产部署指南

### 部署前检查清单

- [ ] 在测试环境验证迁移
- [ ] 备份生产数据库
- [ ] 验证回滚脚本可用
- [ ] 准备回滚计划

### 部署步骤

1. **备份生产数据库**
   ```bash
   cp /path/to/production.db /path/to/production.db.backup
   ```

2. **停止服务**
   ```bash
   systemctl stop ent-dns
   ```

3. **运行迁移**
   ```bash
   # 手动运行迁移
   sqlite3 /path/to/production.db < migrations/004_client_groups.sql

   # 或通过应用程序自动运行迁移（启动时）
   ```

4. **验证迁移**
   ```bash
   # 运行验证脚本
   sqlite3 /path/to/production.db < migrations/verify_004_client_groups.sql
   ```

5. **启动服务**
   ```bash
   systemctl start ent-dns
   ```

6. **监控日志**
   ```bash
   journalctl -u ent-dns -f
   ```

### 回滚步骤（如果迁移失败）

1. **停止服务**
   ```bash
   systemctl stop ent-dns
   ```

2. **回滚数据库**
   ```bash
   sqlite3 /path/to/production.db < migrations/rollback_004_client_groups.sql
   ```

3. **恢复备份（如果需要）**
   ```bash
   cp /path/to/production.db.backup /path/to/production.db
   ```

4. **启动服务**
   ```bash
   systemctl start ent-dns
   ```

---

## 下一步

- [x] 数据迁移设计
- [ ] 后端实现（Model, Handler, Routes）
- [ ] 前端实现（GroupTree, ClientList, GroupRulesPanel）
- [ ] 规则引擎集成
- [ ] 测试验证
