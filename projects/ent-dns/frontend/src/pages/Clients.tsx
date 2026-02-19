import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi, type ClientRecord, type CreateClientPayload } from '@/api/clients';
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
import { Plus, Edit2, RefreshCw, Monitor, X } from 'lucide-react';

interface FormData {
  name: string;
  identifiers: string;
  upstreams: string;
  filter_enabled: boolean;
  tags: string;
}

function ClientDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientRecord | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormData>({
    name: client?.name ?? '',
    identifiers: client?.identifiers?.join('\n') ?? '',
    upstreams: client?.upstreams?.join('\n') ?? '',
    filter_enabled: client?.filter_enabled ?? true,
    tags: client?.tags?.join(', ') ?? '',
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateClientPayload) => clientsApi.create(payload),
    onSuccess: () => {
      toast.success('客户端已创建');
      qc.invalidateQueries({ queryKey: ['clients'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`创建失败: ${e.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreateClientPayload }) =>
      clientsApi.update(id, payload),
    onSuccess: () => {
      toast.success('客户端已更新');
      qc.invalidateQueries({ queryKey: ['clients'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(`更新失败: ${e.message}`),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('请输入客户端名称');
      return;
    }
    const identifiers = form.identifiers.split('\n').map((s) => s.trim()).filter(Boolean);
    if (identifiers.length === 0) {
      toast.error('请至少输入一个标识符（IP 或 MAC）');
      return;
    }
    const upstreams = form.upstreams.split('\n').map((s) => s.trim()).filter(Boolean);
    const tags = form.tags.split(',').map((s) => s.trim()).filter(Boolean);

    const payload: CreateClientPayload = {
      name: form.name.trim(),
      identifiers,
      filter_enabled: form.filter_enabled,
      ...(upstreams.length > 0 ? { upstreams } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };

    if (client) {
      updateMutation.mutate({ id: client.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{client ? '编辑客户端' : '添加客户端'}</DialogTitle>
          <DialogDescription>配置 DNS 客户端的标识符和过滤策略</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如: 客厅电视"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="identifiers">
                标识符 <span className="text-muted-foreground text-xs">(每行一个 IP 或 MAC)</span>
              </Label>
              <textarea
                id="identifiers"
                value={form.identifiers}
                onChange={(e) => setForm({ ...form, identifiers: e.target.value })}
                placeholder="192.168.1.100&#10;AA:BB:CC:DD:EE:FF"
                className="w-full h-20 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="upstreams">
                自定义上游 DNS <span className="text-muted-foreground text-xs">(可选，每行一个)</span>
              </Label>
              <textarea
                id="upstreams"
                value={form.upstreams}
                onChange={(e) => setForm({ ...form, upstreams: e.target.value })}
                placeholder="1.1.1.1&#10;8.8.8.8"
                className="w-full h-16 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tags">
                标签 <span className="text-muted-foreground text-xs">(可选，逗号分隔)</span>
              </Label>
              <Input
                id="tags"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="家庭, IoT"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.filter_enabled}
                onCheckedChange={(v) => setForm({ ...form, filter_enabled: v })}
              />
              <Label>启用过滤</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <><RefreshCw size={14} className="mr-1 animate-spin" />保存中...</>
              ) : (
                <><Plus size={14} className="mr-1" />{client ? '更新' : '创建'}</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function ClientsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);

  const { data: clients = [], isLoading, error, refetch } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.delete(id),
    onSuccess: () => {
      toast.success('客户端已删除');
      qc.invalidateQueries({ queryKey: ['clients'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(`删除失败: ${e.message}`),
  });

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">客户端管理</h2>
          <p className="text-sm text-muted-foreground">按客户端配置独立的 DNS 过滤策略</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus size={16} className="mr-1" />
            添加客户端
          </Button>
        </div>
      </div>

      {/* 表格 */}
      <Card>
        <CardHeader>
          <CardTitle>客户端列表</CardTitle>
          <CardDescription>{clients.length} 个客户端</CardDescription>
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
          ) : clients.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-4">
              <Monitor size={48} className="text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">暂无客户端</p>
                <p className="text-sm text-muted-foreground">添加客户端以实现精细化 DNS 控制</p>
              </div>
              <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus size={16} className="mr-1" />
                添加客户端
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>标识符</TableHead>
                    <TableHead>自定义上游</TableHead>
                    <TableHead>过滤</TableHead>
                    <TableHead>标签</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {client.identifiers?.map((id) => (
                            <span key={id} className="text-xs bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 font-mono">
                              {id}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.upstreams?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {client.upstreams.map((u) => (
                              <span key={u} className="text-xs font-mono bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded">
                                {u}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs">默认</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch checked={client.filter_enabled} disabled />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {client.tags?.map((tag) => (
                            <span key={tag} className="text-xs bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded px-1.5 py-0.5">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(client.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditing(client); setDialogOpen(true); }}
                          >
                            <Edit2 size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(client)}
                          >
                            <X size={14} />
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

      {/* 创建/编辑对话框 */}
      <ClientDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        client={editing}
      />

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除客户端 <strong>{deleteTarget?.name}</strong> 吗？此操作无法撤销。
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
