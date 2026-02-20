// Auth Types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires_in?: number;
  role: string;
  requires_password_change: boolean;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface AuthUser {
  username: string;
  role: string;
}

// Dashboard Types — matches backend snake_case response
export interface DashboardStats {
  total_queries: number;
  blocked_queries: number;
  allowed_queries: number;
  cached_queries: number;
  filter_rules: number;
  filter_lists: number;
  block_rate: number;
  last_week_block_rate: number;
  clients: number;
}

export interface TopDomainEntry {
  domain: string;
  count: number;
}

export interface TopClientEntry {
  client_ip: string;
  count: number;
}

// Rules Types — matches backend: {id, rule, comment, is_enabled, created_by, created_at}
export interface Rule {
  id: string;
  rule: string;
  comment?: string | null;
  is_enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface CreateRuleRequest {
  rule: string;
  comment?: string;
}

// Filter Lists Types — matches backend: {id, name, url, is_enabled, rule_count, last_updated, created_at}
export interface Filter {
  id: string;
  name: string;
  url?: string | null;
  is_enabled: boolean;
  rule_count?: number | null;
  last_updated?: string | null;
  created_at: string;
}

export interface CreateFilterRequest {
  name: string;
  url?: string;
  is_enabled?: boolean;
}

// DNS Rewrites Types — matches backend: {id, domain, answer, created_by, created_at}
export interface Rewrite {
  id: string;
  domain: string;
  answer: string;
  created_by: string;
  created_at: string;
}

export interface CreateRewriteRequest {
  domain: string;
  answer: string;
  ttl?: number;
}

// Query Log Types
export interface QueryLog {
  id: string;
  domain: string;
  query_type: string;
  action: 'blocked' | 'allowed';
  client_ip?: string;
  rule_id?: string;
  timestamp: string;
}

export interface QueryLogParams {
  limit?: number;
  offset?: number;
  domain?: string;
  action?: 'blocked' | 'allowed';
}

// Client Types
export interface Client {
  id: string;
  name: string;
  ip?: string;
  mac?: string;
  groups?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateClientRequest {
  name: string;
  ip?: string;
  mac?: string;
  groups?: string[];
}

// User Types — matches backend roles
export interface User {
  id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'operator' | 'read_only';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: 'super_admin' | 'admin' | 'operator' | 'read_only';
}

export interface UpdateUserRequest {
  role?: 'super_admin' | 'admin' | 'operator' | 'read_only';
}

// DNS Settings Types
export interface DnsSettings {
  port: number;
  upstream_dns?: string[];
  blocking_mode?: string;
  cache_enabled?: boolean;
  cache_ttl?: number;
}

export interface UpdateDnsSettingsRequest {
  port?: number;
  upstream_dns?: string[];
  blocking_mode?: string;
  cache_enabled?: boolean;
  cache_ttl?: number;
}

// API Error Types
export interface ApiError {
  message: string;
  status?: number;
}
