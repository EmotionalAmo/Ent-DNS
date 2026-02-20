# 客户端分组管理 — 规则引擎集成

## 设计原则

遵循 **Goal-Directed Design**，规则引擎应该满足用户的需求：
- 优先级清晰（客户端专属 > 组规则 > 全局规则）
- 冲突可预测（基于创建时间倒序）
- 性能优化（缓存机制）

---

## 规则优先级体系

### 三级优先级

| 级别 | 来源 | 优先级值 | 说明 |
|------|------|----------|------|
| 客户端专属 | `dns_clients` 表的专属规则 | -1 | 最高优先级，仅影响单个客户端 |
| 组规则 | `client_group_rules` 表 | 0-999 | 中等优先级，按组内 `priority` 排序 |
| 全局规则 | `dns_filters`/`dns_rewrites` 表（无组绑定） | 1000+ | 最低优先级，所有客户端默认应用 |

**优先级排序公式**:
```rust
fn sort_rules(rules: Vec<DnsRule>) -> Vec<DnsRule> {
    rules.sort_by(|a, b| {
        match (a.source, b.source) {
            (RuleSource::Client, RuleSource::Client) => a.priority.cmp(&b.priority),
            (RuleSource::Client, _) => Ordering::Less,
            (_, RuleSource::Client) => Ordering::Greater,
            (RuleSource::Group, RuleSource::Group) => a.priority.cmp(&b.priority),
            (RuleSource::Group, RuleSource::Global) => Ordering::Less,
            (RuleSource::Global, RuleSource::Group) => Ordering::Greater,
            (RuleSource::Global, RuleSource::Global) => a.created_at.cmp(&b.created_at).reverse(),
        }
    });
    rules
}
```

---

## 规则合并逻辑

### 步骤 1: 获取客户端专属规则

```sql
-- 从 dns_clients 表获取客户端专属规则
SELECT
    r.*,
    'client' AS source,
    -1 AS priority
FROM dns_client_rules cr
INNER JOIN dns_filters r ON cr.rule_id = r.id AND cr.rule_type = 'filter'
WHERE cr.client_id = ?
UNION ALL
SELECT
    r.*,
    'client' AS source,
    -1 AS priority
FROM dns_client_rules cr
INNER JOIN dns_rewrites r ON cr.rule_id = r.id AND cr.rule_type = 'rewrite'
WHERE cr.client_id = ?;
```

### 步骤 2: 获取组规则

```sql
-- 从 client_group_rules 表获取组规则
WITH client_groups AS (
    SELECT g.id
    FROM client_groups g
    INNER JOIN client_group_memberships m ON g.id = m.group_id
    WHERE m.client_id = ?
)
SELECT
    f.*,
    'group' AS source,
    gr.priority,
    g.name AS group_name
FROM client_group_rules gr
INNER JOIN client_groups cg ON gr.group_id = cg.id
INNER JOIN client_groups g ON gr.group_id = g.id
INNER JOIN dns_filters f ON gr.rule_id = f.id
WHERE gr.rule_type = 'filter'
UNION ALL
SELECT
    r.*,
    'group' AS source,
    gr.priority,
    g.name AS group_name
FROM client_group_rules gr
INNER JOIN client_groups cg ON gr.group_id = cg.id
INNER JOIN client_groups g ON gr.group_id = g.id
INNER JOIN dns_rewrites r ON gr.rule_id = r.id
WHERE gr.rule_type = 'rewrite';
```

### 步骤 3: 获取全局规则

```sql
-- 获取所有未绑定到组的规则（全局规则）
SELECT
    f.*,
    'global' AS source,
    1000 AS priority,
    NULL AS group_name
FROM dns_filters f
WHERE f.id NOT IN (
    SELECT rule_id
    FROM client_group_rules
    WHERE rule_type = 'filter'
)
UNION ALL
SELECT
    r.*,
    'global' AS source,
    1000 AS priority,
    NULL AS group_name
FROM dns_rewrites r
WHERE r.id NOT IN (
    SELECT rule_id
    FROM client_group_rules
    WHERE rule_type = 'rewrite'
);
```

### 步骤 4: 合并并排序

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRule {
    pub id: i64,
    pub rule_type: String, // "filter" | "rewrite"
    pub pattern: String,
    pub action: String,    // "allow" | "block" | "rewrite"
    pub source: String,    // "client" | "group" | "global"
    pub priority: i32,
    pub group_name: Option<String>,
    pub created_at: String,
}

pub async fn get_client_rules(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Vec<DnsRule>, anyhow::Error> {
    let mut rules = Vec::new();

    // 1. 获取客户端专属规则
    let client_rules = sqlx::query_as::<_, DnsRule>(
        r#"
        SELECT
            f.id,
            'filter' AS rule_type,
            f.pattern,
            f.action,
            'client' AS source,
            -1 AS priority,
            NULL AS group_name,
            f.created_at
        FROM dns_client_rules cr
        INNER JOIN dns_filters f ON cr.rule_id = f.id AND cr.rule_type = 'filter'
        WHERE cr.client_id = ?1
        UNION ALL
        SELECT
            r.id,
            'rewrite' AS rule_type,
            r.domain,
            'rewrite' AS action,
            'client' AS source,
            -1 AS priority,
            NULL AS group_name,
            r.created_at
        FROM dns_client_rules cr
        INNER JOIN dns_rewrites r ON cr.rule_id = r.id AND cr.rule_type = 'rewrite'
        WHERE cr.client_id = ?1
        "#
    )
    .bind(client_id)
    .fetch_all(pool)
    .await?;

    rules.extend(client_rules);

    // 2. 获取组规则
    let group_rules = sqlx::query_as::<_, DnsRule>(
        r#"
        WITH client_groups AS (
            SELECT g.id
            FROM client_groups g
            INNER JOIN client_group_memberships m ON g.id = m.group_id
            WHERE m.client_id = ?1
        )
        SELECT
            f.id,
            'filter' AS rule_type,
            f.pattern,
            f.action,
            'group' AS source,
            gr.priority,
            g.name AS group_name,
            f.created_at
        FROM client_group_rules gr
        INNER JOIN client_groups cg ON gr.group_id = cg.id
        INNER JOIN client_groups g ON gr.group_id = g.id
        INNER JOIN dns_filters f ON gr.rule_id = f.id
        WHERE gr.rule_type = 'filter'
        AND gr.group_id IN (SELECT id FROM client_groups)
        UNION ALL
        SELECT
            r.id,
            'rewrite' AS rule_type,
            r.domain,
            'rewrite' AS action,
            'group' AS source,
            gr.priority,
            g.name AS group_name,
            r.created_at
        FROM client_group_rules gr
        INNER JOIN client_groups cg ON gr.group_id = cg.id
        INNER JOIN client_groups g ON gr.group_id = g.id
        INNER JOIN dns_rewrites r ON gr.rule_id = r.id
        WHERE gr.rule_type = 'rewrite'
        AND gr.group_id IN (SELECT id FROM client_groups)
        "#
    )
    .bind(client_id)
    .fetch_all(pool)
    .await?;

    rules.extend(group_rules);

    // 3. 获取全局规则（未绑定到组的规则）
    let global_rules = sqlx::query_as::<_, DnsRule>(
        r#"
        SELECT
            f.id,
            'filter' AS rule_type,
            f.pattern,
            f.action,
            'global' AS source,
            1000 AS priority,
            NULL AS group_name,
            f.created_at
        FROM dns_filters f
        WHERE f.id NOT IN (
            SELECT rule_id
            FROM client_group_rules
            WHERE rule_type = 'filter'
        )
        UNION ALL
        SELECT
            r.id,
            'rewrite' AS rule_type,
            r.domain,
            'rewrite' AS action,
            'global' AS source,
            1000 AS priority,
            NULL AS group_name,
            r.created_at
        FROM dns_rewrites r
        WHERE r.id NOT IN (
            SELECT rule_id
            FROM client_group_rules
            WHERE rule_type = 'rewrite'
        )
        "#
    )
    .fetch_all(pool)
    .await?;

    rules.extend(global_rules);

    // 4. 排序
    rules.sort_by(|a, b| {
        match (a.source.as_str(), b.source.as_str()) {
            ("client", "client") => a.priority.cmp(&b.priority),
            ("client", _) => Ordering::Less,
            (_, "client") => Ordering::Greater,
            ("group", "group") => a.priority.cmp(&b.priority),
            ("group", "global") => Ordering::Less,
            ("global", "group") => Ordering::Greater,
            ("global", "global") => a.created_at.cmp(&b.created_at).reverse(),
            _ => Ordering::Equal,
        }
    });

    Ok(rules)
}
```

---

## 规则应用逻辑

### Filter 规则应用

```rust
pub fn apply_filters(rules: &[DnsRule], domain: &str) -> Option<FilterAction> {
    for rule in rules {
        if rule.rule_type == "filter" && match_pattern(&rule.pattern, domain) {
            return match rule.action.as_str() {
                "block" => Some(FilterAction::Block(rule.clone())),
                "allow" => Some(FilterAction::Allow(rule.clone())),
                _ => None,
            };
        }
    }
    None
}

fn match_pattern(pattern: &str, domain: &str) -> bool {
    // 简单通配符匹配（* 匹配任意字符）
    let pattern = pattern.replace('*', ".*");
    let regex = Regex::new(&format!("^{}$", pattern)).unwrap();
    regex.is_match(domain)
}
```

### Rewrite 规则应用

```rust
pub fn apply_rewrites(rules: &[DnsRule], domain: &str) -> Option<RewriteAction> {
    for rule in rules {
        if rule.rule_type == "rewrite" && match_pattern(&rule.pattern, domain) {
            return Some(RewriteAction {
                original_domain: domain.to_string(),
                rewritten_domain: rule.replacement.clone(),
                rule: rule.clone(),
            });
        }
    }
    None
}
```

---

## 性能优化

### 缓存策略

```rust
use moka::future::Cache;

pub struct ClientConfigCache {
    cache: Cache<String, Vec<DnsRule>>,
}

impl ClientConfigCache {
    pub fn new() -> Self {
        Self {
            cache: Cache::builder()
                .time_to_live(Duration::from_secs(60)) // TTL 60s
                .max_capacity(4096)
                .build(),
        }
    }

    pub async fn get_or_load<F, Fut>(
        &self,
        client_id: &str,
        loader: F,
    ) -> Result<Vec<DnsRule>, anyhow::Error>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Result<Vec<DnsRule>, anyhow::Error>>,
    {
        self.cache
            .try_get_with(client_id.to_string(), loader(client_id.to_string()))
            .await
            .map_err(|e| anyhow::anyhow!("Cache error: {}", e))
    }

    pub fn invalidate(&self, client_id: &str) {
        self.cache.invalidate(client_id);
    }

    pub fn invalidate_all(&self) {
        self.cache.invalidate_all();
    }
}
```

**缓存失效策略**:
- ✅ 客户端分组变更 → 失效该客户端缓存
- ✅ 组规则变更 → 失效该组所有客户端缓存
- ✅ 全局规则变更 → 失效所有缓存

### 批量失效

```rust
pub fn invalidate_group_clients(cache: &ClientConfigCache, pool: &SqlitePool, group_id: i64) {
    let client_ids: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT client_id
        FROM client_group_memberships
        WHERE group_id = ?
        "#
    )
    .bind(group_id)
    .fetch_all(pool)
    .await
    .unwrap();

    for client_id in client_ids {
        cache.invalidate(&client_id);
    }
}
```

---

## 规则冲突检测

### 冲突类型

1. **同源冲突**: 同一个客户端/组有两条相同优先级的规则
2. **跨源冲突**: 不同优先级的规则对同一个域名的处理冲突

### 冲突检测算法

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleConflict {
    pub domain: String,
    pub rules: Vec<DnsRule>,
    pub recommendation: String,
}

pub fn detect_conflicts(rules: &[DnsRule], test_domains: &[&str]) -> Vec<RuleConflict> {
    let mut conflicts = Vec::new();

    for domain in test_domains {
        let mut matching_rules = Vec::new();

        for rule in rules {
            if match_pattern(&rule.pattern, domain) {
                matching_rules.push(rule.clone());
            }
        }

        if matching_rules.len() > 1 {
            // 检查是否有冲突（例如一个 block，一个 allow）
            let has_block = matching_rules.iter().any(|r| r.action == "block");
            let has_allow = matching_rules.iter().any(|r| r.action == "allow");

            if has_block && has_allow {
                let conflict = RuleConflict {
                    domain: domain.to_string(),
                    rules: matching_rules,
                    recommendation: "Review rule priority: higher priority rules will take precedence".to_string(),
                };
                conflicts.push(conflict);
            }
        }
    }

    conflicts
}
```

---

## 测试验证

### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rule_sorting() {
        let mut rules = vec![
            DnsRule {
                id: 1,
                source: "global".to_string(),
                priority: 1000,
                created_at: "2026-02-20T10:00:00Z".to_string(),
                ..Default::default()
            },
            DnsRule {
                id: 2,
                source: "client".to_string(),
                priority: -1,
                created_at: "2026-02-20T10:00:00Z".to_string(),
                ..Default::default()
            },
            DnsRule {
                id: 3,
                source: "group".to_string(),
                priority: 0,
                created_at: "2026-02-20T10:00:00Z".to_string(),
                ..Default::default()
            },
        ];

        sort_rules(&mut rules);

        assert_eq!(rules[0].source, "client");
        assert_eq!(rules[1].source, "group");
        assert_eq!(rules[2].source, "global");
    }

    #[test]
    fn test_pattern_matching() {
        assert!(match_pattern("*github*", "github.com"));
        assert!(match_pattern("*github*", "api.github.com"));
        assert!(!match_pattern("*github*", "gitlab.com"));
        assert!(match_pattern("example.com", "example.com"));
    }
}
```

### 集成测试

```rust
#[tokio::test]
async fn test_get_client_rules() {
    let pool = create_test_pool().await;
    let client_id = "192.168.1.100";

    // 插入测试数据
    insert_test_group(&pool, "研发部门", 0).await;
    insert_test_group_rules(&pool, 1, 1, "filter", 0).await;
    insert_test_membership(&pool, 1, client_id).await;

    // 获取规则
    let rules = get_client_rules(&pool, client_id).await.unwrap();

    // 验证
    assert!(rules.len() > 0);
    assert!(rules.iter().any(|r| r.source == "group"));
}
```

---

## 下一步

- [x] 规则引擎集成逻辑
- [ ] 数据迁移实现
- [ ] 后端实现（Model, Handler, Routes）
- [ ] 前端实现（GroupTree, ClientList, GroupRulesPanel）
- [ ] 测试验证
