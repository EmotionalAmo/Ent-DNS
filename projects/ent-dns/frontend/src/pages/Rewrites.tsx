import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rewritesApi } from '@/api';
import { toast } from 'sonner';
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
  Route,
  Server,
  User,
  Clock,
  ExternalLink,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import type { Rewrite, CreateRewriteRequest } from '@/api/types';

/**
 * Rewrites 页面
 * 管理 DNS 重写规则（域名 -> IP 映射）
 */

// 常用本地服务 IP
const LOCAL_SERVICE_IPS = [
  { ip: '127.0.0.1', label: 'Localhost' },
  { ip: '192.168.1.1', label: 'Router (常见)' },
  { ip: '10.0.0.1', label: 'Gateway (常见)' },
  { ip: '172.16.0.1', label: 'Private Network' },
];

// 常用重写示例
const COMMON_REWRITES = [
  { domain: 'myapp.local', ip: '127.0.0.1', description: '本地开发环境' },
  { domain: 'nas.local', ip: '192.168.1.100', description: 'NAS 设备' },
  { domain: 'pihole.local', ip: '192.168.1.50', description: 'Pi-hole' },
  { domain: 'homeassistant.local', ip: '192.168.1.80', description: 'Home Assistant' },
];

interface CreateRewriteFormData {
  domain: string;
  target: string;
  enabled: boolean;
}

function IpSelector({
  value: _value,
  onChange,
}: {
  value?: string;
  onChange: (ip: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">常用地址</Label>
      <div className="flex flex-wrap gap-2">
        {LOCAL_SERVICE_IPS.map((item) => (
          <button
            key={item.ip}
            type="button"
            onClick={() => onChange(item.ip)}
            className="px-3 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {item.ip}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommonRewritesList({
  onSelect,
}: {
  onSelect: (rewrite: { domain: string; ip: string }) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">常用示例</Label>
      <div className="space-y-1">
        {COMMON_REWRITES.map((item, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onSelect({ domain: item.domain, ip: item.ip })}
            className="w-full flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium font-mono truncate">{item.domain}</div>
              <div className="text-xs text-muted-foreground truncate">{item.description}</div>
            </div>
            <div className="text-xs text-muted-foreground font-mono">{item.ip}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateRewriteDialog({
  open,
  onOpenChange,
  rewrite,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rewrite?: Rewrite | null;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateRewriteFormData>({
    domain: rewrite?.domain || '',
    target: rewrite?.target || '',
    enabled: rewrite?.enabled ?? true,
  });
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: rewritesApi.createRewrite,
    onSuccess: () => {
      toast.success('重写规则创建成功');
      queryClient.invalidateQueries({ queryKey: ['rewrites'] });
      onOpenChange(false);
      setFormData({ domain: '', target: '', enabled: true });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`创建失败: ${error.message || '未知错误'}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateRewriteRequest> }) =>
      rewritesApi.updateRewrite(id, data),
    onSuccess: () => {
      toast.success('重写规则更新成功');
      queryClient.invalidateQueries({ queryKey: ['rewrites'] });
      onOpenChange(false);
      setFormData({ domain: '', target: '', enabled: true });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.domain.trim()) {
      toast.error('请输入域名');
      return;
    }
    if (!formData.target.trim()) {
      toast.error('请输入目标 IP 地址');
      return;
    }

    // 验证 IP 格式（简单验证）
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (!ipRegex.test(formData.target)) {
      toast.error('请输入有效的 IP 地址');
      return;
    }

    if (rewrite) {
      updateMutation.mutate({ id: rewrite.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleSelectCommonRewrite = (item: { domain: string; ip: string }) => {
    setFormData({ domain: item.domain, target: item.ip, enabled: true });
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(formData.domain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('域名已复制到剪贴板');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rewrite ? '编辑重写规则' : '添加重写规则'}</DialogTitle>
          <DialogDescription>
            {rewrite ? '修改 DNS 重写规则配置' : '创建域名到 IP 地址的映射'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* 常用示例（仅创建时显示） */}
            {!rewrite && (
              <CommonRewritesList onSelect={handleSelectCommonRewrite} />
            )}

            {/* 域名输入 */}
            <div className="space-y-2">
              <Label htmlFor="domain">域名 *</Label>
              <div className="relative">
                <Input
                  id="domain"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="例如: myapp.local"
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={handleCopyToClipboard}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="复制"
                >
                  {copied ? <CheckCircle2 size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                DNS 查询此域名时将返回指定的 IP 地址
              </p>
            </div>

            {/* 目标 IP 输入 */}
            <div className="space-y-2">
              <Label htmlFor="target">目标 IP 地址 *</Label>
              <IpSelector
                value={formData.target}
                onChange={(ip) => setFormData({ ...formData, target: ip })}
              />
              <Input
                id="target"
                type="text"
                value={formData.target}
                onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                placeholder="例如: 127.0.0.1"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                支持 IPv4 和 IPv6 地址
              </p>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>启用重写规则</Label>
                <p className="text-xs text-muted-foreground">
                  启用后将应用此映射
                </p>
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
            </div>

            {/* 帮助提示 */}
            <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3">
              <div className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 text-blue-600 shrink-0" />
                <div className="text-xs text-blue-900 dark:text-blue-100">
                  <p className="font-medium mb-1">关于 DNS 重写</p>
                  <ul className="space-y-0.5">
                    <li>• 将指定域名的 DNS 查询解析到指定 IP</li>
                    <li>• 适用于本地开发环境、局域网设备访问</li>
                    <li>• 优先级高于上游 DNS 解析结果</li>
                    <li>• 示例: 将 myapp.local 解析到 127.0.0.1</li>
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
                  {rewrite ? '更新' : '创建'}
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
  rewriteIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  rewriteIds: string[];
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {rewriteIds.length === 1
              ? '确定要删除这条重写规则吗？此操作无法撤销。'
              : `确定要删除选中的 ${rewriteIds.length} 条重写规则吗？此操作无法撤销。`}
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

export default function RewritesPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingRewrite, setEditingRewrite] = useState<Rewrite | null>(null);

  // 查询重写规则列表
  const { data: rewrites = [], isLoading, error, refetch } = useQuery({
    queryKey: ['rewrites'],
    queryFn: rewritesApi.listRewrites,
  });

  // 过滤重写规则
  const filteredRewrites = rewrites.filter((rewrite) =>
    rewrite.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rewrite.target.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 切换重写规则启用状态
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rewritesApi.updateRewrite(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rewrites'] });
      toast.success('重写规则状态已更新');
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  // 删除重写规则
  const deleteMutation = useMutation({
    mutationFn: (id: string) => rewritesApi.deleteRewrite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rewrites'] });
      toast.success(`删除了 ${selectedIds.size} 条重写规则`);
    },
    onError: (error: any) => {
      toast.error(`删除失败: ${error.message || '未知错误'}`);
    },
  });

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === filteredRewrites.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRewrites.map(r => r.id)));
    }
  };

  // 切换单个重写规则选中
  const handleSelectRewrite = (id: string) => {
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

  // 格式化时间
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 测试 DNS 解析（使用 dig 命令显示）
  const handleTestDns = (domain: string) => {
    const command = `dig @127.0.0.1 -p 15353 ${domain} A +short`;
    navigator.clipboard.writeText(command);
    toast.success('测试命令已复制到剪贴板');
  };

  // 计算统计
  const enabledRewrites = rewrites.filter(r => r.enabled).length;
  const localIps = rewrites.filter(r => r.target.startsWith('192.168.') || r.target.startsWith('10.') || r.target.startsWith('127.')).length;
  const customIps = rewrites.length - localIps;

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">总重写规则</CardTitle>
            <Route className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rewrites.length}</div>
            <p className="text-xs text-muted-foreground">{enabledRewrites} 个已启用</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">局域网地址</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{localIps}</div>
            <p className="text-xs text-muted-foreground">192.168.x.x / 10.x.x.x / 127.x.x.x</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">自定义地址</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customIps}</div>
            <p className="text-xs text-muted-foreground">其他 IP 地址</p>
          </CardContent>
        </Card>
      </div>

      {/* 头部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          {/* 搜索框 */}
          <input
            type="text"
            placeholder="搜索域名或 IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-2">
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
            添加重写规则
          </Button>
        </div>
      </div>

      {/* 重写规则表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>DNS 重写规则</CardTitle>
              <CardDescription>
                {rewrites.length} 条规则 {searchQuery && `(${filteredRewrites.length} 匹配)`}
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
                <Route size={48} className="mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">加载重写规则失败，请稍后重试</p>
                <Button variant="outline" onClick={() => refetch()}>
                  重试
                </Button>
              </div>
            </div>
          ) : filteredRewrites.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <div className="space-y-4 max-w-md">
                <Route size={48} className="mx-auto text-muted-foreground" />
                <div>
                  <p className="text-lg font-medium">暂无重写规则</p>
                  <p className="text-muted-foreground">
                    {searchQuery ? '没有找到匹配的重写规则' : '添加 DNS 重写规则来覆盖域名解析'}
                  </p>
                </div>
                {!searchQuery && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus size={16} className="mr-1" />
                    添加重写规则
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
                        checked={selectedIds.size === filteredRewrites.length}
                        onCheckedChange={handleSelectAll}
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead>域名</TableHead>
                    <TableHead>目标 IP</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="w-32">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRewrites.map((rewrite) => {
                    const isLocalIp =
                      rewrite.target.startsWith('192.168.') ||
                      rewrite.target.startsWith('10.') ||
                      rewrite.target.startsWith('127.');

                    return (
                      <TableRow
                        key={rewrite.id}
                        className={selectedIds.has(rewrite.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(rewrite.id)}
                            onCheckedChange={() => handleSelectRewrite(rewrite.id)}
                            aria-label={`选择重写规则 ${rewrite.domain}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                              {rewrite.domain}
                            </code>
                            <button
                              onClick={() => navigator.clipboard.writeText(rewrite.domain)}
                              className="text-muted-foreground hover:text-foreground"
                              title="复制域名"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                              {rewrite.target}
                            </code>
                            {isLocalIp && (
                              <span title="局域网地址">
                                <Server size={14} className="text-muted-foreground" />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={rewrite.enabled}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: rewrite.id, enabled: checked })
                            }
                            disabled={toggleMutation.isPending}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatDate(rewrite.created_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTestDns(rewrite.domain)}
                              title="测试解析"
                            >
                              <ExternalLink size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingRewrite(rewrite)}
                              title="编辑"
                            >
                              <Edit2 size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setSelectedIds(new Set([rewrite.id]));
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

      {/* 创建重写规则对话框 */}
      <CreateRewriteDialog
        open={createDialogOpen || editingRewrite !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingRewrite(null);
          }
        }}
        rewrite={editingRewrite}
        onSuccess={() => {
          setCreateDialogOpen(false);
          setEditingRewrite(null);
        }}
      />

      {/* 删除确认对话框 */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        rewriteIds={Array.from(selectedIds)}
      />
    </div>
  );
}
