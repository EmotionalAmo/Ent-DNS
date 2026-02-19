import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rulesApi } from '@/api';
import type { Rule } from '@/api/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  Shield,
  XCircle,
  CheckCircle2,
  Download,
} from 'lucide-react';

/**
 * 从 AdGuard 规则字符串推断类型
 * @@ 开头 → 允许 (whitelist)，否则 → 阻断 (block)
 */
function inferRuleType(rule: string): 'block' | 'allow' {
  return rule.trim().startsWith('@@') ? 'allow' : 'block';
}

const RULE_EXAMPLES = [
  {
    category: '基本域名阻断',
    examples: [
      '||example.com^ - 阻断 example.com 及其子域名',
      '||ads.example.com^ - 阻断特定子域名',
    ],
  },
  {
    category: '白名单（允许）',
    examples: [
      '@@||example.com^ - 允许 example.com（优先于阻断规则）',
    ],
  },
  {
    category: 'hosts 格式',
    examples: [
      '0.0.0.0 example.com - hosts 格式阻断',
    ],
  },
];

interface CreateRuleFormData {
  rule: string;
  comment: string;
}

function CreateRuleDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateRuleFormData>({
    rule: '',
    comment: '',
  });

  const createMutation = useMutation({
    mutationFn: () => rulesApi.createRule({
      rule: formData.rule.trim(),
      comment: formData.comment.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('规则创建成功');
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      onOpenChange(false);
      setFormData({ rule: '', comment: '' });
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(`创建失败: ${error.response?.data || error.message || '未知错误'}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.rule.trim()) {
      toast.error('请输入规则内容');
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加规则</DialogTitle>
          <DialogDescription>
            输入 AdGuard 格式或 hosts 格式的 DNS 规则
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rule">规则内容</Label>
              <Textarea
                id="rule"
                value={formData.rule}
                onChange={(e) => setFormData({ ...formData, rule: e.target.value })}
                placeholder="例如: ||ads.example.com^"
                className="font-mono text-sm"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                支持 AdGuard 格式（||domain^）和 hosts 格式（0.0.0.0 domain）
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="comment">备注（可选）</Label>
              <Input
                id="comment"
                value={formData.comment}
                onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                placeholder="说明此规则的用途"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <><RefreshCw size={16} className="mr-2 animate-spin" />保存中...</>
              ) : (
                <><Plus size={16} className="mr-1" />创建</>
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
  count,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  count: number;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            {count === 1 ? '确定要删除这条规则吗？' : `确定要删除选中的 ${count} 条规则吗？`}此操作无法撤销。
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
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [isExporting, setIsExporting] = useState(false);

  const { data: rules = [], isLoading, error, refetch } = useQuery<Rule[]>({
    queryKey: ['rules'],
    queryFn: rulesApi.listRules,
  });

  const filteredRules = rules.filter((rule) =>
    rule.rule.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (rule.comment ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const deleteMutation = useMutation({
    mutationFn: rulesApi.deleteRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      setSelectedIds(new Set());
      toast.success(`已删除 ${selectedIds.size} 条规则`);
    },
    onError: (error: any) => {
      toast.error(`删除失败: ${error.message || '未知错误'}`);
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === filteredRules.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRules.map(r => r.id)));
    }
  };

  const handleSelectRule = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const handleDeleteConfirm = () => {
    if (selectedIds.size === 0) return;
    deleteMutation.mutate(Array.from(selectedIds));
    setDeleteDialogOpen(false);
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await rulesApi.exportRules(exportFormat);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rules-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Export failed:', error);
      alert('导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <input
            type="text"
            placeholder="搜索规则..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </Button>
          <div className="h-6 w-px bg-border" />
          <Select value={exportFormat} onValueChange={(val) => setExportFormat(val as 'csv' | 'json')}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={14} className="mr-1" />
            {isExporting ? '导出中...' : '导出'}
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 size={16} className="mr-1" />
              删除 ({selectedIds.size})
            </Button>
          )}
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
                共 {rules.length} 条规则{searchQuery && ` (${filteredRules.length} 匹配)`}
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
                <p className="text-muted-foreground">加载失败，请重试</p>
                <Button variant="outline" onClick={() => refetch()}>重试</Button>
              </div>
            </div>
          ) : filteredRules.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-center">
              <div className="space-y-4 max-w-md">
                <Shield size={48} className="mx-auto text-muted-foreground" />
                <div>
                  <p className="text-lg font-medium">暂无规则</p>
                  <p className="text-muted-foreground">
                    {searchQuery ? '没有找到匹配的规则' : '点击添加按钮创建第一条 DNS 规则'}
                  </p>
                </div>
                {!searchQuery && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus size={16} className="mr-1" />添加规则
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
                        checked={selectedIds.size === filteredRules.length && filteredRules.length > 0}
                        onCheckedChange={handleSelectAll}
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead>规则</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="w-20">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRules.map((rule) => {
                    const ruleType = inferRuleType(rule.rule);
                    return (
                      <TableRow
                        key={rule.id}
                        className={selectedIds.has(rule.id) ? 'bg-primary/10' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(rule.id)}
                            onCheckedChange={() => handleSelectRule(rule.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                            {rule.rule}
                          </code>
                        </TableCell>
                        <TableCell>
                          {ruleType === 'allow' ? (
                            <Badge variant="outline" className="text-green-600 border-green-300">
                              <CheckCircle2 size={12} className="mr-1" />允许
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600 border-red-300">
                              <XCircle size={12} className="mr-1" />阻断
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {rule.comment || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(rule.created_at)}
                        </TableCell>
                        <TableCell>
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

      {/* 规则格式说明 */}
      <Card>
        <CardHeader>
          <button
            onClick={() => setShowExamples(!showExamples)}
            className="flex items-center justify-between w-full"
          >
            <CardTitle className="flex items-center gap-2">
              <Info size={18} />规则格式说明
            </CardTitle>
            {showExamples ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </CardHeader>
        {showExamples && (
          <CardContent className="space-y-4">
            {RULE_EXAMPLES.map((cat, idx) => (
              <div key={idx}>
                <h4 className="font-medium text-sm mb-2">{cat.category}</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {cat.examples.map((ex, i) => (
                    <li key={i} className="font-mono">{ex}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <CreateRuleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={() => setCreateDialogOpen(false)}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        count={selectedIds.size}
      />
    </div>
  );
}
