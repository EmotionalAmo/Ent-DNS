import { apiClient, type DashboardStats } from './';

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
  const response = await apiClient.get<{ stats: ExtendedDashboardStats }>(
    '/api/v1/dashboard/stats'
  );
  return response.data.stats;
}

// Export API object
export const dashboardApi = {
  getStats: getDashboardStats,
};
