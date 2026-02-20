import { apiClient, type DashboardStats } from './';
import type { QueryTrendData } from '@/components/dashboard/QueryTrendChart';
import type { TopDomainEntry, TopClientEntry } from './types';

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await apiClient.get<DashboardStats>(
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

/**
 * Get top 10 blocked domains in the past N hours
 */
export async function getTopBlockedDomains(hours = 24): Promise<TopDomainEntry[]> {
  const response = await apiClient.get<TopDomainEntry[]>(
    `/api/v1/dashboard/top-blocked-domains?hours=${hours}`
  );
  return response.data;
}

/**
 * Get top 10 most active clients in the past N hours
 */
export async function getTopClients(hours = 24): Promise<TopClientEntry[]> {
  const response = await apiClient.get<TopClientEntry[]>(
    `/api/v1/dashboard/top-clients?hours=${hours}`
  );
  return response.data;
}

// Export API object
export const dashboardApi = {
  getStats: getDashboardStats,
  getQueryTrend,
  getTopBlockedDomains,
  getTopClients,
};
