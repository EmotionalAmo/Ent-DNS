import { useState } from 'react';
import { type ClientGroupMember } from '@/api/clientGroups';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Monitor, Clock, Database } from 'lucide-react';

interface ClientListProps {
  clients: ClientGroupMember[];
  selectedClientIds: string[];
  loading?: boolean;
  onToggleClient: (clientId: string) => void;
  onToggleAll: () => void;
  onMoveToGroup?: (clientIds: string[]) => void;
  onEditGroup?: (clientId: string) => void;
  onRemoveFromGroup?: (clientIds: string[]) => void;
}

export function ClientList({
  clients,
  selectedClientIds,
  loading = false,
  onToggleClient,
  onToggleAll,
  onMoveToGroup,
  onEditGroup,
  onRemoveFromGroup,
}: ClientListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const allSelected = clients.length > 0 && selectedClientIds.length === clients.length;

  const filteredClients = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.mac.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatLastSeen = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    return `${diffDays} 天前`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* 搜索框 */}
      <div className="p-4 border-b">
        <Input
          placeholder="搜索设备名、IP 或 MAC..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />
      </div>

      {/* 批量操作栏 */}
      {selectedClientIds.length > 0 && (
        <div className="px-4 py-2 bg-accent border-b flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            已选 {selectedClientIds.length} 台
          </span>
          <div className="flex gap-2">
            {onMoveToGroup && (
              <Button
                size="sm"
                variant="default"
                onClick={() => onMoveToGroup(selectedClientIds)}
              >
                移动到组
              </Button>
            )}
            {onEditGroup && selectedClientIds.length === 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEditGroup(selectedClientIds[0])}
              >
                编辑
              </Button>
            )}
            {onRemoveFromGroup && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onRemoveFromGroup(selectedClientIds)}
              >
                从组移除
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 客户端列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            加载中...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Monitor className="h-12 w-12 mb-4 opacity-50" />
            <p>暂无客户端</p>
          </div>
        ) : (
          <div className="divide-y">
            {/* 表头 */}
            <div className="px-4 py-2 bg-muted/50 text-sm font-medium flex items-center">
              <div className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="全选"
                />
              </div>
              <div className="flex-1 grid grid-cols-12 gap-4">
                <div className="col-span-4">设备名称</div>
                <div className="col-span-2">IP 地址</div>
                <div className="col-span-2">MAC 地址</div>
                <div className="col-span-2">所属分组</div>
                <div className="col-span-2">最后在线</div>
              </div>
            </div>

            {/* 客户端行 */}
            {filteredClients.map((client) => (
              <div
                key={client.id}
                className={cn(
                  'px-4 py-3 hover:bg-accent transition-colors flex items-center',
                  selectedClientIds.includes(client.id) && 'bg-accent/50'
                )}
              >
                <div className="w-10">
                  <Checkbox
                    checked={selectedClientIds.includes(client.id)}
                    onCheckedChange={() => onToggleClient(client.id)}
                    aria-label={`选择 ${client.name}`}
                  />
                </div>
                <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                  {/* 设备名称 */}
                  <div className="col-span-4">
                    <div className="font-medium">{client.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                      <Database className="h-3 w-3" />
                      {client.query_count.toLocaleString()} 查询
                    </div>
                  </div>

                  {/* IP 地址 */}
                  <div className="col-span-2 font-mono text-sm">{client.ip}</div>

                  {/* MAC 地址 */}
                  <div className="col-span-2 font-mono text-sm">{client.mac}</div>

                  {/* 所属分组 */}
                  <div className="col-span-2">
                    {client.group_names.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {client.group_names.map((name) => (
                          <Badge key={name} variant="secondary" className="text-xs">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">未分组</span>
                    )}
                  </div>

                  {/* 最后在线 */}
                  <div className="col-span-2 text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatLastSeen(client.last_seen)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
