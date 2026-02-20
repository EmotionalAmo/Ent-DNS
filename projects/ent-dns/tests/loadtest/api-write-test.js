import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 自定义指标
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');
const dbLockErrors = new Rate('db_lock_errors');

// 配置
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // 预热：2 分钟爬坡到 10 VU
    { duration: '5m', target: 50 },   // 正常负载：5 分钟爬坡到 50 VU
    { duration: '2m', target: 100 },  // 峰值：2 分钟爬坡到 100 VU
    { duration: '2m', target: 200 },  // 压力测试：2 分钟爬坡到 200 VU
    { duration: '2m', target: 0 },   // 冷却：2 分钟降到 0 VU
  ],
  thresholds: {
    'errors': ['rate<0.05'],              // 错误率 < 5%
    'http_req_duration': ['p(95)<500'],   // API P95 < 500ms
    'db_lock_errors': ['rate<0.01'],       // 数据库锁错误 < 1%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080/api/v1';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

// 验证 token
if (!AUTH_TOKEN) {
  console.error('错误: AUTH_TOKEN 环境变量未设置');
  console.error('获取 token: curl -X POST http://127.0.0.1:8080/api/v1/auth/login -H "Content-Type: application/json" -d \'{"username":"admin","password":"admin"}\' | jq -r \'.token\'');
  throw new Error('AUTH_TOKEN 未设置');
}

// 生成随机域名
function randomDomain() {
  const prefix = Math.random().toString(36).substring(7);
  return `${prefix}.test.example.com`;
}

export function setup() {
  // 测试认证是否有效
  const authRes = http.get(`${BASE_URL}/users`, {
    headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
  });

  if (authRes.status !== 200) {
    throw new Error('认证失败：请检查 AUTH_TOKEN');
  }

  console.log('认证验证通过，开始测试');
}

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };

  // 场景 1: 创建 DNS 规则
  const createPayload = JSON.stringify({
    domain: randomDomain(),
    action: Math.random() > 0.5 ? 'block' : 'allow',
    enabled: true,
  });

  const startTime = Date.now();
  const createRes = http.post(`${BASE_URL}/rules`, createPayload, { headers });
  const createTime = Date.now() - startTime;

  // 检查是否为数据库锁错误
  const isDbLockError = createRes.status === 500 &&
                       createRes.body.includes('database is locked') ||
                       createRes.body.includes('SQLITE_BUSY');

  errorRate.add(createRes.status !== 201);
  dbLockErrors.add(isDbLockError);
  apiLatency.add(createTime);

  if (createRes.status !== 201) {
    console.log(`创建规则失败: ${createRes.status} - ${createRes.body}`);
    return; // 失败则跳过后续操作
  }

  const ruleId = createRes.json('id');

  // 场景 2: 查询规则列表
  const listRes = http.get(`${BASE_URL}/rules`, { headers });
  apiLatency.add(listRes.timings.duration);
  errorRate.add(listRes.status !== 200);

  // 场景 3: 查询单个规则
  const getRes = http.get(`${BASE_URL}/rules/${ruleId}`, { headers });
  apiLatency.add(getRes.timings.duration);
  errorRate.add(getRes.status !== 200);

  // 场景 4: 更新规则
  const updatePayload = JSON.stringify({
    enabled: Math.random() > 0.5,
  });
  const updateRes = http.put(`${BASE_URL}/rules/${ruleId}`, updatePayload, { headers });
  apiLatency.add(updateRes.timings.duration);
  errorRate.add(updateRes.status !== 200);

  // 场景 5: 删除规则
  const deleteRes = http.del(`${BASE_URL}/rules/${ruleId}`, null, { headers });
  apiLatency.add(deleteRes.timings.duration);
  errorRate.add(deleteRes.status !== 204);

  // 随机等待（模拟真实用户操作间隔）
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 秒
}

export function teardown(data) {
  console.log('测试完成');
}
