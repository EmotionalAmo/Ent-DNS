import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rulesApi } from '@/api';
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
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Plus,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  Shield,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

/**
 * Rules 页面
 * 管理 DNS 阻断/允许规则
 */

// 规则类型选项
const RULE_TYPES = [
  { value: 'block', label: '阻断 (Block)', color: 'text-red-600', icon: XCircle },
  { value: 'allow', label: '允许 (Allow)', color: 'text-green-600', icon: CheckCircle2 },
  { value: 'blocklist', label: '黑名单 (Blocklist)', color: 'text-red-600', icon: XCircle },
  { value: 'whitelist', label: '白名单 (Whitelist)', color: 'text-green-600', icon: CheckCircle2 },
] as const;

// 规则示例
const RULE_EXAMPLES = [
  {
    category: '基本域名阻断',
    examples: [
      '||example.com^ - 阻断 example.com 及其子域名',
      '||ads.example.com^ - 阻断特定子域名',
      '||*.example.com^ - 阻断所有子域名',
    ],
  },
  {
    category: '通配符匹配',
    examples: [
      '*://*.ads.* - 阻断所有包含 ads 的域名',
      '*://*analytics* - 阻断包含 analytics 的域名',
    ],
  },
  {
    category: '路径阻断',
    examples: [
      '||example.com/ads/* - 阻断 example.com 的 /ads/ 路径',
      '||example.com/*script*.js - 阻断特定脚本',
    ],
  },
  {
    category: '元素隐藏',
    examples: [
      'example.com##.ads - 隐藏元素选择器',
      'example.com##div.ad-banner - 隐藏广告横幅',
    ],
  },
];

interface CreateRuleFormData {
  domain: string;
  type: 'block' | 'allow' | 'blocklist' | 'whitelist';
}

function RuleTypeSelector({
  value,
  onChange,
}: {
  value: CreateRuleFormData['type'];
  onChange: (type: CreateRuleFormData['type']) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {RULE_TYPES.map((type) => {
        const Icon = type.icon;
        const isSelected = value === type.value;
        return (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={`
              flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-all
              ${isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 dark:border-gray-700'}
            `}
          >
            <Icon size={18} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
            <div>
              <div className={`text-sm font-medium ${isSelected ? 'text-blue-900 dark:text-blue-100' : 'text-gray-700 dark:text-gray-300'}`}>
                {type.label}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CreateRuleDialog({
  open,
  onOpenChange,
  rule,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: { id: string; domain: string; type: CreateRuleFormData['type'] } | null;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateRuleFormData>({
    domain: rule?.domain || '',
    type: rule?.type || 'block',
  });

  const createMutation = useMutation({
    mutationFn: rulesApi.createRule,
    onSuccess: () => {
      toast.success('规则创建成功');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onOpenChange(false);
      setFormData({ domain: '', type: 'block' });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`创建失败: ${error.message || '未知错误'}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateRuleFormData }) =>
      rulesApi.updateRule(id, data),
    onSuccess: () => {
      toast.success('规则更新成功');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onOpenChange(false);
      setFormData({ domain: '', type: 'block' });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.domain.trim()) {
      toast.error('请输入域名或规则');
      return;
    }

    if (rule) {
      updateMutation.mutate({ id: rule.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? '编辑规则' : '创建新规则'}</DialogTitle>
          <DialogDescription>
            {rule ? '修改 DNS 规则配置' : '添加新的 DNS 阻断或允许规则'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* 规则类型选择 */}
            <div className="space-y-2">
              <Label>规则类型</Label>
              <RuleTypeSelector
                value={formData.type}
                onChange={(type) => setFormData({ ...formData, type })}
              />
            </div>

            {/* 域名/规则输入 */}
            <div className="space-y-2">
              <Label htmlFor="domain">域名或规则</Label>
              <Textarea
                id="domain"
                value={formData.domain}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, domain: e.target.value })}
                placeholder="例如: ||example.com^"
                className="font-mono text-sm"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                支持标准 AdGuard 格式规则。可以输入多个规则，每行一个。
              </p>
            </div>

            {/* 帮助提示 */}
            <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3">
              <div className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 text-blue-600" />
                <div className="text-xs text-blue-900 dark:text-blue-100">
                  <p className="font-medium mb-1">规则格式说明</p>
                  <ul className="space-y-0.5">
                    <li>• ||domain.com^ - 阻断整个域名</li>
                    <li>• ||sub.domain.com^ - 阻断子域名</li>
                    <li>• ||domain.com/path/* - 阻断特定路径</li>
                    <li>• domain.com##selector - 隐藏页面元素</li>
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
                  {rule ? '更新' : '创建'}
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
  ruleIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  ruleIds: string[];
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {ruleIds.length === 1
              ? '确定要删除这条规则吗？此操作无法撤销。'
              : `确定要删除选中的 ${ruleIds.length} 条规则吗？此操作无法撤销。`}
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

export default function RulesPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showExamples, setShowExamples] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<{ id: string; domain: string; type: CreateRuleFormData['type'] } | null>(null);

  // 查询规则列表
  const { data: rules = [], isLoading, error, refetch } = useQuery({
    queryKey: ['rules'],
    queryFn: rulesApi.listRules,
  });

  // 过滤规则
  const filteredRules = rules.filter((rule) =>
    rule.domain.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 切换规则启用状态
  const toggleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateRuleFormData }) =>
      rulesApi.updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.success('规则状态已更新');
    },
    onError: (error: any) => {
      toast.error(`更新失败: ${error.message || '未知错误'}`);
    },
  });

  // 批量删除
  const deleteMutation = useMutation({
    mutationFn: rulesApi.deleteRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setSelectedIds(new Set());
      toast.success(`删除了 ${selectedIds.size} 条规则`);
    },
    onError: (error: any) => {
      toast.error(`删除失败: ${error.message || '未知错误'}`);
    },
  });

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === filteredRules.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRules.map(r => r.id)));
    }
  };

  // 切换单个规则选中
  const handleSelectRule = (id: string) => {
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
    deleteMutation.mutate(Array.from(selectedIds));
    setDeleteDialogOpen(false);
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

  // 获取规则类型配置
  const getRuleTypeConfig = (type: CreateRuleFormData['type']) => {
    return RULE_TYPES.find(t => t.value === type) || RULE_TYPES[0];
  };

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          {/* 搜索框 */}
          <input
            type="text"
            placeholder="搜索规则..."
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
            添加规则
          </Button>
        </div>
      </div>

      {/* 规则表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>规则列表</CardTitle>
              <CardDescription>
                {rules.length} 条规则 {searchQuery && `(${filteredRules.length} 匹配)`}
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
                <Shield size={48} className="mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">加载规则失败，请稍后重试</p>
                <Button variant="outline" onClick={() => refetch()}>
                  重试
                </Button>
              </div>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <div className="space-y-4 max-w-md">
                <Shield size={48} className="mx-auto text-muted-foreground" />
                <div>
                  <p className="text-lg font-medium">暂无规则</p>
                  <p className="text-muted-foreground">
                    {searchQuery ? '没有找到匹配的规则' : '点击添加按钮创建您的第一条 DNS 规则'}
                  </p>
                </div>
                {!searchQuery && (
                  <div className="flex justify-center gap-2">
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus size={16} className="mr-1" />
                      添加规则
                    </Button>
                    <Button variant="outline" onClick={() => setShowExamples(true)}>
                      查看示例
                    </Button>
                  </div>
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
                        checked={selectedIds.size === filteredRules.length}
                        onCheckedChange={handleSelectAll}
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead>规则内容</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRules.map((rule) => {
                    const typeConfig = getRuleTypeConfig(rule.type);
                    const TypeIcon = typeConfig.icon;
                    return (
                      <TableRow
                        key={rule.id}
                        className={selectedIds.has(rule.id) ? 'bg-blue-50 dark:bg-blue-950' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(rule.id)}
                            onCheckedChange={() => handleSelectRule(rule.id)}
                            aria-label={`选择规则 ${rule.domain}`}
                          />
                        </TableCell>
                        <TableCell>
                          <code className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                            {rule.domain}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-1.5 ${typeConfig.color}`}>
                            <TypeIcon size={14} />
                            <span className="text-sm">{typeConfig.label.split(' ')[0]}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={() =>
                              toggleMutation.mutate({
                                id: rule.id,
                                data: { domain: rule.domain, type: rule.type },
                              })
                            }
                            disabled={toggleMutation.isPending}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(rule.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setEditingRule({
                                  id: rule.id,
                                  domain: rule.domain,
                                  type: rule.type,
                                })
                              }
                            >
                              <Edit2 size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setSelectedIds(new Set([rule.id]));
                                setDeleteDialogOpen(true);
                              }}
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

      {/* 规则示例 */}
      <Card>
        <CardHeader>
          <button
            onClick={() => setShowExamples(!showExamples)}
            className="flex items-center justify-between w-full"
          >
            <CardTitle className="flex items-center gap-2">
              <Info size={18} />
              规则格式说明
            </CardTitle>
            {showExamples ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </CardHeader>
        {showExamples && (
          <CardContent className="space-y-4">
            {RULE_EXAMPLES.map((category, idx) => (
              <div key={idx}>
                <h4 className="font-medium text-sm mb-2">{category.category}</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {category.examples.map((example, i) => (
                    <li key={i} className="font-mono">
                      {example}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* 创建规则对话框 */}
      <CreateRuleDialog
        open={createDialogOpen || editingRule !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            setEditingRule(null);
          }
        }}
        rule={editingRule}
        onSuccess={() => {
          setCreateDialogOpen(false);
          setEditingRule(null);
        }}
      />

      {/* 删除确认对话框 */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        ruleIds={Array.from(selectedIds)}
      />
    </div>
  );
}
