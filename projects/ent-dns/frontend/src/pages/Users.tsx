import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, type UserRecord, type CreateUserPayload } from '@/api/users';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Plus, RefreshCw, Users, Edit2, ShieldCheck } from 'lucide-react';

type Role = 'super_admin' | 'admin' | 'operator' | 'read_only';

const ROLE_LABELS: Record<Role, { label: string; color: string }> = {
  super_admin: { label: '超级管理员', color: 'text-red-600 bg-red-50 dark:bg-red-950' },
  admin: { label: '管理员', color: 'text-blue-600 bg-blue-50 dark:bg-blue-950' },
  operator: { label: '操作员', color: 'text-green-600 bg-green-50 dark:bg-green-950' },
  read_only: { label: '只读', color: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
};

function RoleBadge({ role }: { role: Role }) {
  const cfg = ROLE_LABELS[role] ?? ROLE_LABELS.read_only;
  return (
    <span className={`text-xs font-medium rounded px-2 py-0.5 ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' as Role });

  const mutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => usersApi.create(payload),
    onSuccess: () => {
      toast.success('用户已创建');
      qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
      setForm({ username: '', password: '', role: 'operator' });
    },
    onError: (e: any) => toast.error(`创建失败: ${e.message}`),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username.trim()) { toast.error('请输入用户名'); return; }
    if (form.password.length < 8) { toast.error('密码至少 8 位'); return; }
    mutation.mutate({ username: form.username.trim(), password: form.password, role: form.role });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>创建用户</DialogTitle>
          <DialogDescription>添加新的管理控制台用户</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="请输入用户名"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="至少 8 位"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([val, cfg]) => (
                    <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <><RefreshCw size={14} className="mr-1 animate-spin" />创建中...</>
              ) : (
                <><Plus size={14} className="mr-1" />创建</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UpdateRoleDialog({
  user,
  onClose,
}: {
  user: UserRecord | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>(user?.role ?? 'read_only');

  const mutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.updateRole(id, { role }),
    onSuccess: () => {
      toast.success('角色已更新');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: any) => toast.error(`更新失败: ${e.message}`),
  });

  if (!user) return null;

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>修改角色</DialogTitle>
          <DialogDescription>修改用户 <strong>{user.username}</strong> 的角色</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <Label>新角色</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROLE_LABELS).map(([val, cfg]) => (
                <SelectItem key={val} value={val}>{cfg.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>取消</Button>
          <Button
            onClick={() => mutation.mutate({ id: user.id, role })}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <><RefreshCw size={14} className="mr-1 animate-spin" />保存中...</>
            ) : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function UsersPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);

  const { data: users = [], isLoading, error, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">用户管理</h2>
          <p className="text-sm text-muted-foreground">管理控制台访问用户和权限</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-1" />
            创建用户
          </Button>
        </div>
      </div>

      {/* 表格 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={18} />
            用户列表
          </CardTitle>
          <CardDescription>{users.length} 个用户</CardDescription>
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
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-4">
              <Users size={48} className="text-muted-foreground" />
              <p className="text-muted-foreground">暂无用户</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户名</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>
                        <RoleBadge role={user.role} />
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs rounded px-2 py-0.5 ${
                          user.is_active
                            ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                        }`}>
                          {user.is_active ? '活跃' : '禁用'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(user.created_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingUser(user)}
                        >
                          <Edit2 size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UpdateRoleDialog user={editingUser} onClose={() => setEditingUser(null)} />
    </div>
  );
}
