import apiClient from './client';

export interface DnsSettingsRecord {
  upstreams: string[];
  cache_ttl: number;
  query_log_retention_days: number;
  stats_retention_days: number;
  safe_search_enabled: boolean;
  parental_control_enabled: boolean;
}

export interface UpdateDnsSettingsPayload {
  upstreams?: string[];
  cache_ttl?: number;
  query_log_retention_days?: number;
  stats_retention_days?: number;
  safe_search_enabled?: boolean;
  parental_control_enabled?: boolean;
}

async function getDnsSettings(): Promise<DnsSettingsRecord> {
  const response = await apiClient.get<DnsSettingsRecord>('/api/v1/settings/dns');
  return response.data;
}

async function updateDnsSettings(payload: UpdateDnsSettingsPayload): Promise<void> {
  await apiClient.put('/api/v1/settings/dns', payload);
}

export const settingsApi = {
  getDns: getDnsSettings,
  updateDns: updateDnsSettings,
};
