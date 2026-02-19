import { apiClient, type DashboardStats } from './';
import type { QueryTrendData } from '@/components/dashboard/QueryTrendChart';

// Extended stats type with additional fields for UI
export interface ExtendedDashboardStats extends DashboardStats {
  cached_queries?: number;
  avg_latency_ms?: number;
  dns_status?: 'running' | 'stopped' | 'error';
  cache_ttl?: number;
  filter_engine_rules?: number;
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(): Promise<ExtendedDashboardStats> {
  const response = await apiClient.get<ExtendedDashboardStats>(
    '/api/v1/dashboard/stats'
  );
  return response.data;
}

/**
 * Get hourly query trend data for the past N hours (default 24)
 */
export async function getQueryTrend(hours = 24): Promise<QueryTrendData[]> {
  const response = await apiClient.get<Array<{
    time: string;
    total: number;
    blocked: number;
    allowed: number;
  }>>(`/api/v1/dashboard/query-trend?hours=${hours}`);

  return response.data.map((row) => ({
    time: row.time,
    queries: row.total,
    blocked: row.blocked,
    allowed: row.allowed,
  }));
}

// Export API object
export const dashboardApi = {
  getStats: getDashboardStats,
  getQueryTrend,
};
