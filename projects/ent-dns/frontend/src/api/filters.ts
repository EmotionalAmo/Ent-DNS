import apiClient from './client';
import type { Filter, CreateFilterRequest } from './types';

/**
 * Filters API
 * 管理过滤列表（AdGuard/hosts 格式）
 */
export const filtersApi = {
  /**
   * 获取所有过滤列表
   */
  async listFilters(): Promise<Filter[]> {
    const response = await apiClient.get<{ data: Filter[]; total: number }>('/api/v1/filters');
    return response.data.data;
  },

  /**
   * 创建新过滤列表
   */
  async createFilter(request: CreateFilterRequest): Promise<Filter> {
    const response = await apiClient.post<Filter>('/api/v1/filters', request);
    return response.data;
  },

  /**
   * 更新过滤列表
   */
  async updateFilter(id: string, request: Partial<CreateFilterRequest>): Promise<Filter> {
    const response = await apiClient.put<Filter>(`/api/v1/filters/${id}`, request);
    return response.data;
  },

  /**
   * 删除过滤列表
   */
  async deleteFilter(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/filters/${id}`);
  },

  /**
   * 刷新过滤列表（手动同步远程规则）
   * 后端现在立即返回并在后台同步，syncing=true 表示同步已在后台启动
   */
  async refreshFilter(id: string): Promise<{ rule_count?: number; last_updated?: string; syncing?: boolean; message?: string }> {
    const response = await apiClient.post<{ rule_count?: number; last_updated?: string; syncing?: boolean; message?: string }>(`/api/v1/filters/${id}/refresh`);
    return response.data;
  },

  /**
   * 批量刷新所有过滤列表
   * 返回是否有任何过滤器在后台同步
   */
  async refreshAllFilters(filters: Filter[]): Promise<{ anySyncing: boolean }> {
    const results = await Promise.all(
      filters
        .filter(f => f.url && f.is_enabled)
        .map(f => this.refreshFilter(f.id))
    );
    return { anySyncing: results.some(r => r.syncing) };
  },
};
