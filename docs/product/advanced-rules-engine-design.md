# 高级规则执行引擎技术设计

> 后端实现方案与架构决策

---

## 1. 架构概述

### 1.1 系统组件

```
┌─────────────────────────────────────────────────────────────┐
│                      DNS Query Hot Path                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Query → FilterEngine → AdvancedRuleEngine → Evaluation     │
│                                        │                   │
│                                        ▼                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ExactMatch   │  │ SuffixMatch  │  │ RegexMatch   │      │
│  │ (O(1))       │  │ (O(k))       │  │ (O(n))       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│                            ▼                                 │
│                   ┌──────────────┐                           │
│                   │ Conditional  │                           │
│                   │ Evaluation   │                           │
│                   │ (O(m))       │                           │
│                   └──────────────┘                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

k = 域名标签数 (e.g., www.example.com = 3)
n = 正则规则数
m = 条件规则数
```

### 1.2 执行流程

```rust
pub async fn evaluate(&self, ctx: &RuleContext) -> Result<EvaluationResult> {
    // 1. 精确匹配 (O(1)) - 最快
    if let Some(rule) = self.exact_match(&ctx.domain).await {
        return Ok(rule.to_result());
    }

    // 2. 后缀匹配 (O(k)) - 次
    if let Some(rule) = self.suffix_match(&ctx.domain).await {
        return Ok(rule.to_result());
    }

    // 3. 正则匹配 (O(n)) - spawn_blocking
    if let Some(rule) = self.regex_match(&ctx.domain).await? {
        return Ok(rule.to_result());
    }

    // 4. 条件评估 (O(m)) - 最慢
    if let Some(rule) = self.evaluate_conditions(ctx).await? {
        return Ok(rule.to_result());
    }

    Ok(EvaluationResult::NoMatch)
}
```

---

## 2. 数据结构设计

### 2.1 规则数据模型

```rust
/// 规则类型
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RuleType {
    Domain,      // 精确域名: ||example.com^
    Suffix,      // 域名后缀: *.example.com
    Regex,       // 正则表达式: /ads\./i
    Conditional, // 条件规则: IF ... THEN ...
}

/// 规则动作
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleAction {
    Block,
    Allow,
    Rewrite(IpAddr),
}

/// 高级规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedRule {
    pub id: String,
    pub name: String,
    pub rule_type: RuleType,
    pub pattern: Option<String>,          // 域名或正则模式
    pub action: RuleAction,
    pub conditions: Option<LogicalCondition>,
    pub priority: i32,
    pub is_enabled: bool,
    pub comment: Option<String>,
    pub match_count: u64,
    pub last_matched: Option<DateTime<Utc>>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 编译后的规则（运行时使用）
#[derive(Debug, Clone)]
pub struct CompiledRule {
    pub rule_id: String,
    pub action: RuleAction,
    pub priority: i32,
}

/// 精确域名规则
#[derive(Debug, Clone)]
pub struct ExactDomainRule {
    pub inner: CompiledRule,
    pub domain: String,
}

/// 后缀域名规则
#[derive(Debug, Clone)]
pub struct SuffixDomainRule {
    pub inner: CompiledRule,
    pub suffix: String,
}

/// 正则规则
#[derive(Debug, Clone)]
pub struct RegexRule {
    pub inner: CompiledRule,
    pub pattern: String,
    pub regex: Arc<Regex>,
    pub flags: String,
}

/// 条件规则
#[derive(Debug, Clone)]
pub struct ConditionalRule {
    pub inner: CompiledRule,
    pub conditions: LogicalCondition,
}
```

### 2.2 条件表达式

```rust
/// 条件字段
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConditionField {
    Domain,
    QType,
    ClientIp,
    ClientName,
    Time,
    Day,
}

/// 条件操作符
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConditionOperator {
    Equals,
    Regex,
    In,
}

/// 简单条件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleCondition {
    pub field: ConditionField,
    pub operator: ConditionOperator,
    pub value: String,
}

/// 逻辑运算符
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogicalOperator {
    And,
    Or,
    Not,
}

/// 逻辑条件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogicalCondition {
    pub operator: LogicalOperator,
    pub conditions: Vec<SubCondition>,
}

/// 子条件（简单或逻辑）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SubCondition {
    Simple(SimpleCondition),
    Logical(LogicalCondition),
}
```

### 2.3 查询上下文

```rust
/// 查询上下文（单次 DNS 查询）
#[derive(Debug, Clone)]
pub struct RuleContext {
    pub domain: String,
    pub qtype: String,
    pub client_ip: String,
    pub time: DateTime<Utc>,
}

/// 评估结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResult {
    pub matched: bool,
    pub action: Option<RuleAction>,
    pub rule_id: Option<String>,
    pub error: Option<String>,
}
```

---

## 3. 核心引擎实现

### 3.1 引擎结构

```rust
use anyhow::Result;
use moka::future::Cache as MokaCache;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 高级规则引擎
pub struct AdvancedRuleEngine {
    /// 精确域名匹配: domain -> rule
    exact_rules: RwLock<HashMap<String, Arc<ExactDomainRule>>>,

    /// 后缀域名匹配: suffix -> rule
    suffix_rules: RwLock<HashMap<String, Arc<SuffixDomainRule>>>,

    /// 正则规则（按优先级排序）
    regex_rules: RwLock<Vec<Arc<RegexRule>>>,

    /// 条件规则（按优先级排序）
    conditional_rules: RwLock<Vec<Arc<ConditionalRule>>>,

    /// 正则缓存（避免重复编译）
    regex_cache: MokaCache<String, Arc<Regex>>,

    /// 规则统计（匹配次数）
    rule_stats: Arc<DashMap<String, RuleStats>>,

    /// 数据库连接池（用于更新统计）
    db: DbPool,
}

/// 规则统计
#[derive(Debug, Clone)]
pub struct RuleStats {
    pub match_count: u64,
    pub last_matched: Option<DateTime<Utc>>,
}

impl AdvancedRuleEngine {
    pub async fn new(db: DbPool) -> Result<Self> {
        Ok(Self {
            exact_rules: RwLock::new(HashMap::new()),
            suffix_rules: RwLock::new(HashMap::new()),
            regex_rules: RwLock::new(Vec::new()),
            conditional_rules: RwLock::new(Vec::new()),
            regex_cache: MokaCache::builder()
                .max_capacity(10_000)
                .time_to_live(Duration::from_secs(3600))
                .build(),
            rule_stats: Arc::new(DashMap::new()),
            db,
        })
    }

    /// 重新加载规则（从数据库）
    pub async fn reload(&self) -> Result<()> {
        let mut new_exact = HashMap::new();
        let mut new_suffix = HashMap::new();
        let mut new_regex = Vec::new();
        let mut new_conditional = Vec::new();

        // 从数据库加载规则
        let rules: Vec<AdvancedRule> = sqlx::query_as(
            "SELECT * FROM advanced_rules WHERE is_enabled = 1 ORDER BY priority ASC"
        )
        .fetch_all(&self.db)
        .await?;

        for rule in &rules {
            match rule.rule_type {
                RuleType::Domain => {
                    if let Some(pattern) = &rule.pattern {
                        new_exact.insert(
                            pattern.to_lowercase(),
                            Arc::new(ExactDomainRule {
                                inner: CompiledRule {
                                    rule_id: rule.id.clone(),
                                    action: rule.action.clone(),
                                    priority: rule.priority,
                                },
                                domain: pattern.to_lowercase(),
                            })
                        );
                    }
                }
                RuleType::Regex => {
                    if let Some(pattern) = &rule.pattern {
                        let regex = self.compile_regex(pattern).await?;
                        new_regex.push(Arc::new(RegexRule {
                            inner: CompiledRule {
                                rule_id: rule.id.clone(),
                                action: rule.action.clone(),
                                priority: rule.priority,
                            },
                            pattern: pattern.clone(),
                            regex,
                            flags: "".to_string(), // 从 pattern 解析
                        }));
                    }
                }
                RuleType::Conditional => {
                    if let Some(conditions) = &rule.conditions {
                        new_conditional.push(Arc::new(ConditionalRule {
                            inner: CompiledRule {
                                rule_id: rule.id.clone(),
                                action: rule.action.clone(),
                                priority: rule.priority,
                            },
                            conditions: conditions.clone(),
                        }));
                    }
                }
                _ => {}
            }
        }

        // 原子更新
        *self.exact_rules.write().await = new_exact;
        *self.regex_rules.write().await = new_regex;
        *self.conditional_rules.write().await = new_conditional;

        tracing::info!(
            "Advanced rule engine reloaded: {} exact, {} regex, {} conditional",
            self.exact_rules.read().await.len(),
            self.regex_rules.read().await.len(),
            self.conditional_rules.read().await.len(),
        );

        Ok(())
    }
}
```

### 3.2 精确匹配

```rust
impl AdvancedRuleEngine {
    async fn exact_match(&self, domain: &str) -> Option<Arc<CompiledRule>> {
        let domain = domain.trim_end_matches('.').to_lowercase();
        let rules = self.exact_rules.read().await;
        let rule = rules.get(&domain).cloned();
        if let Some(ref rule) = rule {
            self.record_match(&rule.inner).await;
        }
        rule.map(|r| r.inner)
    }
}
```

### 3.3 后缀匹配

```rust
impl AdvancedRuleEngine {
    async fn suffix_match(&self, domain: &str) -> Option<Arc<CompiledRule>> {
        let domain = domain.trim_end_matches('.').to_lowercase();
        let rules = self.suffix_rules.read().await;

        // 遍历域名标签: www.example.com → example.com → com
        let mut current = domain.as_str();
        loop {
            if let Some(rule) = rules.get(current) {
                self.record_match(&rule.inner).await;
                return Some(rule.inner.clone());
            }

            // 移动到父域名
            match current.find('.') {
                Some(pos) => current = &current[pos + 1..],
                None => return None,
            }
        }
    }
}
```

### 3.4 正则匹配

```rust
const REGEX_TIMEOUT: Duration = Duration::from_millis(100);

impl AdvancedRuleEngine {
    async fn regex_match(&self, domain: &str) -> Result<Option<Arc<CompiledRule>>> {
        let rules = self.regex_rules.read().await;
        let domain = domain.to_string();

        // spawn_blocking 避免阻塞 async 运行时
        match tokio::task::spawn_blocking(move || {
            for rule in &*rules {
                if rule.safe_match(&domain)? {
                    return Ok(Some(rule.inner.clone()));
                }
            }
            Ok::<_, anyhow::Error>(None)
        })
        .await
        .map_err(|e| anyhow!("Regex match task failed: {}", e))??
        {
            Some(rule) => {
                self.record_match(&rule).await;
                Ok(Some(rule))
            }
            None => Ok(None),
        }
    }
}

impl RegexRule {
    /// 安全匹配（带超时）
    fn safe_match(&self, text: &str) -> Result<bool> {
        timeout(REGEX_TIMEOUT, self.regex.is_match(text))
            .map_err(|_| anyhow!("Regex match timeout"))?
    }
}
```

### 3.5 条件评估

```rust
impl AdvancedRuleEngine {
    async fn evaluate_conditions(&self, ctx: &RuleContext) -> Result<Option<Arc<CompiledRule>>> {
        let rules = self.conditional_rules.read().await;
        let ctx = ctx.clone();

        for rule in &*rules {
            if rule.evaluate(&ctx)? {
                self.record_match(&rule.inner).await;
                return Ok(Some(rule.inner.clone()));
            }
        }

        Ok(None)
    }
}

impl ConditionalRule {
    fn evaluate(&self, ctx: &RuleContext) -> Result<bool> {
        self.eval_logical(&self.conditions, ctx)
    }

    fn eval_logical(&self, cond: &LogicalCondition, ctx: &RuleContext) -> Result<bool> {
        match cond.operator {
            LogicalOperator::And => {
                for sub in &cond.conditions {
                    if !self.eval_subcondition(sub, ctx)? {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            LogicalOperator::Or => {
                for sub in &cond.conditions {
                    if self.eval_subcondition(sub, ctx)? {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            LogicalOperator::Not => {
                if cond.conditions.len() != 1 {
                    anyhow::bail!("NOT operator requires exactly one condition");
                }
                Ok(!self.eval_subcondition(&cond.conditions[0], ctx)?)
            }
        }
    }

    fn eval_subcondition(&self, sub: &SubCondition, ctx: &RuleContext) -> Result<bool> {
        match sub {
            SubCondition::Simple(cond) => self.eval_simple(cond, ctx),
            SubCondition::Logical(cond) => self.eval_logical(cond, ctx),
        }
    }

    fn eval_simple(&self, cond: &SimpleCondition, ctx: &RuleContext) -> Result<bool> {
        let value = self.get_field_value(cond, ctx)?;

        match cond.operator {
            ConditionOperator::Equals => Ok(value == cond.value),
            ConditionOperator::Regex => {
                let regex = Regex::new(&cond.value)?;
                Ok(regex.is_match(&value))
            }
            ConditionOperator::In => {
                let values: Vec<&str> = cond.value.split(',').map(|s| s.trim()).collect();
                Ok(values.contains(&value.as_str()))
            }
        }
    }

    fn get_field_value(&self, cond: &SimpleCondition, ctx: &RuleContext) -> Result<String> {
        match cond.field {
            ConditionField::Domain => Ok(ctx.domain.clone()),
            ConditionField::QType => Ok(ctx.qtype.clone()),
            ConditionField::ClientIp => Ok(ctx.client_ip.clone()),
            ConditionField::ClientName => {
                // TODO: 从数据库查询客户端名称
                Ok("".to_string())
            }
            ConditionField::Time => {
                // 格式化为 HH:MM
                Ok(ctx.time.format("%H:%M").to_string())
            }
            ConditionField::Day => {
                // 格式化为 Mon, Tue, Wed...
                Ok(ctx.time.format("%a").to_string())
            }
        }
    }
}
```

---

## 4. 正则安全机制

### 4.1 复杂度验证

```rust
use regex::Regex;

/// 正则复杂度验证
pub fn validate_regex_complexity(pattern: &str) -> Result<()> {
    // 1. 检测嵌套量词
    let mut depth = 0;
    let mut max_depth = 0;
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '*' || c == '+' || c == '?' {
            depth += 1;
            max_depth = max_depth.max(depth);
        } else if c == ')' {
            depth = depth.saturating_sub(1);
        } else if c == '(' && i + 1 < chars.len() && matches!(chars[i + 1], '*' | '+' | '?') {
            // (?: 无影响，但嵌套的量词需警惕
            depth += 1;
            max_depth = max_depth.max(depth);
            i += 1;
        }
        i += 1;
    }

    if max_depth > 3 {
        anyhow::bail!(
            "Regex complexity too high: nested quantifiers depth = {} (max allowed: 3)",
            max_depth
        );
    }

    // 2. 检测回溯攻击模式
    let dangerous_patterns = [
        "(.*){1,100}",     // 嵌套重复
        "(.+){1,100}",     // 嵌套重复
        "(a+)+",           // 嵌套 +
        "(a*)*",           // 嵌套 *
    ];

    for dangerous in &dangerous_patterns {
        if pattern.contains(dangerous) {
            anyhow::bail!("Regex contains dangerous pattern: {}", dangerous);
        }
    }

    // 3. 检测超长模式
    if pattern.len() > 1000 {
        anyhow::bail!("Regex too long: {} chars (max allowed: 1000)", pattern.len());
    }

    Ok(())
}
```

### 4.2 编译与缓存

```rust
impl AdvancedRuleEngine {
    /// 编译正则（带缓存）
    async fn compile_regex(&self, pattern: &str) -> Result<Arc<Regex>> {
        // 检查缓存
        if let Some(cached) = self.regex_cache.get(pattern).await {
            return Ok(cached);
        }

        // 验证复杂度
        validate_regex_complexity(pattern)?;

        // 编译正则（spawn_blocking 避免阻塞）
        let pattern = pattern.to_string();
        let regex = tokio::task::spawn_blocking(move || {
            Regex::new(&pattern)
                .map(Arc::new)
                .map_err(|e| anyhow!("Failed to compile regex: {}", e))
        })
        .await??;

        // 缓存
        self.regex_cache.insert(pattern, regex.clone()).await;

        Ok(regex)
    }
}
```

### 4.3 超时保护

```rust
use tokio::time::timeout;

const REGEX_TIMEOUT: Duration = Duration::from_millis(100);

pub async fn safe_regex_match(regex: &Regex, text: &str) -> Result<bool> {
    let regex = regex.clone();
    let text = text.to_string();

    timeout(REGEX_TIMEOUT, tokio::task::spawn_blocking(move || {
        regex.is_match(&text)
    }))
    .await?
    .map_err(|_| anyhow!("Regex match timeout"))
}
```

---

## 5. 规则统计

### 5.1 记录匹配

```rust
use dashmap::DashMap;
use std::sync::atomic::{AtomicU64, Ordering};

impl AdvancedRuleEngine {
    async fn record_match(&self, rule: &CompiledRule) {
        let entry = self.rule_stats.entry(rule.rule_id.clone()).or_insert_with(|| {
            RuleStats {
                match_count: 0,
                last_matched: None,
            }
        });

        // 原子递增
        let count = entry.match_count.fetch_add(1, Ordering::Relaxed) + 1;

        // 每 100 次匹配异步更新数据库
        if count % 100 == 0 {
            let db = self.db.clone();
            let rule_id = rule.rule_id.clone();
            tokio::spawn(async move {
                if let Err(e) = sqlx::query(
                    "UPDATE advanced_rules SET match_count = ? WHERE id = ?"
                )
                .bind(count as i64)
                .bind(&rule_id)
                .execute(&db)
                .await
                {
                    tracing::warn!("Failed to update rule match count: {}", e);
                }
            });
        }
    }
}
```

### 5.2 查询统计

```rust
impl AdvancedRuleEngine {
    pub async fn get_rule_stats(&self, rule_id: &str) -> Option<RuleStats> {
        self.rule_stats.get(rule_id).map(|entry| entry.clone())
    }

    pub async fn get_top_matched_rules(&self, limit: usize) -> Vec<(String, u64)> {
        let mut stats: Vec<(String, u64)> = self
            .rule_stats
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().match_count))
            .collect();

        stats.sort_by(|a, b| b.1.cmp(&a.1));
        stats.into_iter().take(limit).collect()
    }
}
```

---

## 6. 性能优化

### 6.1 规则索引

```rust
/// 规则索引器
pub struct RuleIndexer {
    exact: HashMap<String, RuleId>,
    suffix: Trie<String, RuleId>,  // 使用 Trie 加速后缀匹配
    regex_priority: BTreeMap<i32, Vec<RuleId>>,
    conditional_priority: BTreeMap<i32, Vec<RuleId>>,
}

impl RuleIndexer {
    /// 构建索引
    pub fn build_index(rules: &[AdvancedRule]) -> Self {
        let mut exact = HashMap::new();
        let mut suffix = Trie::new();
        let mut regex_priority = BTreeMap::new();
        let mut conditional_priority = BTreeMap::new();

        for rule in rules {
            match rule.rule_type {
                RuleType::Domain => {
                    if let Some(pattern) = &rule.pattern {
                        exact.insert(pattern.to_lowercase(), rule.id.clone());
                    }
                }
                RuleType::Regex => {
                    regex_priority
                        .entry(rule.priority)
                        .or_insert_with(Vec::new)
                        .push(rule.id.clone());
                }
                RuleType::Conditional => {
                    conditional_priority
                        .entry(rule.priority)
                        .or_insert_with(Vec::new)
                        .push(rule.id.clone());
                }
                _ => {}
            }
        }

        Self {
            exact,
            suffix,
            regex_priority,
            conditional_priority,
        }
    }
}
```

### 6.2 提前退出

```rust
impl AdvancedRuleEngine {
    /// 评估查询（提前退出优化）
    pub async fn evaluate(&self, ctx: &RuleContext) -> Result<EvaluationResult> {
        // 1. 精确匹配 (O(1))
        if let Some(rule) = self.exact_match(&ctx.domain).await {
            return Ok(rule.to_result());
        }

        // 2. 后缀匹配 (O(k))
        if let Some(rule) = self.suffix_match(&ctx.domain).await {
            return Ok(rule.to_result());
        }

        // 3. 正则匹配 (O(n), 按优先级排序)
        if let Some(rule) = self.regex_match(&ctx.domain).await? {
            return Ok(rule.to_result());
        }

        // 4. 条件评估 (O(m))
        if let Some(rule) = self.evaluate_conditions(ctx).await? {
            return Ok(rule.to_result());
        }

        Ok(EvaluationResult::NoMatch)
    }
}
```

### 6.3 批量更新

```rust
impl AdvancedRuleEngine {
    /// 批量更新规则（减少重载次数）
    pub async fn batch_update(&self, updates: Vec<AdvancedRule>) -> Result<()> {
        // 1. 批量写入数据库
        for rule in &updates {
            sqlx::query(
                "INSERT OR REPLACE INTO advanced_rules (...) VALUES (...)"
            )
            .execute(&self.db)
            .await?;
        }

        // 2. 一次性重载
        self.reload().await?;

        Ok(())
    }
}
```

---

## 7. 错误处理

### 7.1 错误类型

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RuleEngineError {
    #[error("Invalid regex pattern: {0}")]
    InvalidRegex(String),

    #[error("Regex complexity too high: {0}")]
    RegexTooComplex(String),

    #[error("Regex match timeout")]
    RegexTimeout,

    #[error("Condition evaluation failed: {0}")]
    ConditionEvaluation(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Unknown error: {0}")]
    Unknown(#[from] anyhow::Error),
}
```

### 7.2 错误恢复

```rust
impl AdvancedRuleEngine {
    /// 安全评估（错误不影响其他规则）
    pub async fn safe_evaluate(&self, ctx: &RuleContext) -> EvaluationResult {
        match self.evaluate(ctx).await {
            Ok(result) => result,
            Err(e) => {
                tracing::warn!("Rule evaluation failed: {}", e);
                EvaluationResult {
                    matched: false,
                    action: None,
                    rule_id: None,
                    error: Some(e.to_string()),
                }
            }
        }
    }
}
```

---

## 8. 测试策略

### 8.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_exact_match() {
        let engine = AdvancedRuleEngine::new(db).await.unwrap();
        engine.add_rule(AdvancedRule {
            rule_type: RuleType::Domain,
            pattern: Some("example.com".to_string()),
            action: RuleAction::Block,
            ..Default::default()
        }).await.unwrap();

        let ctx = RuleContext {
            domain: "example.com".to_string(),
            qtype: "A".to_string(),
            client_ip: "192.168.1.1".to_string(),
            time: Utc::now(),
        };

        let result = engine.evaluate(&ctx).await.unwrap();
        assert!(result.matched);
        assert_eq!(result.action, Some(RuleAction::Block));
    }

    #[tokio::test]
    async fn test_regex_timeout() {
        let engine = AdvancedRuleEngine::new(db).await.unwrap();

        // 恶意正则（会超时）
        engine.add_rule(AdvancedRule {
            rule_type: RuleType::Regex,
            pattern: Some("(a+)+".to_string()),
            action: RuleAction::Block,
            ..Default::default()
        }).await.unwrap();

        let ctx = RuleContext {
            domain: "a".repeat(1000),
            qtype: "A".to_string(),
            client_ip: "192.168.1.1".to_string(),
            time: Utc::now(),
        };

        // 应该超时但不崩溃
        let result = engine.safe_evaluate(&ctx).await;
        assert!(!result.matched);
    }
}
```

### 8.2 性能测试

```rust
#[tokio::test]
async fn benchmark_100k_rules() {
    let engine = AdvancedRuleEngine::new(db).await.unwrap();

    // 添加 10 万规则
    for i in 0..100_000 {
        engine.add_rule(AdvancedRule {
            rule_type: RuleType::Regex,
            pattern: Some(format!("/test{}/", i)),
            action: RuleAction::Block,
            ..Default::default()
        }).await.unwrap();
    }

    let ctx = RuleContext {
        domain: "example.com".to_string(),
        qtype: "A".to_string(),
        client_ip: "192.168.1.1".to_string(),
        time: Utc::now(),
    };

    let start = Instant::now();
    for _ in 0..10_000 {
        engine.evaluate(&ctx).await.unwrap();
    }
    let elapsed = start.elapsed();

    println!("10,000 queries took {:?}", elapsed);
    assert!(elapsed < Duration::from_secs(10)); // < 1ms per query
}
```

---

## 9. 监控指标

### 9.1 Prometheus 指标

```rust
use prometheus::{IntCounter, IntGauge, Histogram};

pub struct RuleMetrics {
    pub rule_evaluations_total: IntCounter,
    pub rule_matches_total: IntCounter,
    pub rule_eval_duration_seconds: Histogram,
    pub regex_match_duration_seconds: Histogram,
    pub regex_timeout_total: IntCounter,
    pub active_rules: IntGauge,
}

impl RuleMetrics {
    pub fn new() -> Self {
        Self {
            rule_evaluations_total: IntCounter::new(
                "rule_evaluations_total",
                "Total rule evaluations"
            ).unwrap(),
            rule_matches_total: IntCounter::new(
                "rule_matches_total",
                "Total rule matches"
            ).unwrap(),
            rule_eval_duration_seconds: Histogram::with_opts(
                HistogramOpts::new(
                    "rule_eval_duration_seconds",
                    "Rule evaluation duration"
                ).buckets(vec![0.001, 0.005, 0.01, 0.05, 0.1])
            ).unwrap(),
            regex_match_duration_seconds: Histogram::with_opts(
                HistogramOpts::new(
                    "regex_match_duration_seconds",
                    "Regex match duration"
                ).buckets(vec![0.001, 0.01, 0.05, 0.1])
            ).unwrap(),
            regex_timeout_total: IntCounter::new(
                "regex_timeout_total",
                "Total regex timeouts"
            ).unwrap(),
            active_rules: IntGauge::new(
                "active_rules",
                "Number of active rules"
            ).unwrap(),
        }
    }
}
```

---

## 10. 部署建议

### 10.1 配置参数

```toml
[advanced_rules]
# 规则数量限制
max_rules = 100000
max_regex_rules = 10000
max_conditional_rules = 5000

# 正则配置
regex_timeout_ms = 100
regex_cache_size = 10000

# 统计配置
match_count_flush_interval = 100
stats_update_interval_secs = 60
```

### 10.2 性能调优

| 参数 | 推荐 | 说明 |
|------|------|------|
| `regex_timeout_ms` | 100 | 平衡安全与性能 |
| `regex_cache_size` | 10,000 | 避免重复编译 |
| `max_rules` | 100,000 | 防止内存溢出 |

---

**文档版本**: 1.0
**最后更新**: 2026-02-20
