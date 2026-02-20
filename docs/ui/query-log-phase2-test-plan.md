# Query Log Advanced Filtering - Phase 2 Test Plan

**Author:** ui-duarte (Matías Duarte)
**Date:** 2026-02-20
**Project:** Round 10 - Query Log Advanced Filtering Phase 2

---

## Test Overview

本文档描述 Phase 2（智能提示 + 模板管理 + 高级导出）的测试计划和验收标准。

### Phase 2 Deliverables

1. **智能提示（Autocomplete）**
   - 后端优化：基于历史查询热度排序
   - 前端 Hook：300ms 防抖 + 5 分钟缓存
   - 组件：`AutocompleteInput`（支持键盘导航）

2. **模板管理（Templates）**
   - 后端：4 个 CRUD 端点
   - 前端：`TemplateManager` + `TemplateDialog`
   - 数据库：6 个默认模板

3. **高级导出（Export）**
   - 后端：自定义字段选择
   - 前端：`ExportDialog` 组件

---

## Test 1: 智能提示（后端）

### Test 1.1: Suggest Endpoint 基本功能

**Objective:** 验证 `/api/v1/query-log/suggest` 端点正常工作

**Steps:**
```bash
# 1. 获取域名建议
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/suggest?field=question&prefix=goo&limit=10"

# 2. 获取 IP 建议
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/suggest?field=client_ip&prefix=192.168&limit=10"

# 3. 验证响应格式
```

**Expected Results:**
- HTTP 200 OK
- JSON 包含 `suggestions`、`field`、`prefix`、`count` 字段
- `suggestions` 数组按查询热度排序（COUNT(*) DESC）

**Acceptance Criteria:**
- ✅ 端点响应时间 < 100ms（热数据 < 50ms）
- ✅ 返回结果按历史查询热度排序
- ✅ 支持的字段：`question`、`client_ip`、`client_name`、`upstream`
- ✅ 不支持的字段返回 400 错误

---

### Test 1.2: Suggest 热度排序验证

**Objective:** 验证建议结果按查询频率排序

**Steps:**
```bash
# 1. 插入测试数据（手动执行多次查询）
dig @127.0.0.1 -p 15353 google.com A
dig @127.0.0.1 -p 15353 google.com A
dig @127.0.0.1 -p 15353 google.com A
dig @127.0.0.1 -p 15353 github.com A

# 2. 获取建议
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/suggest?field=question&prefix=g&limit=10"

# 3. 验证 google.com 排在 github.com 前面
```

**Expected Results:**
- `google.com` 排在 `github.com` 前面（查询次数更多）

**Acceptance Criteria:**
- ✅ 热度排序正确（按 COUNT(*) DESC）
- ✅ 最近 30 天内数据参与排序

---

## Test 2: 智能提示（前端）

### Test 2.1: useSuggestions Hook 防抖测试

**Objective:** 验证 300ms 防抖正常工作

**Test File:** `frontend/src/hooks/__tests__/useSuggestions.test.ts`

**Steps:**
```typescript
test('useSuggestions should debounce input changes', async () => {
  const { result } = renderHook(() => useSuggestions('question'));
  const { handlePrefixChange } = result.current;

  // 1. 快速输入多个字符
  act(() => {
    handlePrefixChange('g');
    handlePrefixChange('go');
    handlePrefixChange('goo');
    handlePrefixChange('goog');
  });

  // 2. 立即检查（应该没有调用 API）
  expect(result.current.suggestions).toEqual([]);

  // 3. 等待 300ms 后检查
  await waitFor(() => {
    expect(result.current.suggestions).not.toEqual([]);
  });
});
```

**Acceptance Criteria:**
- ✅ 输入变化后 300ms 内不触发 API 调用
- ✅ 300ms 后触发 API 调用
- ✅ 缓存命中时不调用 API

---

### Test 2.2: AutocompleteInput 组件交互测试

**Objective:** 验证键盘导航和点击选择

**Test File:** `frontend/src/components/query-log/__tests__/AutocompleteInput.test.tsx`

**Steps:**
```typescript
test('AutocompleteInput keyboard navigation', () => {
  render(<AutocompleteInput field="question" value="" onChange={jest.fn()} />);

  // 1. 输入字符触发建议
  const input = screen.getByPlaceholderText('输入值...');
  fireEvent.change(input, { target: { value: 'goo' } });

  // 2. 按下 ArrowDown 键
  fireEvent.keyDown(input, { key: 'ArrowDown' });

  // 3. 验证第一个建议被选中
  const firstSuggestion = screen.getByText(/google\.com/);
  expect(firstSuggestion).toHaveClass('bg-accent');

  // 4. 按下 Enter 键
  fireEvent.keyDown(input, { key: 'Enter' });

  // 5. 验证输入框值被更新
  expect(input.value).toBe('google.com');
});
```

**Acceptance Criteria:**
- ✅ 支持上下键导航建议列表
- ✅ 回车键选择当前高亮的建议
- ✅ ESC 键关闭建议列表
- ✅ 点击外部区域关闭建议列表
- ✅ 清除按钮（X）可清空输入框

---

## Test 3: 模板管理（后端）

### Test 3.1: 模板 CRUD 基本功能

**Objective:** 验证模板 CRUD 端点正常工作

**Steps:**
```bash
# 1. 列出所有模板（包含默认模板）
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/templates"

# 2. 创建新模板
TEMPLATE_ID=$(curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试模板",
    "filters": [{"field":"status","operator":"eq","value":"blocked"}],
    "logic": "AND",
    "is_public": false
  }' \
  "http://127.0.0.1:8080/api/v1/query-log/templates" | jq -r '.id')

# 3. 获取单个模板
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/templates/$TEMPLATE_ID"

# 4. 更新模板
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "更新后的测试模板"}' \
  "http://127.0.0.1:8080/api/v1/query-log/templates/$TEMPLATE_ID"

# 5. 删除模板
curl -s -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/templates/$TEMPLATE_ID"
```

**Expected Results:**
- ✅ 所有端点返回 200 OK（DELETE 为 204 或 200）
- ✅ 创建的模板包含所有字段
- ✅ 权限检查：非创建者无法编辑/删除模板

**Acceptance Criteria:**
- ✅ 列出默认 6 个模板
- ✅ 创建、获取、更新、删除功能正常
- ✅ 权限控制生效

---

### Test 3.2: 默认模板验证

**Objective:** 验证 6 个默认模板已正确插入

**Steps:**
```bash
# 查询数据库
sqlite3 /tmp/ent-dns-test.db \
  "SELECT id, name, is_public FROM query_log_templates WHERE created_by = 'system' ORDER BY created_at;"
```

**Expected Results:**
```
550e8400-e29b-41d4-a716-446655440001|最近拦截|1
550e8400-e29b-41d4-a716-446655440002|慢查询|1
550e8400-e29b-41d4-a716-446655440003|错误查询|1
550e8400-e29b-41d4-a716-446655440004|A 记录查询|1
550e8400-e29b-41d4-a716-446655440005|广告域名|1
550e8400-e29b-41d4-a716-446655440006|IoT 设备|1
```

**Acceptance Criteria:**
- ✅ 6 个默认模板全部存在
- ✅ `created_by` 为 `system`
- ✅ `is_public` 为 `true`

---

## Test 4: 模板管理（前端）

### Test 4.1: 模板保存和加载

**Objective:** 验证模板保存和加载功能

**Steps:**
1. 打开查询日志页面
2. 添加 2 个过滤器（status=blocked, time=relative:-24h）
3. 点击"模板"按钮 → 点击"新建"
4. 输入模板名称"测试拦截查询"，点击"保存"
5. 刷新页面
6. 点击"模板"按钮，验证新模板出现在列表中
7. 点击模板的"加载"按钮
8. 验证过滤器已应用到当前筛选条件

**Acceptance Criteria:**
- ✅ 模板保存成功，列表中显示
- ✅ 模板加载后，过滤器条件正确应用
- ✅ Toast 提示正确显示

---

### Test 4.2: 模板展开和删除

**Objective:** 验证模板展开详情和删除功能

**Steps:**
1. 打开模板列表
2. 点击模板名称展开详情
3. 验证显示：创建者、创建时间、过滤器列表
4. 点击"删除"按钮
5. 确认删除
6. 验证模板从列表中消失

**Acceptance Criteria:**
- ✅ 展开显示完整模板信息
- ✅ 删除前有确认提示
- ✅ 删除成功后 Toast 提示
- ✅ 刷新页面后模板仍然消失

---

## Test 5: 高级导出（后端）

### Test 5.1: 导出自定义字段

**Objective:** 验证导出功能支持自定义字段选择

**Steps:**
```bash
# 1. 导出 CSV（仅包含 question 和 status）
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/export?format=csv&fields=question,status" \
  -o test-export.csv

# 2. 验证 CSV 头
head -n 1 test-export.csv
# Expected: question,status

# 3. 导出 JSON（包含所有字段）
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/export?format=json&fields=id,time,client_ip,question,status" \
  -o test-export.json

# 4. 验证 JSON 格式
jq 'length' test-export.json
```

**Acceptance Criteria:**
- ✅ 支持通过 `fields` 参数选择字段
- ✅ CSV 和 JSON 格式正确
- ✅ 字段无效时返回错误提示

---

### Test 5.2: 导出支持过滤器

**Objective:** 验证导出支持高级过滤器

**Steps:**
```bash
# 1. 导出被拦截的查询
FILTERS_JSON='[{"field":"status","operator":"eq","value":"blocked"}]'
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/export?format=csv&fields=question,status&filters_json=$FILTERS_JSON" \
  -o blocked-export.csv

# 2. 验证导出的所有记录 status=blocked
grep -v 'status' blocked-export.csv | cut -d',' -f2 | sort -u
# Expected: blocked
```

**Acceptance Criteria:**
- ✅ 支持通过 `filters_json` 参数过滤导出
- ✅ 导出结果符合过滤条件

---

## Test 6: 高级导出（前端）

### Test 6.1: 导出对话框交互

**Objective:** 验证 ExportDialog 组件交互

**Steps:**
1. 打开查询日志页面
2. 点击"导出"按钮
3. 验证对话框打开，显示格式选择
4. 选择"CSV"格式
5. 展开"导出字段"
6. 勾选/取消勾选字段
7. 点击"全选"和"清除"
8. 点击"导出 CSV (表格)"
9. 验证文件下载成功

**Acceptance Criteria:**
- ✅ 对话框正确打开和关闭
- ✅ 格式切换正常（CSV/JSON）
- ✅ 字段选择器工作正常
- ✅ "全选"和"清除"按钮有效
- ✅ 下载触发成功

---

### Test 6.2: 导出字段验证

**Objective:** 验证导出文件包含正确的字段

**Steps:**
1. 打开导出对话框
2. 仅选择 3 个字段：time、question、status
3. 点击"导出"
4. 打开下载的 CSV 文件
5. 验证 CSV 头仅包含 3 列
6. 验证数据正确

**Acceptance Criteria:**
- ✅ CSV 头与选择的字段一致
- ✅ 数据正确填充
- ✅ 字段顺序与选择顺序一致

---

## Performance Tests

### Test 7.1: 智能提示响应时间

**Objective:** 验证智能提示延迟 < 50ms

**Steps:**
```bash
# 使用 curl 计时
time curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/suggest?field=question&prefix=g&limit=10" \
  > /dev/null
```

**Acceptance Criteria:**
- ✅ 热数据（缓存命中）< 50ms
- ✅ 冷数据（缓存未命中）< 200ms

---

### Test 7.2: 模板列表加载时间

**Objective:** 验证模板列表加载时间 < 100ms

**Steps:**
```bash
time curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8080/api/v1/query-log/templates" \
  > /dev/null
```

**Acceptance Criteria:**
- ✅ 模板列表加载 < 100ms
- ✅ 包含默认 6 个模板

---

## Integration Test

### Test 8: 端到端流程

**Objective:** 验证完整的查询 → 保存为模板 → 导出流程

**Steps:**
1. 打开查询日志页面
2. 添加过滤器：status=blocked, time=relative:-24h
3. 点击"搜索"按钮
4. 验证查询结果正确
5. 点击"模板" → "新建"
6. 输入名称"最近拦截查询"，点击"保存"
7. 刷新页面
8. 点击"模板"，点击"最近拦截查询"的"加载"按钮
9. 验证过滤器自动应用
10. 点击"导出"按钮
11. 选择 CSV 格式，选择全部字段
12. 点击"导出 CSV (表格)"
13. 验证文件下载成功

**Acceptance Criteria:**
- ✅ 所有步骤流程顺畅
- ✅ 无错误提示
- ✅ 导出文件包含正确的过滤结果

---

## Test Results Template

```
| Test ID | Description | Status | Notes |
|---------|-------------|--------|-------|
| 1.1     | Suggest 基本功能        | ⬜       |        |
| 1.2     | Suggest 热度排序        | ⬜       |        |
| 2.1     | useSuggestions 防抖测试 | ⬜       |        |
| 2.2     | AutocompleteInput 交互    | ⬜       |        |
| 3.1     | 模板 CRUD 基本功能     | ⬜       |        |
| 3.2     | 默认模板验证          | ⬜       |        |
| 4.1     | 模板保存和加载        | ⬜       |        |
| 4.2     | 模板展开和删除        | ⬜       |        |
| 5.1     | 导出自定义字段         | ⬜       |        |
| 5.2     | 导出支持过滤器          | ⬜       |        |
| 6.1     | 导出对话框交互          | ⬜       |        |
| 6.2     | 导出字段验证          | ⬜       |        |
| 7.1     | 智能提示响应时间        | ⬜       |        |
| 7.2     | 模板列表加载时间        | ⬜       |        |
| 8       | 端到端流程           | ⬜       |        |
```

---

## Notes

### Known Limitations

1. **导出文件大小限制**：最多导出 10,000 条记录
2. **模板数量限制**：理论上无限制，建议不超过 100 个
3. **智能提示缓存**：5 分钟 TTL，可能影响实时性

### Testing Environment

- **数据库**：SQLite（WAL mode）
- **数据量**：测试时建议至少 1,000 条记录
- **浏览器**：Chrome / Firefox / Safari 最新版本

---

**Design by ui-duarte (Matías Duarte)**
**遵循原则：Bold, Graphic, Intentional**
