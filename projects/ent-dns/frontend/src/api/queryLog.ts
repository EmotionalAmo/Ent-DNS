import apiClient from './client';

// Matches backend query_log table columns
export interface QueryLogEntry {
  id: number;
  time: string;
  client_ip: string;
  client_name: string | null;
  question: string;
  qtype: string;
  answer: string | null;
  status: 'blocked' | 'allowed';
  reason: string | null;
  elapsed_ms: number | null;
}

export interface QueryLogListParams {
  limit?: number;
  offset?: number;
  domain?: string;
  status?: 'blocked' | 'allowed';
  client?: string;
}

export interface QueryLogResponse {
  data: QueryLogEntry[];
  total: number;
  returned: number;
  offset: number;
  limit: number;
}

export async function listQueryLogs(params: QueryLogListParams = {}): Promise<QueryLogResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  if (params.domain) query.set('domain', params.domain);
  if (params.status) query.set('status', params.status);
  if (params.client) query.set('client', params.client);

  const qs = query.toString();
  const response = await apiClient.get<QueryLogResponse>(
    `/api/v1/query-log${qs ? `?${qs}` : ''}`
  );
  return response.data;
}

export interface ExportParams {
  format: 'csv' | 'json';
  start_time?: string;
  end_time?: string;
}

/**
 * Export query logs
 */
export async function exportQueryLogs(params: ExportParams): Promise<Blob> {
  const query = new URLSearchParams();
  query.set('format', params.format);
  if (params.start_time) query.set('start_time', params.start_time);
  if (params.end_time) query.set('end_time', params.end_time);

  const response = await apiClient.get(`/api/v1/query-log/export?${query.toString()}`, {
    responseType: 'blob',
  });
  return response.data;
}

export const queryLogApi = {
  list: listQueryLogs,
  export: exportQueryLogs,
};
