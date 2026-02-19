import apiClient from './client';
import type { LoginRequest, LoginResponse, AuthUser } from './types';

export const authApi = {
  // Login
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/api/v1/auth/login', credentials);
    return response.data;
  },

  // Logout
  logout: async (): Promise<void> => {
    await apiClient.post('/api/v1/auth/logout');
  },

  // Verify token (optional endpoint if exists)
  verify: async (): Promise<AuthUser> => {
    const response = await apiClient.get<AuthUser>('/api/v1/auth/me');
    return response.data;
  },
};
