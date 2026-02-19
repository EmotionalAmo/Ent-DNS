import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { settingsApi, type DnsSettingsRecord, type UpdateDnsSettingsPayload } from '@/api/settings';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RefreshCw, Save, Settings as SettingsIcon, Shield } from 'lucide-react';

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

export default function SettingsPage() {
  const { data: settings, isLoading, error, refetch } = useQuery({
    queryKey: ['settings-dns'],
    queryFn: settingsApi.getDns,
  });

  // Local form state
  const [form, setForm] = useState<UpdateDnsSettingsPayload>({});

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

  const handleSave = () => {
    updateMutation.mutate(form);
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
          <h2 className="text-lg font-semibold">DNS 设置</h2>
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

      {/* 上游 DNS（只读显示） */}
      <Card>
        <CardHeader>
          <CardTitle>上游 DNS</CardTitle>
          <CardDescription>当前使用的上游 DNS 服务器（通过配置文件修改）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {settings?.upstreams?.map((upstream) => (
              <div key={upstream} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <code className="text-sm font-mono">{upstream}</code>
              </div>
            ))}
            {!settings?.upstreams?.length && (
              <p className="text-sm text-muted-foreground">未配置上游 DNS</p>
            )}
          </div>
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
    </div>
  );
}
