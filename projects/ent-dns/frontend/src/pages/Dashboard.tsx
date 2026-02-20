import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardApi } from '@/api';
import { QueryTrendChart } from '@/components/dashboard/QueryTrendChart';
import { Activity, Shield, Database, Server, Filter, Settings, TrendingUp, TrendingDown, Minus, Wifi, List, Eye } from 'lucide-react';

export default function DashboardPage() {
  // Fetch dashboard stats (refresh every 30s)
  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Fetch trend chart data (refresh every 5s for near-realtime feel)
  const { data: trendData = [], isLoading: trendLoading } = useQuery({
    queryKey: ['dashboard', 'query-trend'],
    queryFn: () => dashboardApi.getQueryTrend(24),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  // Fetch Top 10 blocked domains
  const { data: topDomains = [], isLoading: topDomainsLoading } = useQuery({
    queryKey: ['dashboard', 'top-blocked-domains'],
    queryFn: () => dashboardApi.getTopBlockedDomains(24),
    refetchInterval: 30000,
    staleTime: 20000,
  });

  // Fetch Top 10 active clients
  const { data: topClients = [], isLoading: topClientsLoading } = useQuery({
    queryKey: ['dashboard', 'top-clients'],
    queryFn: () => dashboardApi.getTopClients(24),
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const totalQueries = stats?.total_queries ?? 0;
  const blockedQueries = stats?.blocked_queries ?? 0;
  const cachedQueries = stats?.cached_queries ?? 0;
  const filterRules = stats?.filter_rules ?? 0;
  const filterLists = stats?.filter_lists ?? 0;
  const blockRate = stats?.block_rate ?? 0;
  const lastWeekBlockRate = stats?.last_week_block_rate ?? 0;

  // Format numbers
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Calculate rates
  const blockRateStr = totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) : '0.0';
  const cacheHitRate = totalQueries > 0 ? ((cachedQueries / totalQueries) * 100).toFixed(1) : '0.0';

  // Week-over-week trend
  const blockRateDiff = blockRate - lastWeekBlockRate;
  const blockRateTrend = Math.abs(blockRateDiff) < 0.1 ? 'flat' : blockRateDiff > 0 ? 'up' : 'down';

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
      subtitle: `拦截率: ${blockRateStr}%`,
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

  // Zero-traffic onboarding guide
  const showOnboarding = !isLoading && !error && totalQueries === 0;

  return (
    <div className="space-y-6">
      {/* Zero-traffic onboarding guide */}
      {showOnboarding && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-800 text-base">开始使用 Ent-DNS</CardTitle>
            <CardDescription className="text-blue-600">尚未检测到任何 DNS 查询，按以下步骤完成配置</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2 shrink-0">
                  <List className="h-4 w-4 text-blue-700" />
                </div>
                <div>
                  <p className="font-medium text-blue-900 text-sm">1. 订阅过滤列表</p>
                  <p className="text-xs text-blue-600 mt-1">前往「过滤列表」页面，添加 AdGuard、EasyList 等订阅源</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2 shrink-0">
                  <Wifi className="h-4 w-4 text-blue-700" />
                </div>
                <div>
                  <p className="font-medium text-blue-900 text-sm">2. 将设备 DNS 指向本机</p>
                  <p className="text-xs text-blue-600 mt-1">修改设备 DNS 服务器为运行 Ent-DNS 的主机 IP（默认端口 53）</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-100 p-2 shrink-0">
                  <Eye className="h-4 w-4 text-blue-700" />
                </div>
                <div>
                  <p className="font-medium text-blue-900 text-sm">3. 查看实时日志</p>
                  <p className="text-xs text-blue-600 mt-1">前往「查询日志」页面确认 DNS 请求已被正确处理</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
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
              <CardDescription>最近 24 小时 DNS 查询，每 5 秒自动刷新</CardDescription>
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

              {/* Block Rate with week-over-week */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">拦截率</span>
                </div>
                {isLoading ? (
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{blockRateStr}%</span>
                    {lastWeekBlockRate > 0 && (
                      <span className={`flex items-center text-xs ${
                        blockRateTrend === 'up' ? 'text-red-500' :
                        blockRateTrend === 'down' ? 'text-green-500' :
                        'text-muted-foreground'
                      }`}>
                        {blockRateTrend === 'up' && <TrendingUp className="h-3 w-3" />}
                        {blockRateTrend === 'down' && <TrendingDown className="h-3 w-3" />}
                        {blockRateTrend === 'flat' && <Minus className="h-3 w-3" />}
                        {blockRateDiff > 0 ? '+' : ''}{blockRateDiff.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Cache Hit Rate */}
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

      {/* Top 10 Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top 10 Blocked Domains */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-destructive" />
              Top 10 被拦截域名
            </CardTitle>
            <CardDescription>过去 24 小时拦截次数最多的域名</CardDescription>
          </CardHeader>
          <CardContent>
            {topDomainsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-6 animate-pulse bg-muted rounded" />
                ))}
              </div>
            ) : topDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无拦截数据</p>
            ) : (
              <div className="space-y-2">
                {topDomains.map((entry, i) => {
                  const maxCount = topDomains[0]?.count ?? 1;
                  const pct = Math.round((entry.count / maxCount) * 100);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate font-mono text-xs max-w-[70%]" title={entry.domain}>
                          <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                          {entry.domain}
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">{formatNumber(entry.count)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-destructive/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top 10 Active Clients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Top 10 活跃客户端
            </CardTitle>
            <CardDescription>过去 24 小时查询次数最多的客户端</CardDescription>
          </CardHeader>
          <CardContent>
            {topClientsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-6 animate-pulse bg-muted rounded" />
                ))}
              </div>
            ) : topClients.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无客户端数据</p>
            ) : (
              <div className="space-y-2">
                {topClients.map((entry, i) => {
                  const maxCount = topClients[0]?.count ?? 1;
                  const pct = Math.round((entry.count / maxCount) * 100);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">
                          <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                          {entry.client_ip}
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">{formatNumber(entry.count)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/50"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
