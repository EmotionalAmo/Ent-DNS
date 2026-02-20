// Export Dialog Component with Custom Field Selection
// File: frontend/src/components/query-log/ExportDialog.tsx
// Author: ui-duarte (Matías Duarte)
// Design Principle: Graphic - Clear visual hierarchy + intentional choices

import { useState } from 'react';
import { Download, FileSpreadsheet, FileJson, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { Filter } from '@/components/query-log/FilterRow';
import { cn } from '@/lib/utils';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filters: Filter[];
  estimatedCount?: number;
}

const AVAILABLE_FIELDS = [
  { key: 'id', label: 'ID', default: false },
  { key: 'time', label: '时间', default: true },
  { key: 'client_ip', label: '客户端 IP', default: true },
  { key: 'client_name', label: '客户端名称', default: false },
  { key: 'question', label: '域名', default: true },
  { key: 'qtype', label: '查询类型', default: true },
  { key: 'answer', label: '响应', default: false },
  { key: 'status', label: '状态', default: true },
  { key: 'reason', label: '原因', default: false },
  { key: 'upstream', label: '上游服务器', default: false },
  { key: 'elapsed_ms', label: '响应时间 (ms)', default: false },
];

export function ExportDialog({ isOpen, onClose, filters, estimatedCount }: ExportDialogProps) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [selectedFields, setSelectedFields] = useState<string[]>(
    AVAILABLE_FIELDS.filter(f => f.default).map(f => f.key)
  );
  const [isFieldsExpanded, setIsFieldsExpanded] = useState(false);

  const handleFieldToggle = (field: string, checked: boolean) => {
    if (checked) {
      setSelectedFields([...selectedFields, field]);
    } else if (selectedFields.length > 1) {
      setSelectedFields(selectedFields.filter(f => f !== field));
    }
  };

  const handleSelectAllFields = () => {
    setSelectedFields(AVAILABLE_FIELDS.map(f => f.key));
  };

  const handleDeselectAllFields = () => {
    setSelectedFields(['time', 'question']); // Keep minimum required fields
  };

  const handleExport = () => {
    // Build export URL
    const baseUrl = '/api/v1/query-log/export';
    const params = new URLSearchParams({
      format: format,
      fields: selectedFields.join(','),
      limit: '10000',
    });

    // Include filters if any
    if (filters.length > 0) {
      params.append('filters_json', JSON.stringify(filters));
    }

    const url = `${baseUrl}?${params.toString()}`;

    // Trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = `query-logs.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onClose();
  };

  const formatLabel = format === 'csv' ? 'CSV (表格)' : 'JSON (数据)';
  // const FormatIcon = format === 'csv' ? FileSpreadsheet : FileJson;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download size={20} />
            导出查询日志
          </DialogTitle>
          <DialogDescription>
            选择导出格式和需要包含的字段
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Export format selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">导出格式</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('csv')}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg border-2 transition-all",
                  format === 'csv'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <FileSpreadsheet size={24} className={cn(
                  format === 'csv' ? "text-primary" : "text-muted-foreground"
                )} />
                <div className="text-left">
                  <div className="font-medium">CSV</div>
                  <div className="text-xs text-muted-foreground">Excel 可用</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat('json')}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg border-2 transition-all",
                  format === 'json'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <FileJson size={24} className={cn(
                  format === 'json' ? "text-primary" : "text-muted-foreground"
                )} />
                <div className="text-left">
                  <div className="font-medium">JSON</div>
                  <div className="text-xs text-muted-foreground">程序处理</div>
                </div>
              </button>
            </div>
          </div>

          {/* Field selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium">
                导出字段
                <span className="text-muted-foreground ml-2">
                  ({selectedFields.length} / {AVAILABLE_FIELDS.length})
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAllFields}
                  disabled={selectedFields.length === AVAILABLE_FIELDS.length}
                  className="text-xs"
                >
                  全选
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeselectAllFields}
                  disabled={selectedFields.length <= 2}
                  className="text-xs"
                >
                  清除
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsFieldsExpanded(!isFieldsExpanded)}
                  className="text-xs gap-1"
                >
                  {isFieldsExpanded ? (
                    <>
                      <ChevronUp size={14} />
                      收起
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      展开
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className={cn(
              "border rounded-md overflow-hidden transition-all",
              !isFieldsExpanded && "max-h-64 overflow-y-auto"
            )}>
              <div className="grid grid-cols-2 gap-0 divide-x divide-border">
                {/* Left column */}
                <div className="divide-y">
                  {AVAILABLE_FIELDS.slice(0, Math.ceil(AVAILABLE_FIELDS.length / 2)).map(field => (
                    <label
                      key={field.key}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors",
                        selectedFields.includes(field.key) && "bg-muted/30"
                      )}
                    >
                      <Checkbox
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={(checked) => handleFieldToggle(field.key, checked as boolean)}
                      />
                      <span className="text-sm flex-1">{field.label}</span>
                    </label>
                  ))}
                </div>

                {/* Right column */}
                <div className="divide-y">
                  {AVAILABLE_FIELDS.slice(Math.ceil(AVAILABLE_FIELDS.length / 2)).map(field => (
                    <label
                      key={field.key}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors",
                        selectedFields.includes(field.key) && "bg-muted/30"
                      )}
                    >
                      <Checkbox
                        checked={selectedFields.includes(field.key)}
                        onCheckedChange={(checked) => handleFieldToggle(field.key, checked as boolean)}
                      />
                      <span className="text-sm flex-1">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Export statistics */}
          <div className="bg-muted/50 rounded-md p-4 space-y-2">
            <div className="flex items-start gap-2">
              <Info size={16} className="text-primary mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <div>
                  <span className="font-medium">导出条件：</span>
                  {filters.length > 0
                    ? `${filters.length} 个过滤器`
                    : '无过滤条件（导出全部）'}
                </div>
                {estimatedCount && (
                  <div>
                    <span className="font-medium">预计记录数：</span>
                    {estimatedCount.toLocaleString('zh-CN')}
                  </div>
                )}
                <div>
                  <span className="font-medium">导出限制：</span>
                  最多 10,000 条记录
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleExport}
            disabled={selectedFields.length === 0}
            className="gap-2"
          >
            <Download size={16} />
            导出 {formatLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
