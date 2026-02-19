import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryLogApi, type QueryLogListParams } from '@/api/queryLog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RefreshCw, CheckCircle2, XCircle, Globe, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: '' as const, label: '全部' },
  { value: 'blocked' as const, label: '已拦截' },
  { value: 'allowed' as const, label: '已允许' },
];

function StatusBadge({ status }: { status: string }) {
  if (status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <XCircle size={12} />
        拦截
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
      <CheckCircle2 size={12} />
      允许
    </span>
  );
}

function formatTime(timeStr: string) {
  try {
    return new Date(timeStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timeStr;
  }
}

export default function QueryLogsPage() {
  const [domainFilter, setDomainFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'blocked' | 'allowed' | ''>('');
  const [clientFilter, setClientFilter] = useState('');
  const [page, setPage] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<QueryLogListParams>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['query-logs', appliedFilters],
    queryFn: () => queryLogApi.list(appliedFilters),
    refetchInterval: 10000,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const applyFilters = () => {
    const newFilters: QueryLogListParams = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (domainFilter) newFilters.domain = domainFilter;
    if (statusFilter) newFilters.status = statusFilter;
    if (clientFilter) newFilters.client = clientFilter;
    setAppliedFilters(newFilters);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    applyFilters();
  };

  const goToPage = (newPage: number) => {
    const newFilters = {
      ...appliedFilters,
      offset: newPage * PAGE_SIZE,
    };
    setPage(newPage);
    setAppliedFilters(newFilters);
  };

  return (
    <div className="space-y-6">
      {/* 过滤器 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={18} />
            查询日志
          </CardTitle>
          <CardDescription>实时 DNS 查询记录，每 10 秒自动刷新</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">域名</label>
              <input
                type="text"
                placeholder="过滤域名..."
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className="h-9 w-48 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">客户端 IP</label>
              <input
                type="text"
                placeholder="过滤客户端..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="h-9 w-40 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">状态</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="h-9 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={isFetching}>
                搜索
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 日志表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>日志列表</CardTitle>
              <CardDescription>共 {total} 条记录</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={32} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-muted-foreground">加载失败，请重试</p>
              <Button variant="outline" onClick={() => refetch()}>重试</Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Globe size={48} className="text-muted-foreground" />
              <p className="text-muted-foreground">暂无查询记录</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>域名</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>客户端</TableHead>
                      <TableHead>响应</TableHead>
                      <TableHead className="text-right">耗时</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(log.time)}
                        </TableCell>
                        <TableCell>
                          <code className="text-sm font-mono">{log.question}</code>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono">
                            {log.qtype}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={log.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.client_ip || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                          {log.answer || '-'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {log.elapsed_ms != null ? `${log.elapsed_ms}ms` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {page + 1} / {totalPages} 页，共 {total} 条
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => goToPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
