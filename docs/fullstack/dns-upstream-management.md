# DNS Upstream 管理机制 - 技术文档

## 概述

实现企业级 DNS Upstream 管理和故障转移机制，支持：
- 多个上游 DNS 服务器配置
- 优先级选择 (Primary/Secondary)
- 健康检查和状态监控
- 手动/自动故障转移
- 故障转移日志记录

## 架构设计

### 数据库层

**dns_upstreams 表** - 存储上游 DNS 服务器配置：
- `id` - UUID 主键
- `name` - 显示名称
- `addresses` - JSON 数组，存储多个 DNS 服务器地址
- `priority` - 优先级 (1=Primary, 2=Secondary, ...)
- `is_active` - 是否启用
- `health_check_enabled` - 是否启用健康检查
- `failover_enabled` - 是否启用自动故障转移
- `health_check_interval` - 健康检查间隔 (秒)
- `health_check_timeout` - 健康检查超时 (秒)
- `failover_threshold` - 连续失败阈值
- `health_status` - 当前健康状态 (healthy/degraded/down/unknown)
- `last_health_check_at` - 最后一次健康检查时间
- `last_failover_at` - 最后一次故障转移时间

**upstream_failover_log 表** - 记录故障转移历史：
- `id` - UUID 主键
- `upstream_id` - 关联的 upstream ID
- `action` - 操作类型 (health_check_failed/failover_triggered/recovered)
- `reason` - 失败原因或详情
- `timestamp` - 时间戳

### API 层

**端点：**

| 方法 | 路径 | 认证 | 描述 |
|------|--------|--------|------|
| GET | `/api/v1/settings/upstreams` | 是 | 获取所有 upstream |
| POST | `/api/v1/settings/upstreams` | 是 | 创建新 upstream |
| GET | `/api/v1/settings/upstreams/{id}` | 是 | 获取单个 upstream |
| PUT | `/api/v1/settings/upstreams/{id}` | 是 | 更新 upstream |
| DELETE | `/api/v1/settings/upstreams/{id}` | 是 | 删除 upstream |
| POST | `/api/v1/settings/upstreams/{id}/test` | 是 | 测试连通性 |
| POST | `/api/v1/settings/upstreams/failover` | 是 | 手动触发故障转移 |
| GET | `/api/v1/settings/upstreams/failover-log` | 是 | 获取故障转移日志 (Admin) |

### 前端层

**Settings 页面扩展：**
- Upstream 列表显示（名称、地址、优先级、状态）
- 创建/编辑 Upstream 对话框
- 健康检查按钮和结果显示
- 状态指示器（绿色健康、黄色降级、红色故障）
- 故障转移日志显示

**新增 API 文件：** `frontend/src/api/upstreams.ts`

## 健康检查机制

**当前实现：**
- 使用 UDP DNS 查询测试连通性（比 TCP 更快）
- 支持自定义超时时间
- 返回延迟和错误信息

**测试流程：**
```rust
1. 解析地址 (支持 "ip" 和 "ip:port" 格式)
2. 配置 hickory-resolver 使用该地址
3. 执行 example.com 的 A 记录查询
4. 记录延迟和结果
```

## 故障转移机制

**手动故障转移：**
- 触发端点：`POST /api/v1/settings/upstreams/failover`
- 查找第一个健康的 upstream（按优先级排序）
- 记录故障转移事件到 `upstream_failover_log`

**自动故障转移（待实现）：**
- 基于连续失败次数阈值自动切换
- 后台定时任务监控 upstream 状态
- 状态恢复时自动切回 Primary

## 默认配置

Migration 自动创建两个默认 upstream：

1. **Cloudflare Primary** (priority=1)
   - 地址：1.1.1.1:53, 1.0.0.1:53
   - 检查间隔：30秒
   - 超时：5秒
   - 阈值：3

2. **Google DNS** (priority=2)
   - 地址：8.8.8.8:53, 8.8.4.4:53
   - 检查间隔：30秒
   - 超时：5秒
   - 阈值：3

## 与现有 DNS Resolver 的集成

**当前状态：**
- Resolver 仍使用硬编码的 hickory `ResolverConfig::cloudflare()`
- Upstream 配置已存储在数据库，但尚未被 resolver 使用

**后续改进：**
1. 改造 `src/dns/resolver.rs` 从数据库加载 upstream 配置
2. 实现基于优先级的 upstream 选择逻辑
3. 在健康检查失败时动态切换 resolver
4. 实现后台健康检查定时任务

## 文件清单

**新增文件：**
- `/src/db/migrations/002_add_upstreams.sql` - 数据库迁移
- `/src/db/models/upstream.rs` - Upstream 数据模型和仓库
- `/src/api/handlers/upstreams.rs` - API 处理器
- `/frontend/src/api/upstreams.ts` - 前端 API 客户端

**修改文件：**
- `/src/db/models/mod.rs` - 添加 upstream 模块
- `/src/api/handlers/mod.rs` - 添加 upstreams handler 模块
- `/src/api/router.rs` - 添加 upstreams 路由
- `/frontend/src/pages/Settings.tsx` - 扩展 Settings 页面

## 测试

**API 测试：**
```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.token')

# 获取 upstreams
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/settings/upstreams

# 测试连通性
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/settings/upstreams/{id}/test

# 手动故障转移
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/api/v1/settings/upstreams/failover
```

## 设计原则

遵循 DHH 开发哲学：
1. **简单优先** - MVP 功能，不过度工程化
2. **约定优于配置** - 遵循现有项目结构和命名约定
3. **可测试性** - 独立的 API 端点，便于测试
4. **渐进增强** - 先实现基础管理功能，后续扩展自动故障转移

## 已知限制

1. **DNS Resolver 集成未完成** - 当前 resolver 仍使用硬编码配置
2. **无后台健康检查** - 健康检查仅为手动触发
3. **无自动故障转移** - 故障转移仅为手动触发
4. **无 DNS 查询统计** - 未记录每个 upstream 的查询数量

## 后续改进方向

1. **完整 Resolver 集成**
   - 从数据库动态加载 upstream 配置
   - 实现基于优先级的 upstream 选择
   - 查询失败时自动切换

2. **后台健康检查**
   - 使用 tokio 定时任务定期检查所有 upstream
   - 更新数据库中的 health_status
   - 触发自动故障转移

3. **负载均衡**
   - 同优先级多个地址间的负载均衡
   - 基于响应时间自动选择最优服务器

4. **客户端特定 Upstream**
   - 支持为特定客户端指定专用 upstream
