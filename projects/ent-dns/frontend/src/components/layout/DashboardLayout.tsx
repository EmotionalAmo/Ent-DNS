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
  { path: '/',         title: 'Dashboard',  icon: <BarChart3 size={16} /> },
  { path: '/rules',   title: '规则',         icon: <List size={16} /> },
  { path: '/filters', title: '过滤列表',     icon: <Shield size={16} /> },
  { path: '/rewrites',title: 'DNS 重写',     icon: <ArrowLeftRight size={16} /> },
  { path: '/clients', title: '客户端',        icon: <Laptop size={16} /> },
  { path: '/logs',    title: '查询日志',     icon: <FileText size={16} /> },
  { path: '/settings',title: '设置',         icon: <Settings size={16} /> },
  { path: '/users',   title: '用户管理',     icon: <Users size={16} />, adminOnly: true },
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
    } catch {
      // ignore
    } finally {
      clearAuth();
      navigate('/login');
      toast.success('已退出登录');
    }
  };

  const filteredNavItems = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin' || user?.role === 'super_admin'
  );

  const getCurrentTitle = () => {
    const current = navItems.find((item) => item.path === location.pathname);
    return current?.title || title;
  };

  const avatarLetter = user?.username?.[0]?.toUpperCase() ?? 'U';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={cn(
          'sidebar fixed left-0 top-0 z-50 flex h-screen w-60 flex-col',
          '-translate-x-full transition-transform duration-300 ease-in-out',
          'lg:static lg:translate-x-0 lg:transition-none',
          sidebarOpen && 'translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="sidebar-logo-area flex h-14 items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5 text-white">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold tracking-wide">Ent-DNS</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1 text-white/50 hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-0.5">
            {filteredNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn('sidebar-nav-item', isActive && 'active')}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User */}
        <div className="sidebar-footer p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
              {avatarLetter}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.username ?? 'User'}
              </p>
              <p className="truncate text-xs capitalize" style={{ color: 'hsl(var(--sidebar-text))' }}>
                {user?.role ?? 'user'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="退出登录"
              className="shrink-0 rounded-md p-1 text-white/40 transition-colors hover:text-white"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 sm:px-6">
          {/* Mobile menu */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu size={20} />
          </button>

          {/* Page title */}
          <h1 className="text-sm font-semibold text-foreground lg:text-base">
            {getCurrentTitle()}
          </h1>

          {/* Status */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle size={14} className="text-success" />
            <span className="hidden sm:inline">DNS 服务正常</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
