import apiClient from './client';
import type { Rewrite, CreateRewriteRequest } from './types';

/**
 * Rewrites API
 * 管理 DNS 重写规则（域名 -> IP 映射）
 */
export const rewritesApi = {
  /**
   * 获取所有 DNS 重写规则
   */
  async listRewrites(): Promise<Rewrite[]> {
    const response = await apiClient.get<Rewrite[]>('/api/v1/rewrites');
    return response.data;
  },

  /**
   * 创建新重写规则
   */
  async createRewrite(request: CreateRewriteRequest): Promise<Rewrite> {
    const response = await apiClient.post<Rewrite>('/api/v1/rewrites', request);
    return response.data;
  },

  /**
   * 更新重写规则
   */
  async updateRewrite(id: string, request: Partial<CreateRewriteRequest>): Promise<Rewrite> {
    const response = await apiClient.put<Rewrite>(`/api/v1/rewrites/${id}`, request);
    return response.data;
  },

  /**
   * 删除重写规则
   */
  async deleteRewrite(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/rewrites/${id}`);
  },

  /**
   * 批量删除重写规则
   */
  async deleteRewrites(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => this.deleteRewrite(id)));
  },
};
