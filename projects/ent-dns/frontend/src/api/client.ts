import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type { ApiError } from './types';

// Get API base URL from environment or default to localhost
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Dynamically import authStore to avoid circular dependency
let getToken: (() => string | null) | null = null;
let clearAuth: (() => void) | null = null;

// Function to set auth store callbacks
export const setAuthStoreCallbacks = (
  getTokenFn: () => string | null,
  clearAuthFn: () => void
) => {
  getToken = getTokenFn;
  clearAuth = clearAuthFn;
};

// Request interceptor - add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (getToken) {
      const token = getToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<any>) => {
    const apiError: ApiError = {
      message: error.response?.data?.message || error.message || 'An unknown error occurred',
      status: error.response?.status,
    };

    // Handle 401 Unauthorized - clear token and redirect to login
    if (error.response?.status === 401 && clearAuth) {
      clearAuth();
      window.location.href = '/login';
    }

    return Promise.reject(apiError);
  }
);

export default apiClient;
