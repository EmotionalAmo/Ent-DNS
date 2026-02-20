# Ent-DNS 高级规则 DSL 语法手册

> 供管理员和高级用户编写规则的完整参考

---

## 目录

1. [快速开始](#1-快速开始)
2. [基础规则](#2-基础规则)
3. [正则规则](#3-正则规则)
4. [时间规则](#4-时间规则)
5. [条件规则](#5-条件规则)
6. [修饰符](#6-修饰符)
7. [完整示例](#7-完整示例)
8. [常见场景](#8-常见场景)
9. [最佳实践](#9-最佳实践)
10. [故障排除](#10-故障排除)

---

## 1. 快速开始

### 1.1 最简单的规则

```yaml
# 阻断 example.com 及其所有子域名
||example.com^

# 允许 example.com（白名单）
@@||example.com^
```

### 1.2 使用正则表达式

```yaml
# 阻断所有包含 ads. 的域名
/ads\./i

# 阻断所有 .ads TLD 的域名
/.*\.ads$/
```

### 1.3 添加时间限制

```yaml
# 仅在夜间阻断广告域名
/ads\./$time=22:00-06:00

# 仅在工作日阻断社交媒体
||facebook.com^$days=[Mon,Tue,Wed,Thu,Fri]
```

---

## 2. 基础规则

### 2.1 阻断规则

**语法**: `||domain^`

匹配域名及其所有子域名。

```yaml
# 阻断 example.com
||example.com^

# 阻断 ads.example.com 及其子域名
||ads.example.com^
```

**匹配示例**:

| 规则 | 匹配 | 不匹配 |
|------|------|--------|
| `||example.com^` | example.com, www.example.com, api.example.com | not-example.com |
| `||ads.example.com^` | ads.example.com, tracker.ads.example.com | example.com, other.com |

### 2.2 允许规则（白名单）

**语法**: `@@||domain^`

允许域名，优先级高于阻断规则。

```yaml
# 允许 example.com（即使其他规则会阻断它）
@@||example.com^
```

### 2.3 通配符

**语法**: `*.domain^`

匹配域名及其所有子域名（与 `||domain^` 等效）。

```yaml
# 阻断 example.com 的所有子域名（不含 example.com）
*.example.com
```

---

## 3. 正则规则

### 3.1 基本语法

**语法**: `/pattern/[flags]`

- `pattern`: 正则表达式（POSIX 兼容）
- `flags`: 可选标志（如 `i` 表示忽略大小写）

```yaml
# 忽略大小写匹配 ads.
/ads\./i

# 精确匹配域名结尾
/example\.com$/

# 匹配域名开头
/^ads\./
```

### 3.2 正则标志

| 标志 | 说明 | 示例 |
|------|------|------|
| `i` | 忽略大小写 | `/ads\./i` 匹配 `Ads.COM` |
| 无 | 大小写敏感 | `/ads\./` 不匹配 `Ads.COM` |

### 3.3 常用正则模式

```yaml
# 阻断包含特定关键词的域名
/ads\./           # 包含 ads.
/tracker\./        # 包含 tracker.
/analytics\./      # 包含 analytics.

# 阻断特定 TLD 的域名
/.*\.ads$/         # .ads TLD
/.*\.tk$/          # .tk TLD

# 阻断特定模式
/^a[0-9]{6}\./     # a123456. 格式
/^cache\./          # cache. 开头

# 组合模式
/(ads|tracker|analytics)\./i  # 任意关键词
```

---

## 4. 时间规则

### 4.1 时间段限制

**语法**: `$time=HH:MM-HH:MM`

```yaml
# 夜间阻断（22:00 到次日 06:00）
/ads\./$time=22:00-06:00

# 工作时间阻断（09:00-18:00）
||facebook.com^$time=09:00-18:00

# 午休时间允许
@@||youtube.com^$time=12:00-13:00
```

**时间格式**:

- 24 小时制：`HH:MM`
- 跨午夜：`22:00-06:00`（次日 06:00 结束）
- 相同时间：`00:00-00:00`（全天无效）

### 4.2 星期限制

**语法**: `$days=[Mon,Tue,Wed,Thu,Fri,Sat,Sun]`

```yaml
# 仅工作日（周一到周五）
||facebook.com^$days=[Mon,Tue,Wed,Thu,Fri]

# 仅周末
||facebook.com^$days=[Sat,Sun]

# 仅周一、周三、周五
||facebook.com^$days=[Mon,Wed,Fri]
```

**星期代码**:

| 代码 | 英文 | 中文 |
|------|------|------|
| Mon | Monday | 周一 |
| Tue | Tuesday | 周二 |
| Wed | Wednesday | 周三 |
| Thu | Thursday | 周四 |
| Fri | Friday | 周五 |
| Sat | Saturday | 周六 |
| Sun | Sunday | 周日 |

### 4.3 组合时间和星期

```yaml
# 工作日工作时间
||facebook.com^$time=09:00-18:00,days=[Mon,Tue,Wed,Thu,Fri]

# 夜间周末
/ads\./$time=22:00-06:00,days=[Fri,Sat,Sun]
```

---

## 5. 条件规则

### 5.1 语法概述

**语法**: `IF condition THEN action`

```yaml
# 基础条件规则
IF domain=example.com THEN block

# 多条件组合
IF client_ip=192.168.1.100 AND time=09:00-18:00 THEN block
```

### 5.2 条件变量

#### 5.2.1 domain（域名）

**类型**: string

```yaml
IF domain=example.com THEN block

# 正则匹配
IF domain=~ads\.com$ THEN block
```

#### 5.2.2 qtype（查询类型）

**类型**: enum (A, AAAA, MX, TXT, CNAME, ...)

```yaml
# 只阻断 A 记录查询
IF qtype=A AND domain=~ads\.com$ THEN block

# 只允许 AAAA 记录
IF qtype=AAAA THEN allow
```

**常见查询类型**:

| 类型 | 说明 |
|------|------|
| A | IPv4 地址 |
| AAAA | IPv6 地址 |
| MX | 邮件交换 |
| TXT | 文本记录 |
| CNAME | 别名 |
| NS | 名称服务器 |

#### 5.2.3 client_ip（客户端 IP）

**类型**: IP 或 CIDR

```yaml
# 精确 IP 匹配
IF client_ip=192.168.1.100 THEN block

# CIDR 网段匹配
IF client_ip=192.168.1.0/24 THEN block
```

#### 5.2.4 client_name（客户端名称）

**类型**: string

```yaml
# 特定设备允许
IF client_name=kids-tablet THEN allow

# 办公设备阻断
IF client_name IN [office-pc, work-laptop] THEN block
```

#### 5.2.5 time（时间）

**类型**: HH:MM-HH:MM

```yaml
IF time=22:00-06:00 THEN block
```

#### 5.2.6 day（星期）

**类型**: list

```yaml
IF day IN [Mon,Tue,Wed,Thu,Fri] THEN block
```

### 5.3 操作符

#### 5.3.1 精确匹配（=）

```yaml
IF domain=example.com THEN block
IF qtype=A THEN allow
```

#### 5.3.2 正则匹配（~）

```yaml
IF domain=~ads\.com$ THEN block
```

#### 5.3.3 集合匹配（IN）

```yaml
IF client_ip IN [192.168.1.100, 192.168.1.101] THEN block
IF day IN [Mon,Wed,Fri] THEN block
```

### 5.4 逻辑运算符

#### 5.4.1 AND（与）

```yaml
# 满足所有条件
IF client_ip=192.168.1.0/24 AND time=09:00-18:00 THEN block

# 链式 AND
IF domain=~ads\./ AND qtype=A AND client_ip=192.168.1.100 THEN block
```

#### 5.4.2 OR（或）

```yaml
# 满足任意一个条件
IF time=22:00-06:00 OR day IN [Sat,Sun] THEN block
```

#### 5.4.3 NOT（非）

```yaml
# 不满足条件
IF NOT domain=whitelist.com THEN block
```

### 5.5 复杂条件示例

```yaml
# 办公网络 + 工作时间 + 社交媒体域名
IF client_ip=10.0.0.0/8 AND
   time=09:00-18:00 AND
   days=[Mon,Tue,Wed,Thu,Fri] AND
   domain=~(facebook|twitter|instagram)\.com$
THEN block

# 儿童设备 + 不在工作时间 + 非教育网站
IF client_name=kids-tablet AND
   (time=06:00-09:00 OR time=18:00-22:00) AND
   NOT domain=~(khanacademy|educative)\.com$
THEN block

# 多个客户端 IP 或 IP 段
IF client_ip IN [192.168.1.100, 192.168.1.200] OR
   client_ip=10.0.5.0/24
THEN allow

# 特定查询类型 + 域名模式
IF (qtype=A OR qtype=AAAA) AND domain=~^cache\./
THEN allow
```

---

## 6. 修饰符

### 6.1 优先级（priority）

**语法**: `$priority=N`

数字越小优先级越高（默认 100）。

```yaml
[1] @@||whitelist.com^              # 最高优先级
[50] ||ad-network.com^              # 中等优先级
[100] /ads\./                       # 默认优先级
```

**执行顺序**: 按优先级从低到高评估，匹配即返回。

### 6.2 启用/禁用（enabled）

**语法**: `$enabled=true|false`

```yaml
||example.com^$enabled=false          # 禁用规则
||example.com^$enabled=true           # 启用规则（默认）
```

### 6.3 注释（comment）

**语法**: `$comment="..."`

```yaml
||example.com^$comment="阻断广告域名"
```

### 6.4 组合修饰符

```yaml
||example.com^$priority=50,enabled=true,comment="阻断广告"
/ads\./$time=22:00-06:00,days=[Mon,Tue,Wed,Thu,Fri,Sat,Sun]
```

---

## 7. 完整示例

### 7.1 家庭网络场景

```yaml
# 优先级 1: 白名单（始终允许）
[1] @@||google.com^$comment="允许 Google"
[1] @@||khanacademy.org^$comment="允许教育网站"

# 优先级 10: 儿童设备限制
[10] IF client_name=kids-tablet AND
      domain=~(facebook|twitter|instagram|tiktok)\.com$
     THEN block

# 优先级 20: 阻断广告
[20] /ads\./i
[20] /tracker\./i
[20] /analytics\./i

# 优先级 50: 夜间社交媒体限制
[50] ||facebook.com^$time=22:00-06:00
[50] ||twitter.com^$time=22:00-06:00
[50] ||instagram.com^$time=22:00-06:00

# 优先级 100: 通用阻断
[100] ||malware.com^
[100] ||phishing.net^
```

### 7.2 企业办公场景

```yaml
# 优先级 1: 内部域名允许
[1] @@||internal.example.com^
[1] @@||gitlab.example.com^
[1] @@||jira.example.com^

# 优先级 10: 工作时间社交媒体阻断
[10] IF client_ip=10.0.0.0/8 AND
      time=09:00-18:00 AND
      days=[Mon,Tue,Wed,Thu,Fri] AND
      domain=~(facebook|twitter|linkedin|instagram)\.com$
     THEN block

# 优先级 20: 阻断流媒体
[20] ||netflix.com^$time=09:00-18:00,days=[Mon,Tue,Wed,Thu,Fri]
[20] ||youtube.com^$time=09:00-18:00,days=[Mon,Tue,Wed,Thu,Fri]

# 优先级 50: 阻断游戏
[50] /steamcommunity\./i
[50] /epicgames\./i

# 优先级 100: 安全阻断
[100] ||malware-detection.net^
[100] /.*\.phishing$/i
```

### 7.3 公共 Wi-Fi 场景

```yaml
# 优先级 1: 允许公共服务
[1] @@||google.com^
[1] @@||cloudflare.com^

# 优先级 10: 阻断追踪器
[10] /tracker\./i
[10] /analytics\./i
[10] /beacon\./i

# 优先级 20: 阻断成人内容
[20] /(xxx|adult|porn)\./i

# 优先级 50: 限制大型下载
[50] IF qtype=AAAA AND domain=~(steam|epicgames|blizzard)\.com$
     THEN block
```

---

## 8. 常见场景

### 8.1 阻断所有广告域名

```yaml
# 方案 1: 正则匹配
/ads\./i
/tracker\./i
/analytics\./i
/beacon\./i

# 方案 2: 域名后缀
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
```

### 8.2 仅在工作时间阻断

```yaml
# 周一至周五 9:00-18:00
||facebook.com^$time=09:00-18:00,days=[Mon,Tue,Wed,Thu,Fri]
||twitter.com^$time=09:00-18:00,days=[Mon,Tue,Wed,Thu,Fri]
```

### 8.3 特定设备允许访问

```yaml
# 儿童平板允许 YouTube
IF client_name=kids-tablet AND domain=~youtube\.com$ THEN allow

# 办公电脑允许所有社交媒体
IF client_ip=10.0.0.0/8 THEN allow
```

### 8.4 夜间阻断所有流量

```yaml
# 夜间（22:00-06:00）阻断所有域名
IF time=22:00-06:00 THEN block
```

### 8.5 允许子域名但阻断主域名

```yaml
# 阻断 example.com 但允许 sub.example.com
||example.com^
@@||sub.example.com^
```

---

## 9. 最佳实践

### 9.1 性能优化

**优先使用精确匹配**:

```yaml
# 好的: 精确匹配（O(1)）
||example.com^

# 避免: 复杂正则（可能慢）
/^e.?x.?a.?m.?p.?l.?e\..*com$/
```

**避免过度通配**:

```yaml
# 好的: 具体域名
||ads.example.com^

# 避免: 过于宽泛
/.*com$/i  # 匹配所有 .com 域名
```

### 9.2 规则组织

**按优先级排序**:

```yaml
# 高优先级: 白名单
[1] @@||whitelist.com^

# 中优先级: 特定规则
[50] ||example.com^

# 低优先级: 通用规则
[100] /ads\./i
```

**使用注释**:

```yaml
# 白名单: 始终允许的服务
[1] @@||google.com^$comment="允许 Google"
[1] @@||cloudflare.com^$comment="允许 Cloudflare"

# 广告阻断: 常见广告域名
[50] ||doubleclick.net^$comment="DoubleClick 广告网络"
```

### 9.3 调试技巧

**先测试再部署**:

1. 在规则编辑器中使用测试工具
2. 输入测试域名，观察匹配结果
3. 确认无误后再保存

**从小到大**:

```yaml
# 步骤 1: 测试单个域名
||example.com^

# 步骤 2: 扩展到子域名
*.example.com

# 步骤 3: 使用正则
/example\./
```

### 9.4 安全考虑

**避免 ReDoS（正则 DoS）**:

```yaml
# 危险: 嵌套量词
/(.*){1,100}/

# 安全: 简单模式
/ads\./i
```

**限制规则数量**:

- 自定义规则上限: 100,000
- 正则规则上限: 10,000
- 条件规则上限: 5,000

---

## 10. 故障排除

### 10.1 规则不生效

**检查清单**:

1. **规则是否启用?**

```yaml
||example.com^$enabled=false  # 禁用的规则不会生效
```

2. **优先级是否正确?**

```yaml
# 优先级低的规则可能被优先级高的规则覆盖
[1] @@||example.com^  # 允许规则（高优先级）
[100] ||example.com^  # 阻断规则（低优先级）
```

3. **条件是否满足?**

```yaml
IF client_ip=192.168.1.100 AND time=09:00-18:00 THEN block
# 如果客户端 IP 不是 192.168.1.100 或时间不在 09:00-18:00，规则不生效
```

### 10.2 正则匹配失败

**常见错误**:

```yaml
# 错误: 未转义特殊字符
/example.com/  # 点号 . 匹配任意字符

# 正确: 转义点号
/example\.com/
```

```yaml
# 错误: 未锚定
ads\.com  # 匹配 myads.com, ads.com.com

# 正确: 锚定开始/结束
/^ads\.com$/  # 只匹配 ads.com
```

### 10.3 时间规则不生效

**检查时区**:

```yaml
# 服务器时区与本地时区不同？
||example.com^$time=22:00-06:00

# 建议在规则中明确时区（未来版本支持）
```

**跨午夜时间**:

```yaml
# 正确: 跨午夜（22:00 到次日 06:00）
||example.com^$time=22:00-06:00

# 错误: 时间范围无效
||example.com^$time=06:00-22:00  # 白天，非夜间
```

### 10.4 查询日志

**查看规则匹配记录**:

1. 进入 Dashboard → Query Log
2. 过滤 `reason = "filter_rule"`
3. 查看匹配的规则 ID

---

## 附录 A: 正则表达式快速参考

### A.1 元字符

| 字符 | 说明 | 示例 |
|------|------|------|
| `.` | 匹配任意单个字符 | `a.c` 匹配 abc, adc, a1c |
| `*` | 匹配前一个字符 0 次或多次 | `a*` 匹配空, a, aa, aaa |
| `+` | 匹配前一个字符 1 次或多次 | `a+` 匹配 a, aa, aaa |
| `?` | 匹配前一个字符 0 次或 1 次 | `a?` 匹配空, a |
| `^` | 匹配字符串开头 | `^ads` 匹配 ads.com |
| `$` | 匹配字符串结尾 | `\.com$` 匹配 example.com |
| `[...]` | 匹配字符集 | `[abc]` 匹配 a, b, c |
| `|` | 或 | `a|b` 匹配 a 或 b |

### A.2 转义字符

| 字符 | 转义后 | 说明 |
|------|--------|------|
| `.` | `\.` | 匹配点号 |
| `*` | `\*` | 匹配星号 |
| `+` | `\+` | 匹配加号 |
| `?` | `\?` | 匹配问号 |
| `[` | `\[` | 匹配左括号 |
| `]` | `\]` | 匹配右括号 |

### A.3 常用模式

```yaml
# 域名中的点号
/example\.com/     # 匹配 example.com（点号必须转义）

# 数字
/[0-9]+/          # 匹配一个或多个数字
/\d{3}/           # 匹配 3 个数字

# 字母
/[a-z]+/          # 匹配小写字母
/[A-Z]+/          # 匹配大写字母
/[a-zA-Z]+/       # 匹配所有字母

# 可选部分
/ads?\.com/       # 匹配 ad.com 或 ads.com

# 多选一
/(ads|tracker|analytics)\./  # 匹配 ads. 或 tracker. 或 analytics.
```

---

## 附录 B: 内置模板

### B.1 广告阻断模板

```yaml
[50] /ads\./i
[50] /tracker\./i
[50] /analytics\./i
[50] /beacon\./i
[50] ||doubleclick.net^
[50] ||googlesyndication.com^
```

### B.2 工作时间社交媒体限制

```yaml
[50] IF client_ip=10.0.0.0/8 AND
      time=09:00-18:00 AND
      days=[Mon,Tue,Wed,Thu,Fri] AND
      domain=~(facebook|twitter|linkedin|instagram)\.com$
     THEN block
```

### B.3 儿童设备限制

```yaml
[10] IF client_name=kids-tablet AND
      domain=~(facebook|twitter|instagram|tiktok)\.com$
     THEN block

[20] /(casino|bet|gambling)\./i
[20] /(xxx|adult|porn)\./i
```

---

**手册版本**: 1.0
**最后更新**: 2026-02-20
