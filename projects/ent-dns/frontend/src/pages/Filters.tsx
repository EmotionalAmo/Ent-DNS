import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { filtersApi } from '@/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Info,
  ListFilter,
  Globe,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import type { Filter, CreateFilterRequest } from '@/api/types';

/**
 * Filters 页面
 * 管理过滤列表（AdGuard/hosts 格式）
 */

// 过滤器类型选项
const FILTER_TYPES = [
  { value: 'adguard', label: 'AdGuard 格式', description: '支持标准 AdGuard 规则语法' },
  { value: 'hosts', label: 'Hosts 格式', description: '传统 hosts 文件格式' },
] as const;

// 热门过滤列表推荐
const POPULAR_FILTERS = [
  {
    name: 'AdGuard DNS Filter',
    url: 'https://filters.adtidy.org/extension/ublock/filters/3.txt',
    type: 'adguard' as const,
    description: 'AdGuard 官方过滤器',
  },
  {
    name: 'Peter Lowe\'s Ad and tracking server list',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&mimetype=plaintext',
    type: 'hosts' as const,
    description: '广告和跟踪服务器列表',
  },
  {
    name: 'AdAway Default Blocklist',
    url: 'https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt',
    type: 'hosts' as const,
    description: 'AdAway 默认阻止列表',
  },
];

interface CreateFilterFormData {
  name: string;
  url: string;
  type: 'adguard' | 'hosts';  // local UI only, not sent to backend
  is_enabled: boolean;
}

function FilterTypeSelector({
  value,
  onChange,
}: {
  value: CreateFilterFormData['type'];
  onChange: (type: CreateFilterFormData['type']) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {FILTER_TYPES.map((type) => {
        const isSelected = value === type.value;
        return (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={cn(
              'flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all',
              isSelected
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted/50'
            )}
          >
            <Globe size={18} className={cn('mt-0.5', isSelected ? 'text-primary' : 'text-muted-foreground')} />
            <div>
              <div className={cn('text-sm font-medium', isSelected ? 'text-primary' : 'text-foreground')}>
                {type.label}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{type.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PopularFiltersList({
  onSelect,
}: {
  onSelect: (filter: { name: string; url: string; type: 'adguard' | 'hosts' }) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">热门推荐</Label>
      <div className="space-y-2">
        {POPULAR_FILTERS.map((filter, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onSelect(filter)}
            className="w-full flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{filter.name}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{filter.url}</div>
            </div>
            <Badge variant="outline" className="shrink-0">{'AdGuard'}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateFilterDialog({
  open,
  onOpenChange,
  filter,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter?: Filter | null;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateFilterFormData>({
    name: filter?.name || '',
    url: filter?.url || '',
    type: 'adguard',
    is_enabled: filter?.is_enabled ?? true,
  });

  const createMutation = useMutation({
    mutationFn: filtersApi.createFilter,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      onOpenChange(false);
      setFormData({ name: '', url: '', type: 'adguard', is_enabled: true });
      onSuccess();
      if (data?.syncing) {
        toast.success('过滤列表已创建，规则同步在后台进行，完成后自动刷新');
        // Poll for completion: refresh list every 3s for up to 60s
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          queryClient.invalidateQueries({ queryKey: ['filters'] });
          if (attempts >= 20) clearInterval(timer);
        }, 3000);
      } else {
        toast.success('过滤列表创建成功');
      }
    },
    onError: (error: any) => {
      toast.error(`创建失败: ${error.message || '未知错误'}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateFilterRequest> }) =>
      filtersApi.updateFilter(id, data),
    onSuccess: () => {
      toast.success('过滤列表更新成功');
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      onOpenChange(false);
      setFormData({ name: '', url: '', type: 'adguard', is_enabled: true });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('请输入过滤器名称');
      return;
    }

    if (filter) {
      updateMutation.mutate({ id: filter.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleSelectPopularFilter = (popularFilter: { name: string; url: string; type: 'adguard' | 'hosts' }) => {
    setFormData({
      name: popularFilter.name,
      url: popularFilter.url,
      type: popularFilter.type,
      is_enabled: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{filter ? '编辑过滤列表' : '添加过滤列表'}</DialogTitle>
          <DialogDescription>
            {filter ? '修改过滤列表配置' : '从远程 URL 订阅过滤列表或创建本地列表'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* 热门推荐（仅创建时显示） */}
            {!filter && (
              <PopularFiltersList onSelect={handleSelectPopularFilter} />
            )}

            {/* 过滤器类型选择 */}
            <div className="space-y-2">
              <Label>过滤器类型</Label>
              <FilterTypeSelector
                value={formData.type}
                onChange={(type) => setFormData({ ...formData, type })}
              />
            </div>

            {/* 名称输入 */}
            <div className="space-y-2">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如: AdGuard DNS Filter"
              />
            </div>

            {/* URL 输入 */}
            <div className="space-y-2">
              <Label htmlFor="url">
                订阅 URL {formData.url ? '' : '(留空则创建本地列表)'}
              </Label>
              <Input
                id="url"
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/filter.txt"
              />
              <p className="text-xs text-muted-foreground">
                支持 AdGuard 规则或 hosts 格式。留空可创建本地空列表，用于手动添加自定义规则。
              </p>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>启用过滤器</Label>
                <p className="text-xs text-muted-foreground">
                  启用后将自动同步并应用规则
                </p>
              </div>
              <Switch
                checked={formData.is_enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, is_enabled: checked })}
              />
            </div>

            {/* 帮助提示 */}
            <div className="rounded-md bg-primary/10 p-3">
              <div className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 text-primary shrink-0" />
                <div className="text-xs text-primary">
                  <p className="font-medium mb-1">关于过滤列表</p>
                  <ul className="space-y-0.5">
                    <li>• 远程列表：从 URL 自动同步规则</li>
                    <li>• 本地列表：创建后可以手动添加自定义规则</li>
                    <li>• AdGuard 格式：支持 ||domain.com^ 等高级语法</li>
                    <li>• Hosts 格式：标准 hosts 文件格式（127.0.0.1 domain.com）</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <>
                  <RefreshCw size={16} className="mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Plus size={16} className="mr-1" />
                  {filter ? '更新' : '创建'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  filterIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  filterIds: string[];
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {filterIds.length === 1
              ? '确定要删除这个过滤列表吗？此操作无法撤销。'
              : `确定要删除选中的 ${filterIds.length} 个过滤列表吗？此操作无法撤销。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function FiltersPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<Filter | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);

  // 查询过滤列表
  const { data: filters = [], isLoading, error, refetch } = useQuery({
    queryKey: ['filters'],
    queryFn: filtersApi.listFilters,
  });

  // 过滤过滤列表
  const filteredFilters = filters.filter((filter) =>
    filter.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    filter.url?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 切换过滤器启用状态
  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      filtersApi.updateFilter(id, { is_enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      toast.success('过滤器状态已更新');
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  // 删除过滤器
  const deleteMutation = useMutation({
    mutationFn: (id: string) => filtersApi.deleteFilter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      toast.success(`删除了 ${selectedIds.size} 个过滤列表`);
    },
    onError: (error: any) => {
      toast.error(`删除失败: ${error.message || '未知错误'}`);
    },
  });

  // 刷新单个过滤器
  const refreshMutation = useMutation({
    mutationFn: (id: string) => filtersApi.refreshFilter(id),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      if (data?.syncing) {
        toast.success('规则同步已在后台启动，完成后自动刷新');
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          queryClient.invalidateQueries({ queryKey: ['filters'] });
          if (attempts >= 20) clearInterval(timer);
        }, 3000);
      } else {
        toast.success(`同步成功，共 ${data?.rule_count ?? 0} 条规则`);
      }
    },
    onError: (error: any) => {
      toast.error(`同步失败: ${error.message || '未知错误'}`);
    },
    onSettled: () => {
      setRefreshingId(null);
    },
  });

  // 刷新所有过滤器
  const refreshAllMutation = useMutation({
    mutationFn: () => filtersApi.refreshAllFilters(filters),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
      if (data?.anySyncing) {
        toast.success('所有过滤器同步已在后台启动，完成后自动刷新');
        let attempts = 0;
        const timer = setInterval(() => {
          attempts++;
          queryClient.invalidateQueries({ queryKey: ['filters'] });
          if (attempts >= 20) clearInterval(timer);
        }, 3000);
      } else {
        toast.success('已刷新所有过滤器');
      }
    },
    onError: (error: any) => {
      toast.error(`刷新失败: ${error.message || '未知错误'}`);
    },
    onSettled: () => {
      setRefreshingAll(false);
    },
  });

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === filteredFilters.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFilters.map(f => f.id)));
    }
  };

  // 切换单个过滤器选中
  const handleSelectFilter = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // 确认删除
  const handleDeleteConfirm = () => {
    if (selectedIds.size === 0) return;
    Promise.all(Array.from(selectedIds).map(id => deleteMutation.mutateAsync(id))).then(() => {
      setSelectedIds(new Set());
      setDeleteDialogOpen(false);
    });
  };

  // 刷新单个过滤器
  const handleRefreshFilter = (id: string) => {
    setRefreshingId(id);
    refreshMutation.mutate(id);
  };

  // 刷新所有过滤器
  const handleRefreshAll = () => {
    setRefreshingAll(true);
    refreshAllMutation.mutate();
  };

  // 格式化时间
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN');
  };

  // 计算统计
  const totalRules = filters.reduce((sum, f) => sum + (f.rule_count || 0), 0);
  const enabledFilters = filters.filter(f => f.is_enabled).length;
  const remoteFilters = filters.filter(f => f.url).length;

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">总规则数</CardTitle>
            <ListFilter className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRules.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">来自 {enabledFilters} 个启用的过滤器</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">已启用</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{enabledFilters}</div>
            <p className="text-xs text-muted-foreground">/ {filters.length} 个过滤器</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">远程订阅</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{remoteFilters}</div>
            <p className="text-xs text-muted-foreground">可自动同步</p>
          </CardContent>
        </Card>
      </div>

      {/* 头部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          {/* 搜索框 */}
          <input
            type="text"
            placeholder="搜索过滤列表..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* 刷新全部按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={refreshingAll || isLoading || enabledFilters === 0}
          >
            <RefreshCw size={16} className={refreshingAll ? 'animate-spin' : ''} />
            <span className="hidden sm:inline ml-1">刷新全部</span>
          </Button>
          {/* 刷新按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          {/* 删除按钮 */}
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 size={16} className="mr-1" />
              删除 ({selectedIds.size})
            </Button>
          )}
          {/* 创建按钮 */}
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus size={16} className="mr-1" />
            添加过滤器
          </Button>
        </div>
      </div>

      {/* 过滤器表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>过滤列表</CardTitle>
              <CardDescription>
                {filters.length} 个过滤器 {searchQuery && `(${filteredFilters.length} 匹配)`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={32} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-center">
              <div className="space-y-2">
                <AlertCircle size={48} className="mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">加载过滤列表失败，请稍后重试</p>
                <Button variant="outline" onClick={() => refetch()}>
                  重试
                </Button>
              </div>
            </div>
          ) : filteredFilters.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <div className="space-y-4 max-w-md">
                <ListFilter size={48} className="mx-auto text-muted-foreground" />
                <div>
                  <p className="text-lg font-medium">暂无过滤列表</p>
                  <p className="text-muted-foreground">
                    {searchQuery ? '没有找到匹配的过滤列表' : '添加过滤列表来拦截广告和跟踪器'}
                  </p>
                </div>
                {!searchQuery && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus size={16} className="mr-1" />
                    添加过滤器
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedIds.size === filteredFilters.length}
                        onCheckedChange={handleSelectAll}
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead>名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>规则数</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>最后更新</TableHead>
                    <TableHead className="w-32">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFilters.map((filter) => {
                    const isRefreshing = refreshingId === filter.id;
                    return (
                      <TableRow
                        key={filter.id}
                        className={selectedIds.has(filter.id) ? 'bg-primary/10' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(filter.id)}
                            onCheckedChange={() => handleSelectFilter(filter.id)}
                            aria-label={`选择过滤器 ${filter.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">{filter.name}</span>
                              {filter.url && (
                                <a
                                  href={filter.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground"
                                  title={filter.url}
                                >
                                  <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                            {filter.url && (
                              <div className="text-xs text-muted-foreground truncate max-w-xs">
                                {filter.url}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{'AdGuard'}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-mono">
                            {filter.rule_count?.toLocaleString() ?? '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={filter.is_enabled}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: filter.id, is_enabled: checked })
                            }
                            disabled={toggleMutation.isPending}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            {filter.last_updated ? (
                              <>
                                <Clock size={12} />
                                {formatDate(filter.last_updated)}
                              </>
                            ) : (
                              <span>-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {filter.url && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRefreshFilter(filter.id)}
                                disabled={isRefreshing || !filter.is_enabled}
                                title="刷新"
                              >
                                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingFilter(filter)}
                              title="编辑"
                            >
                              <Edit2 size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setSelectedIds(new Set([filter.id]));
                                setDeleteDialogOpen(true);
                              }}
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建过滤器对话框 */}
      <CreateFilterDialog
        open={createDialogOpen || editingFilter !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingFilter(null);
          }
        }}
        filter={editingFilter}
        onSuccess={() => {
          setCreateDialogOpen(false);
          setEditingFilter(null);
        }}
      />

      {/* 删除确认对话框 */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        filterIds={Array.from(selectedIds)}
      />
    </div>
  );
}
