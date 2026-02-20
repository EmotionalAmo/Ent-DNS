import { useState } from 'react';
import { type GroupRule, type ClientGroup } from '@/api/clientGroups';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Trash2, Plus, Filter, ArrowRightCircle } from 'lucide-react';

interface GroupRulesPanelProps {
  group: ClientGroup | null;
  rules: GroupRule[];
  loading?: boolean;
  onBindRule: (ruleId: number, ruleType: string, priority: number) => Promise<void>;
  onUnbindRule: (ruleId: number, ruleType: string) => Promise<void>;
  availableFilters?: Array<{ id: number; name: string; pattern: string; action: string }>;
  availableRewrites?: Array<{ id: number; name: string; domain: string }>;
}

export function GroupRulesPanel({
  group,
  rules,
  loading = false,
  onBindRule,
  onUnbindRule,
  availableFilters = [],
}: GroupRulesPanelProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState<{
    rule: GroupRule | null;
  }>({ rule: null });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedRules, setSelectedRules] = useState<Set<number>>(new Set());
  const [bindLoading, setBindLoading] = useState(false);

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Filter className="h-12 w-12 mb-4 opacity-50" />
        <p>请选择一个分组查看规则</p>
      </div>
    );
  }

  const handleAddRules = async () => {
    if (selectedRules.size === 0) return;

    setBindLoading(true);
    try {
      const promises = Array.from(selectedRules).map(async (ruleId) => {
        const filter = availableFilters.find((f) => f.id === ruleId);
        if (filter) {
          await onBindRule(ruleId, 'filter', 0);
        }
      });

      await Promise.all(promises);
      setSelectedRules(new Set());
      setShowAddDialog(false);
    } catch (error) {
      console.error('绑定规则失败:', error);
    } finally {
      setBindLoading(false);
    }
  };

  const handleUnbindRule = async (rule: GroupRule) => {
    setShowDeleteDialog({ rule });
  };

  const confirmUnbind = async () => {
    if (!showDeleteDialog.rule) return;

    try {
      await onUnbindRule(showDeleteDialog.rule.rule_id, showDeleteDialog.rule.rule_type);
      setShowDeleteDialog({ rule: null });
    } catch (error) {
      console.error('解绑规则失败:', error);
    }
  };

  const getRuleIcon = (ruleType: string) => {
    return ruleType === 'filter' ? (
      <Filter className="h-4 w-4" />
    ) : (
      <ArrowRightCircle className="h-4 w-4" />
    );
  };

  const getRuleActionBadge = (rule: GroupRule) => {
    if (rule.rule_type === 'filter' && rule.action) {
      return (
        <Badge variant={rule.action === 'block' ? 'destructive' : 'default'}>
          {rule.action === 'block' ? '阻断' : '允许'}
        </Badge>
      );
    }
    return <Badge variant="outline">重写</Badge>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{group.name} - 规则</h2>
          <p className="text-sm text-muted-foreground">
            共 {rules.length} 条规则
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          添加规则
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            加载中...
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Filter className="h-12 w-12 mb-4 opacity-50" />
            <p>暂无规则</p>
            <p className="text-sm mt-2">点击"添加规则"开始配置</p>
          </div>
        ) : (
          <div className="divide-y">
            {rules.map((rule, index) => (
              <div
                key={rule.rule_id}
                className="px-4 py-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-muted-foreground">
                        {index + 1}.
                      </span>
                      <span className="font-medium">{rule.name}</span>
                      {getRuleActionBadge(rule)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {getRuleIcon(rule.rule_type)}
                      {rule.rule_type === 'filter' ? (
                        <>
                          <span className="font-mono">{rule.pattern}</span>
                          <Badge variant="outline" className="text-xs">
                            优先级: {rule.priority}
                          </Badge>
                        </>
                      ) : (
                        <>
                          <span className="font-mono">{rule.domain}</span>
                          <ArrowRightCircle className="h-3 w-3" />
                          <span className="font-mono">{rule.replacement}</span>
                          <Badge variant="outline" className="text-xs">
                            优先级: {rule.priority}
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleUnbindRule(rule)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog open={!!showDeleteDialog.rule} onOpenChange={(open) => !open && setShowDeleteDialog({ rule: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解绑规则</AlertDialogTitle>
            <AlertDialogDescription>
              确定要解绑规则 "{showDeleteDialog.rule?.name}" 吗？
              <br />
              <br />
              解绑后，该规则将不再应用于分组内的所有客户端。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnbind} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认解绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 添加规则对话框 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加规则</DialogTitle>
            <DialogDescription>
              选择要绑定到分组的规则
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {availableFilters.map((filter) => (
              <label
                key={filter.id}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent transition-colors',
                  selectedRules.has(filter.id) && 'bg-accent border-primary'
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selectedRules.has(filter.id)}
                  onChange={(e) => {
                    const newSet = new Set(selectedRules);
                    if (e.target.checked) {
                      newSet.add(filter.id);
                    } else {
                      newSet.delete(filter.id);
                    }
                    setSelectedRules(newSet);
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{filter.name}</span>
                    <Badge variant={filter.action === 'block' ? 'destructive' : 'default'}>
                      {filter.action === 'block' ? '阻断' : '允许'}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {filter.pattern}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAddRules} disabled={bindLoading || selectedRules.size === 0}>
              {bindLoading ? '绑定中...' : `确认绑定 (${selectedRules.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
