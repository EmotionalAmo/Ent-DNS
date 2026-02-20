# Ent-DNS 高级过滤规则设计文档

> 设计者: product-norman (Don Norman Design Philosophy)
> 版本: 1.0
> 日期: 2026-02-20

---

## 1. 执行摘要

为 Ent-DNS 增加高级过滤规则功能，支持：
- **正则表达式匹配** — 灵活的域名模式匹配
- **时间规则** — 按时间段/星期生效
- **条件规则** — IF-THEN-ELSE 逻辑
- **规则优先级** — 可排序、可禁用
- **规则模板** — 常用场景一键导入

**核心理念**: 复杂性必须渐进式披露。用户无需了解所有功能就能使用，高级功能按需展开。

---

## 2. 规则 DSL 设计

### 2.1 语法概览

```
# 基础规则（保持兼容）
||example.com^
@@||whitelist.com^

# 正则规则
/regex/i
/@@regex/

# 带时间的规则
||example.com^$time=22:00-06:00
||example.com^$weekdays

# 多条件规则
IF client_ip=192.168.1.0/24 AND qtype=A THEN block
IF time=22:00-06:00 AND domain=~ads\. THEN block

# 优先级标注
[100] ||example.com^
```

### 2.2 完整语法规范

#### 2.2.1 规则类型

| 类型 | 语法 | 说明 |
|------|------|------|
| 域名阻断 | `||domain^` | 阻断 domain 及其子域名 |
| 域名允许 | `@@||domain^` | 允许（白名单） |
| 正则阻断 | `/pattern/[flags]` | 正则匹配阻断 |
| 正则允许 | `/@pattern/[flags]` | 正则匹配允许 |
| 条件规则 | `IF cond THEN action` | 条件表达式 |

#### 2.2.2 条件变量

| 变量 | 类型 | 示例 |
|------|------|------|
| `domain` | string | `domain="example.com"` |
| `qtype` | enum | `qtype=A` |
| `client_ip` | IP/CIDR | `client_ip=192.168.1.100` |
| `client_name` | string | `client_name="office-pc"` |
| `time` | HH:MM-HH:MM | `time=22:00-06:00` |
| `day` | list | `day=[Mon,Tue,Wed,Thu,Fri]` |

#### 2.2.3 操作符

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `=` | 精确匹配 | `qtype=A` |
| `~` | 正则匹配 | `domain=~ads\.com$` |
| `IN` | 集合成员 | `client_name IN [office-pc, home-pc]` |
| `AND`, `OR`, `NOT` | 逻辑组合 | `time=22:00-06:00 AND domain=~ads\.` |

#### 2.2.4 动作

| 动作 | 说明 |
|------|------|
| `block` | 阻断（返回 NXDOMAIN） |
| `allow` | 允许（跳过过滤） |
| `rewrite 1.2.3.4` | 重写 IP |

#### 2.2.5 修饰符

| 修饰符 | 说明 |
|--------|------|
| `$time=HH:MM-HH:MM` | 时间段限制 |
| `$days=[Mon,Tue,Wed,...]` | 星期限制 |
| `$priority=N` | 优先级（默认 100） |
| `$enabled=false` | 禁用规则 |
| `$comment="..."` | 注释 |

### 2.3 实际示例

```yaml
# 示例 1: 夜间阻断所有广告域名
/ads\./$time=22:00-06:00,days=[Mon,Tue,Wed,Thu,Fri,Sat,Sun]

# 示例 2: 办公网络在工作时间阻断社交媒体
IF client_ip=10.0.0.0/8 AND time=09:00-18:00 AND days=[Mon,Tue,Wed,Thu,Fri] THEN block
  AND domain=~(facebook|twitter|instagram)\.com

# 示例 3: 特定设备允许 YouTube
IF client_name="kids-tablet" AND domain=~youtube\.com$ THEN allow

# 示例 4: 优先级排序（数字越小优先级越高）
[1] @@||whitelist.com^
[50] ||ad-network.com^
[100] /ads\./

# 示例 5: 带注释的规则
# 阻断所有 .ads TLD 的域名
$comment="阻断 .ads TLD" ||*.ads^

# 示例 6: 复杂条件 - 子网 + 时间 + 域名模式
IF (client_ip IN [192.168.1.0/24, 10.0.5.0/24]) AND time=08:00-17:00 THEN allow
  AND domain=~(internal|private)\.example\.com$
```

---

## 3. 用户体验设计（UX）

### 3.1 渐进式披露原则

**问题**: 一次性展示所有功能会让普通用户望而却步。

**解决方案**: 分层设计，根据用户需求展开功能。

#### 3.1.1 三个使用模式

| 模式 | 用户 | 可见功能 | 隐藏功能 |
|------|------|----------|----------|
| **新手模式** | 家庭用户 | 域名输入框 + 启用/禁用 | 正则、时间、条件 |
| **进阶模式** | IT 管理员 | 域名 + 时间选择器 | 正则编辑器、高级条件 |
| **专家模式** | 网络工程师 | DSL 代码编辑器 | 无 |

#### 3.1.2 新手模式界面

```
+------------------------------------------+
|  新建规则                                 |
+------------------------------------------+
|  域名或模式: [_____________]             |
|                                          |
|  动作:  ○ 阻断   ● 允许                  |
|                                          |
|  [ 高级选项 ▼ ]  ← 点击展开               |
|                                          |
|        [取消]  [保存规则]                |
+------------------------------------------+
```

**心智模型符合**: 用户理解"输入域名 → 选择阻断/允许"。

**可供性**: 输入框清晰，单选按钮直观。

#### 3.1.3 进阶模式界面（展开后）

```
+------------------------------------------+
|  新建规则 (高级)                          |
+------------------------------------------+
|  匹配条件:                                 |
|    ○ 域名: [example.com        ]        |
|    ○ 正则: [ads\./              ] [测试] |
|                                          |
|  动作:                                    |
|    ○ 阻断   ● 允许   ○ 重写到 [_____]     |
|                                          |
|  生效时间:                                 |
|    [  ] 22:00  至  [  ] 06:00            |
|    [x] 周一 [x] 周二 [x] 周三            |
|    [x] 周四 [x] 周五 [ ] 周六 [ ] 周日   |
|                                          |
|  [ 更高级选项 ▼ ]  ← 点击展开             |
|                                          |
|        [取消]  [保存规则]                |
+------------------------------------------+
```

#### 3.1.4 专家模式界面（DSL 编辑器）

```
+------------------------------------------+
|  规则编辑器 (DSL)                         |
+------------------------------------------+
|  1.  ||example.com^                      |
|  2.  /ads\./$time=22:00-06:00            |
|  3.  IF client_ip=10.0.0.0/8 AND         |
|  4.     time=09:00-18:00 THEN block      |
|  5.                                        |
|  +------------------------------------+  |
|  | /ads\./$time=22:00-06:00           |  |
|  | [语法错误] 缺少 days 参数             |  |
|  +------------------------------------+  |
|                                          |
|  [导入模板] [验证] [取消] [保存规则]      |
+------------------------------------------+
```

**反馈**: 实时语法高亮、错误提示、模板建议。

### 3.2 规则测试工具

**需求**: 用户需要在不影响生产环境的情况下测试规则。

**设计**: 沙盒测试环境，支持批量测试。

```
+------------------------------------------+
|  规则测试器                               |
+------------------------------------------+
|  测试域名:                                |
|  [google.com]      [广告.com]            |
|  [facebook.com]   [ads.tracker.io]       |
|  [             ]                         |
|                                          |
|  测试条件:                                 |
|  客户端 IP: [192.168.1.100]              |
|  时间: [2026-02-20 14:30:00]              |
|  查询类型: [A ▼]                         |
|                                          |
|  [ 运行测试 ]                              |
|                                          |
|  测试结果:                                 |
|  +------------------------------------+  |
|  | google.com        → ALLOWED        |  |
|  | facebook.com     → BLOCKED (规则3) |  |
|  | 广告.com          → BLOCKED (规则5) |  |
|  | ads.tracker.io    → BLOCKED (规则1) |  |
|  +------------------------------------+  |
|                                          |
|  显示匹配的规则，用户可点击跳转编辑         |
+------------------------------------------+
```

### 3.3 规则模板库

**需求**: 用户不需要从零学习 DSL，直接复制粘贴常见场景。

**设计**: 分类模板，一键导入，预览效果。

```
+------------------------------------------+
|  规则模板库                               |
+------------------------------------------+
|  搜索: [阻断广告...        ]              |
|                                          |
|  分类:                                    |
|  [全部] [广告阻断] [社交媒体] [工作时间]   |
|  [家庭] [游戏] [自定义]                  |
|                                          |
|  +------------------------------------+  |
|  | 🔔 阻断所有广告域名                 |  |
|  |                                    |  |
|  | /ads\./                            |  |
|  | /tracker\./                        |  |
|  | /analytics\./                      |  |
|  |                                    |  |
|  | [预览] [导入]                      |  |
|  +------------------------------------+  |
|                                          |
|  +------------------------------------+  |
|  | ⏰ 工作时间阻断社交媒体               |  |
|  |                                    |  |
|  | IF time=09:00-18:00 AND             |  |
|  |    days=[Mon,Tue,Wed,Thu,Fri] THEN |  |
|  |    block AND domain=~(facebook|    |  |
|  |    twitter|instagram|tiktok)\.com$ |  |
|  |                                    |  |
|  | [预览] [导入]                      |  |
|  +------------------------------------+  |
+------------------------------------------+
```

### 3.4 规则列表交互

**问题**: 规则多了之后，用户需要快速理解哪些规则生效、匹配了什么。

**设计**: 卡片式展示，支持拖拽排序，实时状态指示。

```
+------------------------------------------+
|  规则列表 (25)                            |
+------------------------------------------+
|  [启用全部] [禁用全部] [导入模板]         |
|  搜索: [ads...     ]  类型: [全部 ▼]     |
|                                          |
|  +------------------------------------+  |
|  | ✅ #1 [优先级: 1] ||ads.com^      |  |
|  |                                    |  |
|  | 阻断 ads.com 及其子域名              |  |
|  | 匹配次数: 1,234 次 (本周)           |  |
|  |                                    |  |
|  | [编辑] [禁用] [复制] [删除]         |  |
|  +------------------------------------+  |
|  ⋮                                     |
|  +------------------------------------+  |
|  | ⏸️ #5 [优先级: 50]                  |  |
|  |    /ads\./$time=22:00-06:00        |  |
|  |                                    |  |
|  | 仅在 22:00-06:00 生效               |  |
|  | 匹配次数: 0 次 (本周)               |  |
|  |                                    |  |
|  | [编辑] [启用] [复制] [删除]         |  |
|  +------------------------------------+  |
|                                          |
|  ← 1 2 3 4 5 →                           |
+------------------------------------------+
```

**反馈**: 状态图标（✅/⏸️）、优先级标签、匹配次数统计。

**映射**: 拖拽规则重新排序 → 直觉操作，无需说明书。

### 3.5 可发现性设计

**问题**: 用户可能不知道有高级功能。

**解决方案**:

1. **引导提示**: 新手第一次进入规则页面时，弹出简短引导：
   ```
   提示: 您可以使用正则表达式匹配域名，
         或者设置规则只在特定时间生效。
         [查看示例] [知道了]
   ```

2. **空状态**: 没有规则时，显示快速入门卡片：
   ```
   +------------------------------------------+
   |  还没有规则                               |
   |                                          |
   |  从模板开始:                              |
   |  [🔔 阻断广告] [⏰ 工作时间限制]         |
   |  [🏠 家庭控制] [🎮 游戏优化]             |
   |                                          |
   |  或手动创建:                              |
   |  [新建规则]                               |
   +------------------------------------------+
   ```

3. **功能提示**: 当用户在域名输入框输入 `*` 时，弹出：
   ```
   提示: 您正在使用通配符，这会匹配所有子域名。
         想要更精确的控制吗？尝试正则表达式模式。
         [学习正则] [关闭]
   ```

---

## 4. 错误预防与恢复

### 4.1 常见错误场景

| 场景 | 用户意图 | 容易犯的错误 | 防护措施 |
|------|----------|--------------|----------|
| 输入域名 | 阻断 example.com | 误写成 `exmaple.com` | 自动域名验证 + 建议 |
| 使用正则 | 匹配广告域名 | 写成正则 DoS 攻击 | 复杂度限制 + 超时保护 |
| 时间规则 | 夜间阻断 | 时区理解错误 | 时区自动检测 + 预览 |
| 优先级排序 | 关键规则优先 | 忘记设置优先级 | 视觉提示 + 默认值 |

### 4.2 实时验证

**域名验证**:
```
输入: exmaple.com
→ ⚠️ 您是否想输入 example.com？
  (点击自动修正)
```

**正则验证**:
```
输入: /(.*){1,100}/
→ ⚠️ 警告: 该正则表达式可能导致性能问题。
   建议使用更具体的模式，如 /ads\./
   [继续添加] [修改规则]
```

**时间验证**:
```
时间: 22:00 - 06:00
→ ℹ️ 提示: 该时间范围跨越午夜，将在次日 06:00 结束。
   您的本地时区是 Asia/Shanghai (UTC+8)。
   [我了解] [预览时间线]
```

### 4.3 撤销/恢复

**问题**: 用户误删或误改规则。

**解决方案**:

1. **软删除**: 规则删除后移至回收站（7天自动清理）:
   ```
   回收站 (3)
   - ||example.com^ [恢复] [永久删除]
   - /ads\./ [恢复] [永久删除]
   ```

2. **版本历史**: 记录规则变更，支持回滚:
   ```
   规则历史
   - 2026-02-20 14:30: admin 修改规则
   - 2026-02-20 10:15: admin 创建规则
     [回滚到此版本]
   ```

3. **导入备份**: 支持导出/导入规则 JSON 文件，快速恢复。

---

## 5. 性能与安全考虑

### 5.1 正则表达式 DoS 防护

**威胁**: 恶意正则表达式导致指数级回溯，耗尽 CPU。

**防护措施**:

| 措施 | 实现 | 说明 |
|------|------|------|
| 复杂度限制 | 限制 `*` 和 `+` 嵌套深度 | 最多 3 层 |
| 超时保护 | `tokio::time::timeout(100ms)` | 单次匹配超时 |
| 预编译缓存 | `regex::Regex::new` + LRU cache | 避免重复编译 |
| 禁用回溯引擎 | 使用 `regex` crate 的非回溯模式 | 牺牲灵活性换取安全 |

**实现示例**:
```rust
use regex::Regex;
use std::time::Duration;
use tokio::time::timeout;

const REGEX_TIMEOUT: Duration = Duration::from_millis(100);

pub async fn safe_match(pattern: &str, text: &str) -> Result<bool> {
    let regex = Regex::new(pattern)
        .map_err(|e| anyhow!("Invalid regex: {}", e))?;

    timeout(REGEX_TIMEOUT, tokio::task::spawn_blocking(move || {
        regex.is_match(text)
    }))
    .await?
    .map_err(|_| anyhow!("Regex match timeout"))
}
```

### 5.2 规则执行优化

**问题**: 规则数量可能达到 10 万+，线性匹配不可接受。

**解决方案**: 分层索引 + 提前退出。

#### 5.2.1 规则索引

| 索引类型 | 用途 | 数据结构 |
|----------|------|----------|
| 域名精确匹配 | `||example.com^` | `HashMap<String, Rule>` |
| 域名后缀匹配 | `||*.example.com^` | `Trie` |
| 正则表达式 | `/ads\./` | `Vec<Regex>` (按优先级排序) |
| 条件规则 | `IF ... THEN ...` | 单独执行队列 |

**执行流程**:
```
1. 域名精确匹配 (O(1))
   → 匹配? 返回

2. 域名后缀匹配 (O(k), k=域名标签数)
   → 匹配? 返回

3. 正则表达式 (O(n), n=正则规则数)
   → 按优先级排序，匹配即返回

4. 条件规则 (O(m), m=条件规则数)
   → 评估条件表达式
```

#### 5.2.2 热路径优化

**DNS 查询是热路径，必须非阻塞**:

```rust
// 使用 tokio::task::spawn_blocking 避免阻塞 async 运行时
pub async fn check_blocked(&self, domain: &str) -> bool {
    // 快速路径: 内存中哈希查找（非阻塞）
    if let Some(rule) = self.exact_match(domain) {
        return rule.is_block();
    }

    // 慢速路径: 正则匹配（spawn_blocking）
    let domain = domain.to_string();
    let regexes = self.regex_rules.clone();
    tokio::task::spawn_blocking(move || {
        for regex_rule in &regexes {
            if regex_rule.matches(&domain) {
                return regex_rule.is_block();
            }
        }
        false
    }).await.unwrap_or(false)
}
```

### 5.3 规则复杂度限制

**问题**: 用户可能创建 10 万条规则，导致内存/性能问题。

**限制**:

| 限制类型 | 默认值 | 可配置 |
|----------|--------|--------|
| 最大规则数 | 100,000 | 通过配置文件 |
| 最大正则规则 | 10,000 | 正则较昂贵 |
| 单规则长度 | 10,000 字符 | 防止超大规则 |
| 条件规则数 | 5,000 | 条件评估最贵 |

**触发阈值时的行为**:
```
⚠️ 警告: 您的自定义规则数量已接近上限 (98,000/100,000)。

建议:
1. 启用订阅列表替代部分自定义规则
2. 清理不再使用的规则
3. 联系管理员增加限额

[查看规则统计] [忽略]
```

---

## 6. 数据库设计

### 6.1 新表结构

```sql
-- 高级规则表（扩展 custom_rules）
CREATE TABLE IF NOT EXISTS advanced_rules (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,              -- 用户友好的规则名
    rule_type     TEXT NOT NULL,              -- 'domain', 'regex', 'conditional'
    pattern       TEXT NOT NULL,              -- 域名或正则模式
    action        TEXT NOT NULL,              -- 'block', 'allow', 'rewrite'
    rewrite_ip    TEXT,                       -- 重写目标 IP（action='rewrite' 时）
    conditions    TEXT,                       -- JSON: 条件表达式
    priority      INTEGER NOT NULL DEFAULT 100,
    is_enabled    INTEGER NOT NULL DEFAULT 1,
    comment       TEXT,
    match_count   INTEGER NOT NULL DEFAULT 0, -- 统计匹配次数
    last_matched  TEXT,                       -- 最后一次匹配时间
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX idx_advanced_rules_type ON advanced_rules(rule_type, is_enabled);
CREATE INDEX idx_advanced_rules_priority ON advanced_rules(priority ASC);
CREATE INDEX idx_advanced_rules_name ON advanced_rules(name);

-- 规则版本历史（支持回滚）
CREATE TABLE IF NOT EXISTS rule_versions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id       TEXT NOT NULL,
    rule_data     TEXT NOT NULL,              -- JSON: 完整规则快照
    version       INTEGER NOT NULL,
    changed_by    TEXT NOT NULL,
    changed_at    TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES advanced_rules(id) ON DELETE CASCADE
);

CREATE INDEX idx_rule_versions_rule ON rule_versions(rule_id, version DESC);

-- 规则模板
CREATE TABLE IF NOT EXISTS rule_templates (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,              -- 'ads', 'social', 'work', 'family'
    description   TEXT NOT NULL,
    rules         TEXT NOT NULL,              -- JSON: 规则列表
    is_builtin    INTEGER NOT NULL DEFAULT 0,  -- 内置模板不可删除
    created_by    TEXT,
    created_at    TEXT NOT NULL
);

CREATE INDEX idx_rule_templates_category ON rule_templates(category);
```

### 6.2 数据迁移

```sql
-- 迁移 001_initial.sql 中的 custom_rules 到 advanced_rules
-- 保留 custom_rules 表以兼容旧 API，但新增高级功能使用 advanced_rules

INSERT INTO advanced_rules (
    id, name, rule_type, pattern, action,
    priority, is_enabled, comment, created_by, created_at, updated_at
)
SELECT
    id,
    SUBSTR(rule, 1, 50),  -- 使用规则前50字符作为默认名称
    CASE
        WHEN rule LIKE '@@%' THEN 'domain'
        WHEN rule LIKE '||%' THEN 'domain'
        WHEN rule LIKE '/%/' THEN 'regex'
        ELSE 'domain'
    END AS rule_type,
    CASE
        WHEN rule LIKE '@@%' THEN SUBSTR(rule, 3)
        WHEN rule LIKE '||%' THEN SUBSTR(rule, 3)
        ELSE rule
    END AS pattern,
    CASE
        WHEN rule LIKE '@@%' THEN 'allow'
        ELSE 'block'
    END AS action,
    100 AS priority,
    is_enabled,
    comment,
    created_by,
    created_at,
    created_at
FROM custom_rules;
```

---

## 7. API 设计

### 7.1 端点列表

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/v1/advanced-rules` | 列出高级规则（分页） |
| POST | `/api/v1/advanced-rules` | 创建规则 |
| GET | `/api/v1/advanced-rules/{id}` | 获取规则详情 |
| PUT | `/api/v1/advanced-rules/{id}` | 更新规则 |
| DELETE | `/api/v1/advanced-rules/{id}` | 删除规则 |
| POST | `/api/v1/advanced-rules/{id}/test` | 测试规则 |
| POST | `/api/v1/advanced-rules/reorder` | 批量排序规则 |
| POST | `/api/v1/advanced-rules/bulk` | 批量操作 |
| GET | `/api/v1/advanced-rules/{id}/versions` | 规则版本历史 |
| POST | `/api/v1/advanced-rules/{id}/rollback` | 回滚到指定版本 |
| GET | `/api/v1/advanced-rules/export` | 导出规则（JSON/CSV） |
| POST | `/api/v1/advanced-rules/import` | 导入规则 |
| GET | `/api/v1/rule-templates` | 列出规则模板 |
| POST | `/api/v1/rule-templates/{id}/import` | 导入模板 |

### 7.2 数据模型

```typescript
// 规则类型
type RuleType = 'domain' | 'regex' | 'conditional';

// 动作类型
type ActionType = 'block' | 'allow' | 'rewrite';

// 条件表达式
interface Condition {
  field: 'domain' | 'qtype' | 'client_ip' | 'client_name' | 'time' | 'day';
  operator: '=' | '~' | 'IN';
  value: string | string[];
}

interface LogicalCondition {
  operator: 'AND' | 'OR' | 'NOT';
  conditions: (Condition | LogicalCondition)[];
}

// 规则对象
interface AdvancedRule {
  id: string;
  name: string;
  rule_type: RuleType;
  pattern?: string;
  action: ActionType;
  rewrite_ip?: string;
  conditions?: LogicalCondition;
  priority: number;
  is_enabled: boolean;
  comment?: string;
  match_count: number;
  last_matched?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// 创建规则请求
interface CreateRuleRequest {
  name: string;
  rule_type: RuleType;
  pattern?: string;
  action: ActionType;
  rewrite_ip?: string;
  conditions?: LogicalCondition;
  priority?: number;
  is_enabled?: boolean;
  comment?: string;
}

// 测试规则请求
interface TestRuleRequest {
  rule: AdvancedRule;
  test_cases: Array<{
    domain: string;
    qtype: string;
    client_ip: string;
    time: string;
  }>;
}

interface TestRuleResponse {
  results: Array<{
    domain: string;
    matched: boolean;
    action: 'block' | 'allow' | 'rewrite';
    rewrite_ip?: string;
    error?: string;
  }>;
}

// 规则模板
interface RuleTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  rules: AdvancedRule[];
  is_builtin: boolean;
  created_by?: string;
  created_at: string;
}
```

### 7.3 API 示例

#### 7.3.1 创建正则规则

```http
POST /api/v1/advanced-rules
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "阻断广告域名",
  "rule_type": "regex",
  "pattern": "/ads\\./i",
  "action": "block",
  "priority": 100,
  "is_enabled": true,
  "comment": "匹配所有包含 ads. 的域名"
}
```

#### 7.3.2 创建条件规则

```http
POST /api/v1/advanced-rules
Content-Type: application/json
Authorization: Bearer <token>

{
  "name": "工作时间阻断社交媒体",
  "rule_type": "conditional",
  "action": "block",
  "conditions": {
    "operator": "AND",
    "conditions": [
      {
        "field": "time",
        "operator": "=",
        "value": "09:00-18:00"
      },
      {
        "operator": "AND",
        "conditions": [
          {
            "field": "domain",
            "operator": "~",
            "value": "facebook\\.com$"
          },
          {
            "field": "domain",
            "operator": "~",
            "value": "twitter\\.com$"
          }
        ]
      }
    ]
  },
  "priority": 50,
  "is_enabled": true
}
```

#### 7.3.3 测试规则

```http
POST /api/v1/advanced-rules/test
Content-Type: application/json
Authorization: Bearer <token>

{
  "rule": {
    "rule_type": "regex",
    "pattern": "/ads\\./i",
    "action": "block"
  },
  "test_cases": [
    {
      "domain": "google.com",
      "qtype": "A",
      "client_ip": "192.168.1.100",
      "time": "2026-02-20T14:30:00Z"
    },
    {
      "domain": "ads.google.com",
      "qtype": "A",
      "client_ip": "192.168.1.100",
      "time": "2026-02-20T14:30:00Z"
    }
  ]
}

Response:
{
  "results": [
    {
      "domain": "google.com",
      "matched": false,
      "action": "allow"
    },
    {
      "domain": "ads.google.com",
      "matched": true,
      "action": "block"
    }
  ]
}
```

#### 7.3.4 导入模板

```http
POST /api/v1/rule-templates/ads-blocker/import
Authorization: Bearer <token>

Response:
{
  "imported": 15,
  "rules": [
    {
      "id": "rule-123",
      "name": "阻断 adnetwork.com",
      ...
    },
    ...
  ]
}
```

---

## 8. 前端实现方案

### 8.1 技术选型

| 功能 | 技术库 | 说明 |
|------|--------|------|
| 规则编辑器 | Monaco Editor | VS Code 同款编辑器，支持语法高亮 |
| 正则测试 | regexr.com | 内嵌正则测试工具 |
| 拖拽排序 | dnd-kit | React 拖拽库 |
| 时间选择 | react-flatpickr | 时间范围选择器 |
| 表单验证 | Zod | TypeScript 优先的 Schema 验证 |
| 状态管理 | Zustand | 轻量级状态管理 |

### 8.2 组件结构

```
frontend/src/features/advanced-rules/
├── components/
│   ├── RuleEditor.tsx          # 规则编辑器主组件
│   ├── DomainInput.tsx         # 域名输入（带验证）
│   ├── RegexInput.tsx          # 正则输入（带测试）
│   ├── ConditionBuilder.tsx    # 条件构建器
│   ├── TimeSelector.tsx        # 时间选择器
│   ├── RuleTestTool.tsx        # 规则测试工具
│   ├── RuleCard.tsx            # 规则卡片展示
│   ├── RuleList.tsx            # 规则列表（支持拖拽）
│   └── TemplateLibrary.tsx     # 规则模板库
├── hooks/
│   ├── useRuleValidation.ts    # 规则验证逻辑
│   ├── useRuleTest.ts          # 规则测试逻辑
│   └── useRuleTemplates.ts     # 模板加载逻辑
├── utils/
│   ├── ruleParser.ts           # 规则解析器（DSL ↔ JSON）
│   ├── ruleValidator.ts        # 规则验证逻辑
│   └── regexTester.ts         # 正则测试工具
└── types.ts                    # TypeScript 类型定义
```

### 8.3 关键组件设计

#### 8.3.1 规则编辑器（RuleEditor）

```tsx
import { useState } from 'react';
import { useRuleValidation } from '../hooks/useRuleValidation';
import { DomainInput } from './DomainInput';
import { RegexInput } from './RegexInput';
import { ConditionBuilder } from './ConditionBuilder';

export function RuleEditor({ mode = 'basic' }: { mode: 'basic' | 'advanced' | 'expert' }) {
  const [ruleType, setRuleType] = useState<'domain' | 'regex' | 'conditional'>('domain');
  const { errors, validate } = useRuleValidation();

  return (
    <div className="rule-editor">
      {mode === 'expert' ? (
        <MonacoEditor language="dns-rule" />
      ) : (
        <>
          <TabGroup>
            <Tab value="domain" onClick={() => setRuleType('domain')}>
              域名规则
            </Tab>
            <Tab value="regex" onClick={() => setRuleType('regex')}>
              正则规则
            </Tab>
            {mode === 'advanced' && (
              <Tab value="conditional" onClick={() => setRuleType('conditional')}>
                条件规则
              </Tab>
            )}
          </TabGroup>

          {ruleType === 'domain' && <DomainInput />}
          {ruleType === 'regex' && <RegexInput />}
          {ruleType === 'conditional' && <ConditionBuilder />}
        </>
      )}
    </div>
  );
}
```

#### 8.3.2 正则输入（RegexInput）

```tsx
import { useState } from 'react';
import { regexTester } from '../utils/regexTester';

export function RegexInput() {
  const [pattern, setPattern] = useState('');
  const [testDomain, setTestDomain] = useState('');
  const [testResult, setTestResult] = useState<boolean | null>(null);

  const handleTest = async () => {
    const result = await regexTester.test(pattern, testDomain);
    setTestResult(result.matched);
    if (result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="regex-input">
      <label>正则模式:</label>
      <input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        placeholder="/ads\\./i"
      />

      <div className="test-area">
        <input
          value={testDomain}
          onChange={(e) => setTestDomain(e.target.value)}
          placeholder="输入测试域名"
        />
        <button onClick={handleTest}>测试</button>
        {testResult !== null && (
          <span className={testResult ? 'matched' : 'not-matched'}>
            {testResult ? '✓ 匹配' : '✗ 不匹配'}
          </span>
        )}
      </div>
    </div>
  );
}
```

#### 8.3.3 条件构建器（ConditionBuilder）

```tsx
import { useState } from 'react';

export function ConditionBuilder() {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [operator, setOperator] = useState<'AND' | 'OR'>('AND');

  const addCondition = () => {
    setConditions([...conditions, {
      field: 'domain',
      operator: '=',
      value: '',
    }]);
  };

  return (
    <div className="condition-builder">
      <div className="conditions">
        {conditions.map((cond, idx) => (
          <div key={idx} className="condition-row">
            <select
              value={cond.field}
              onChange={(e) => updateCondition(idx, 'field', e.target.value)}
            >
              <option value="domain">域名</option>
              <option value="qtype">查询类型</option>
              <option value="client_ip">客户端 IP</option>
              <option value="time">时间</option>
            </select>

            <select
              value={cond.operator}
              onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
            >
              <option value="=">等于</option>
              <option value="~">正则匹配</option>
              <option value="IN">在列表中</option>
            </select>

            <input
              value={cond.value}
              onChange={(e) => updateCondition(idx, 'value', e.target.value)}
              placeholder="值"
            />

            <button onClick={() => removeCondition(idx)}>删除</button>
          </div>
        ))}
      </div>

      <div className="logical-operator">
        <label>组合方式:</label>
        <select value={operator} onChange={(e) => setOperator(e.target.value as any)}>
          <option value="AND">AND（全部满足）</option>
          <option value="OR">OR（任一满足）</option>
        </select>
      </div>

      <button onClick={addCondition}>添加条件</button>
    </div>
  );
}
```

---

## 9. 后端实现方案

### 9.1 模块结构

```
src/
├── dns/
│   ├── rules.rs              # 现有规则引擎（保持兼容）
│   ├── advanced_rules.rs     # 新增：高级规则引擎
│   ├── regex_matcher.rs      # 新增：正则匹配器（带超时）
│   └── condition_eval.rs    # 新增：条件评估器
├── api/
│   └── handlers/
│       └── advanced_rules.rs # 新增：高级规则 API
└── db/
    └── migrations/
        └── 004_advanced_rules.sql  # 新增：数据库迁移
```

### 9.2 核心模块设计

#### 9.2.1 高级规则引擎（advanced_rules.rs）

```rust
use anyhow::Result;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 高级规则引擎
pub struct AdvancedRuleEngine {
    /// 精确域名匹配: domain -> rule
    exact_rules: RwLock<HashMap<String, Arc<AdvancedRule>>>,

    /// 后缀域名匹配: trie 或 hashmap
    suffix_rules: RwLock<HashMap<String, Arc<AdvancedRule>>>,

    /// 正则规则（按优先级排序）
    regex_rules: RwLock<Vec<Arc<RegexRule>>>,

    /// 条件规则
    conditional_rules: RwLock<Vec<Arc<ConditionalRule>>>,

    /// 正则缓存（避免重复编译）
    regex_cache: moka::future::Cache<String, Arc<Regex>>,
}

impl AdvancedRuleEngine {
    /// 评估单个查询
    pub async fn evaluate(&self, ctx: &RuleContext) -> Result<EvaluationResult> {
        // 1. 精确匹配
        if let Some(rule) = self.exact_match(&ctx.domain).await {
            return Ok(rule.to_result());
        }

        // 2. 后缀匹配
        if let Some(rule) = self.suffix_match(&ctx.domain).await {
            return Ok(rule.to_result());
        }

        // 3. 正则匹配（spawn_blocking）
        if let Some(rule) = self.regex_match(&ctx.domain).await? {
            return Ok(rule.to_result());
        }

        // 4. 条件评估
        if let Some(rule) = self.evaluate_conditions(ctx).await? {
            return Ok(rule.to_result());
        }

        Ok(EvaluationResult::NoMatch)
    }
}
```

#### 9.2.2 正则匹配器（regex_matcher.rs）

```rust
use regex::Regex;
use std::time::Duration;
use tokio::time::timeout;

/// 正则规则（带超时保护）
pub struct RegexRule {
    pub rule_id: String,
    pub pattern: String,
    pub regex: Arc<Regex>,
    pub action: RuleAction,
    pub priority: i32,
}

impl RegexRule {
    /// 安全匹配（带超时）
    pub async fn safe_match(&self, text: &str) -> Result<bool> {
        let regex = self.regex.clone();
        let text = text.to_string();

        timeout(Duration::from_millis(100), tokio::task::spawn_blocking(move || {
            regex.is_match(&text)
        }))
        .await?
        .map_err(|_| anyhow!("Regex match timeout"))
    }
}

/// 编译正则（带验证）
pub fn compile_regex(pattern: &str) -> Result<Regex> {
    // 验证复杂度
    validate_regex_complexity(pattern)?;

    // 编译正则
    let regex = Regex::new(pattern)
        .map_err(|e| anyhow!("Invalid regex: {}", e))?;

    Ok(regex)
}

/// 验证正则复杂度（防止 ReDoS）
fn validate_regex_complexity(pattern: &str) -> Result<()> {
    // 检测嵌套量词
    let nested_quantifiers = pattern
        .chars()
        .scan(0, |depth, c| {
            if c == '*' || c == '+' || c == '?' {
                *depth += 1;
            } else if c == ')' {
                *depth = (*depth - 1).max(0);
            }
            Some(*depth)
        })
        .max()
        .unwrap_or(0);

    if nested_quantifiers > 3 {
        anyhow::bail!("Regex complexity too high: nested quantifiers > 3");
    }

    Ok(())
}
```

#### 9.2.3 条件评估器（condition_eval.rs）

```rust
/// 条件规则
pub struct ConditionalRule {
    pub rule_id: String,
    pub conditions: LogicalCondition,
    pub action: RuleAction,
    pub priority: i32,
}

impl ConditionalRule {
    /// 评估条件
    pub async fn evaluate(&self, ctx: &RuleContext) -> Result<bool> {
        self.eval_logical(&self.conditions, ctx).await
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

    fn eval_simple(&self, cond: &Condition, ctx: &RuleContext) -> Result<bool> {
        match cond.operator {
            Operator::Equals => Ok(self.get_field_value(cond, ctx)? == cond.value),
            Operator::Regex => {
                let regex = Regex::new(&cond.value)?;
                Ok(regex.is_match(&self.get_field_value(cond, ctx)?))
            }
            Operator::In => {
                let values: Vec<&str> = cond.value.split(',').collect();
                Ok(values.contains(&self.get_field_value(cond, ctx)?.as_str()))
            }
        }
    }
}
```

### 9.3 API Handler 实现

```rust
use axum::{
    extract::{Path, State},
    Json,
};

/// 创建规则
pub async fn create_rule(
    State(app): State<Arc<AppState>>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateRuleRequest>,
) -> Result<Json<AdvancedRule>> {
    // 验证规则
    validate_rule(&req)?;

    // 插入数据库
    let rule = db_create_rule(&app.db, &req, &user.username).await?;

    // 重新加载规则引擎
    app.advanced_rules.reload().await?;

    Ok(Json(rule))
}

/// 测试规则
pub async fn test_rule(
    AuthUser(_user): AuthUser,
    Json(req): Json<TestRuleRequest>,
) -> Result<Json<TestRuleResponse>> {
    let mut results = Vec::new();

    for test_case in &req.test_cases {
        let ctx = RuleContext {
            domain: test_case.domain.clone(),
            qtype: test_case.qtype.clone(),
            client_ip: test_case.client_ip.clone(),
            time: test_case.time.clone(),
        };

        let result = evaluate_rule(&req.rule, &ctx).await?;
        results.push(TestResult {
            domain: test_case.domain.clone(),
            matched: result.matched,
            action: result.action,
            rewrite_ip: result.rewrite_ip,
            error: result.error,
        });
    }

    Ok(Json(TestRuleResponse { results }))
}
```

---

## 10. 实现路线图

### Phase 1: MVP（最小可行产品）
**目标**: 基础正则规则 + 简单时间限制

| 任务 | 负责角色 | 工作量 |
|------|----------|--------|
| 数据库迁移（advanced_rules 表） | devops-hightower | 0.5 天 |
| 正则规则后端实现 | fullstack-dhh | 2 天 |
| 正则规则 API endpoints | fullstack-dhh | 1 天 |
| 前端规则编辑器（基础） | ui-duarte | 2 天 |
| 前端规则列表展示 | ui-duarte | 1 天 |
| 正则测试工具 | interaction-cooper | 1 天 |

**总计**: 7.5 天

### Phase 2: 时间与条件规则
**目标**: 时间限制 + 条件表达式

| 任务 | 负责角色 | 工作量 |
|------|----------|--------|
| 时间规则后端实现 | fullstack-dhh | 2 天 |
| 条件评估引擎 | fullstack-dhh | 2 天 |
| 前端时间选择器 | ui-duarte | 1 天 |
| 前端条件构建器 | ui-duarte | 2 天 |
| 时区处理逻辑 | fullstack-dhh | 0.5 天 |

**总计**: 7.5 天

### Phase 3: 规则管理
**目标**: 优先级排序 + 模板库 + 版本历史

| 任务 | 负责角色 | 工作量 |
|------|----------|--------|
| 优先级排序实现 | fullstack-dhh | 1 天 |
| 规则版本历史 | fullstack-dhh | 1.5 天 |
| 前端拖拽排序 | ui-duarte | 1 天 |
| 规则模板库（后端） | fullstack-dhh | 1 天 |
| 规则模板库（前端） | ui-duarte | 1.5 天 |
| 内置模板内容 | product-norman | 1 天 |

**总计**: 7 天

### Phase 4: 用户体验优化
**目标**: DSL 编辑器 + 引导提示 + 撤销恢复

| 任务 | 负责角色 | 工作量 |
|------|----------|--------|
| Monaco Editor 集成 | ui-duarte | 1.5 天 |
| 新手引导流程 | interaction-cooper | 1 天 |
| 空状态优化 | interaction-cooper | 0.5 天 |
| 软删除 + 回收站 | fullstack-dhh | 1.5 天 |
| 规则导出/导入 | fullstack-dhh | 1 天 |

**总计**: 5.5 天

### Phase 5: 性能与安全
**目标**: 规则索引 + ReDoS 防护 + 性能测试

| 任务 | 负责角色 | 工作量 |
|------|----------|--------|
| 规则索引实现 | fullstack-dhh | 2 天 |
| 正则复杂度验证 | fullstack-dhh | 1 天 |
| 性能基准测试 | qa-bach | 2 天 |
| 安全审计 | critic-munger | 1 天 |
| 压力测试 | qa-bach | 1 天 |

**总计**: 7 天

**总工作量**: 34.5 天（约 7 周）

---

## 11. 测试计划

### 11.1 单元测试

| 模块 | 测试覆盖 |
|------|----------|
| `regex_matcher` | 正则编译、复杂度验证、超时保护 |
| `condition_eval` | 条件评估、逻辑运算、边界情况 |
| `advanced_rules` | 规则执行顺序、优先级、缓存 |

### 11.2 集成测试

| 场景 | 测试内容 |
|------|----------|
| 规则创建 | DSL 解析、数据库存储、引擎重载 |
| 规则评估 | 各类型规则匹配、优先级正确性 |
| API 测试 | 所有 endpoints 请求/响应验证 |
| 性能测试 | 10 万规则下查询延迟 |

### 11.3 用户测试

**可用性测试**:
- 新手能否创建简单规则？
- 进阶用户能否理解条件规则？
- 错误提示是否清晰？

**Beta 测试**:
- 邀请 10 位真实用户使用 2 周
- 收集反馈，迭代优化

---

## 12. 风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 正则 DoS 攻击 | 高 | 中 | 复杂度限制 + 超时保护 |
| 规则过多导致内存问题 | 高 | 低 | 规则数量限制 + 监控告警 |
| 用户体验复杂度高 | 中 | 高 | 渐进式披露 + 引导提示 |
| 性能不达标（>10ms 延迟） | 中 | 中 | 规则索引 + 提前退出优化 |
| 向后兼容性问题 | 低 | 低 | 保留 `custom_rules` 表，迁移工具 |

---

## 13. 成功指标

| 指标 | 目标 |
|------|------|
| 用户创建规则成功率 | > 90% |
| 规则匹配延迟（平均） | < 5 ms |
| 规则匹配延迟（P99） | < 20 ms |
| 支持 10 万规则 | 内存 < 2 GB |
| 用户满意度 | > 4.0/5.0 |

---

## 14. 下一步行动

1. **技术评审** (`cto-vogels`) — 评估架构可行性、性能风险
2. **用户研究** (`interaction-cooper`) — 确认用户场景、优先级
3. **原型验证** (`ui-duarte`) — 快速原型，收集反馈
4. **Pre-Mortem** (`critic-munger`) — 识别潜在风险
5. **开始 Phase 1** — MVP 开发

---

## 附录 A: 内置规则模板

```json
{
  "templates": [
    {
      "id": "ads-blocker",
      "name": "广告阻断",
      "category": "ads",
      "description": "阻断常见的广告域名",
      "rules": [
        {
          "name": "阻断 .ads 域名",
          "rule_type": "regex",
          "pattern": "/ads\\./i",
          "action": "block",
          "priority": 100
        },
        {
          "name": "阻断 tracker 域名",
          "rule_type": "regex",
          "pattern": "/tracker\\./i",
          "action": "block",
          "priority": 100
        },
        {
          "name": "阻断 analytics 域名",
          "rule_type": "regex",
          "pattern": "/analytics\\./i",
          "action": "block",
          "priority": 100
        }
      ]
    },
    {
      "id": "work-social-block",
      "name": "工作时间社交媒体限制",
      "category": "work",
      "description": "在周一至周五 9:00-18:00 阻断社交媒体",
      "rules": [
        {
          "name": "阻断 Facebook",
          "rule_type": "conditional",
          "action": "block",
          "conditions": {
            "operator": "AND",
            "conditions": [
              {
                "field": "time",
                "operator": "=",
                "value": "09:00-18:00"
              },
              {
                "field": "domain",
                "operator": "~",
                "value": "facebook\\.com$"
              }
            ]
          },
          "priority": 50
        }
      ]
    },
    {
      "id": "family-kids-control",
      "name": "儿童设备限制",
      "category": "family",
      "description": "阻断不适合儿童的网站",
      "rules": [
        {
          "name": "阻断赌博网站",
          "rule_type": "regex",
          "pattern": "/(casino|bet|gambling)\\./i",
          "action": "block",
          "priority": 10
        },
        {
          "name": "阻断成人网站",
          "rule_type": "regex",
          "pattern": "/(xxx|adult|porn)\\./i",
          "action": "block",
          "priority": 10
        }
      ]
    }
  ]
}
```

---

## 附录 B: DSL 语法BNF

```ebnf
<rule>       ::= <simple-rule> | <conditional-rule>

<simple-rule> ::= <allow-rule> | <block-rule> | <regex-rule>
<allow-rule>  ::= "@@||" <domain> "^" <modifiers>?
<block-rule>  ::= "||" <domain> "^" <modifiers>?
<regex-rule>  ::= "/" <pattern> "/" <flags>? <modifiers>?

<conditional-rule> ::= "IF" <condition> "THEN" <action> <modifiers>?

<condition>   ::= <simple-condition> | <logical-condition>
<simple-condition> ::= <field> <operator> <value>
<logical-condition> ::= <logical-op> "(" <condition> ("," <condition>)* ")"

<field>       ::= "domain" | "qtype" | "client_ip" | "client_name" | "time" | "day"
<operator>    ::= "=" | "~" | "IN"
<value>       ::= <string> | <number> | "[" <string> ("," <string>)* "]"
<logical-op>  ::= "AND" | "OR" | "NOT"

<action>      ::= "block" | "allow" | "rewrite" <ip-address>

<modifiers>   ::= "$" <modifier> ("," <modifier>)*
<modifier>    ::= "time=" <time-range>
                | "days=" <day-list>
                | "priority=" <number>
                | "enabled=" ("true" | "false")
                | "comment=" <string>

<time-range>  ::= <hour> ":" <minute> "-" <hour> ":" <minute>
<day-list>    ::= "[" <day> ("," <day>)* "]"
<day>         ::= "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"

<domain>      ::= <label> ("." <label>)*
<label>       ::= [a-zA-Z0-9-]+
<pattern>     ::= <regex-syntax>
<flags>       ::= [i]*

<number>      ::= [0-9]+
<string>      ::= '"' [^"]* '"'
<ip-address>  ::= <ipv4> | <ipv6>
```

---

**文档结束**
