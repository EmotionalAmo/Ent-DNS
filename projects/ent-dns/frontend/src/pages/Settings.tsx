import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type DnsSettingsRecord, type UpdateDnsSettingsPayload } from '@/api/settings';
import { upstreamsApi, type DnsUpstream, type CreateUpstreamRequest, type UpdateUpstreamRequest, type HealthCheckResult } from '@/api/upstreams';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RefreshCw, Save, Settings as SettingsIcon, Shield, Server, Plus, Trash2, Zap, Activity } from 'lucide-react';

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b last:border-0">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="ml-8">{children}</div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy': return 'bg-green-500';
    case 'degraded': return 'bg-yellow-500';
    case 'down': return 'bg-red-500';
    default: return 'bg-gray-400';
  }
}

function UpstreamDialog({
  upstream,
  onSave,
  onCancel,
}: {
  upstream?: DnsUpstream;
  onSave: (data: CreateUpstreamRequest | UpdateUpstreamRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(upstream?.name || '');
  const [addresses, setAddresses] = useState(upstream?.addresses.join(', ') || '');
  const [priority, setPriority] = useState(upstream?.priority || 1);
  const [interval, setInterval] = useState(upstream?.health_check_interval || 30);
  const [timeout, setTimeout] = useState(upstream?.health_check_timeout || 5);
  const [threshold, setThreshold] = useState(upstream?.failover_threshold || 3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const addressesArray = addresses.split(',').map(a => a.trim()).filter(Boolean);
    if (addressesArray.length === 0) {
      toast.error('请至少输入一个 DNS 服务器地址');
      return;
    }

    const data = upstream
      ? ({
          name,
          addresses: addressesArray,
          priority,
          health_check_interval: interval,
          health_check_timeout: timeout,
          failover_threshold: threshold,
        } as UpdateUpstreamRequest)
      : ({
          name,
          addresses: addressesArray,
          priority,
          health_check_interval: interval,
          health_check_timeout: timeout,
          failover_threshold: threshold,
        } as CreateUpstreamRequest);

    onSave(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="name">名称</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: Cloudflare Primary"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="addresses">DNS 服务器地址</Label>
          <Input
            id="addresses"
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="例如: 1.1.1.1:53, 1.0.0.1:53"
          />
          <p className="text-xs text-muted-foreground">多个地址用逗号分隔</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="priority">优先级 (1=Primary, 2=Secondary)</Label>
          <Input
            id="priority"
            type="number"
            min="1"
            max="10"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="interval">检查间隔 (秒)</Label>
            <Input
              id="interval"
              type="number"
              min="10"
              max="3600"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timeout">超时 (秒)</Label>
            <Input
              id="timeout"
              type="number"
              min="1"
              max="30"
              value={timeout}
              onChange={(e) => setTimeout(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="threshold">故障阈值</Label>
            <Input
              id="threshold"
              type="number"
              min="1"
              max="10"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="submit">保存</Button>
      </DialogFooter>
    </form>
  );
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error, refetch } = useQuery({
    queryKey: ['settings-dns'],
    queryFn: settingsApi.getDns,
  });

  const { data: upstreams, isLoading: upstreamsLoading } = useQuery({
    queryKey: ['upstreams'],
    queryFn: upstreamsApi.list,
  });

  const { data: failoverLog } = useQuery({
    queryKey: ['failover-log'],
    queryFn: upstreamsApi.getFailoverLog,
  });

  // Local form state
  const [form, setForm] = useState<UpdateDnsSettingsPayload>({});

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUpstream, setEditingUpstream] = useState<DnsUpstream | undefined>();
  const [testingUpstream, setTestingUpstream] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, HealthCheckResult>>({});

  // Sync form when settings load
  useEffect(() => {
    if (settings) {
      setForm({
        cache_ttl: settings.cache_ttl,
        query_log_retention_days: settings.query_log_retention_days,
        stats_retention_days: settings.stats_retention_days,
        safe_search_enabled: settings.safe_search_enabled,
        parental_control_enabled: settings.parental_control_enabled,
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateDnsSettingsPayload) => settingsApi.updateDns(payload),
    onSuccess: () => {
      toast.success('设置已保存');
      refetch();
    },
    onError: (e: any) => toast.error(`保存失败: ${e.message}`),
  });

  const createUpstreamMutation = useMutation({
    mutationFn: (req: CreateUpstreamRequest) => upstreamsApi.create(req),
    onSuccess: () => {
      toast.success('Upstream 已创建');
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['upstreams'] });
    },
    onError: (e: any) => toast.error(`创建失败: ${e.message}`),
  });

  const updateUpstreamMutation = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateUpstreamRequest }) =>
      upstreamsApi.update(id, req),
    onSuccess: () => {
      toast.success('Upstream 已更新');
      setDialogOpen(false);
      setEditingUpstream(undefined);
      queryClient.invalidateQueries({ queryKey: ['upstreams'] });
    },
    onError: (e: any) => toast.error(`更新失败: ${e.message}`),
  });

  const deleteUpstreamMutation = useMutation({
    mutationFn: (id: string) => upstreamsApi.delete(id),
    onSuccess: () => {
      toast.success('Upstream 已删除');
      queryClient.invalidateQueries({ queryKey: ['upstreams'] });
    },
    onError: (e: any) => toast.error(`删除失败: ${e.message}`),
  });

  const failoverMutation = useMutation({
    mutationFn: () => upstreamsApi.triggerFailover(),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`已切换到: ${result.message}`);
      } else {
        toast.warning(result.message);
      }
      queryClient.invalidateQueries({ queryKey: ['upstreams'] });
      queryClient.invalidateQueries({ queryKey: ['failover-log'] });
    },
    onError: (e: any) => toast.error(`故障转移失败: ${e.message}`),
  });

  const handleSave = () => {
    updateMutation.mutate(form);
  };

  const handleTestUpstream = async (id: string) => {
    setTestingUpstream(id);
    try {
      const result = await upstreamsApi.testConnectivity(id);
      setTestResults(prev => ({ ...prev, [id]: result }));
      if (result.success) {
        toast.success(`连接成功，延迟: ${result.latency_ms}ms`);
      } else {
        toast.error(`连接失败: ${result.error}`);
      }
    } catch (e: any) {
      toast.error(`测试失败: ${e.message}`);
    } finally {
      setTestingUpstream(null);
    }
  };

  const handleSaveUpstream = (data: CreateUpstreamRequest | UpdateUpstreamRequest) => {
    if (editingUpstream) {
      updateUpstreamMutation.mutate({ id: editingUpstream.id, req: data as UpdateUpstreamRequest });
    } else {
      createUpstreamMutation.mutate(data as CreateUpstreamRequest);
    }
  };

  const handleDeleteUpstream = (id: string, name: string) => {
    if (confirm(`确定要删除 "${name}" 吗？`)) {
      deleteUpstreamMutation.mutate(id);
    }
  };

  const handleCreateUpstream = () => {
    setEditingUpstream(undefined);
    setDialogOpen(true);
  };

  const handleEditUpstream = (upstream: DnsUpstream) => {
    setEditingUpstream(upstream);
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <RefreshCw size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 gap-3">
        <p className="text-muted-foreground">加载设置失败</p>
        <Button variant="outline" onClick={() => refetch()}>重试</Button>
      </div>
    );
  }

  const current = { ...settings, ...form } as DnsSettingsRecord & UpdateDnsSettingsPayload;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">设置</h2>
          <p className="text-sm text-muted-foreground">配置 DNS 服务器行为和数据保留策略</p>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? (
            <><RefreshCw size={14} className="mr-1 animate-spin" />保存中...</>
          ) : (
            <><Save size={14} className="mr-1" />保存设置</>
          )}
        </Button>
      </div>

      {/* 缓存设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon size={16} />
            缓存设置
          </CardTitle>
          <CardDescription>DNS 查询结果缓存配置</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="缓存 TTL"
            description="DNS 响应缓存时间（秒），0 表示禁用缓存"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={86400}
                value={current.cache_ttl ?? 300}
                onChange={(e) =>
                  setForm({ ...form, cache_ttl: Number(e.target.value) })
                }
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">秒</span>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* 数据保留 */}
      <Card>
        <CardHeader>
          <CardTitle>数据保留</CardTitle>
          <CardDescription>查询日志和统计数据的保留周期</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="查询日志保留"
            description="DNS 查询日志的保留天数"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={current.query_log_retention_days ?? 30}
                onChange={(e) =>
                  setForm({ ...form, query_log_retention_days: Number(e.target.value) })
                }
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">天</span>
            </div>
          </SettingRow>
          <SettingRow
            label="统计数据保留"
            description="Dashboard 统计数据的保留天数"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={current.stats_retention_days ?? 90}
                onChange={(e) =>
                  setForm({ ...form, stats_retention_days: Number(e.target.value) })
                }
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">天</span>
            </div>
          </SettingRow>
        </CardContent>
      </Card>

      {/* 安全过滤 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield size={16} />
            安全过滤
          </CardTitle>
          <CardDescription>额外的内容过滤选项</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            label="安全搜索"
            description="强制使用 Google/Bing/YouTube 的安全搜索模式"
          >
            <Switch
              checked={current.safe_search_enabled ?? false}
              onCheckedChange={(v) => setForm({ ...form, safe_search_enabled: v })}
            />
          </SettingRow>
          <SettingRow
            label="家长控制"
            description="拦截成人内容相关域名"
          >
            <Switch
              checked={current.parental_control_enabled ?? false}
              onCheckedChange={(v) => setForm({ ...form, parental_control_enabled: v })}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Upstream 管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Server size={16} />
              DNS 上游服务器
            </span>
            <Button size="sm" onClick={handleCreateUpstream}>
              <Plus size={14} className="mr-1" />添加
            </Button>
          </CardTitle>
          <CardDescription>配置上游 DNS 服务器和故障转移策略</CardDescription>
        </CardHeader>
        <CardContent>
          {upstreamsLoading ? (
            <div className="flex justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : upstreams && upstreams.length > 0 ? (
            <div className="space-y-3">
              {upstreams.map((upstream) => (
                <div
                  key={upstream.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${getStatusColor(upstream.health_status)}`}
                          title={upstream.health_status}
                        />
                        <h4 className="font-medium">{upstream.name}</h4>
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          优先级 {upstream.priority}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>
                          地址: {upstream.addresses.join(', ')}
                        </div>
                        {testResults[upstream.id] && (
                          <div className={`text-xs ${testResults[upstream.id]?.success ? 'text-green-600' : 'text-red-600'}`}>
                            {testResults[upstream.id]?.success
                              ? `测试通过 (${testResults[upstream.id]?.latency_ms}ms)`
                              : `测试失败: ${testResults[upstream.id]?.error}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEditUpstream(upstream)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTestUpstream(upstream.id)}
                        disabled={testingUpstream === upstream.id}
                      >
                        {testingUpstream === upstream.id ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Activity size={14} />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteUpstream(upstream.id, upstream.name)}
                      >
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>检查间隔: {upstream.health_check_interval}s</span>
                    <span>超时: {upstream.health_check_timeout}s</span>
                    <span>阈值: {upstream.failover_threshold}</span>
                    <span>启用: {upstream.is_active ? '是' : '否'}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              暂无上游服务器，点击"添加"创建
            </div>
          )}
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => failoverMutation.mutate()}
              disabled={failoverMutation.isPending}
              className="w-full"
            >
              <Zap size={16} className="mr-2" />
              {failoverMutation.isPending ? '切换中...' : '手动故障转移'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 故障转移日志 */}
      <Card>
        <CardHeader>
          <CardTitle>故障转移日志</CardTitle>
          <CardDescription>Upstream 切换历史记录</CardDescription>
        </CardHeader>
        <CardContent>
          {failoverLog && failoverLog.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {failoverLog.map((entry) => (
                <div
                  key={entry.id}
                  className="text-sm py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString('zh-CN')}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      entry.action === 'failover_triggered' ? 'bg-yellow-100 text-yellow-800' :
                      entry.action === 'recovered' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {entry.action}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs mt-1">
                    Upstream: {entry.upstream_id}
                    {entry.reason && ` - ${entry.reason}`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              暂无故障转移记录
            </div>
          )}
        </CardContent>
      </Card>

      {/* 保存按钮 (底部) */}
      <div className="flex justify-end pb-4">
        <Button onClick={handleSave} disabled={updateMutation.isPending} size="lg">
          {updateMutation.isPending ? (
            <><RefreshCw size={16} className="mr-2 animate-spin" />保存中...</>
          ) : (
            <><Save size={16} className="mr-2" />保存所有设置</>
          )}
        </Button>
      </div>

      {/* Upstream Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingUpstream ? '编辑 Upstream' : '创建 Upstream'}
            </DialogTitle>
          </DialogHeader>
          <UpstreamDialog
            upstream={editingUpstream}
            onSave={handleSaveUpstream}
            onCancel={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
