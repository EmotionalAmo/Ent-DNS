import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api';
import { toast } from 'sonner';
import {
  BarChart3,
  List,
  Shield,
  ArrowLeftRight,
  Laptop,
  FileText,
  Settings,
  Users,
  Menu,
  X,
  LogOut,
  User,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  path: string;
  title: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { path: '/', title: 'Dashboard', icon: <BarChart3 size={18} /> },
  { path: '/rules', title: 'Rules', icon: <List size={18} /> },
  { path: '/filters', title: 'Filters', icon: <Shield size={18} /> },
  { path: '/rewrites', title: 'Rewrites', icon: <ArrowLeftRight size={18} /> },
  { path: '/clients', title: 'Clients', icon: <Laptop size={18} /> },
  { path: '/logs', title: 'Query Log', icon: <FileText size={18} /> },
  { path: '/settings', title: 'Settings', icon: <Settings size={18} /> },
  { path: '/users', title: 'Users', icon: <Users size={18} />, adminOnly: true },
];

interface DashboardLayoutProps {
  title: string;
  children?: React.ReactNode;
}

export function DashboardLayout({ title }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, clearAuth } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // Ignore logout errors
    } finally {
      clearAuth();
      navigate('/login');
      toast.success('Logged out successfully');
    }
  };

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

  const getCurrentTitle = () => {
    const currentItem = navItems.find((item) => item.path === location.pathname);
    return currentItem?.title || title;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-64 -translate-x-full transform bg-slate-900 text-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0',
          sidebarOpen && 'translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-slate-700 px-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-xl">
            <Shield className="h-6 w-6 text-blue-400" />
            <span>Ent-DNS</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4">
          <ul className="space-y-1">
            {filteredNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    )}
                  >
                    {item.icon}
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sidebar footer */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-700 p-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600">
              <User size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">
                {user?.username || 'User'}
              </p>
              <p className="truncate text-xs text-slate-400 capitalize">
                {user?.role || 'user'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 dark:border-gray-700 dark:bg-gray-800">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>

          {/* Page title */}
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {getCurrentTitle()}
          </h1>

          {/* Right side actions */}
          <div className="flex items-center gap-4">
            {/* Status indicator */}
            <div className="hidden sm:flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <CheckCircle size={16} className="text-green-500" />
              <span>Connected</span>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label="Logout"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
