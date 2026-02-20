// Autocomplete Input Component with Smart Suggestions
// File: frontend/src/components/query-log/AutocompleteInput.tsx
// Author: ui-duarte (Matías Duarte)
// Design Principle: Graphic - Visual feedback + intentional design

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useSuggestions } from '@/hooks/useSuggestions';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface AutocompleteInputProps {
  value: string | null | undefined;
  field: 'question' | 'client_ip' | 'client_name' | 'upstream';
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function AutocompleteInput({
  value,
  field,
  onChange,
  placeholder = '输入值...',
  className,
  disabled = false,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { suggestions, isLoading } = useSuggestions(field);

  // Sync external value changes
  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value || '');
    }
  }, [value]);

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    onChange(newValue);
    setIsOpen(newValue.length >= 2);
    setSelectedIndex(-1);
  };

  const handleSelect = (suggestion: string) => {
    setInputValue(suggestion);
    onChange(suggestion);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleClear = () => {
    setInputValue('');
    onChange('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && isOpen) {
      const selectedElement = document.getElementById(`suggestion-${selectedIndex}`);
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, isOpen]);

  const fieldLabel = {
    question: '域名',
    client_ip: '客户端 IP',
    client_name: '客户端名称',
    upstream: '上游服务器',
  }[field];

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {/* Input with clear button */}
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsOpen(inputValue.length >= 2)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-8"
        />

        {/* Clear button */}
        {inputValue && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Suggestions dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {/* Field header */}
          <div className="px-3 py-2 text-xs text-muted-foreground border-b bg-muted/50">
            {fieldLabel}建议（基于最近 30 天查询）
          </div>

          {/* Suggestion list */}
          <ul className="py-1">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                id={`suggestion-${index}`}
                onClick={() => handleSelect(suggestion)}
                className={cn(
                  'px-3 py-2 cursor-pointer text-sm transition-colors',
                  index === selectedIndex && 'bg-accent',
                  index !== selectedIndex && 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-foreground">{suggestion}</span>
                  {field === 'question' && (
                    <span className="text-xs text-muted-foreground">域名</span>
                  )}
                  {field === 'client_ip' && (
                    <span className="text-xs text-muted-foreground">IP</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* Loading indicator */}
          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t">
              加载中...
            </div>
          )}

          {/* Footer hint */}
          {!isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
              {suggestions.length} 条结果，使用上下键导航，回车选择
            </div>
          )}
        </div>
      )}

      {/* No suggestions message */}
      {isOpen && inputValue.length >= 2 && !isLoading && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-lg px-3 py-2 text-sm text-muted-foreground">
          暂无建议，请输入更多字符
        </div>
      )}
    </div>
  );
}
