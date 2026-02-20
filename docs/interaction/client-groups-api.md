# 客户端分组管理 — API 设计

## 设计原则

遵循 **RESTful API** 规范，同时考虑 Alex（系统管理员）的使用场景：
- 批量操作优先（减少请求次数）
- 影响范围可见（每个响应显示影响的设备/规则数量）
- 错误信息友好（不暴露技术细节）

---

## API 端点总览

### 分组管理

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/client-groups` | 获取所有分组列表 |
| POST | `/api/v1/client-groups` | 创建新分组 |
| PUT | `/api/v1/client-groups/{id}` | 更新分组信息 |
| DELETE | `/api/v1/client-groups/{id}` | 删除分组 |
| PUT | `/api/v1/client-groups/{id}/reorder` | 调整分组排序 |

### 分组成员管理

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/client-groups/{id}/members` | 获取分组的所有客户端 |
| POST | `/api/v1/client-groups/{id}/members` | 批量添加客户端到分组 |
| DELETE | `/api/v1/client-groups/{id}/members` | 批量从分组移除客户端 |
| GET | `/api/v1/client-groups/{id}/members/preview` | 预览分组规则对客户端的影响 |

### 客户端分组操作

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/clients/{client_id}/groups` | 获取客户端所属的所有分组 |
| POST | `/api/v1/clients/batch-move` | 批量移动客户端到分组 |
| POST | `/api/v1/clients/batch-copy` | 批量复制客户端到分组（保留原分组） |

### 分组规则管理

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/client-groups/{id}/rules` | 获取分组的所有规则 |
| POST | `/api/v1/client-groups/{id}/rules` | 批量绑定规则到分组 |
| DELETE | `/api/v1/client-groups/{id}/rules` | 批量从分组解绑规则 |
| PUT | `/api/v1/client-groups/{id}/rules/reorder` | 调整分组内规则排序 |

### 预览与验证

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/client-groups/preview-rules` | 预览某客户端应用分组规则后的结果 |
| POST | `/api/v1/client-groups/validate-rules` | 验证分组规则是否有冲突 |

---

## 详细 API 设计

### 1. 获取所有分组列表

**Request**:
```http
GET /api/v1/client-groups
Authorization: Bearer <token>
```

**Response**:
```json
{
  "data": [
    {
      "id": 1,
      "name": "研发部门",
      "color": "#6366f1",
      "description": "研发团队设备",
      "priority": 0,
      "client_count": 12,
      "rule_count": 3,
      "created_at": "2026-02-20T10:00:00Z",
      "updated_at": "2026-02-20T10:00:00Z"
    },
    {
      "id": 2,
      "name": "隔离组",
      "color": "#ef4444",
      "description": "安全隔离设备",
      "priority": 1,
      "client_count": 5,
      "rule_count": 2,
      "created_at": "2026-02-20T10:00:00Z",
      "updated_at": "2026-02-20T10:00:00Z"
    }
  ],
  "total": 2
}
```

**设计决策**:
- ✅ 包含 `client_count` 和 `rule_count`，避免前端额外请求
- ✅ 按 `priority` 排序（拖拽排序后保存）

---

### 2. 创建新分组

**Request**:
```http
POST /api/v1/client-groups
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "市场部",
  "color": "#22c55e",
  "description": "市场团队设备",
  "priority": 2
}
```

**Response**:
```json
{
  "id": 3,
  "name": "市场部",
  "color": "#22c55e",
  "description": "市场团队设备",
  "priority": 2,
  "client_count": 0,
  "rule_count": 0,
  "created_at": "2026-02-20T10:00:00Z",
  "updated_at": "2026-02-20T10:00:00Z"
}
```

**错误响应**:
```json
{
  "error": "Group name already exists",
  "code": "GROUP_NAME_EXISTS",
  "details": {
    "name": "市场部"
  }
}
```

---

### 3. 更新分组信息

**Request**:
```http
PUT /api/v1/client-groups/{id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "市场团队",
  "color": "#16a34a",
  "description": "市场部设备（更新）",
  "priority": 1
}
```

**Response**:
```json
{
  "id": 3,
  "name": "市场团队",
  "color": "#16a34a",
  "description": "市场部设备（更新）",
  "priority": 1,
  "client_count": 0,
  "rule_count": 0,
  "created_at": "2026-02-20T10:00:00Z",
  "updated_at": "2026-02-20T11:00:00Z"
}
```

---

### 4. 删除分组

**Request**:
```http
DELETE /api/v1/client-groups/{id}
Authorization: Bearer <token>
```

**Response**:
```json
{
  "message": "Group deleted successfully",
  "affected_clients": 12,
  "affected_rules": 3
}
```

**设计决策**:
- ✅ 显示影响范围（设备数量 + 规则数量）
- ✅ 不实际删除客户端，客户端移至"未分组"

**错误响应**:
```json
{
  "error": "Group not found",
  "code": "GROUP_NOT_FOUND",
  "details": {
    "id": 999
  }
}
```

---

### 5. 获取分组的所有客户端

**Request**:
```http
GET /api/v1/client-groups/{id}/members?page=1&page_size=20
Authorization: Bearer <token>
```

**Response**:
```json
{
  "data": [
    {
      "id": "192.168.1.100",
      "name": "开发机-01",
      "ip": "192.168.1.100",
      "mac": "00:11:22:33:44:55",
      "last_seen": "2026-02-20T10:00:00Z",
      "query_count": 1234,
      "group_ids": [1, 2],
      "group_names": ["研发部门", "隔离组"]
    }
  ],
  "total": 12,
  "page": 1,
  "page_size": 20
}
```

**设计决策**:
- ✅ 包含 `group_ids` 和 `group_names`，显示该客户端的其他分组
- ✅ 支持分页（避免大量设备时响应过大）

---

### 6. 批量添加客户端到分组

**Request**:
```http
POST /api/v1/client-groups/{id}/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "client_ids": ["192.168.1.100", "192.168.1.101", "192.168.1.102"]
}
```

**Response**:
```json
{
  "message": "Added 3 clients to group",
  "added_count": 3,
  "skipped_count": 0,
  "skipped_clients": []
}
```

**设计决策**:
- ✅ 批量操作（减少请求次数）
- ✅ 返回跳过的客户端（避免重复添加）

**错误响应**:
```json
{
  "error": "Some clients not found",
  "code": "CLIENTS_NOT_FOUND",
  "details": {
    "not_found": ["192.168.1.999"],
    "added_count": 2,
    "skipped_count": 1
  }
}
```

---

### 7. 批量从分组移除客户端

**Request**:
```http
DELETE /api/v1/client-groups/{id}/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "client_ids": ["192.168.1.100", "192.168.1.101"]
}
```

**Response**:
```json
{
  "message": "Removed 2 clients from group",
  "removed_count": 2
}
```

---

### 8. 批量移动客户端到分组

**Request**:
```http
POST /api/v1/clients/batch-move
Authorization: Bearer <token>
Content-Type: application/json

{
  "client_ids": ["192.168.1.100", "192.168.1.101", "192.168.1.102"],
  "from_group_id": null,
  "to_group_id": 1
}
```

**Response**:
```json
{
  "message": "Moved 3 clients to group",
  "moved_count": 3,
  "affected_rules_count": 3,
  "applied_rules": [
    {
      "rule_id": 1,
      "rule_type": "filter",
      "name": "阻断外部访问"
    }
  ]
}
```

**设计决策**:
- ✅ `from_group_id` 为 `null` 表示从"未分组"移动
- ✅ 显示应用的规则列表（用户可见影响范围）

---

### 9. 获取分组的所有规则

**Request**:
```http
GET /api/v1/client-groups/{id}/rules?rule_type=filter
Authorization: Bearer <token>
```

**Response**:
```json
{
  "data": [
    {
      "rule_id": 1,
      "rule_type": "filter",
      "name": "阻断外部访问",
      "pattern": "*external*",
      "action": "block",
      "priority": 0,
      "created_at": "2026-02-20T10:00:00Z"
    },
    {
      "rule_id": 2,
      "rule_type": "filter",
      "name": "允许研发资源",
      "pattern": "*研发资源*",
      "action": "allow",
      "priority": 1,
      "created_at": "2026-02-20T10:00:00Z"
    }
  ],
  "total": 2
}
```

**设计决策**:
- ✅ 按 `priority` 排序（支持拖拽排序）
- ✅ 过滤 `rule_type`（filter/rewrite/rule）

---

### 10. 批量绑定规则到分组

**Request**:
```http
POST /api/v1/client-groups/{id}/rules
Authorization: Bearer <token>
Content-Type: application/json

{
  "rules": [
    {
      "rule_id": 1,
      "rule_type": "filter",
      "priority": 0
    },
    {
      "rule_id": 2,
      "rule_type": "filter",
      "priority": 1
    }
  ]
}
```

**Response**:
```json
{
  "message": "Bound 2 rules to group",
  "bound_count": 2,
  "skipped_count": 0,
  "skipped_rules": []
}
```

---

### 11. 预览分组规则对客户端的影响

**Request**:
```http
GET /api/v1/client-groups/{id}/members/preview?client_id=192.168.1.100
Authorization: Bearer <token>
```

**Response**:
```json
{
  "client_id": "192.168.1.100",
  "client_name": "开发机-01",
  "current_groups": ["研发部门", "隔离组"],
  "target_group": "研发部门",
  "applied_rules": [
    {
      "rule_id": 1,
      "rule_type": "filter",
      "name": "阻断外部访问",
      "pattern": "*external*",
      "action": "block",
      "source": "group",
      "group_name": "研发部门",
      "priority": 0
    },
    {
      "rule_id": 3,
      "rule_type": "filter",
      "name": "阻断 GitHub",
      "pattern": "*github*",
      "action": "block",
      "source": "client",
      "priority": -1
    }
  ],
  "test_results": [
    {
      "domain": "github.com",
      "expected_action": "block",
      "applied_rule": "阻断 GitHub",
      "rule_source": "client"
    },
    {
      "domain": "internal.example.com",
      "expected_action": "allow",
      "applied_rule": null,
      "rule_source": "global"
    }
  ]
}
```

**设计决策**:
- ✅ 显示规则来源（global/group/client）
- ✅ 显示测试结果（验证规则是否生效）
- ✅ 客户端专属规则优先级最高（priority = -1）

---

### 12. 预览某客户端应用分组规则后的结果

**Request**:
```http
POST /api/v1/client-groups/preview-rules
Authorization: Bearer <token>
Content-Type: application/json

{
  "client_id": "192.168.1.100",
  "test_domains": ["github.com", "internal.example.com", "external.com"]
}
```

**Response**:
```json
{
  "client_id": "192.168.1.100",
  "client_name": "开发机-01",
  "groups": ["研发部门", "隔离组"],
  "applied_rules": [
    {
      "rule_id": 3,
      "rule_type": "filter",
      "name": "阻断 GitHub",
      "pattern": "*github*",
      "action": "block",
      "source": "client",
      "priority": -1
    }
  ],
  "test_results": [
    {
      "domain": "github.com",
      "expected_action": "block",
      "applied_rule": "阻断 GitHub",
      "rule_source": "client"
    },
    {
      "domain": "internal.example.com",
      "expected_action": "allow",
      "applied_rule": null,
      "rule_source": "global"
    },
    {
      "domain": "external.com",
      "expected_action": "block",
      "applied_rule": "阻断外部访问",
      "rule_source": "group",
      "group_name": "隔离组"
    }
  ],
  "conflicts": [
    {
      "domain": "example.com",
      "rules": [
        {
          "rule_id": 1,
          "name": "阻断外部访问",
          "action": "block",
          "source": "group",
          "group_name": "研发部门"
        },
        {
          "rule_id": 4,
          "name": "允许 example.com",
          "action": "allow",
          "source": "group",
          "group_name": "隔离组"
        }
      ],
      "recommendation": "Review rule priority: group rules are applied in creation order"
    }
  ]
}
```

**设计决策**:
- ✅ 显示规则冲突（帮助用户排查问题）
- ✅ 给出建议（如何解决冲突）
- ✅ 不实际保存配置（仅预览）

---

## 错误代码规范

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `GROUP_NOT_FOUND` | 分组不存在 | 404 |
| `GROUP_NAME_EXISTS` | 分组名已存在 | 409 |
| `CLIENT_NOT_FOUND` | 客户端不存在 | 404 |
| `CLIENTS_NOT_FOUND` | 部分客户端不存在 | 207 |
| `RULE_NOT_FOUND` | 规则不存在 | 404 |
| `RULE_TYPE_INVALID` | 规则类型无效 | 400 |
| `INVALID_PRIORITY` | 优先级无效 | 400 |
| `PREVIEW_ERROR` | 预览失败 | 500 |

---

## 认证与授权

### 权限要求

| Endpoint | Required Role |
|----------|---------------|
| GET `/api/v1/client-groups` | User |
| POST `/api/v1/client-groups` | Admin |
| PUT `/api/v1/client-groups/{id}` | Admin |
| DELETE `/api/v1/client-groups/{id}` | Admin |
| GET `/api/v1/client-groups/{id}/members` | User |
| POST `/api/v1/client-groups/{id}/members` | Admin |
| DELETE `/api/v1/client-groups/{id}/members` | Admin |
| POST `/api/v1/clients/batch-move` | Admin |
| GET `/api/v1/client-groups/{id}/rules` | User |
| POST `/api/v1/client-groups/{id}/rules` | Admin |
| DELETE `/api/v1/client-groups/{id}/rules` | Admin |
| POST `/api/v1/client-groups/preview-rules` | User |

---

## 审计日志

所有修改操作（创建/更新/删除）记录审计日志：

```json
{
  "id": 123,
  "timestamp": "2026-02-20T10:00:00Z",
  "user_id": 1,
  "username": "admin",
  "action": "client_group_updated",
  "resource_type": "client_group",
  "resource_id": 1,
  "details": {
    "group_name": "研发部门",
    "changes": {
      "description": {
        "old": "研发团队设备",
        "new": "研发团队设备（更新）"
      }
    }
  },
  "ip_address": "192.168.1.100"
}
```

---

## 下一步

- [x] API 端点设计
- [ ] Model 定义（Rust structs）
- [ ] Handler 实现（Axum handlers）
- [ ] 路由集成
- [ ] 前端 API 封装
