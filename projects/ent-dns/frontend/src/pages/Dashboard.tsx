import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardApi } from '@/api';
import { QueryTrendChart, type QueryTrendData } from '@/components/dashboard/QueryTrendChart';
import { Activity, Shield, Database, Clock, Server, Filter, Settings } from 'lucide-react';

// Generate mock trend data (in production, this would come from API)
function generateTrendData(): QueryTrendData[] {
  const data: QueryTrendData[] = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
    const queries = Math.floor(Math.random() * 1000) + 200;
    const blocked = Math.floor(queries * (Math.random() * 0.1 + 0.05));
    data.push({
      time: hour.getHours().toString().padStart(2, '0') + ':00',
      queries,
      blocked,
      allowed: queries - blocked,
    });
  }
  return data;
}

export default function DashboardPage() {
  // Fetch dashboard stats
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000, // Consider data stale after 10 seconds
  });

  // Generate mock trend data (replace with real API data when available)
  const trendData = generateTrendData();

  // Calculate derived values
  const totalQueries = stats?.totalQueries ?? 0;
  const blockedQueries = stats?.blockedQueries ?? 0;
  const cachedQueries = stats?.cached_queries ?? 0;
  const avgLatency = stats?.avg_latency_ms ?? 0;
  const activeRules = stats?.activeRules ?? 0;
  const filterEngineRules = stats?.filter_engine_rules ?? 0;
  const cacheTtl = stats?.cache_ttl ?? 300;
  const dnsStatus = stats?.dns_status ?? 'running';

  // Format numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Format latency
  const formatLatency = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(1)}ms`;
  };

  // Format uptime
  const formatUptime = (uptime: string): string => {
    return uptime || '未知';
  };

  // Calculate block rate
  const blockRate = totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) : '0.0';
  const cacheHitRate = totalQueries > 0 ? ((cachedQueries / totalQueries) * 100).toFixed(1) : '0.0';

  const statsCards = [
    {
      title: '总查询数',
      value: formatNumber(totalQueries),
      subtitle: stats?.uptime ? `运行时间: ${formatUptime(stats.uptime)}` : '暂无数据',
      icon: Activity,
      trend: null,
    },
    {
      title: '拦截查询',
      value: formatNumber(blockedQueries),
      subtitle: `拦截率: ${blockRate}%`,
      icon: Shield,
      trend: 'down' as const,
    },
    {
      title: '缓存命中',
      value: formatNumber(cachedQueries),
      subtitle: `命中率: ${cacheHitRate}%`,
      icon: Database,
      trend: 'up' as const,
    },
    {
      title: '平均延迟',
      value: formatLatency(avgLatency),
      subtitle: avgLatency > 0 ? '响应时间' : '暂无数据',
      icon: Clock,
      trend: null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-9 w-20 animate-pulse bg-muted rounded" />
                ) : error ? (
                  <div className="text-2xl font-bold text-destructive">-</div>
                ) : (
                  <div className="text-2xl font-bold">{card.value}</div>
                )}
                <p className="text-xs text-muted-foreground">{card.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Query Trend Chart */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>查询趋势 (24小时)</CardTitle>
              <CardDescription>最近 24 小时的 DNS 查询统计</CardDescription>
            </CardHeader>
            <CardContent>
              <QueryTrendChart data={trendData} isLoading={isLoading} />
            </CardContent>
          </Card>
        </div>

        {/* System Status */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>系统状态</CardTitle>
              <CardDescription>DNS 服务运行状态</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* DNS Server Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">DNS 服务器</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : dnsStatus === 'running' ? (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Running
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-destructive">
                    <span className="h-2 w-2 rounded-full bg-destructive" />
                    {dnsStatus}
                  </span>
                )}
              </div>

              {/* Filter Engine */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">过滤引擎</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">
                    {activeRules} 规则
                  </span>
                )}
              </div>

              {/* Cache TTL */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">缓存 TTL</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{cacheTtl} 秒</span>
                )}
              </div>

              {/* Active Filter Lists */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">过滤器规则</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{filterEngineRules} 条</span>
                )}
              </div>

              <div className="pt-4 border-t">
                <button
                  onClick={() => refetch()}
                  className="w-full px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
                >
                  刷新状态
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
