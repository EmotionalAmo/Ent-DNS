import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { upstreamsApi, type DnsUpstream, type CreateUpstreamRequest } from '@/api/upstreams';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Plus, RefreshCw, Edit2, Trash2, Zap, ChevronDown, ChevronUp, Server,
} from 'lucide-react';

// ─── Health Badge ───────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-0">健康</Badge>;
    case 'unhealthy':
    case 'down':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-0">异常</Badge>;
    case 'degraded':
      return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-0">降级</Badge>;
    default:
      return <Badge className="bg-muted text-muted-foreground border-0">未知</Badge>;
  }
}

// ─── Upstream Dialog ─────────────────────────────────────────────────────────

interface UpstreamDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  upstream?: DnsUpstream | null;
}

function UpstreamDialog({ open, onOpenChange, upstream }: UpstreamDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: upstream?.name ?? '',
    addresses: upstream?.addresses?.join('\n') ?? '',
    priority: upstream?.priority ?? 10,
    health_check_interval: upstream?.health_check_interval ?? 30,
    health_check_timeout: upstream?.health_check_timeout ?? 5,
    failover_threshold: upstream?.failover_threshold ?? 3,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateUpstreamRequest) => upstreamsApi.create(payload),
    onSuccess: () => {
      toast.success('上游 DNS 已创建');
      qc.invalidateQueries({ queryKey: ['upstreams'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`创建失败: ${e.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateUpstreamRequest> }) =>
      upstreamsApi.update(id, payload),
    onSuccess: () => {
      toast.success('上游 DNS 已更新');
      qc.invalidateQueries({ queryKey: ['upstreams'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`更新失败: ${e.message}`),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('请输入名称'); return; }
    const addresses = form.addresses.split('\n').map((s) => s.trim()).filter(Boolean);
    if (addresses.length === 0) { toast.error('请至少填写一个地址'); return; }

    const payload: CreateUpstreamRequest = {
      name: form.name.trim(),
      addresses,
      priority: Number(form.priority),
      health_check_interval: Number(form.health_check_interval),
      health_check_timeout: Number(form.health_check_timeout),
      failover_threshold: Number(form.failover_threshold),
    };

    if (upstream) {
      updateMutation.mutate({ id: upstream.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{upstream ? '编辑上游 DNS' : '添加上游 DNS'}</DialogTitle>
          <DialogDescription>配置上游 DNS 服务器地址和健康检查参数</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="name">名称</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如: Cloudflare DoH"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="addresses">
                  DNS 地址 <span className="text-xs text-muted-foreground">(每行一个)</span>
                </Label>
                <Textarea
                  id="addresses"
                  value={form.addresses}
                  onChange={(e) => setForm({ ...form, addresses: e.target.value })}
                  placeholder={"https://1.1.1.1/dns-query\nhttps://1.0.0.1/dns-query"}
                  className="h-20 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="priority">优先级</Label>
                <Input
                  id="priority"
                  type="number"
                  min={1}
                  max={100}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="failover_threshold">
                  故障阈值 <span className="text-xs text-muted-foreground">(次)</span>
                </Label>
                <Input
                  id="failover_threshold"
                  type="number"
                  min={1}
                  value={form.failover_threshold}
                  onChange={(e) => setForm({ ...form, failover_threshold: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hc_interval">
                  检查间隔 <span className="text-xs text-muted-foreground">(秒)</span>
                </Label>
                <Input
                  id="hc_interval"
                  type="number"
                  min={5}
                  value={form.health_check_interval}
                  onChange={(e) => setForm({ ...form, health_check_interval: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hc_timeout">
                  超时时间 <span className="text-xs text-muted-foreground">(秒)</span>
                </Label>
                <Input
                  id="hc_timeout"
                  type="number"
                  min={1}
                  value={form.health_check_timeout}
                  onChange={(e) => setForm({ ...form, health_check_timeout: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <><RefreshCw size={14} className="mr-1 animate-spin" />保存中...</> : upstream ? '更新' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Failover Log Panel ──────────────────────────────────────────────────────

function FailoverLogPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['upstreams', 'failover-log'],
    queryFn: upstreamsApi.getFailoverLog,
    enabled: expanded,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <div>
            <CardTitle className="text-base">Failover 日志</CardTitle>
            <CardDescription>上游切换历史记录</CardDescription>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <RefreshCw size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">暂无 Failover 记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>上游 ID</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.upstream_id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.reason ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function UpstreamsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DnsUpstream | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DnsUpstream | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: upstreams = [], isLoading, error, refetch } = useQuery({
    queryKey: ['upstreams'],
    queryFn: upstreamsApi.list,
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => upstreamsApi.delete(id),
    onSuccess: () => {
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['upstreams'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(`删除失败: ${e.message}`),
  });

  const handleTest = async (up: DnsUpstream) => {
    setTestingId(up.id);
    try {
      const result = await upstreamsApi.testConnectivity(up.id);
      if (result.success) {
        toast.success(`连接成功，延迟 ${result.latency_ms}ms`);
      } else {
        toast.error(`连接失败: ${result.error ?? '未知错误'}`);
      }
    } catch (e: any) {
      toast.error(`测试失败: ${e.message}`);
    } finally {
      setTestingId(null);
      qc.invalidateQueries({ queryKey: ['upstreams'] });
    }
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">上游 DNS 管理</h2>
          <p className="text-sm text-muted-foreground">配置上游 DNS 服务器及健康检查策略</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus size={16} className="mr-1" />
            添加上游
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <Card>
        <CardHeader>
          <CardTitle>上游服务器</CardTitle>
          <CardDescription>{upstreams.length} 个上游 DNS 服务器，按优先级排序</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <RefreshCw size={32} className="animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <p className="text-muted-foreground">加载失败</p>
              <Button variant="outline" onClick={() => refetch()}>重试</Button>
            </div>
          ) : upstreams.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-4">
              <Server size={48} className="text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">暂无上游 DNS</p>
                <p className="text-sm text-muted-foreground">添加上游服务器以自定义 DNS 解析路径</p>
              </div>
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus size={16} className="mr-1" />添加上游
              </Button>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>地址</TableHead>
                    <TableHead>优先级</TableHead>
                    <TableHead>健康状态</TableHead>
                    <TableHead>最近检查</TableHead>
                    <TableHead className="w-32">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upstreams.map((up) => (
                    <TableRow key={up.id}>
                      <TableCell className="font-medium">{up.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {up.addresses?.map((addr) => (
                            <code key={addr} className="text-xs font-mono text-muted-foreground">{addr}</code>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-mono">{up.priority}</span>
                      </TableCell>
                      <TableCell>
                        <HealthBadge status={up.health_status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {up.last_health_check_at
                          ? new Date(up.last_health_check_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="测试连接"
                            disabled={testingId === up.id}
                            onClick={() => handleTest(up)}
                          >
                            {testingId === up.id
                              ? <RefreshCw size={14} className="animate-spin" />
                              : <Zap size={14} />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditing(up); setDialogOpen(true); }}
                          >
                            <Edit2 size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(up)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Failover 日志 */}
      <FailoverLogPanel />

      {/* 对话框 */}
      <UpstreamDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }}
        upstream={editing}
      />

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除上游 <strong>{deleteTarget?.name}</strong> 吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
