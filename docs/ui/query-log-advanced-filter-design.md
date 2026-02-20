# Query Log Advanced Filter Design

**Author:** ui-duarte (Matías Duarte)
**Date:** 2026-02-20
**Project:** Ent-DNS Round 10 - Query Log Advanced Filtering

---

## Executive Summary

为 Ent-DNS 设计企业级查询日志高级过滤系统，支持复杂条件查询、聚合分析和模板保存。设计遵循 Material Design 原则：**Bold、Graphic、Intentional**。

### 核心价值
- **信息密度优化** - 1000+ 日志快速定位问题
- **洞察发现** - 通过聚合统计发现异常模式
- **效率提升** - 预设模板 + 快捷过滤器减少重复操作
- **可扩展性** - 未来可接入自定义字段（如 client_tag、rule_id）

---

## 1. 后端实现设计

### 1.1 API 端点设计

#### 1.1.1 增强列表查询
```
GET /api/v1/query-log?filters={...}
```

**Query Parameters（JSON 编码）:**

```json
{
  "filters": [
    {
      "field": "time",
      "operator": "between",
      "value": ["2026-02-20T00:00:00Z", "2026-02-20T23:59:59Z"]
    },
    {
      "field": "qtype",
      "operator": "in",
      "value": ["A", "AAAA", "CNAME"]
    },
    {
      "field": "status",
      "operator": "eq",
      "value": "blocked"
    },
    {
      "field": "elapsed_ms",
      "operator": "gt",
      "value": 100
    }
  ],
  "logic": "AND", // 全局逻辑：AND 或 OR
  "limit": 100,
  "offset": 0
}
```

**Supported Fields & Operators:**

| Field | Type | Operators | Notes |
|-------|------|-----------|-------|
| `time` | ISO8601 | `eq`, `gt`, `lt`, `gte`, `lte`, `between` | 支持相对时间：`-1h`, `-24h`, `-7d` |
| `client_ip` | CIDR/IP | `eq`, `contains`, `like` | 支持 `192.168.1.0/24` |
| `client_name` | String | `eq`, `contains`, `like` | |
| `question` | String | `eq`, `contains`, `like`, `regex` | 正则需 `WHERE question REGEXP ?` |
| `qtype` | Enum | `eq`, `in` | A/AAAA/CNAME/MX/TXT/SRV/NS/ANY |
| `answer` | String | `eq`, `contains`, `like` | |
| `status` | Enum | `eq`, `in` | allowed/blocked/cached/error |
| `reason` | String | `eq`, `contains`, `like` | 拦截原因 |
| `upstream` | String | `eq`, `contains`, `like` | 上游服务器 |
| `elapsed_ms` | Integer | `eq`, `gt`, `lt`, `gte`, `lte` | 响应时间 |

**Response:**

```json
{
  "data": [...],
  "total": 1234,
  "returned": 100,
  "offset": 0,
  "limit": 100,
  "query_ms": 23 // 查询耗时（性能监控）
}
```

---

#### 1.1.2 聚合统计
```
GET /api/v1/query-log/aggregate
```

**Query Parameters:**

```json
{
  "filters": [...], // 同上
  "group_by": ["qtype", "status"], // 分组维度
  "metric": "count", // count | sum_elapsed_ms | avg_elapsed_ms
  "time_bucket": "1h", // 1m, 5m, 15m, 1h, 1d
  "limit": 20 // Top N
}
```

**Response:**

```json
{
  "data": [
    { "qtype": "A", "status": "allowed", "count": 5432 },
    { "qtype": "A", "status": "blocked", "count": 1234 },
    ...
  ],
  "total": 10000,
  "time_series": [ // 仅当指定 time_bucket 时返回
    { "time": "2026-02-20T00:00:00Z", "count": 120 },
    { "time": "2026-02-20T01:00:00Z", "count": 95 },
    ...
  ]
}
```

---

#### 1.1.3 Top N 排行
```
GET /api/v1/query-log/top
```

**Query Parameters:**

```json
{
  "dimension": "domain", // domain | client | qtype | upstream
  "metric": "count", // count | sum_elapsed | avg_elapsed
  "time_range": "-24h", // 相对时间范围
  "filters": [...], // 可选附加过滤
  "limit": 10
}
```

**Response:**

```json
{
  "top_domains": [
    { "value": "api.example.com", "count": 1234, "trend": "+12%" },
    { "value": "cdn.example.org", "count": 987, "trend": "-5%" },
    ...
  ],
  "period_start": "2026-02-19T00:00:00Z",
  "period_end": "2026-02-20T00:00:00Z",
  "previous_period": { // 上周期对比数据
    "period_start": "2026-02-18T00:00:00Z",
    "period_end": "2026-02-19T00:00:00Z"
  }
}
```

---

#### 1.1.4 查询模板 CRUD
```
GET    /api/v1/query-log/templates
POST   /api/v1/query-log/templates
PUT    /api/v1/query-log/templates/{id}
DELETE /api/v1/query-log/templates/{id}
```

**Template Schema:**

```json
{
  "id": "uuid",
  "name": "Blocked Ads Queries",
  "filters": [...],
  "logic": "AND",
  "created_by": "admin",
  "created_at": "2026-02-20T10:00:00Z",
  "is_public": true // 是否全员可见
}
```

---

### 1.2 SQL 查询生成（动态 WHERE 子句）

#### Rust 实现示例

```rust
use sqlx::{Pool, Sqlite, query_as, query_scalar};
use serde_json::Value;
use anyhow::Result;

#[derive(Debug, Clone, Deserialize)]
struct Filter {
    field: String,
    operator: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
struct QueryParams {
    filters: Vec<Filter>,
    #[serde(default)]
    logic: String, // "AND" | "OR"
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 { 100 }

fn build_sql(params: &QueryParams) -> (String, Vec<Value>) {
    let mut conditions = Vec::new();
    let mut bindings = Vec::new();

    for filter in &params.filters {
        let (condition, values) = match (filter.field.as_str(), filter.operator.as_str()) {
            // 时间范围
            ("time", "between") => {
                let arr = filter.value.as_array().expect("time between requires array");
                (
                    "time BETWEEN ? AND ?",
                    vec![arr[0].clone(), arr[1].clone()]
                )
            },
            ("time", op) if matches!(op, "gt" | "lt" | "gte" | "lte") => {
                let sql_op = match op {
                    "gt" => ">",
                    "lt" => "<",
                    "gte" => ">=",
                    "lte" => "<=",
                    _ => unreachable!(),
                };
                (format!("time {sql_op} ?"), vec![filter.value.clone()])
            },

            // 相对时间（需在应用层转换）
            ("time", "relative") => {
                // "-1h", "-24h", "-7d" → 计算为绝对时间
                let duration = filter.value.as_str().expect("relative time is string");
                let (start, end) = parse_relative_time(duration);
                (
                    "time BETWEEN ? AND ?",
                    vec![Value::String(start), Value::String(end)]
                )
            },

            // 字符串模糊匹配
            ("question" | "answer" | "client_name", "like") => {
                let pattern = format!("%{}%", filter.value.as_str().unwrap());
                (format!("{} LIKE ?", filter.field), vec![Value::String(pattern)])
            },

            // 正则表达式（SQLite 需启用 REGEXP 扩展）
            ("question", "regex") => (
                format!("{} REGEXP ?", filter.field),
                vec![filter.value.clone()]
            ),

            // 枚举值
            ("status" | "qtype", "eq") => (
                format!("{} = ?", filter.field),
                vec![filter.value.clone()]
            ),
            ("status" | "qtype", "in") => {
                let arr = filter.value.as_array().expect("in operator requires array");
                let placeholders = (0..arr.len()).map(|_| "?").collect::<Vec<_>>().join(",");
                let values = arr.to_vec();
                (format!("{} IN ({})", filter.field, placeholders), values)
            },

            // 数值比较
            ("elapsed_ms", op) if matches!(op, "gt" | "lt" | "gte" | "lte" | "eq") => {
                let sql_op = match op {
                    "gt" => ">",
                    "lt" => "<",
                    "gte" => ">=",
                    "lte" => "<=",
                    "eq" => "=",
                    _ => unreachable!(),
                };
                (format!("elapsed_ms {sql_op} ?"), vec![filter.value.clone()])
            },

            // CIDR IP 匹配（需自定义函数）
            ("client_ip", "cidr") => {
                // 实现 ip_match_cidr(client_ip, ?)
                (format!("client_ip = ? OR client_ip LIKE ?", filter.field), vec![
                    filter.value.clone(),
                    Value::String(format!("{}%", filter.value.as_str().unwrap().split('/').next().unwrap()))
                ])
            },

            _ => continue, // 跳过不支持的字段/操作符
        };

        conditions.push(condition);
        bindings.extend(values);
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        let logic = params.logic.as_str();
        format!("WHERE {}", conditions.join(format!(" {logic} ").as_str()))
    };

    let sql = format!(
        "SELECT id, time, client_ip, client_name, question, qtype, answer, status, reason, upstream, elapsed_ms
         FROM query_log {where_clause} ORDER BY time DESC LIMIT ? OFFSET ?"
    );

    bindings.push(Value::Number(serde_json::Number::from(params.limit)));
    bindings.push(Value::Number(serde_json::Number::from(params.offset)));

    (sql, bindings)
}

fn parse_relative_time(duration: &str) -> (String, String) {
    // "-1h", "-24h", "-7d" → ISO8601
    let (num, unit) = duration.split_at(duration.len() - 1);
    let num: i64 = num.parse().unwrap();
    let now = chrono::Utc::now();

    let start = match unit {
        "h" => now - chrono::Duration::hours(num.abs()),
        "d" => now - chrono::Duration::days(num.abs()),
        "w" => now - chrono::Duration::weeks(num.abs()),
        "M" => now - chrono::Duration::days(num.abs() * 30),
        _ => now,
    };

    (start.to_rfc3339(), now.to_rfc3339())
}
```

---

### 1.3 聚合查询 SQL

#### GROUP BY + COUNT

```sql
SELECT
    qtype,
    status,
    COUNT(*) as count
FROM query_log
WHERE time BETWEEN ? AND ?
GROUP BY qtype, status
ORDER BY count DESC
LIMIT ?
```

#### 时间桶聚合（SQLite 没有原生 DATE_BUCKET，需计算）

```sql
SELECT
    datetime((strftime('%s', time) / ?) * ?, 'unixepoch') as time_bucket,
    COUNT(*) as count
FROM query_log
WHERE time BETWEEN ? AND ?
GROUP BY time_bucket
ORDER BY time_bucket ASC
```

其中第一个 `?` 是桶大小（秒），如 `3600` 表示 1 小时桶。

---

### 1.4 性能优化策略

#### 1.4.1 索引设计（见 Section 3）

#### 1.4.2 查询缓存

```rust
use moka::future::Cache;
use std::time::Duration;

// 缓存键：hash(filters + logic)
struct QueryCache {
    cache: Cache<String, (Value, Instant)>,
}

impl QueryCache {
    fn new() -> Self {
        Self {
            cache: Cache::builder()
                .max_capacity(1000)
                .time_to_live(Duration::from_secs(60)) // 60 秒缓存
                .build(),
        }
    }

    async fn get_or_compute<F, Fut>(&self, key: &str, f: F) -> Result<Value>
    where
        F: FnOnce() -> Fut,
        Fut: futures::Future<Output = Result<Value>>,
    {
        if let Some((result, _)) = self.cache.get(key) {
            return Ok(result);
        }

        let result = f().await?;
        self.cache.insert(key.to_string(), (result.clone(), Instant::now()));
        Ok(result)
    }
}
```

#### 1.4.3 分页优化

**问题：** `OFFSET N` 在大表上性能差（SQLite 需扫描 N 行）

**解决方案：** Cursor-based pagination

```rust
// WHERE id < last_seen_id ORDER BY id DESC LIMIT N
let sql = if let Some(cursor) = params.cursor {
    format!(
        "SELECT ... FROM query_log WHERE id < ? {where_clause} ORDER BY id DESC LIMIT ?",
        cursor
    )
} else {
    format!("SELECT ... FROM query_log {where_clause} ORDER BY id DESC LIMIT ?")
};
```

**前端适配：**

```typescript
interface QueryParams {
  cursor?: number; // 上一页最后一条记录的 id
  filters?: Filter[];
}
```

---

## 2. 数据库优化

### 2.1 索引策略

#### 当前索引（001_initial.sql）
```sql
CREATE INDEX idx_query_log_time ON query_log(time DESC);
CREATE INDEX idx_query_log_client ON query_log(client_ip, time DESC);
CREATE INDEX idx_query_log_question ON query_log(question);
```

#### 新增索引建议（004_query_log_indexes.sql）

```sql
-- 1. 复合索引用于时间 + 状态过滤（最常见查询）
CREATE INDEX IF NOT EXISTS idx_query_log_time_status
    ON query_log(time DESC, status);

-- 2. 复合索引用于时间 + 响应时间分析
CREATE INDEX IF NOT EXISTS idx_query_log_time_elapsed
    ON query_log(time DESC, elapsed_ms);

-- 3. 客户端 + 时间分页优化
CREATE INDEX IF NOT EXISTS idx_query_log_client_time
    ON query_log(client_ip, time DESC);

-- 4. 域名前缀索引（支持 domain LIKE 'example.%'）
-- SQLite 不支持部分索引，用完整索引替代
CREATE INDEX IF NOT EXISTS idx_query_log_question_prefix
    ON query_log(question);

-- 5. 上游服务器索引（如果频繁过滤 upstream）
CREATE INDEX IF NOT EXISTS idx_query_log_upstream_time
    ON query_log(upstream, time DESC);

-- 6. 部分索引：仅索引 blocked 状态（减少索引大小）
CREATE INDEX IF NOT EXISTS idx_query_log_blocked_time
    ON query_log(time DESC)
    WHERE status = 'blocked';

-- 7. 部分索引：仅索引 error 状态
CREATE INDEX IF NOT EXISTS idx_query_log_error_time
    ON query_log(time DESC)
    WHERE status = 'error';
```

**索引选择原则：**

| 查询模式 | 推荐索引 | 原因 |
|---------|---------|------|
| `WHERE time > ? AND status = ?` | `idx_query_log_time_status` | 覆盖索引，无需回表 |
| `WHERE elapsed_ms > 100` | `idx_query_log_time_elapsed` | 范围查询优化 |
| `WHERE client_ip = ? AND time > ?` | `idx_query_log_client_time` | 客户端历史查询 |
| `WHERE question LIKE 'ads.%'` | `idx_query_log_question_prefix` | 前缀匹配 |
| `WHERE upstream = 'cloudflare'` | `idx_query_log_upstream_time` | 上游服务器分析 |

---

### 2.2 查询性能基准

#### 测试环境假设
- 数据量：100 万条 query_log（30 天 × 日均 3.3 万查询）
- SQLite：WAL mode + 同步= NORMAL
- 硬件：SSD + 4 CPU + 8GB RAM

#### 基准测试脚本

```sql
-- 测试 1：简单时间范围（当前索引）
EXPLAIN QUERY PLAN
SELECT * FROM query_log
WHERE time > '2026-02-19T00:00:00Z'
ORDER BY time DESC LIMIT 100;

-- 预期：USE INDEX idx_query_log_time (0.1ms)

-- 测试 2：时间 + 状态（新增索引）
EXPLAIN QUERY PLAN
SELECT * FROM query_log
WHERE time > '2026-02-19T00:00:00Z'
  AND status = 'blocked'
ORDER BY time DESC LIMIT 100;

-- 预期：USE INDEX idx_query_log_time_status (0.15ms)

-- 测试 3：响应时间范围
EXPLAIN QUERY PLAN
SELECT * FROM query_log
WHERE elapsed_ms > 100
ORDER BY time DESC LIMIT 100;

-- 预期：USE INDEX idx_query_log_time_elapsed (0.2ms)

-- 测试 4：域名模糊匹配（无索引优化）
EXPLAIN QUERY PLAN
SELECT * FROM query_log
WHERE question LIKE '%ads%'
ORDER BY time DESC LIMIT 100;

-- 预期：TABLE SCAN idx_query_log_time (500ms+)

-- 优化方案：建议添加 FTS5 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS query_log_fts
USING fts5(question, content=query_log, content_rowid=id);

-- 测试 5：FTS5 搜索
EXPLAIN QUERY PLAN
SELECT ql.* FROM query_log ql
JOIN query_log_fts fts ON ql.id = fts.rowid
WHERE question MATCH 'ads*'
ORDER BY time DESC LIMIT 100;

-- 预期：USE INDEX query_log_fts (0.5ms)
```

---

### 2.3 数据分区策略（未来扩展）

**SQLite 不支持分区**，但可通过模拟：

```sql
-- 按月分表（query_log_202601, query_log_202602, ...）
-- 应用层路由：根据时间选择表
-- 优点：删除旧数据快速（DROP TABLE query_log_202501）
-- 缺点：跨月查询需 UNION
```

**替代方案：** 保留 30 天数据，定时清理

```sql
-- 设置自动清理
PRAGMA journal_mode = WAL;
VACUUM; -- 回收空间
```

---

## 3. 前端设计

### 3.1 过滤器组件库设计

#### 设计原则（Material Design）
- **Bold**：每个过滤器独立卡片，视觉清晰
- **Graphic**：图标 + 颜色编码操作符
- **Intentional**：每一步操作有明确反馈

---

### 3.1.1 核心组件结构

```
QueryLogPage
├── FilterBuilder
│   ├── FilterRow[]
│   │   ├── FieldSelect (time | status | qtype | ...)
│   │   ├── OperatorSelect (eq | gt | between | ...)
│   │   ├── ValueInput (动态类型)
│   │   └── RemoveButton
│   ├── AddFilterButton
│   └── QuickFilters (预设)
├── TemplateSelector
│   ├── SavedTemplates
│   └── SaveAsTemplateButton
├── AggregationPanel (可选)
│   ├── GroupBySelect
│   ├── MetricSelect
│   └── ChartView (Bar | Line | Pie)
└── ResultTable
    ├── ColumnVisibilityToggle
    └── ExportButton
```

---

### 3.1.2 过滤器构建器 UI

#### FilterRow 组件

```typescript
// src/components/query-log/FilterRow.tsx
import { X, Plus, Clock, Hash, Globe, Zap } from 'lucide-react';

interface FilterRowProps {
  filter: Filter;
  onChange: (filter: Filter) => void;
  onRemove: () => void;
}

const FIELD_OPTIONS = [
  { value: 'time', label: '时间', icon: Clock },
  { value: 'client_ip', label: '客户端 IP', icon: Globe },
  { value: 'question', label: '域名', icon: Globe },
  { value: 'qtype', label: '查询类型', icon: Hash },
  { value: 'status', label: '状态', icon: Zap },
  { value: 'elapsed_ms', label: '响应时间', icon: Zap },
];

const OPERATOR_CONFIG: Record<string, { label: string; inputType: 'select' | 'text' | 'number' | 'date-range' }> = {
  eq: { label: '等于', inputType: 'text' },
  gt: { label: '大于', inputType: 'number' },
  lt: { label: '小于', inputType: 'number' },
  gte: { label: '大于等于', inputType: 'number' },
  lte: { label: '小于等于', inputType: 'number' },
  between: { label: '介于', inputType: 'date-range' },
  in: { label: '包含', inputType: 'select' },
  like: { label: '模糊匹配', inputType: 'text' },
};

export function FilterRow({ filter, onChange, onRemove }: FilterRowProps) {
  const field = FIELD_OPTIONS.find(f => f.value === filter.field);
  const Icon = field?.icon;

  return (
    <div className="flex gap-2 items-start">
      {/* 字段选择 */}
      <Select value={filter.field} onValueChange={(v) => onChange({ ...filter, field: v })}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="字段" />
        </SelectTrigger>
        <SelectContent>
          {FIELD_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              <opt.icon size={14} className="mr-2" />
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 操作符选择 */}
      <Select value={filter.operator} onValueChange={(v) => onChange({ ...filter, operator: v })}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="条件" />
        </SelectTrigger>
        <SelectContent>
          {getOperatorsForField(filter.field).map(op => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 值输入（动态类型） */}
      <ValueInput
        field={filter.field}
        operator={filter.operator}
        value={filter.value}
        onChange={(v) => onChange({ ...filter, value: v })}
      />

      {/* 删除按钮 */}
      <Button variant="ghost" size="icon-sm" onClick={onRemove}>
        <X size={16} />
      </Button>
    </div>
  );
}
```

#### ValueInput 组件（动态类型）

```typescript
// src/components/query-log/ValueInput.tsx
import { useState } from 'react';
import { DatePickerWithRange } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ValueInputProps {
  field: string;
  operator: string;
  value: any;
  onChange: (value: any) => void;
}

export function ValueInput({ field, operator, value, onChange }: ValueInputProps) {
  // 日期范围选择器
  if (field === 'time' && operator === 'between') {
    return (
      <DatePickerWithRange
        value={value as DateRange}
        onChange={onChange}
        className="w-72"
      />
    );
  }

  // 相对时间选择器
  if (field === 'time' && operator === 'relative') {
    const RELATIVE_OPTIONS = [
      { value: '-1h', label: '最近 1 小时' },
      { value: '-24h', label: '最近 24 小时' },
      { value: '-7d', label: '最近 7 天' },
      { value: '-30d', label: '最近 30 天' },
    ];
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RELATIVE_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 枚举值选择
  if (field === 'status') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="allowed">已允许</SelectItem>
          <SelectItem value="blocked">已拦截</SelectItem>
          <SelectItem value="cached">已缓存</SelectItem>
          <SelectItem value="error">错误</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field === 'qtype') {
    const QTYPE_OPTIONS = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'ANY'];
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QTYPE_OPTIONS.map(q => (
            <SelectItem key={q} value={q}>{q}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 数值输入
  if (field === 'elapsed_ms') {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-32"
        placeholder="ms"
      />
    );
  }

  // 默认文本输入
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1"
      placeholder="输入值..."
    />
  );
}
```

---

### 3.1.3 快捷过滤器（预设）

```typescript
// src/components/query-log/QuickFilters.tsx
import { Shield, Clock, Zap, Globe } from 'lucide-react';

const QUICK_FILTERS = [
  {
    name: '最近拦截',
    icon: Shield,
    color: 'text-red-600 bg-red-50',
    filters: [
      { field: 'status', operator: 'eq', value: 'blocked' },
      { field: 'time', operator: 'relative', value: '-24h' },
    ],
  },
  {
    name: '慢查询 (>100ms)',
    icon: Clock,
    color: 'text-orange-600 bg-orange-50',
    filters: [
      { field: 'elapsed_ms', operator: 'gt', value: 100 },
      { field: 'time', operator: 'relative', value: '-24h' },
    ],
  },
  {
    name: '错误查询',
    icon: Zap,
    color: 'text-yellow-600 bg-yellow-50',
    filters: [
      { field: 'status', operator: 'eq', value: 'error' },
      { field: 'time', operator: 'relative', value: '-24h' },
    ],
  },
  {
    name: '热门域名',
    icon: Globe,
    color: 'text-blue-600 bg-blue-50',
    filters: [
      { field: 'qtype', operator: 'eq', value: 'A' },
      { field: 'time', operator: 'relative', value: '-1h' },
    ],
  },
];

export function QuickFilters({ onApply }: { onApply: (filters: Filter[]) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {QUICK_FILTERS.map(qf => {
        const Icon = qf.icon;
        return (
          <button
            key={qf.name}
            onClick={() => onApply(qf.filters)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:shadow-md",
              qf.color
            )}
          >
            <Icon size={14} />
            {qf.name}
          </button>
        );
      })}
    </div>
  );
}
```

---

### 3.1.4 查询模板管理

```typescript
// src/components/query-log/TemplateManager.tsx
import { useState } from 'react';
import { Save, FolderOpen, Trash2, Copy } from 'lucide-react';

export function TemplateManager({
  templates,
  onLoadTemplate,
  onSaveTemplate,
  onDeleteTemplate,
}: TemplateManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [currentFilters, setCurrentFilters] = useState<Filter[]>([]);

  return (
    <div className="flex gap-2">
      {/* 加载模板 */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <FolderOpen size={14} className="mr-1" />
            模板
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">保存的模板</h4>
            {templates.map(t => (
              <div key={t.id} className="flex items-center justify-between p-2 hover:bg-muted rounded">
                <button
                  onClick={() => {
                    onLoadTemplate(t.filters);
                    setIsOpen(false);
                  }}
                  className="flex-1 text-left text-sm"
                >
                  {t.name}
                </button>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm">
                    <Copy size={12} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDeleteTemplate(t.id)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 保存为模板 */}
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Save size={14} className="mr-1" />
            保存
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为模板</DialogTitle>
          </DialogHeader>
          <Input
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            placeholder="模板名称..."
          />
          <DialogFooter>
            <Button
              onClick={() => {
                onSaveTemplate({ name: newTemplateName, filters: currentFilters });
                setNewTemplateName('');
              }}
              disabled={!newTemplateName}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

### 3.2 聚合分析面板

#### 图表展示（Recharts）

```typescript
// src/components/query-log/AggregateChart.tsx
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useState } from 'react';

export function AggregateChart({ data, groupBy }: AggregateChartProps) {
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  return (
    <div className="space-y-4">
      {/* 图表类型切换 */}
      <div className="flex gap-2">
        <Button
          variant={chartType === 'bar' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setChartType('bar')}
        >
          柱状图
        </Button>
        <Button
          variant={chartType === 'line' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setChartType('line')}
        >
          折线图
        </Button>
      </div>

      {/* 图表渲染 */}
      <ResponsiveContainer width="100%" height={300}>
        {chartType === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={groupBy} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={groupBy} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
```

---

### 3.3 结果展示优化

#### 列可见性切换

```typescript
// src/components/query-log/ColumnVisibility.tsx
import { Settings } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

const ALL_COLUMNS = [
  { key: 'time', label: '时间' },
  { key: 'question', label: '域名' },
  { key: 'qtype', label: '类型' },
  { key: 'status', label: '状态' },
  { key: 'client_ip', label: '客户端 IP' },
  { key: 'answer', label: '响应' },
  { key: 'elapsed_ms', label: '耗时' },
  { key: 'upstream', label: '上游' },
  { key: 'reason', label: '原因' },
];

export function ColumnVisibility({
  visibleColumns,
  onChange,
}: ColumnVisibilityProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm">
          <Settings size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48">
        <div className="space-y-2">
          {ALL_COLUMNS.map(col => (
            <div key={col.key} className="flex items-center space-x-2">
              <Checkbox
                id={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onChange([...visibleColumns, col.key]);
                  } else {
                    onChange(visibleColumns.filter(c => c !== col.key));
                  }
                }}
              />
              <label htmlFor={col.key} className="text-sm">
                {col.label}
              </label>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

---

### 3.4 智能提示（自动补全）

#### 域名自动补全 API

```rust
// GET /api/v1/query-log/suggest?field=question&prefix=ads
pub async fn suggest(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SuggestParams>,
    _auth: AuthUser,
) -> AppResult<Json<Value>> {
    let suggestions: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT question FROM query_log
         WHERE question LIKE ? LIMIT 10"
    )
    .bind(format!("{}%", params.prefix))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "suggestions": suggestions })))
}
```

#### 前端自动补全组件

```typescript
// src/components/query-log/AutocompleteInput.tsx
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

export function AutocompleteInput({
  field,
  value,
  onChange,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const { data: suggestions } = useQuery({
    queryKey: ['suggest', field, inputValue],
    queryFn: () => fetchSuggestions(field, inputValue),
    enabled: inputValue.length >= 2,
    staleTime: 30000, // 30 秒缓存
  });

  return (
    <div className="relative">
      <Input
        value={value || inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />
      {isOpen && suggestions?.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg">
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => {
                onChange(s);
                setInputValue('');
                setIsOpen(false);
              }}
              className="block w-full text-left px-3 py-2 hover:bg-muted text-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 4. 导出增强

### 4.1 自定义导出字段

```rust
// POST /api/v1/query-log/export
#[derive(Deserialize)]
pub struct ExportRequest {
    filters: Vec<Filter>,
    format: String, // csv | json
    fields: Vec<String>, // 选择导出字段
}

pub async fn export_with_filters(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Json(req): Json<ExportRequest>,
) -> AppResult<impl IntoResponse> {
    let (sql, bindings) = build_sql(&req.filters);
    let field_list = req.fields.join(", ");

    let query_sql = format!(
        "SELECT {} FROM query_log WHERE {}", field_list, sql
    );

    let rows = sqlx::query(&query_sql)
        .fetch_all(&state.db)
        .await?;

    // 生成 CSV/JSON（略，参考现有 export）
}
```

#### 前端导出对话框

```typescript
// src/components/query-log/ExportDialog.tsx
export function ExportDialog({ filters, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [selectedFields, setSelectedFields] = useState(ALL_COLUMNS.map(c => c.key));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出查询日志</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 格式选择 */}
          <div>
            <label className="text-sm font-medium">格式</label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'csv' | 'json')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 字段选择 */}
          <div>
            <label className="text-sm font-medium mb-2 block">导出字段</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_COLUMNS.map(col => (
                <label key={col.key} className="flex items-center space-x-2 text-sm">
                  <Checkbox
                    checked={selectedFields.includes(col.key)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedFields([...selectedFields, col.key]);
                      } else {
                        setSelectedFields(selectedFields.filter(f => f !== col.key));
                      }
                    }}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 导出统计 */}
          <div className="text-sm text-muted-foreground">
            导出条件：{filters.length} 个过滤器，预计约 {estimatedCount} 条记录
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => handleExport({ format, fields: selectedFields })}
          >
            导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 5. 实现优先级建议

### Phase 1：核心功能（2-3 天）
- [ ] **后端**：增强 `/api/v1/query-log` 支持复杂 filters
- [ ] **后端**：实现 `build_sql` 动态查询生成
- [ ] **前端**：`FilterBuilder` 组件（单个过滤器）
- [ ] **前端**：`ValueInput` 动态类型输入
- [ ] **数据库**：新增索引 `idx_query_log_time_status`、`idx_query_log_time_elapsed`

### Phase 2：用户体验优化（2-3 天）
- [ ] **前端**：快捷过滤器（预设）
- [ ] **前端**：查询模板 CRUD
- [ ] **前端**：智能提示（域名/IP 自动补全）
- [ ] **后端**：`/api/v1/query-log/suggest` 端点
- [ ] **前端**：列可见性切换

### Phase 3：聚合分析（3-4 天）
- [ ] **后端**：`/api/v1/query-log/aggregate` 端点
- [ ] **后端**：`/api/v1/query-log/top` 端点
- [ ] **前端**：聚合面板（GROUP BY 选择）
- [ ] **前端**：Recharts 图表展示（柱状图 + 折线图）

### Phase 4：导出增强（1-2 天）
- [ ] **后端**：自定义字段导出
- [ ] **前端**：导出对话框（格式 + 字段选择）
- [ ] **前端**：导出进度指示（大数据集）

### Phase 5：性能优化（2-3 天）
- [ ] **数据库**：全面索引策略（FTS5 全文索引）
- [ ] **后端**：查询缓存（moka）
- [ ] **后端**：Cursor-based 分页
- [ ] **前端**：虚拟滚动（react-window）

---

## 6. 风险与挑战

### 6.1 性能风险
| 风险 | 缓解方案 |
|------|---------|
| 大数据集（100万+）查询慢 | 索引优化 + 查询缓存 + 分页限制 |
| 正则表达式性能差 | 提示用户慎用，添加警告 |
| 多条件组合复杂度高 | 限制最多 5 个过滤器，简化逻辑 |

### 6.2 用户体验风险
| 风险 | 缓解方案 |
|------|---------|
| 过滤器太多让用户困惑 | 提供快捷过滤器 + 预设模板 |
| 查询结果为空时沮丧感 | 显示推荐过滤器 |
| 导出大数据超时 | 限制导出 1 万条，提供分批导出 |

---

## 7. 附录

### 7.1 技术栈
- **前端**：React + TypeScript + Tailwind CSS + Radix UI + Recharts
- **后端**：Rust + Axum + SQLx + SQLite
- **缓存**：moka（内存缓存）

### 7.2 设计资源
- Material Design 3：https://m3.material.io/
- Radix UI：https://www.radix-ui.com/
- Recharts：https://recharts.org/

### 7.3 相关文件
- 后端：`src/api/handlers/query_log.rs`
- 前端：`frontend/src/pages/QueryLogs.tsx`
- 数据库：`src/db/migrations/004_query_log_indexes.sql`（新增）

---

**Design by ui-duarte (Matías Duarte)**
**遵循原则：Bold, Graphic, Intentional**
