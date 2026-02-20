import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export type ValidationError = {
  code: string;
  message: string;
  field: string;
  line?: number;
  column?: number;
  suggestion?: string;
};

export type RuleValidationResult = {
  valid: boolean;
  error?: ValidationError;
};

interface RuleInputProps {
  value: string;
  onChange: (value: string) => void;
  ruleType: 'filter' | 'rewrite';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  rows?: number;
  id?: string;
  name?: string;
  error?: string;
}

export function RuleInput({
  value,
  onChange,
  ruleType,
  placeholder = '输入规则内容',
  disabled = false,
  className = '',
  rows = 3,
  id,
  name,
  error: externalError,
}: RuleInputProps) {
  const queryClient = useQueryClient();
  const [localResult, setLocalResult] = useState<RuleValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  // 验证规则
  const validateRule = async (ruleValue: string) => {
    if (!ruleValue.trim()) {
      setLocalResult(null);
      return;
    }

    // 检查缓存
    const cacheKey = ['rule-validation', ruleType, ruleValue];
    const cached = queryClient.getQueryData<RuleValidationResult>(cacheKey);
    if (cached) {
      setLocalResult(cached);
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/api/v1/rules/validate', {
        type: ruleType,
        rule: ruleValue.trim(),
      });
      const result = response.data;
      setLocalResult(result);
      // 缓存结果
      queryClient.setQueryData(cacheKey, result);
    } catch (error) {
      // 静默失败，不显示错误
      console.error('Validation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 防抖验证
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      validateRule(value);
      timeoutRef.current = null;
    }, 500);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, ruleType]);

  const isValid = localResult?.valid ?? null;
  const validationMessage = localResult?.error;
  const hasError = !!validationMessage || !!externalError;
  const displayError = validationMessage || externalError;

  const getStatusColor = () => {
    if (isLoading) return 'border-blue-300';
    if (isValid === true) return 'border-green-300';
    if (isValid === false) return 'border-red-300';
    return 'border-gray-300';
  };

  const getStatusIcon = () => {
    if (isLoading) return <Loader2 size={16} className="animate-spin text-blue-500" />;
    if (isValid === true) return <CheckCircle2 size={16} className="text-green-500" />;
    if (isValid === false) return <XCircle size={16} className="text-red-500" />;
    return null;
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative">
        <textarea
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className={`
            w-full rounded-md border-2 bg-background px-3 py-2 text-sm
            focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed
            font-mono transition-colors
            ${getStatusColor()}
            ${hasError ? 'border-red-500' : ''}
          `}
        />
        {getStatusIcon() && (
          <div className="absolute right-3 top-3">
            {getStatusIcon()}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {hasError && displayError && (
        <div className="flex items-start gap-2 text-sm text-red-600">
          <XCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            {typeof displayError === 'string' ? (
              <span>{displayError}</span>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">{displayError?.message}</div>
                {displayError?.suggestion && (
                  <div className="text-xs opacity-80">
                    建议: {displayError.suggestion}
                  </div>
                )}
                {displayError?.code && (
                  <div className="text-xs opacity-60">
                    错误码: {displayError.code}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 有效规则提示 */}
      {isValid === true && value.trim() && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 size={16} />
          <span>规则语法正确</span>
        </div>
      )}

      {/* 加载提示 */}
      {isLoading && value.trim() && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Loader2 size={16} className="animate-spin" />
          <span>验证中...</span>
        </div>
      )}
    </div>
  );
}
