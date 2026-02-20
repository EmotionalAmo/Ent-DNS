import { apiClient } from './client';

/**
 * 客户端分组数据模型
 */
export interface ClientGroup {
  id: number;
  name: string;
  color: string;
  description?: string;
  priority: number;
  client_count: number;
  rule_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * 创建客户端分组请求
 */
export interface CreateClientGroupRequest {
  name: string;
  color?: string;
  description?: string;
  priority?: number;
}

/**
 * 更新客户端分组请求
 */
export interface UpdateClientGroupRequest {
  name?: string;
  color?: string;
  description?: string;
  priority?: number;
}

/**
 * 客户端分组成员
 */
export interface ClientGroupMember {
  id: string;
  name: string;
  ip: string;
  mac: string;
  last_seen: string;
  query_count: number;
  group_ids: number[];
  group_names: string[];
}

/**
 * 分组规则详情
 */
export interface GroupRule {
  rule_id: number;
  rule_type: string;
  name: string;
  pattern?: string;
  domain?: string;
  replacement?: string;
  action?: string;
  priority: number;
  created_at: string;
}

/**
 * 绑定规则请求
 */
export interface BindRuleRequest {
  rule_id: number;
  rule_type: string;
  priority?: number;
}

/**
 * 批量绑定规则请求
 */
export interface BatchBindRulesRequest {
  rules: BindRuleRequest[];
}

/**
 * 批量添加客户端请求
 */
export interface BatchAddClientsRequest {
  client_ids: string[];
}

/**
 * 批量移除客户端请求
 */
export interface BatchRemoveClientsRequest {
  client_ids: string[];
}

/**
 * 批量移动客户端请求
 */
export interface BatchMoveClientsRequest {
  client_ids: string[];
  from_group_id?: number;
  to_group_id?: number;
}

/**
 * 批量解绑规则请求
 */
export interface BatchUnbindRulesRequest {
  rule_ids: number[];
  rule_type: string;
}

/**
 * 分页参数
 */
export interface PageParams {
  page?: number;
  page_size?: number;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  page_size?: number;
}

/**
 * 客户端分组 API
 */
export const clientGroupsApi = {
  /**
   * 获取所有分组列表
   */
  async list(): Promise<ClientGroup[]> {
    const response = await apiClient.get<{ data: ClientGroup[]; total: number }>('/client-groups');
    return response.data;
  },

  /**
   * 创建新分组
   */
  async create(data: CreateClientGroupRequest): Promise<ClientGroup> {
    const response = await apiClient.post<ClientGroup>('/client-groups', data);
    return response;
  },

  /**
   * 更新分组信息
   */
  async update(id: number, data: UpdateClientGroupRequest): Promise<ClientGroup> {
    const response = await apiClient.put<ClientGroup>(`/client-groups/${id}`, data);
    return response;
  },

  /**
   * 删除分组
   */
  async delete(id: number): Promise<{ message: string; affected_clients: number; affected_rules: number }> {
    return apiClient.delete(`/client-groups/${id}`);
  },

  /**
   * 获取分组成员
   */
  async getMembers(id: number, params?: PageParams): Promise<PaginatedResponse<ClientGroupMember>> {
    const response = await apiClient.get<PaginatedResponse<ClientGroupMember>>(
      `/client-groups/${id}/members`,
      params
    );
    return response;
  },

  /**
   * 批量添加客户端到分组
   */
  async addMembers(
    id: number,
    data: BatchAddClientsRequest
  ): Promise<{
    message: string;
    added_count: number;
    skipped_count: number;
    skipped_clients: string[];
  }> {
    return apiClient.post(`/client-groups/${id}/members`, data);
  },

  /**
   * 批量从分组移除客户端
   */
  async removeMembers(
    id: number,
    data: BatchRemoveClientsRequest
  ): Promise<{ message: string; removed_count: number }> {
    return apiClient.request<{ message: string; removed_count: number }>({
      method: 'DELETE',
      url: `/client-groups/${id}/members`,
      data,
    });
  },

  /**
   * 批量移动客户端到分组
   */
  async batchMove(data: BatchMoveClientsRequest): Promise<{
    message: string;
    moved_count: number;
    affected_rules_count: number;
    applied_rules: Array<{ rule_id: number; rule_type: string; name: string; action: string }>;
  }> {
    return apiClient.post('/clients/batch-move', data);
  },

  /**
   * 获取分组规则
   */
  async getRules(id: number, params?: { rule_type?: string }): Promise<{ data: GroupRule[]; total: number }> {
    return apiClient.get<{ data: GroupRule[]; total: number }>(`/client-groups/${id}/rules`, params);
  },

  /**
   * 批量绑定规则到分组
   */
  async bindRules(id: number, data: BatchBindRulesRequest): Promise<{
    message: string;
    bound_count: number;
    skipped_count: number;
    skipped_rules: any[];
  }> {
    return apiClient.post(`/client-groups/${id}/rules`, data);
  },

  /**
   * 批量解绑规则
   */
  async unbindRules(
    id: number,
    data: BatchUnbindRulesRequest
  ): Promise<{ message: string; unbound_count: number }> {
    return apiClient.request<{ message: string; unbound_count: number }>({
      method: 'DELETE',
      url: `/client-groups/${id}/rules`,
      params: { rule_type: data.rule_type },
      data: { rule_ids: data.rule_ids },
    });
  },
};
