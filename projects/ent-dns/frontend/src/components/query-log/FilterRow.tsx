import { Clock, Globe, Hash, Zap, Shield, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AutocompleteInput } from './AutocompleteInput';

export interface Filter {
  field: string;
  operator: string;
  value: any;
}

export interface FilterRowProps {
  filter: Filter;
  index: number;
  onChange: (index: number, filter: Filter) => void;
  onRemove: (index: number) => void;
}

// 字段定义
const FIELD_OPTIONS = [
  { value: 'time', label: '时间', icon: Clock },
  { value: 'client_ip', label: '客户端 IP', icon: Globe },
  { value: 'client_name', label: '客户端名称', icon: Globe },
  { value: 'question', label: '域名', icon: Globe },
  { value: 'qtype', label: '查询类型', icon: Hash },
  { value: 'status', label: '状态', icon: Zap },
  { value: 'reason', label: '原因', icon: Shield },
  { value: 'upstream', label: '上游', icon: Globe },
  { value: 'elapsed_ms', label: '响应时间', icon: Clock },
];

// 根据字段获取可用操作符
function getOperatorsForField(field: string) {
  switch (field) {
    case 'time':
      return [
        { value: 'relative', label: '相对时间' },
        { value: 'between', label: '介于' },
        { value: 'gt', label: '晚于' },
        { value: 'lt', label: '早于' },
      ];
    case 'client_ip':
      return [
        { value: 'eq', label: '等于' },
        { value: 'like', label: '模糊匹配' },
      ];
    case 'question':
      return [
        { value: 'eq', label: '等于' },
        { value: 'like', label: '包含' },
      ];
    case 'qtype':
    case 'status':
      return [
        { value: 'eq', label: '等于' },
        { value: 'in', label: '包含多个' },
      ];
    case 'elapsed_ms':
      return [
        { value: 'gt', label: '大于' },
        { value: 'lt', label: '小于' },
        { value: 'eq', label: '等于' },
      ];
    default:
      return [{ value: 'eq', label: '等于' }, { value: 'like', label: '包含' }];
  }
}

// 值输入组件
function ValueInput({ field, operator, value, onChange }: { field: string; operator: string; value: any; onChange: (v: any) => void }) {
  // 相对时间选择器
  if (field === 'time' && operator === 'relative') {
    const RELATIVE_OPTIONS = [
      { value: '-1h', label: '最近 1 小时' },
      { value: '-6h', label: '最近 6 小时' },
      { value: '-24h', label: '最近 24 小时' },
      { value: '-7d', label: '最近 7 天' },
      { value: '-30d', label: '最近 30 天' },
    ];
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="选择时间范围" />
        </SelectTrigger>
        <SelectContent>
          {RELATIVE_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 状态枚举
  if (field === 'status') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="allowed">已允许</SelectItem>
          <SelectItem value="blocked">已拦截</SelectItem>
          <SelectItem value="cached">已缓存</SelectItem>
          <SelectItem value="error">错误</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  // 查询类型枚举
  if (field === 'qtype') {
    const QTYPE_OPTIONS = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'ANY', 'SOA', 'PTR'];
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QTYPE_OPTIONS.map(q => (
            <SelectItem key={q} value={q}>{q}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 数值输入
  if (field === 'elapsed_ms') {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={value || ''}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="w-24 h-9"
          placeholder="ms"
        />
        <span className="text-xs text-muted-foreground">ms</span>
      </div>
    );
  }

  // 默认文本输入（支持自动补全）
  const autocompleteField = field as 'question' | 'client_ip' | 'client_name' | 'upstream';
  const shouldAutocomplete = ['question', 'client_ip', 'client_name', 'upstream'].includes(field);

  if (shouldAutocomplete) {
    return (
      <AutocompleteInput
        field={autocompleteField}
        value={value}
        onChange={onChange}
        placeholder="输入值..."
        className="flex-1 min-w-[200px]"
      />
    );
  }

  return (
    <Input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 h-9 min-w-[200px]"
      placeholder="输入值..."
    />
  );
}

export function FilterRow({ filter, index, onChange, onRemove }: FilterRowProps) {
  return (
    <div className="flex gap-2 items-start">
      {/* 逻辑连接符（除了第一行） */}
      {index > 0 && (
        <span className="text-xs text-muted-foreground pt-2 w-8 text-center">AND</span>
      )}

      {/* 字段选择 */}
      <Select value={filter.field} onValueChange={(v) => onChange(index, { ...filter, field: v })}>
        <SelectTrigger className="w-36 h-9">
          <SelectValue placeholder="字段" />
        </SelectTrigger>
        <SelectContent>
          {FIELD_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex items-center gap-2">
                <opt.icon size={14} />
                {opt.label}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 操作符选择 */}
      <Select value={filter.operator} onValueChange={(v) => onChange(index, { ...filter, operator: v })}>
        <SelectTrigger className="w-28 h-9">
          <SelectValue placeholder="条件" />
        </SelectTrigger>
        <SelectContent>
          {getOperatorsForField(filter.field).map(op => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 值输入 */}
      <ValueInput
        field={filter.field}
        operator={filter.operator}
        value={filter.value}
        onChange={(v) => onChange(index, { ...filter, value: v })}
      />

      {/* 删除按钮 */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(index)}
        className="h-9 w-9 text-muted-foreground hover:text-destructive"
      >
        <X size={14} />
      </Button>
    </div>
  );
}

// 快捷过滤器
export function QuickFilters({ onApply }: { onApply: (filters: Filter[]) => void }) {
  const QUICK_FILTERS = [
    {
      name: '最近拦截',
      icon: Shield,
      color: 'text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-950 dark:hover:bg-red-900',
      filters: [
        { field: 'status', operator: 'eq', value: 'blocked' },
        { field: 'time', operator: 'relative', value: '-24h' },
      ],
    },
    {
      name: '慢查询 (>100ms)',
      icon: Clock,
      color: 'text-orange-600 bg-orange-50 hover:bg-orange-100 dark:text-orange-400 dark:bg-orange-950 dark:hover:bg-orange-900',
      filters: [
        { field: 'elapsed_ms', operator: 'gt', value: 100 },
        { field: 'time', operator: 'relative', value: '-24h' },
      ],
    },
    {
      name: '错误查询',
      icon: Zap,
      color: 'text-yellow-600 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-950 dark:hover:bg-yellow-900',
      filters: [
        { field: 'status', operator: 'eq', value: 'error' },
        { field: 'time', operator: 'relative', value: '-24h' },
      ],
    },
    {
      name: 'A 记录查询',
      icon: Globe,
      color: 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-950 dark:hover:bg-blue-900',
      filters: [
        { field: 'qtype', operator: 'eq', value: 'A' },
        { field: 'time', operator: 'relative', value: '-1h' },
      ],
    },
  ];

  return (
    <div className="flex gap-2 flex-wrap mb-4">
      {QUICK_FILTERS.map(qf => {
        const Icon = qf.icon;
        return (
          <button
            key={qf.name}
            onClick={() => onApply(qf.filters)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:shadow-sm",
              qf.color
            )}
          >
            <Icon size={14} />
            {qf.name}
          </button>
        );
      })}
    </div>
  );
}
