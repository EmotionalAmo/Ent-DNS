import { useState } from 'react';
import { Plus, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FilterRow, Filter, QuickFilters } from './FilterRow';

interface FilterBuilderProps {
  onSearch: (filters: Filter[]) => void;
  isLoading?: boolean;
}

export function FilterBuilder({ onSearch, isLoading }: FilterBuilderProps) {
  const [filters, setFilters] = useState<Filter[]>([
    { field: 'time', operator: 'relative', value: '-24h' },
  ]);

  const addFilter = () => {
    setFilters([...filters, { field: 'question', operator: 'like', value: '' }]);
  };

  const updateFilter = (index: number, filter: Filter) => {
    const newFilters = [...filters];
    newFilters[index] = filter;
    setFilters(newFilters);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const handleSearch = () => {
    // 移除空值的过滤器
    const validFilters = filters.filter(f => {
      if (f.value === null || f.value === undefined || f.value === '') return false;
      if (Array.isArray(f.value) && f.value.length === 0) return false;
      return true;
    });
    onSearch(validFilters);
  };

  const handleReset = () => {
    setFilters([{ field: 'time', operator: 'relative', value: '-24h' }]);
  };

  const applyQuickFilter = (quickFilters: Filter[]) => {
    setFilters(quickFilters);
    onSearch(quickFilters);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus size={18} />
          高级过滤器
        </CardTitle>
        <CardDescription>组合多个条件进行精准查询</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 快捷过滤器 */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">快捷筛选</label>
          <QuickFilters onApply={applyQuickFilter} />
        </div>

        {/* 过滤器列表 */}
        <div className="space-y-2">
          {filters.map((filter, index) => (
            <FilterRow
              key={index}
              filter={filter}
              index={index}
              onChange={updateFilter}
              onRemove={removeFilter}
            />
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            onClick={addFilter}
            variant="outline"
            size="sm"
            disabled={filters.length >= 10}
          >
            <Plus size={14} className="mr-1" />
            添加条件
          </Button>

          <div className="flex-1" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
          >
            <RotateCcw size={14} className="mr-1" />
            重置
          </Button>

          <Button
            type="button"
            onClick={handleSearch}
            size="sm"
            disabled={isLoading}
          >
            <Play size={14} className="mr-1" />
            搜索
          </Button>
        </div>

        {/* 提示信息 */}
        {filters.length >= 10 && (
          <p className="text-xs text-muted-foreground">
            已达到最大过滤器数量（10 个），建议使用查询模板或简化条件。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
