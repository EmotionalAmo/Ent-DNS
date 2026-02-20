// Query Log Advanced Filtering API Client
// File: frontend/src/api/queryLogAdvanced.ts
// Author: ui-duarte
// Date: 2026-02-20

import apiClient from './client';

export interface Filter {
  field: string;
  operator: string;
  value: any;
}

export interface AdvancedQueryParams {
  filters: Filter[];
  logic?: 'AND' | 'OR';
  limit?: number;
  offset?: number;
}

export interface AggregateParams {
  filters?: Filter[];
  groupBy: string[];
  metric?: 'count' | 'sum_elapsed_ms' | 'avg_elapsed_ms';
  timeBucket?: string; // '1m', '5m', '15m', '1h', '1d'
  limit?: number;
}

export interface TopParams {
  dimension: 'domain' | 'client' | 'qtype' | 'upstream';
  metric?: string;
  timeRange?: string;
  filters?: Filter[];
  limit?: number;
}

export interface Template {
  id: string;
  name: string;
  filters: Filter[];
  logic: string;
  createdBy: string;
  createdAt: string;
  isPublic: boolean;
}

export interface QueryLogListResponse {
  data: Array<{
    id: number;
    time: string;
    clientIp: string;
    clientName: string | null;
    question: string;
    qtype: string;
    answer: string | null;
    status: string;
    reason: string | null;
    upstream: string | null;
    elapsedMs: number | null;
  }>;
  total: number;
  returned: number;
  offset: number;
  limit: number;
  queryMs?: number;
}

export interface SuggestionResponse {
  suggestions: string[];
  field: string;
  prefix: string;
  count: number;
}

export const queryLogAdvancedApi = {
  // ===== 高级查询 =====
  list: async (params: AdvancedQueryParams): Promise<QueryLogListResponse> => {
    const response = await apiClient.get('/query-log/advanced', { params });
    return response.data;
  },

  // ===== 聚合统计 =====
  aggregate: async (params: AggregateParams) => {
    const response = await apiClient.get('/query-log/aggregate', { params });
    return response.data;
  },

  // ===== Top N 排行 =====
  top: async (params: TopParams) => {
    const response = await apiClient.get('/query-log/top', { params });
    return response.data;
  },

  // ===== 智能提示（自动补全） =====
  suggest: async (field: string, prefix: string, limit: number = 10): Promise<string[]> => {
    const response = await apiClient.get('/query-log/suggest', {
      params: { field, prefix, limit },
    });
    return response.data.suggestions;
  },

  // ===== 查询模板 CRUD =====
  templates: {
    list: async (): Promise<Template[]> => {
      const response = await apiClient.get('/query-log/templates');
      return response.data;
    },

    create: async (data: Omit<Template, 'id' | 'createdAt' | 'createdBy'>): Promise<Template> => {
      const response = await apiClient.post('/query-log/templates', data);
      return response.data;
    },

    get: async (id: string): Promise<Template> => {
      const response = await apiClient.get(`/query-log/templates/${id}`);
      return response.data;
    },

    update: async (id: string, data: Partial<Template>): Promise<Template> => {
      const response = await apiClient.put(`/query-log/templates/${id}`, data);
      return response.data;
    },

    delete: async (id: string): Promise<void> => {
      await apiClient.delete(`/query-log/templates/${id}`);
    },
  },
};

// Export for useSuggestions hook
export const fetchSuggestions = async (field: string, prefix: string): Promise<SuggestionResponse> => {
  const response = await apiClient.get('/query-log/suggest', {
    params: { field, prefix, limit: 10 },
  });
  return response.data;
};
