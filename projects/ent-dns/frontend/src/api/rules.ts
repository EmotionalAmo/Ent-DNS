import apiClient from './client';
import type { Rule, CreateRuleRequest } from './types';

/**
 * Rules API
 * 管理 DNS 阻断/允许规则
 */
export const rulesApi = {
  /**
   * 获取所有规则
   */
  async listRules(): Promise<Rule[]> {
    const response = await apiClient.get<{ data: Rule[]; total: number }>('/api/v1/rules');
    return response.data.data;
  },

  /**
   * 创建新规则
   */
  async createRule(request: CreateRuleRequest): Promise<Rule> {
    const response = await apiClient.post<Rule>('/api/v1/rules', request);
    return response.data;
  },

  /**
   * 删除规则
   */
  async deleteRule(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/rules/${id}`);
  },

  /**
   * 批量删除规则
   */
  async deleteRules(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.deleteRule(id)));
  },
};
