import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientGroupsApi, type ClientGroup, type ClientGroupMember, type CreateClientGroupRequest, type UpdateClientGroupRequest } from '@/api/clientGroups';
import { clientsApi } from '@/api/clients';
import { filtersApi } from '@/api/filters';
import { GroupTree } from '@/components/GroupTree';
import { ClientList } from '@/components/ClientList';
import { GroupRulesPanel } from '@/components/GroupRulesPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PRESET_COLORS } from '@/lib/colors';

export default function ClientGroupsPage() {
  const qc = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'clients' | 'rules'>('clients');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<ClientGroup | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [editGroup, setEditGroup] = useState<ClientGroup | null>(null);
  const [form, setForm] = useState<{
    name: string;
    color: string;
    description: string;
  }>({ name: '', color: PRESET_COLORS[0], description: '' });
  const [moveToGroupId, setMoveToGroupId] = useState<number | null>(null);

  // 查询分组列表
  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ['client-groups'],
    queryFn: () => clientGroupsApi.list(),
  });

  // 查询客户端列表
  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients', selectedGroupId],
    queryFn: () =>
      selectedGroupId
        ? clientGroupsApi.getMembers(selectedGroupId)
        : clientsApi.list().then((allClients) => ({
            data: allClients.map((c) => ({
              ...c,
              group_ids: [],
              group_names: [],
            })),
            total: allClients.length,
          })),
    enabled: !!selectedGroupId || activeTab === 'clients',
  });

  const clients = clientsData?.data || [];

  // 查询分组规则
  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['client-group-rules', selectedGroupId],
    queryFn: () => clientGroupsApi.getRules(selectedGroupId!, { rule_type: 'filter' }),
    enabled: !!selectedGroupId && activeTab === 'rules',
  });

  const rules = rulesData?.data || [];

  // 查询可用的过滤器列表
  const { data: availableFilters = [] } = useQuery({
    queryKey: ['filters'],
    queryFn: () => filtersApi.list(),
  });

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  // 创建分组
  const createMutation = useMutation({
    mutationFn: (data: CreateClientGroupRequest) => clientGroupsApi.create(data),
    onSuccess: () => {
      toast.success('分组已创建');
      qc.invalidateQueries({ queryKey: ['client-groups'] });
      setShowCreateDialog(false);
      resetForm();
    },
    onError: (e: any) => toast.error(`创建失败: ${e.message}`),
  });

  // 更新分组
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateClientGroupRequest }) =>
      clientGroupsApi.update(id, data),
    onSuccess: () => {
      toast.success('分组已更新');
      qc.invalidateQueries({ queryKey: ['client-groups'] });
      setShowEditDialog(false);
      resetForm();
    },
    onError: (e: any) => toast.error(`更新失败: ${e.message}`),
  });

  // 删除分组
  const deleteMutation = useMutation({
    mutationFn: (id: number) => clientGroupsApi.delete(id),
    onSuccess: () => {
      toast.success('分组已删除');
      qc.invalidateQueries({ queryKey: ['client-groups'] });
      if (selectedGroupId === showDeleteDialog?.id) {
        setSelectedGroupId(null);
      }
      setShowDeleteDialog(null);
    },
    onError: (e: any) => toast.error(`删除失败: ${e.message}`),
  });

  // 批量移动客户端
  const moveMutation = useMutation({
    mutationFn: (data: { client_ids: string[]; from_group_id?: number; to_group_id?: number }) =>
      clientGroupsApi.batchMove(data),
    onSuccess: () => {
      toast.success('客户端已移动');
      qc.invalidateQueries({ queryKey: ['clients', selectedGroupId] });
      qc.invalidateQueries({ queryKey: ['client-groups'] });
      setSelectedClientIds([]);
      setShowMoveDialog(false);
      setMoveToGroupId(null);
    },
    onError: (e: any) => toast.error(`移动失败: ${e.message}`),
  });

  // 从组移除客户端
  const removeMutation = useMutation({
    mutationFn: (data: { client_ids: string[] }) =>
      selectedGroupId
        ? clientGroupsApi.removeMembers(selectedGroupId, data)
        : Promise.reject('No group selected'),
    onSuccess: () => {
      toast.success('客户端已移除');
      qc.invalidateQueries({ queryKey: ['clients', selectedGroupId] });
      qc.invalidateQueries({ queryKey: ['client-groups'] });
      setSelectedClientIds([]);
    },
    onError: (e: any) => toast.error(`移除失败: ${e.message}`),
  });

  // 绑定规则
  const bindRuleMutation = useMutation({
    mutationFn: (data: { ruleId: number; ruleType: string; priority: number }) =>
      selectedGroupId
        ? clientGroupsApi.bindRules(selectedGroupId, { rules: [data] })
        : Promise.reject('No group selected'),
    onSuccess: () => {
      toast.success('规则已绑定');
      qc.invalidateQueries({ queryKey: ['client-group-rules', selectedGroupId] });
      qc.invalidateQueries({ queryKey: ['client-groups'] });
    },
    onError: (e: any) => toast.error(`绑定失败: ${e.message}`),
  });

  // 解绑规则
  const unbindRuleMutation = useMutation({
    mutationFn: (data: { ruleId: number; ruleType: string }) =>
      selectedGroupId
        ? clientGroupsApi.unbindRules(selectedGroupId, {
            rule_ids: [data.ruleId],
            rule_type: data.ruleType,
          })
        : Promise.reject('No group selected'),
    onSuccess: () => {
      toast.success('规则已解绑');
      qc.invalidateQueries({ queryKey: ['client-group-rules', selectedGroupId] });
      qc.invalidateQueries({ queryKey: ['client-groups'] });
    },
    onError: (e: any) => toast.error(`解绑失败: ${e.message}`),
  });

  const resetForm = () => {
    setForm({ name: '', color: PRESET_COLORS_LIST[0], description: '' });
    setEditGroup(null);
  };

  const handleCreateGroup = () => {
    setEditGroup(null);
    resetForm();
    setShowCreateDialog(true);
  };

  const handleEditGroup = (group: ClientGroup) => {
    setEditGroup(group);
    setForm({
      name: group.name,
      color: group.color,
      description: group.description || '',
    });
    setShowEditDialog(true);
  };

  const handleDeleteGroup = (group: ClientGroup) => {
    setShowDeleteDialog(group);
  };

  const handleSaveGroup = () => {
    if (!form.name.trim()) {
      toast.error('请输入分组名称');
      return;
    }

    if (editGroup) {
      updateMutation.mutate({ id: editGroup.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleSelectClient = (clientId: string) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId]
    );
  };

  const handleToggleAll = () => {
    const allClientIds = clients.map((c) => c.id);
    if (selectedClientIds.length === allClientIds.length) {
      setSelectedClientIds([]);
    } else {
      setSelectedClientIds(allClientIds);
    }
  };

  const handleMoveToGroup = (clientIds: string[]) => {
    setSelectedClientIds(clientIds);
    setShowMoveDialog(true);
  };

  const confirmMoveToGroup = () => {
    if (moveToGroupId === null) {
      toast.error('请选择目标分组');
      return;
    }

    moveMutation.mutate({
      client_ids: selectedClientIds,
      from_group_id: selectedGroupId || undefined,
      to_group_id: moveToGroupId,
    });
  };

  const handleRemoveFromGroup = (clientIds: string[]) => {
    removeMutation.mutate({ client_ids: clientIds });
  };

  return (
    <div className="flex h-screen">
      {/* 左侧分组树 */}
      <div className="w-80 border-r">
        <GroupTree
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onCreateGroup={handleCreateGroup}
          onEditGroup={handleEditGroup}
          onDeleteGroup={handleDeleteGroup}
        />
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col">
        {selectedGroup ? (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col">
            <div className="border-b px-6 py-4">
              <h1 className="text-2xl font-bold">{selectedGroup.name}</h1>
              <p className="text-muted-foreground">{selectedGroup.description}</p>
              <div className="flex items-center gap-4 mt-2">
                <Badge variant="secondary">{selectedGroup.client_count} 台设备</Badge>
                <Badge variant="secondary">{selectedGroup.rule_count} 条规则</Badge>
              </div>
            </div>

            <TabsList className="mx-6 mt-4">
              <TabsTrigger value="clients">客户端</TabsTrigger>
              <TabsTrigger value="rules">规则</TabsTrigger>
            </TabsList>

            <TabsContent value="clients" className="flex-1 mt-0">
              <ClientList
                clients={clients}
                selectedClientIds={selectedClientIds}
                loading={clientsLoading}
                onToggleClient={handleSelectClient}
                onToggleAll={handleToggleAll}
                onMoveToGroup={handleMoveToGroup}
                onRemoveFromGroup={handleRemoveFromGroup}
              />
            </TabsContent>

            <TabsContent value="rules" className="flex-1 mt-0">
              <GroupRulesPanel
                group={selectedGroup}
                rules={rules}
                loading={rulesLoading}
                onBindRule={(ruleId, ruleType, priority) =>
                  bindRuleMutation.mutateAsync({ ruleId, ruleType, priority })
                }
                onUnbindRule={(ruleId, ruleType) =>
                  unbindRuleMutation.mutateAsync({ ruleId, ruleType })
                }
                availableFilters={availableFilters.map((f) => ({
                  id: f.id,
                  name: f.name,
                  pattern: f.pattern,
                  action: f.action,
                }))}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>请从左侧选择一个分组</p>
          </div>
        )}
      </div>

      {/* 创建分组对话框 */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建分组</DialogTitle>
            <DialogDescription>
              创建一个新的客户端分组
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">分组名称</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：研发部门"
              />
            </div>
            <div>
              <Label>颜色标记</Label>
              <div className="flex gap-2 mt-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'w-8 h-8 rounded-full transition-all',
                      form.color === color
                        ? 'ring-2 ring-offset-2 ring-primary'
                        : 'ring-0'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setForm({ ...form, color })}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="description">描述（可选）</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="分组的用途说明"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveGroup} disabled={createMutation.isPending}>
              {createMutation.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑分组对话框 */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑分组</DialogTitle>
            <DialogDescription>
              修改分组信息
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">分组名称</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：研发部门"
              />
            </div>
            <div>
              <Label>颜色标记</Label>
              <div className="flex gap-2 mt-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'w-8 h-8 rounded-full transition-all',
                      form.color === color
                        ? 'ring-2 ring-offset-2 ring-primary'
                        : 'ring-0'
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setForm({ ...form, color })}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="edit-description">描述（可选）</Label>
              <Textarea
                id="edit-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="分组的用途说明"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveGroup} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除分组确认对话框 */}
      <AlertDialog open={!!showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除分组</AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ 删除分组 "{showDeleteDialog?.name}" 后：
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>组内的 {showDeleteDialog?.client_count} 台设备将移至"未分组"</li>
                <li>该组绑定的 {showDeleteDialog?.rule_count} 条规则将解绑</li>
              </ul>
              <p className="mt-3 text-destructive font-medium">
                此操作不可撤销，确定删除吗？
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => showDeleteDialog && deleteMutation.mutate(showDeleteDialog.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 移动到组对话框 */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动到分组</DialogTitle>
            <DialogDescription>
              将 {selectedClientIds.length} 台设备移动到分组
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>目标分组</Label>
              <div className="space-y-2 mt-2">
                {groups.map((group) => (
                  <label
                    key={group.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent transition-colors',
                      moveToGroupId === group.id && 'bg-accent border-primary'
                    )}
                  >
                    <input
                      type="radio"
                      name="target-group"
                      checked={moveToGroupId === group.id}
                      onChange={() => setMoveToGroupId(group.id)}
                      className="mt-0.5"
                    />
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <span>{group.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {group.client_count}
                      </Badge>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
              取消
            </Button>
            <Button
              onClick={confirmMoveToGroup}
              disabled={moveMutation.isPending || moveToGroupId === null}
            >
              {moveMutation.isPending ? '移动中...' : '确认移动'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
