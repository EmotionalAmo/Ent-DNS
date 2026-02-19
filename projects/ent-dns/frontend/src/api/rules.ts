import apiClient from './client';
import type { Rule, CreateRuleRequest } from './types';

export interface ListRulesParams {
  page?: number;
  per_page?: number;
  search?: string;
}

export interface ListRulesResponse {
  data: Rule[];
  total: number;
  page: number;
  per_page: number;
}

/**
 * Rules API
 * 管理用户自定义 DNS 阻断/允许规则（不含订阅列表规则）
 */
export const rulesApi = {
  async listRules(params: ListRulesParams = {}): Promise<ListRulesResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.per_page) query.set('per_page', String(params.per_page));
    if (params.search) query.set('search', params.search);
    const response = await apiClient.get<ListRulesResponse>(`/api/v1/rules?${query}`);
    return response.data;
  },

  async createRule(request: CreateRuleRequest): Promise<Rule> {
    const response = await apiClient.post<Rule>('/api/v1/rules', request);
    return response.data;
  },

  async deleteRule(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/rules/${id}`);
  },

  async deleteRules(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.deleteRule(id)));
  },

  async exportRules(format: 'csv' | 'json'): Promise<Blob> {
    const response = await apiClient.get(`/api/v1/rules/export?format=${format}`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
