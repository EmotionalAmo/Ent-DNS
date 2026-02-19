import apiClient from './client';

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface DnsUpstream {
  id: string;
  name: string;
  addresses: string[];
  priority: number;
  is_active: boolean;
  health_check_enabled: boolean;
  failover_enabled: boolean;
  health_check_interval: number;
  health_check_timeout: number;
  failover_threshold: number;
  health_status: HealthStatus;
  last_health_check_at: string | null;
  last_failover_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUpstreamRequest {
  name: string;
  addresses: string[];
  priority: number;
  health_check_interval: number;
  health_check_timeout: number;
  failover_threshold: number;
}

export interface UpdateUpstreamRequest {
  name?: string;
  addresses?: string[];
  priority?: number;
  is_active?: boolean;
  health_check_enabled?: boolean;
  failover_enabled?: boolean;
  health_check_interval?: number;
  health_check_timeout?: number;
  failover_threshold?: number;
}

export interface HealthCheckResult {
  success: boolean;
  latency_ms: number;
  error: string | null;
}

export interface FailoverResult {
  success: boolean;
  new_upstream_id: string | null;
  message: string;
}

export interface FailoverLogEntry {
  id: string;
  upstream_id: string;
  action: string;
  reason: string | null;
  timestamp: string;
}

interface UpstreamListResponse {
  data: DnsUpstream[];
  total: number;
}

interface FailoverLogResponse {
  data: FailoverLogEntry[];
  total: number;
}

async function listUpstreams(): Promise<DnsUpstream[]> {
  const response = await apiClient.get<UpstreamListResponse>('/api/v1/settings/upstreams');
  return response.data.data;
}

async function getUpstream(id: string): Promise<DnsUpstream> {
  const response = await apiClient.get<DnsUpstream>(`/api/v1/settings/upstreams/${id}`);
  return response.data;
}

async function createUpstream(req: CreateUpstreamRequest): Promise<DnsUpstream> {
  const response = await apiClient.post<DnsUpstream>('/api/v1/settings/upstreams', req);
  return response.data;
}

async function updateUpstream(id: string, req: UpdateUpstreamRequest): Promise<DnsUpstream> {
  const response = await apiClient.put<DnsUpstream>(`/api/v1/settings/upstreams/${id}`, req);
  return response.data;
}

async function deleteUpstream(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/settings/upstreams/${id}`);
}

async function testConnectivity(id: string): Promise<HealthCheckResult> {
  const response = await apiClient.post<HealthCheckResult>(`/api/v1/settings/upstreams/${id}/test`, {});
  return response.data;
}

async function triggerFailover(): Promise<FailoverResult> {
  const response = await apiClient.post<FailoverResult>('/api/v1/settings/upstreams/failover', {});
  return response.data;
}

async function getFailoverLog(): Promise<FailoverLogEntry[]> {
  const response = await apiClient.get<FailoverLogResponse>('/api/v1/settings/upstreams/failover-log');
  return response.data.data;
}

export const upstreamsApi = {
  list: listUpstreams,
  get: getUpstream,
  create: createUpstream,
  update: updateUpstream,
  delete: deleteUpstream,
  testConnectivity,
  triggerFailover,
  getFailoverLog,
};
