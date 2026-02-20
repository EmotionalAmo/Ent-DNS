// Template Manager Component
// File: frontend/src/components/query-log/TemplateManager.tsx
// Author: ui-duarte (Matías Duarte)
// Design Principle: Bold - Clear visual hierarchy + intentional actions

import { useState, useEffect } from 'react';
import { FolderOpen, Save, Trash2, Copy, Plus, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryLogAdvancedApi, Template, Filter } from '@/api/queryLogAdvanced';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface TemplateManagerProps {
  currentFilters: Filter[];
  onLoadTemplate: (filters: Filter[]) => void;
}

export function TemplateManager({ currentFilters, onLoadTemplate }: TemplateManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['query-log-templates'],
    queryFn: () => queryLogAdvancedApi.templates.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<Template, 'id' | 'createdAt' | 'createdBy'>) =>
      queryLogAdvancedApi.templates.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-log-templates'] });
      setSaveDialogOpen(false);
      setTemplateName('');
      setIsPublic(false);
      toast({
        title: '模板已保存',
        description: '查询模板已成功保存',
      });
    },
    onError: (error: any) => {
      toast({
        title: '保存失败',
        description: error.response?.data?.message || '未知错误',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => queryLogAdvancedApi.templates.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-log-templates'] });
      toast({
        title: '模板已删除',
        description: '查询模板已成功删除',
      });
    },
    onError: (error: any) => {
      toast({
        title: '删除失败',
        description: error.response?.data?.message || '未知错误',
        variant: 'destructive',
      });
    },
  });

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      toast({
        title: '请输入模板名称',
        description: '模板名称不能为空',
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate({
      name: templateName,
      filters: currentFilters,
      logic: 'AND',
      isPublic,
    });
  };

  const handleLoadTemplate = (template: Template) => {
    onLoadTemplate(template.filters);
    setIsOpen(false);
    toast({
      title: '模板已加载',
      description: `已加载模板：${template.name}`,
    });
  };

  const handleDuplicateTemplate = (e: React.MouseEvent, template: Template) => {
    e.stopPropagation();
    const newFilters = [...template.filters];
    onLoadTemplate(newFilters);
    toast({
      title: '模板已复制',
      description: `已复制模板：${template.name}`,
    });
  };

  const handleDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('确定要删除这个模板吗？')) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <>
      {/* Template selector popover */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <FolderOpen size={14} />
            模板
            <span className="text-xs text-muted-foreground">({templates.length})</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 max-h-[500px] overflow-y-auto p-0">
          {/* Header */}
          <div className="sticky top-0 bg-background border-b p-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">查询模板</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSaveDialogOpen(true)}
                className="gap-1"
              >
                <Plus size={14} />
                新建
              </Button>
            </div>
          </div>

          {/* Template list */}
          <div className="p-2">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : templates.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                暂无模板，点击"新建"创建第一个模板
              </div>
            ) : (
              <div className="space-y-1">
                {templates.map((template) => {
                  const isExpanded = expandedId === template.id;
                  return (
                    <div
                      key={template.id}
                      className="border rounded-md overflow-hidden hover:border-accent transition-colors"
                    >
                      {/* Template header */}
                      <button
                        onClick={() => {
                          setExpandedId(isExpanded ? null : template.id);
                        }}
                        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {isExpanded ? (
                            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate">{template.name}</span>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{template.filters.length} 个条件</span>
                              {template.isPublic && (
                                <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                  公开
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadTemplate(template);
                            }}
                            title="加载模板"
                          >
                            <FolderOpen size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => handleDuplicateTemplate(e, template)}
                            title="复制模板"
                          >
                            <Copy size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => handleDeleteTemplate(e, template.id)}
                            title="删除模板"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-3 py-2 bg-muted/30 border-t text-xs space-y-1">
                          <div className="text-muted-foreground">创建者：{template.createdBy}</div>
                          <div className="text-muted-foreground">
                            创建时间：{new Date(template.createdAt).toLocaleString('zh-CN')}
                          </div>
                          <div className="mt-2">
                            <div className="font-medium mb-1">过滤器：</div>
                            <ul className="space-y-0.5 pl-2">
                              {template.filters.map((filter, index) => (
                                <li key={index} className="text-muted-foreground">
                                  {filter.field} {filter.operator} {String(filter.value).substring(0, 30)}
                                  {String(filter.value).length > 30 && '...'}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Save template dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Template name input */}
            <div>
              <label htmlFor="template-name" className="text-sm font-medium mb-2 block">
                模板名称
              </label>
              <Input
                id="template-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="例如：最近拦截的广告域名"
                autoFocus
              />
            </div>

            {/* Public checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-public"
                checked={isPublic}
                onCheckedChange={(checked) => setIsPublic(checked as boolean)}
              />
              <label htmlFor="is-public" className="text-sm">
                公开模板（所有用户可见）
              </label>
            </div>

            {/* Filters preview */}
            {currentFilters.length > 0 && (
              <div className="bg-muted/50 rounded-md p-3">
                <div className="text-xs text-muted-foreground mb-2">当前过滤器：</div>
                <div className="space-y-1">
                  {currentFilters.map((filter, index) => (
                    <div key={index} className="text-xs">
                      {filter.field} {filter.operator} {String(filter.value)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warning when no filters */}
            {currentFilters.length === 0 && (
              <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950 rounded-md p-3">
                当前没有过滤器，建议先添加至少一个过滤条件。
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={!templateName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>保存中...</>
              ) : (
                <>
                  <Save size={14} className="mr-1" />
                  保存模板
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
