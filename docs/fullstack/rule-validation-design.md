# Ent-DNS 规则语法实时验证功能设计文档

**版本**: 1.0
**日期**: 2026-02-20
**负责人**: fullstack-dhh
**状态**: 设计阶段

---

## 1. 需求概述

为 Ent-DNS 项目添加规则语法实时验证功能，在用户输入规则时即时反馈语法错误，提升用户体验和规则质量。

### 1.1 当前状态

- **规则类型**：
  - DNS rewrite（域名 → IP）
  - Filter rule（AdGuard 格式域名阻断/允许）
  - Block rule（基本域名阻断）
- **前端验证**：仅做非空检查
- **后端解析**：`RuleSet::add_rule()` 静默返回 `false` 表示无效规则
- **问题**：
  - 无语法错误提示
  - 无法定位错误位置
  - 用户不知道为何规则被拒绝

### 1.2 目标

1. **实时反馈**：用户输入时即时显示验证结果
2. **错误定位**：指出第几行、第几列的错误
3. **友好提示**：提供具体修复建议
4. **高性能**：防抖 + 缓存，减少 API 调用

---

## 2. API 设计

### 2.1 验证端点

```http
POST /api/v1/rules/validate
Authorization: Bearer <JWT>
Content-Type: application/json
```

**请求体**：

```typescript
{
  rule_type: "filter" | "rewrite",
  content: string,      // 单行或多行规则
  strict?: boolean       // 是否启用严格模式（默认 false）
}
```

**成功响应**：

```typescript
{
  valid: true,
  warnings?: Array<{
    line: number,
    column: number,
    message: string,
    severity: "info" | "warning"
  }>
}
```

**错误响应**：

```typescript
{
  valid: false,
  errors: Array<{
    line: number,        // 1-based
    column: number,      // 1-based
    message: string,     // 友好错误描述
    code: string,        // 错误代码（E001, E002...）
    suggestion?: string  // 修复建议
  }>,
  valid_count: number,  // 有效规则数量
  invalid_count: number // 无效规则数量
}
```

**错误代码列表**：

| 代码 | 含义 | 示例 |
|------|------|------|
| E001 | 空行或注释（仅 strict 模式） | `# comment` |
| E002 | 域名为空 | `||` 或 `0.0.0.0` |
| E003 | 域名格式无效 | `ex ample.com`（含空格） |
| E004 | 域名过长（>253 字符） | `a.repeat(254).com` |
| E005 | 标签过长（>63 字符） | `a.repeat(64).com` |
| E006 | 标签以连字符开头/结尾 | `-example.com` |
| E007 | 裸 TLD（无点的顶级域名） | `com` |
| E008 | IP 地址无效 | `256.1.1.1` |
| E009 | hosts 格式缺域名 | `0.0.0.0` |
| E010 | localhost 被跳过 | `0.0.0.0 localhost` |
| E011 | 正则规则暂不支持 | `/ads\./` |
| W001 | 规则大小写将被标准化 | `||Example.COM^` |

---

## 3. 前端实现方案

### 3.1 组件层级

```
RulesPage
  └── CreateRuleDialog
       ├── RuleEditor (新增)
       │   ├── Textarea
       │   └── ValidationResult
       └── SubmitButton (disabled when invalid)
```

### 3.2 新增组件

#### `RuleEditor.tsx`

```typescript
interface RuleEditorProps {
  ruleType: "filter" | "rewrite";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

**核心功能**：
1. 自动推断规则类型（filter/rewrite）
2. 防抖调用验证 API（500ms）
3. 实时显示错误/警告
4. 语法高亮提示（未来扩展）

#### `ValidationResult.tsx`

```typescript
interface ValidationResultProps {
  result: ValidationResult | null;
  loading?: boolean;
}
```

**UI 设计**：
```
[✓] 规则格式正确
[!] 3 条警告
    第 2 行, 第 8 列: 域名将标准化为小写 (W001)
```

### 3.3 防抖策略

```typescript
// useDebounce.ts
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
```

**使用场景**：
- `useDebounce(value, 500)` - 规则内容验证
- `useDebounce(searchQuery, 300)` - 规则搜索

### 3.4 状态管理

```typescript
// 在 CreateRuleDialog 中
const [rule, setRule] = useState("");
const [debouncedRule, setDebouncedRule] = useState("");
const { data: validation, isLoading } = useQuery({
  queryKey: ["validate-rule", ruleType, debouncedRule],
  queryFn: () => rulesApi.validateRule(ruleType, debouncedRule),
  enabled: debouncedRule.length > 0,
  retry: false, // 验证失败不重试
});

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedRule(rule);
  }, 500);
  return () => clearTimeout(timer);
}, [rule]);
```

### 3.5 提交逻辑

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  // 1. 客户端快速验证（避免空提交）
  if (!rule.trim()) {
    toast.error("请输入规则内容");
    return;
  }

  // 2. 使用最新的验证结果
  if (!validation?.valid) {
    toast.error("规则格式有误，请修复后再提交");
    return;
  }

  // 3. 提交
  createMutation.mutate();
};
```

---

## 4. 后端验证逻辑

### 4.1 模块结构

```
src/
  ├── validation/
  │   ├── mod.rs          # 模块入口
  │   ├── domain.rs       # 域名验证
  │   ├── ip.rs           # IP 验证
  │   ├── rule.rs         # 规则解析与验证
  │   └── error.rs        # 错误类型定义
  └── api/handlers/
      └── rules.rs        # 新增 validate() handler
```

### 4.2 核心验证器

#### `domain.rs`

```rust
use std::net::IpAddr;

pub fn validate_domain(input: &str) -> Result<Domain, ValidationError> {
    let normalized = input.trim().trim_end_matches('.').to_lowercase();

    if normalized.is_empty() {
        return Err(ValidationError {
            code: "E002".to_string(),
            message: "域名为空".to_string(),
            suggestion: Some("输入完整域名，如 example.com".to_string()),
            line: 0,
            column: 0,
        });
    }

    if normalized.len() > 253 {
        return Err(ValidationError {
            code: "E004".to_string(),
            message: format!("域名过长 ({} > 253 字符)", normalized.len()),
            suggestion: Some("使用更短的域名".to_string()),
            line: 0,
            column: 254,
        });
    }

    // 验证每个标签
    let labels: Vec<&str> = normalized.split('.').collect();
    if !normalized.contains('.') && normalized != "localhost" {
        return Err(ValidationError {
            code: "E007".to_string(),
            message: "不能是裸顶级域名".to_string(),
            suggestion: Some("输入完整域名，如 example.com".to_string()),
            line: 0,
            column: normalized.len(),
        });
    }

    for (i, label) in labels.iter().enumerate() {
        if label.is_empty() {
            return Err(ValidationError {
                code: "E003".to_string(),
                message: "标签不能为空".to_string(),
                suggestion: Some("检查是否有连续点号".to_string()),
                line: 0,
                column: find_label_offset(&normalized, i),
            });
        }

        if label.len() > 63 {
            return Err(ValidationError {
                code: "E005".to_string(),
                message: format!("标签过长 ({} > 63 字符)", label.len()),
                suggestion: Some("缩短标签长度".to_string()),
                line: 0,
                column: find_label_offset(&normalized, i) + 64,
            });
        }

        if label.starts_with('-') || label.ends_with('-') {
            return Err(ValidationError {
                code: "E006".to_string(),
                message: "标签不能以连字符开头或结尾".to_string(),
                suggestion: Some("删除首尾的连字符".to_string()),
                line: 0,
                column: find_label_offset(&normalized, i) + (label.starts_with('-') ? 0 : label.len()),
            });
        }

        if !label.chars().all(|c| c.is_alphanumeric() || c == '-') {
            let invalid_char = label.chars().find(|c| !c.is_alphanumeric() && *c != '-');
            return Err(ValidationError {
                code: "E003".to_string(),
                message: format!("域名包含非法字符: {:?}", invalid_char),
                suggestion: Some("只允许字母、数字和连字符".to_string()),
                line: 0,
                column: find_label_offset(&normalized, i) + label.find(|c| !c.is_alphanumeric() && c != &'-').unwrap(),
            });
        }
    }

    Ok(Domain { raw: input.to_string(), normalized })
}

fn find_label_offset(domain: &str, label_index: usize) -> usize {
    let mut offset = 0;
    for (i, label) in domain.split('.').enumerate() {
        if i == label_index {
            return offset;
        }
        offset += label.len() + 1; // +1 for dot
    }
    offset
}
```

#### `rule.rs`

```rust
use crate::validation::{domain, ip, error::{ValidationError, ValidationWarning}};

pub fn validate_rule(rule: &str, strict: bool) -> ValidationResult {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let line = rule.trim();

    // 跳过空行和注释
    if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
        if strict {
            errors.push(ValidationError {
                code: "E001".to_string(),
                message: "空行或注释不能作为规则".to_string(),
                suggestion: Some("删除空行或移除 # 前缀".to_string()),
                line: 1,
                column: 1,
            });
        }
        return ValidationResult { valid: !strict, errors, warnings };
    }

    // 跳过正则规则
    if line.starts_with('/') && line.ends_with('/') {
        errors.push(ValidationError {
            code: "E011".to_string(),
            message: "正则表达式规则暂不支持".to_string(),
            suggestion: Some("使用 AdGuard 格式 (||domain^) 或通配符 (*.domain.com)".to_string()),
            line: 1,
            column: 1,
        });
        return ValidationResult { valid: false, errors, warnings };
    }

    // 检测大小写警告
    if line.chars().any(|c| c.is_uppercase()) {
        warnings.push(ValidationWarning {
            line: 1,
            column: line.find(|c| c.is_uppercase()).map(|i| i + 1).unwrap_or(1),
            message: "域名将被标准化为小写".to_string(),
            severity: "info".to_string(),
            code: "W001".to_string(),
        });
    }

    // 解析规则类型
    if let Some(result) = parse_adguard_rule(line) {
        match result {
            Ok(domain) => {
                // 域名已验证
                return ValidationResult {
                    valid: true,
                    errors: Vec::new(),
                    warnings,
                };
            }
            Err(e) => errors.push(e),
        }
    } else if let Some(result) = parse_hosts_rule(line) {
        match result {
            Ok((ip, domain)) => {
                // IP 和域名已验证
                return ValidationResult {
                    valid: true,
                    errors: Vec::new(),
                    warnings,
                };
            }
            Err(e) => errors.push(e),
        }
    } else if let Some(result) = parse_wildcard_rule(line) {
        match result {
            Ok(domain) => {
                return ValidationResult {
                    valid: true,
                    errors: Vec::new(),
                    warnings,
                };
            }
            Err(e) => errors.push(e),
        }
    } else if let Some(result) = parse_plain_domain(line) {
        match result {
            Ok(domain) => {
                return ValidationResult {
                    valid: true,
                    errors: Vec::new(),
                    warnings,
                };
            }
            Err(e) => errors.push(e),
        }
    } else {
        errors.push(ValidationError {
            code: "E003".to_string(),
            message: "无法识别的规则格式".to_string(),
            suggestion: Some("支持的格式:\n  AdGuard: ||domain^\n  Hosts: 0.0.0.0 domain\n  通配符: *.domain.com\n  纯域名: domain.com".to_string()),
            line: 1,
            column: 1,
        });
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn parse_adguard_rule(line: &str) -> Option<Result<Domain, ValidationError>> {
    let rest = if let Some(s) = line.strip_prefix("@@") { s } else { line };
    let rest = rest.strip_prefix("||").or_else(|| rest.strip_prefix('|'))?;

    let domain_part = rest.split('^').next()
        .unwrap_or(rest)
        .trim_end_matches('|')
        .trim_end_matches('/')
        .trim_end_matches('.');

    Some(domain::validate_domain(domain_part).map_err(|e| ValidationError {
        code: e.code,
        message: e.message,
        suggestion: e.suggestion,
        line: 1,
        column: e.column + if line.starts_with("@@") { 2 } else { 2 },
    }))
}

fn parse_hosts_rule(line: &str) -> Option<Result<(IpAddr, Domain), ValidationError>> {
    let mut parts = line.split_whitespace();
    let ip_str = parts.next()?;
    let domain_str = parts.next()?;

    let ip = match ip_str.parse::<IpAddr>() {
        Ok(ip) => ip,
        Err(_) => {
            return Some(Err(ValidationError {
                code: "E008".to_string(),
                message: format!("无效的 IP 地址: {}", ip_str),
                suggestion: Some("使用有效的 IPv4 或 IPv6 地址".to_string()),
                line: 1,
                column: 1,
            }))
        }
    };

    if domain_str == "localhost" || domain_str.ends_with(".local") {
        return Some(Err(ValidationError {
            code: "E010".to_string(),
            message: "localhost 和 .local 域名会被跳过".to_string(),
            suggestion: Some("使用其他域名".to_string()),
            line: 1,
            column: ip_str.len() + 2,
        }));
    }

    let domain = domain::validate_domain(domain_str).map_err(|e| ValidationError {
        code: e.code,
        message: e.message,
        suggestion: e.suggestion,
        line: 1,
        column: e.column + ip_str.len() + 1,
    })?;

    Some(Ok((ip, domain)))
}

// ... 其他解析函数类似
```

### 4.3 Handler 实现

```rust
// api/handlers/rules.rs (新增)

#[derive(Deserialize)]
pub struct ValidateRuleRequest {
    rule_type: String,  // "filter" | "rewrite"
    content: String,
    #[serde(default)]
    strict: bool,
}

#[derive(Serialize)]
pub struct ValidateRuleResponse {
    valid: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<ValidationError>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<ValidationWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    valid_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invalid_count: Option<usize>,
}

pub async fn validate(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Json(req): Json<ValidateRuleRequest>,
) -> AppResult<Json<ValidateRuleResponse>> {
    let rule_type = req.rule_type.as_str();

    match rule_type {
        "filter" => {
            let mut valid_count = 0;
            let mut invalid_count = 0;
            let mut all_errors = Vec::new();
            let mut all_warnings = Vec::new();

            // 支持多行输入
            for (line_num, line) in req.content.lines().enumerate() {
                let result = validation::validate_rule(line, req.strict);
                if result.valid {
                    valid_count += 1;
                } else {
                    invalid_count += 1;
                }

                // 为错误添加行号
                let mut errors: Vec<_> = result.errors
                    .into_iter()
                    .map(|mut e| {
                        e.line = line_num + 1;
                        e
                    })
                    .collect();

                let mut warnings: Vec<_> = result.warnings
                    .into_iter()
                    .map(|mut w| {
                        w.line = line_num + 1;
                        w
                    })
                    .collect();

                all_errors.extend(errors);
                all_warnings.extend(warnings);
            }

            Ok(Json(ValidateRuleResponse {
                valid: invalid_count == 0,
                errors: all_errors,
                warnings: all_warnings,
                valid_count: if !req.content.is_empty() { Some(valid_count) } else { None },
                invalid_count: if !req.content.is_empty() { Some(invalid_count) } else { None },
            }))
        }
        "rewrite" => {
            // DNS rewrite 验证: "domain -> ip" 或仅域名
            let parts: Vec<&str> = req.content.split("->").collect();

            let (domain, ip) = match parts.len() {
                1 => {
                    // 仅域名（用于更新域名）
                    let domain = validation::validate_domain(parts[0].trim())?;
                    (domain, None)
                }
                2 => {
                    // domain -> ip
                    let domain = validation::validate_domain(parts[0].trim())?;
                    let ip_str = parts[1].trim();
                    let ip = validation::validate_ip(ip_str)?;
                    (domain, Some(ip))
                }
                _ => {
                    return Err(AppError::Validation(
                        "rewrite 格式应为: domain 或 domain->ip".to_string()
                    ));
                }
            };

            Ok(Json(ValidateRuleResponse {
                valid: true,
                errors: Vec::new(),
                warnings: Vec::new(),
                valid_count: Some(1),
                invalid_count: Some(0),
            }))
        }
        _ => Err(AppError::Validation(
            "rule_type 必须是 filter 或 rewrite".to_string()
        )),
    }
}
```

### 4.4 路由注册

```rust
// api/mod.rs

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/rules/validate", post(handlers::rules::validate))
        // ... 其他路由
        .with_state(state)
}
```

---

## 5. 性能优化

### 5.1 缓存策略

```rust
// validation/cache.rs
use moka::future::Cache;
use std::hash::Hash;

#[derive(Clone)]
pub struct ValidationCache {
    inner: Cache<String, ValidationResult>,
}

impl ValidationCache {
    pub fn new() -> Self {
        Self {
            inner: Cache::builder()
                .max_capacity(1000)
                .time_to_live(std::time::Duration::from_secs(300)) // 5 分钟
                .build(),
        }
    }

    pub async fn get_or_insert<F, Fut>(
        &self,
        key: String,
        f: F,
    ) -> ValidationResult
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = ValidationResult>,
    {
        self.inner.get_with_by_ref(&key, f).await
    }
}

// 使用
static VALIDATION_CACHE: Lazy<ValidationCache> = Lazy::new(ValidationCache::new);

pub async fn validate_with_cache(
    rule: &str,
    strict: bool,
) -> ValidationResult {
    let key = format!("{}:{}", rule, strict);
    VALIDATION_CACHE
        .get_or_insert(key.clone(), || async move {
            validate_rule(rule, strict)
        })
        .await
}
```

### 5.2 批量验证

```rust
// 支持一次性验证多条规则
#[derive(Deserialize)]
pub struct BatchValidateRequest {
    rules: Vec<ValidateRuleRequest>,
}

pub async fn batch_validate(
    State(state): State<Arc<AppState>>,
    _auth: AuthUser,
    Json(req): Json<BatchValidateRequest>,
) -> AppResult<Json<Vec<ValidateRuleResponse>>> {
    // 并发验证（使用 tokio::spawn）
    let results = stream::iter(req.rules)
        .map(|rule_req| async move {
            let result = validation::validate_rule(&rule_req.content, rule_req.strict);
            ValidateRuleResponse {
                valid: result.valid,
                errors: result.errors,
                warnings: result.warnings,
                valid_count: Some(if result.valid { 1 } else { 0 }),
                invalid_count: Some(if !result.valid { 1 } else { 0 }),
            }
        })
        .buffer_unordered(10) // 最多 10 个并发
        .collect::<Vec<_>>()
        .await;

    Ok(Json(results))
}
```

---

## 6. 用户体验流程

### 6.1 规则创建流程

```
用户打开添加规则对话框
    ↓
用户输入规则内容
    ↓
[500ms 防抖]
    ↓
前端调用 /api/v1/rules/validate
    ↓
后端验证并返回结果
    ↓
前端显示验证结果:
    - ✓ valid: 绿色对勾
    - ✗ invalid: 红色错误列表（带行号、列号）
    - ⚠️ warning: 黄色提示
    ↓
用户修改规则 → 重复验证
    ↓
验证通过 → 提交按钮启用
    ↓
用户点击提交 → POST /api/v1/rules
```

### 6.2 错误提示示例

**场景 1：域名含空格**

```
输入: ||ex ample.com^

显示:
  ✗ 第 1 行, 第 6 列: 域名包含非法字符: ' ' (E003)
     提示: 只允许字母、数字和连字符
```

**场景 2：标签过长**

```
输入: ||a-very-long-label-that-exceeds-the-63-character-limit.example.com^

显示:
  ✗ 第 1 行, 第 65 列: 标签过长 (64 > 63 字符) (E005)
     提示: 缩短标签长度
```

**场景 3：IP 无效**

```
输入: 0.0.0.0 256.1.1.1

显示:
  ✗ 第 1 行, 第 9 列: 无效的 IP 地址: 256.1.1.1 (E008)
     提示: 使用有效的 IPv4 或 IPv6 地址
```

---

## 7. 测试策略

### 7.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_adguard_format() {
        let result = validate_rule("||example.com^", false);
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_invalid_empty_domain() {
        let result = validate_rule("||^", false);
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].code, "E002");
    }

    #[test]
    fn test_invalid_long_label() {
        let domain = format!("||{}^.com", "a".repeat(64));
        let result = validate_rule(&domain, false);
        assert!(!result.valid);
        assert_eq!(result.errors[0].code, "E005");
    }

    #[test]
    fn test_warning_case_mixed() {
        let result = validate_rule("||Example.COM^", false);
        assert!(result.valid);
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].code, "W001");
    }

    #[test]
    fn test_hosts_format_valid() {
        let result = validate_rule("0.0.0.0 example.com", false);
        assert!(result.valid);
    }

    #[test]
    fn test_hosts_format_invalid_ip() {
        let result = validate_rule("256.1.1.1 example.com", false);
        assert!(!result.valid);
        assert_eq!(result.errors[0].code, "E008");
    }

    #[test]
    fn test_localhost_skipped() {
        let result = validate_rule("0.0.0.0 localhost", true);
        assert!(!result.valid);
        assert_eq!(result.errors[0].code, "E010");
    }

    #[test]
    fn test_wildcard_format() {
        let result = validate_rule("*.ads.com", false);
        assert!(result.valid);
    }

    #[test]
    fn test_bare_tld_rejected() {
        let result = validate_rule("com", false);
        assert!(!result.valid);
        assert_eq!(result.errors[0].code, "E007");
    }

    #[test]
    fn test_regex_not_supported() {
        let result = validate_rule("/ads\\./", false);
        assert!(!result.valid);
        assert_eq!(result.errors[0].code, "E011");
    }
}
```

### 7.2 集成测试

```rust
#[tokio::test]
async fn test_validate_endpoint() {
    let app = create_test_app().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/rules/validate")
                .header("Authorization", format!("Bearer {}", get_test_token()))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::json!({
                    "rule_type": "filter",
                    "content": "||example.com^"
                }).to_string()))
                .unwrap()
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: ValidateRuleResponse = read_json(response).await;
    assert!(body.valid);
}

#[tokio::test]
async fn test_validate_endpoint_invalid_rule() {
    let app = create_test_app().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/rules/validate")
                .header("Authorization", format!("Bearer {}", get_test_token()))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::json!({
                    "rule_type": "filter",
                    "content": "||^"
                }).to_string()))
                .unwrap()
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: ValidateRuleResponse = read_json(response).await;
    assert!(!body.valid);
    assert_eq!(body.errors.len(), 1);
    assert_eq!(body.errors[0].code, "E002");
}
```

### 7.3 前端测试

```typescript
// RuleEditor.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RuleEditor } from './RuleEditor';

describe('RuleEditor', () => {
  it('shows validation error for invalid rule', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <RuleEditor ruleType="filter" value="" onChange={() => {}} />
      </QueryClientProvider>
    );

    const textarea = screen.getByPlaceholderText(/例如/);
    await userEvent.type(textarea, '||^');

    // 等待防抖
    await waitFor(() => {
      expect(screen.getByText(/E002/)).toBeInTheDocument();
    });
  });

  it('shows success for valid rule', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <RuleEditor ruleType="filter" value="" onChange={() => {}} />
      </QueryClientProvider>
    );

    const textarea = screen.getByPlaceholderText(/例如/);
    await userEvent.type(textarea, '||example.com^');

    await waitFor(() => {
      expect(screen.getByText(/规则格式正确/)).toBeInTheDocument();
    });
  });
});
```

### 7.4 边界情况测试清单

| 场景 | 输入 | 预期结果 |
|------|------|----------|
| 空输入 | `""` | valid=true (或根据 strict 返回 E001) |
| 仅空格 | `"   "` | E002 (域名为空) |
| 连续点号 | `"example..com"` | E003 (标签为空) |
| 结尾点 | `"example.com."` | valid=true (标准化后移除) |
| 开头点 | `".example.com"` | E003 (标签为空) |
| 最大长度 | `"a"*253 + ".com"` | E004 (过长) |
| 最大标签 | `"a"*64 + ".com"` | E005 (标签过长) |
| IPv4 无效 | `"256.1.1.1"` | E008 (IP 无效) |
| IPv6 无效 | `":::1"` | E008 (IP 无效) |
| 中文域名 | `"例子.中国"` | E003 (非法字符) |
| Punycode | `"xn--fiqs8s.xn--fiqs8s"` | valid=true (IDN 支持) |
| 通配符深度 | `"*.a.b.c.d.e.f.g"` | valid=true |
| 混合格式 | `"||domain^$third-party"` | valid=true (忽略选项) |
| 多行输入 | `"||a.com^\n||b.com^\n||c.com^"` | valid_count=3, invalid_count=0 |
| 多行含错误 | `"||a.com^\n||^\n||c.com^"` | valid_count=2, invalid_count=1 |

---

## 8. 扩展考虑

### 8.1 未来功能

1. **语法高亮**：在 Textarea 上覆盖一层高亮显示的 `<code>` 元素
2. **自动完成**：输入 `||` 后提示常见域名
3. **批量导入验证**：粘贴整份规则列表，显示通过率
4. **规则冲突检测**：检查同一域名同时存在 block 和 allow 规则
5. **规则性能预估**：复杂规则可能影响匹配性能，提示警告

### 8.2 性能监控

```rust
// 添加 metrics
use prometheus::{Counter, Histogram};

lazy_static! {
    static ref VALIDATION_REQUESTS: Counter = register_counter!(
        "ent_dns_validation_requests_total",
        "Total validation requests"
    ).unwrap();

    static ref VALIDATION_DURATION: Histogram = register_histogram!(
        "ent_dns_validation_duration_seconds",
        "Validation duration"
    ).unwrap();
}

pub async fn validate_with_metrics(rule: &str, strict: bool) -> ValidationResult {
    VALIDATION_REQUESTS.inc();
    let timer = VALIDATION_DURATION.start_timer();

    let result = validate_rule(rule, strict);

    timer.observe_duration();
    result
}
```

---

## 9. 实施计划

### 阶段 1：核心验证逻辑（2 天）
- [ ] 创建 `validation/` 模块
- [ ] 实现 `domain::validate_domain()`
- [ ] 实现 `ip::validate_ip()`
- [ ] 实现 `rule::validate_rule()`
- [ ] 编写单元测试（覆盖率 >90%）

### 阶段 2：API Handler（1 天）
- [ ] 实现 `validate()` handler
- [ ] 注册路由
- [ ] 添加缓存层
- [ ] 编写集成测试

### 阶段 3：前端组件（2 天）
- [ ] 创建 `RuleEditor.tsx`
- [ ] 创建 `ValidationResult.tsx`
- [ ] 实现 `useDebounce` hook
- [ ] 集成到 `CreateRuleDialog`
- [ ] 编写组件测试

### 阶段 4：测试与优化（1 天）
- [ ] 端到端测试
- [ ] 性能基准测试
- [ ] 用户体验优化
- [ ] 文档更新

**总计**: 6 天

---

## 10. 相关文件清单

### 新增文件
```
src/validation/mod.rs
src/validation/domain.rs
src/validation/ip.rs
src/validation/rule.rs
src/validation/error.rs
src/validation/cache.rs

frontend/src/components/rules/RuleEditor.tsx
frontend/src/components/rules/ValidationResult.tsx
frontend/src/hooks/useDebounce.ts
frontend/src/api/rules.ts (添加 validateRule 方法)
```

### 修改文件
```
src/api/mod.rs (注册路由)
src/api/handlers/rules.rs (添加 validate handler)
src/error.rs (添加 ValidationError 序列化)
frontend/src/pages/Rules.tsx (集成 RuleEditor)
```

### 测试文件
```
src/validation/tests/mod.rs
src/api/tests/validation_integration.rs
frontend/src/components/rules/__tests__/RuleEditor.test.tsx
```

---

## 11. 参考资料

- [RFC 1035 - Domain Names](https://tools.ietf.org/html/rfc1035)
- [AdGuard DNS Filtering Syntax](https://adguard.com/kb/general/ad-filtering/create-own-filters/)
- [Hosts File Format](https://en.wikipedia.org/wiki/Hosts_(file))
- [RFC 3986 - IPv6 Address Format](https://tools.ietf.org/html/rfc3986)
