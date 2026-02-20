import { useState } from 'react';
import { type ClientGroup } from '@/api/clientGroups';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Plus, Settings, Trash2 } from 'lucide-react';

interface GroupTreeProps {
  groups: ClientGroup[];
  selectedGroupId: number | null;
  onSelectGroup: (groupId: number | null) => void;
  onCreateGroup: () => void;
  onEditGroup: (group: ClientGroup) => void;
  onDeleteGroup: (group: ClientGroup) => void;
}

export function GroupTree({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
}: GroupTreeProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">客户端分组</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* "全部" 选项 */}
        <button
          className={cn(
            'w-full text-left px-3 py-2 rounded-md flex items-center justify-between hover:bg-accent transition-colors',
            selectedGroupId === null ? 'bg-accent' : ''
          )}
          onClick={() => onSelectGroup(null)}
        >
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <span className="font-medium">全部</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {groups.reduce((sum, g) => sum + g.client_count, 0)}
          </span>
        </button>

        {/* 分组列表 */}
        {groups.map((group) => (
          <ContextMenu key={group.id}>
            <ContextMenuTrigger asChild>
              <button
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md flex items-center justify-between hover:bg-accent transition-colors',
                  selectedGroupId === group.id ? 'bg-accent' : ''
                )}
                onClick={() => onSelectGroup(group.id)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="font-medium truncate">{group.name}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{group.client_count}</span>
                  <span className="text-[10px] opacity-70">
                    {group.rule_count} 条规则
                  </span>
                </div>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEditGroup(group)}>
                <Settings className="mr-2 h-4 w-4" />
                编辑
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onDeleteGroup(group)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <div className="p-3 border-t">
        <Button onClick={onCreateGroup} className="w-full" variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          新建分组
        </Button>
      </div>
    </div>
  );
}
