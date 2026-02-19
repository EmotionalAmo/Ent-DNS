// Export API client
export { default as apiClient } from './client';

// Export API modules
export { authApi } from './auth';
export { dashboardApi, type ExtendedDashboardStats } from './dashboard';
export { rulesApi } from './rules';
export { filtersApi } from './filters';
export { rewritesApi } from './rewrites';

// Export types
export type {
  LoginRequest,
  LoginResponse,
  AuthUser,
  DashboardStats,
  Rule,
  CreateRuleRequest,
  Filter,
  CreateFilterRequest,
  Rewrite,
  CreateRewriteRequest,
  QueryLog,
  QueryLogParams,
  Client,
  CreateClientRequest,
  User,
  CreateUserRequest,
  UpdateUserRequest,
  DnsSettings,
  UpdateDnsSettingsRequest,
  ApiError,
} from './types';
