import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardApi } from '@/api';
import { QueryTrendChart } from '@/components/dashboard/QueryTrendChart';
import { Activity, Shield, Database, Server, Filter, Settings } from 'lucide-react';

export default function DashboardPage() {
  // Fetch dashboard stats
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Fetch trend chart data
  const { data: trendData = [], isLoading: trendLoading } = useQuery({
    queryKey: ['dashboard', 'query-trend'],
    queryFn: () => dashboardApi.getQueryTrend(24),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Backend returns snake_case
  const totalQueries = (stats as any)?.total_queries ?? 0;
  const blockedQueries = (stats as any)?.blocked_queries ?? 0;
  const cachedQueries = (stats as any)?.cached_queries ?? 0;
  const filterRules = (stats as any)?.filter_rules ?? 0;
  const filterLists = (stats as any)?.filter_lists ?? 0;

  // Format numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Calculate rates
  const blockRate = totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) : '0.0';
  const cacheHitRate = totalQueries > 0 ? ((cachedQueries / totalQueries) * 100).toFixed(1) : '0.0';

  const statsCards = [
    {
      title: '总查询数',
      value: formatNumber(totalQueries),
      subtitle: '过去 24 小时',
      icon: Activity,
    },
    {
      title: '拦截查询',
      value: formatNumber(blockedQueries),
      subtitle: `拦截率: ${blockRate}%`,
      icon: Shield,
    },
    {
      title: '缓存命中',
      value: formatNumber(cachedQueries),
      subtitle: `命中率: ${cacheHitRate}%`,
      icon: Database,
    },
    {
      title: '过滤列表',
      value: filterLists.toString(),
      subtitle: `${filterRules} 条自定义规则`,
      icon: Filter,
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
              <QueryTrendChart data={trendData} isLoading={trendLoading} />
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
                <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Running
                </span>
              </div>

              {/* Filter Rules */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">自定义规则</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{filterRules} 条</span>
                )}
              </div>

              {/* Filter Lists */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">过滤列表</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{filterLists} 个</span>
                )}
              </div>

              {/* Block Rate */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">拦截率</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{blockRate}%</span>
                )}
              </div>

              {/* Queries in last hour */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">缓存命中率</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <span className="text-sm font-medium">{cacheHitRate}%</span>
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
