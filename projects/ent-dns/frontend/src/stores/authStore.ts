import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/api';
import { setAuthStoreCallbacks } from '@/api/client';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  requiresPasswordChange: boolean;

  // Actions
  setAuth: (token: string, user: AuthUser) => void;
  setRequiresPasswordChange: (requires: boolean) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      requiresPasswordChange: false,

      setAuth: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
          error: null,
        }),

      setRequiresPasswordChange: (requires) =>
        set({
          requiresPasswordChange: requires,
        }),

      clearAuth: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          error: null,
          requiresPasswordChange: false,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Set up callbacks for API client after hydration
        setAuthStoreCallbacks(
          () => state?.token || null,
          () => state?.clearAuth() || (() => {})
        );
      },
    }
  )
);
