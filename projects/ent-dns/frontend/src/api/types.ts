// Auth Types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expires_in?: number;
  role: string;
}

export interface AuthUser {
  username: string;
  role: string;
}

// Dashboard Types
export interface DashboardStats {
  totalQueries: number;
  blockedQueries: number;
  allowedQueries: number;
  activeRules: number;
  uptime: string;
}

// Rules Types
export interface Rule {
  id: string;
  domain: string;
  type: 'block' | 'allow' | 'blocklist' | 'whitelist';
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleRequest {
  domain: string;
  type: 'block' | 'allow' | 'blocklist' | 'whitelist';
  enabled?: boolean;
}

// Filter Lists Types
export interface Filter {
  id: string;
  name: string;
  url?: string;
  type: 'hosts' | 'adguard';
  enabled: boolean;
  last_updated?: string;
  rule_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateFilterRequest {
  name: string;
  url?: string;
  type: 'hosts' | 'adguard';
  enabled?: boolean;
}

// DNS Rewrites Types
export interface Rewrite {
  id: string;
  domain: string;
  target: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRewriteRequest {
  domain: string;
  target: string;
  enabled?: boolean;
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

// User Types
export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: 'admin' | 'user';
}

export interface UpdateUserRequest {
  role?: 'admin' | 'user';
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
