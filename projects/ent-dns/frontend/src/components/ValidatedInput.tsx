import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// 验证域名
async function validateDomain(domain: string): Promise<{ valid: boolean; error?: any }> {
  try {
    const result = await apiClient.post('/api/v1/rules/validate', {
      type: 'filter',
      rule: domain.trim(),
    });
    return result.data;
  } catch (error) {
    return { valid: false, error };
  }
}

// 验证 IP
async function validateIp(ip: string): Promise<{ valid: boolean; error?: any }> {
  try {
    const result = await apiClient.post('/api/v1/rules/validate', {
      type: 'rewrite',
      rule: `test.local -> ${ip.trim()}`,
    });
    return result.data;
  } catch (error) {
    return { valid: false, error };
  }
}

interface ValidatedInputProps {
  value: string;
  onChange: (value: string) => void;
  type: 'domain' | 'ip';
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  error?: string;
}

export function ValidatedInput({
  value,
  onChange,
  type,
  label,
  placeholder,
  disabled = false,
  className = '',
  id,
  name,
  error: externalError,
}: ValidatedInputProps) {
  const queryClient = useQueryClient();

  const [localValid, setLocalValid] = useState<boolean | null>(null);
  const [localError, setLocalError] = useState<any>(null);
  const debouncedValidateRef = useRef<(() => void) | null>(null);

  // 创建防抖验证函数
  useEffect(() => {
    const validateFn = () => {
      if (!value.trim()) {
        setLocalValid(null);
        setLocalError(null);
        return;
      }

      const cacheKey = ['validation', type, value];
      const cached = queryClient.getQueryData(cacheKey);
      if (cached) {
        setLocalValid((cached as any).valid);
        setLocalError((cached as any).error);
        return;
      }

      const promise = type === 'domain' ? validateDomain(value) : validateIp(value);

      promise.then((result) => {
        setLocalValid(result.valid);
        setLocalError(result.error);
        queryClient.setQueryData(cacheKey, result);
      });
    };

    debouncedValidateRef.current = () => {
      const timeout = setTimeout(validateFn, 500);
      return () => clearTimeout(timeout);
    };

    return () => {
      if (debouncedValidateRef.current) {
        debouncedValidateRef.current();
      }
    };
  }, [type, queryClient]);

  // 触发验证
  useEffect(() => {
    if (debouncedValidateRef.current) {
      debouncedValidateRef.current();
    }
  }, [value]);

  const isValid = localValid;
  const validationError = localError;
  const hasError = !!validationError || !!externalError;
  const displayError = validationError || externalError;

  const getStatusColor = () => {
    if (isValid === true) return 'border-green-300';
    if (isValid === false) return 'border-red-300';
    return 'border-gray-300';
  };

  const getStatusIcon = () => {
    if (isValid === true) return <CheckCircle2 size={16} className="text-green-500" />;
    if (isValid === false) return <XCircle size={16} className="text-red-500" />;
    return null;
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            pr-9 font-mono transition-colors
            ${getStatusColor()}
            ${hasError ? 'border-red-500' : ''}
          `}
        />
        {getStatusIcon() && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
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
            ) : displayError?.message ? (
              <div className="space-y-1">
                <div className="font-medium">{displayError.message}</div>
                {displayError.suggestion && (
                  <div className="text-xs opacity-80">建议: {displayError.suggestion}</div>
                )}
              </div>
            ) : (
              <span>格式错误</span>
            )}
          </div>
        </div>
      )}

      {/* 有效提示 */}
      {isValid === true && value.trim() && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 size={16} />
          <span>格式正确</span>
        </div>
      )}
    </div>
  );
}
