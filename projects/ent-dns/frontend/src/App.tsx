import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToasterProvider } from './components/ui/sonner';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ThemeProvider } from './contexts/ThemeContext';
import { useAuthStore } from './stores/authStore';
import { setAuthStoreCallbacks } from './api/client';
import LoginPage from './pages/Login';
import ChangePasswordPage from './pages/ChangePassword';
import DashboardPage from './pages/Dashboard';
import RulesPage from './pages/Rules';
import FiltersPage from './pages/Filters';
import RewritesPage from './pages/Rewrites';
import QueryLogsPage from './pages/QueryLogs';
import ClientsPage from './pages/Clients';
import UsersPage from './pages/Users';
import SettingsPage from './pages/Settings';

// Create Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
    },
  },
});

function App() {
  const token = useAuthStore((state) => state.token);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  // Initialize API client callbacks
  useEffect(() => {
    setAuthStoreCallbacks(
      () => token,
      clearAuth
    );
  }, [token, clearAuth]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToasterProvider />
        <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />

          {/* Protected Routes with Layout */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Dashboard">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
          </Route>

          {/* Other protected routes with layout */}
          <Route
            path="/rules"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Rules">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<RulesPage />} />
          </Route>

          <Route
            path="/filters"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Filters">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<FiltersPage />} />
          </Route>

          <Route
            path="/rewrites"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Rewrites">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<RewritesPage />} />
          </Route>

          <Route
            path="/clients"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Clients">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<ClientsPage />} />
          </Route>

          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Users">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<UsersPage />} />
          </Route>

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Settings">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<SettingsPage />} />
          </Route>

          <Route
            path="/logs"
            element={
              <ProtectedRoute>
                <DashboardLayout title="Query Log">
                  <Outlet />
                </DashboardLayout>
              </ProtectedRoute>
            }
          >
            <Route index element={<QueryLogsPage />} />
          </Route>

          {/* Catch all - redirect to dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
