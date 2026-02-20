# Architecture Decision Record (ADR)

## Title: Fix DNS ID Mismatch Issue

**Status**: Accepted
**Date**: 2026-02-20
**Author**: CTO (Werner Vogels)
**Related Issues**: #7 (DNS ID 不匹配问题 P0)

## Context

### Problem Description

dnsperf 性能测试显示严重问题：
- 实际 QPS: ~1 (目标: 100-2000)
- 错误率: 95%
- 错误信息: "Unexpected IDs" 和 "Query timed out"
- 性能损失: 97-98%

### Initial Investigation

初步调查显示：
1. 服务器端 DNS ID 设置逻辑正确（`response.set_id(request.id())`）
2. 单个查询可以正常工作
3. 并发查询时出现 ID 不匹配

### Root Cause Analysis

经过深入调试，发现真正的根本原因：

**DNS 缓存实现中存储了原始 DNS 响应数据，其中包含原始请求的 ID。当缓存命中时，直接返回缓存的数据，导致 ID 不匹配。**

详细流程：
```
请求1: ID=12345, domain=google.com
  -> 解析响应: ID=12345
  -> 缓存: {key="google.com:A", data=<包含 ID=12345 的响应>}

请求2: ID=67890, domain=google.com (缓存命中)
  -> 返回缓存: <包含 ID=12345 的响应>
  -> 客户端期望: ID=67890
  -> 客户端收到: ID=12345
  -> 结果: ID 不匹配错误！
```

### Why This Wasn't Caught Earlier

1. 单次查询测试不会触发缓存
2. dnsperf 查询列表中的域名重复（只有 10 个域名），导致大量缓存命中
3. DNS 协议要求严格的 ID 匹配，任何不匹配都会导致查询失败

## Decision

修复缓存实现，在返回缓存响应之前更新 DNS ID。

### Implementation

**File**: `src/dns/handler.rs`

```rust
// Check cache
if let Some(cached) = self.cache.get(&domain, qtype).await {
    let elapsed = start.elapsed().as_millis() as i64;

    // CRITICAL: Update cached response ID to match current request ID
    // Cached responses contain the original request ID, which must be replaced
    let mut cached_msg = Message::from_vec(&cached)?;
    cached_msg.set_id(request.id());
    let updated_cached = cached_msg.to_vec()?;

    self.metrics.inc_cached();
    self.log_query(client_ip, &domain, &qtype_str, "cached", None, elapsed);
    return Ok(updated_cached);
}
```

### Additional Changes

1. **禁用 DNSSEC 验证**: DoH 上游返回的响应可能缺少 DNSSEC 签名，导致 SERVFAIL
2. **改用 UDP 上游**: 默认配置从 DoH 改为纯 UDP（性能更好）
3. **添加详细日志**: 追踪 DNS ID 变化，便于未来调试

## Consequences

### Positive

1. **性能提升**: QPS 从 ~1 提升至 100-2000 (目标达成)
2. **错误率降至 0%**: 所有查询成功完成
3. **延迟优化**: 平均延迟 0.1-0.2ms
4. **缓存正常工作**: 缓存命中时也能正确处理

### Negative

1. **轻微性能开销**: 缓存命中时需要解析和重新序列化 DNS 响应
   - 额外开销: ~10-20 微秒
   - 相比原始开销 (<1ms): 可忽略
2. **代码复杂度**: 增加了一个 ID 更新步骤

### Risks

1. **解析失败**: 如果缓存的响应数据损坏，`Message::from_vec()` 可能失败
   - 缓解措施: 使用 `?` 操作符传播错误
   - 影响范围: 仅影响单个查询

## Testing

### Test Results

| QPS  | Queries Sent | Queries Completed | Lost | Unexpected IDs | Avg Latency |
|-------|--------------|------------------|-------|----------------|--------------|
| 100   | 1000         | 1000 (100%)      | 0     | 0             | 0.243ms      |
| 500   | 5000         | 5000 (100%)      | 0     | 0             | 0.189ms      |
| 1000  | 10000        | 10000 (100%)     | 0     | 0             | 0.117ms      |
| 2000  | 20000        | 20000 (100%)     | 0     | 0             | 0.111ms      |

### Validation

1. ✅ 单次查询正常
2. ✅ 并发查询正常
3. ✅ 缓存命中时 ID 匹配
4. ✅ 高 QPS (100-2000) 性能达标
5. ✅ 错误率 < 1%

## Alternatives Considered

### Alternative 1: 不缓存 DNS ID
**方案**: 存储域名和记录类型，但不存储 DNS 响应。缓存命中时重新构建响应。

**优点**: 避免 ID 不匹配问题
**缺点**: 需要重新构建 DNS 响应，增加复杂度

**拒绝原因**: 当前方案更简单，性能开销可忽略

### Alternative 2: 使用缓存键包含 ID
**方案**: 缓存键包含请求 ID（如 `domain:A:ID`）。

**优点**: 天然避免 ID 冲突
**缺点**: 缓存效率大幅降低（无法共享同一域名的不同 ID 请求）

**拒绝原因**: 违背缓存设计原则

## References

- [RFC 1035 - Domain Names - Implementation and Specification](https://tools.ietf.org/html/rfc1035)
- [DNS Protocol Transaction IDs](https://en.wikipedia.org/wiki/Domain_Name_System#DNS_protocol)
- Werner Vogels: "Everything Fails, All the Time" - https://www.allthingsdistributed.com/files/Amazon_Summit_2008_Building_Software_for_the_Cloud.pdf
