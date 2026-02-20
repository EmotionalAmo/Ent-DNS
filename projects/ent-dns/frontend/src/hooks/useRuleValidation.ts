import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';

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

// 防抖函数：延迟执行，返回取消函数
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => () => void {
  let timeout: number | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);

    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait) as unknown as number;

    // 返回取消函数
    return () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
  };
}

// 验证规则
async function validateRule(ruleType: 'filter' | 'rewrite', rule: string): Promise<RuleValidationResult> {
  const response = await apiClient.post('/api/v1/rules/validate', {
    type: ruleType,
    rule: rule.trim(),
  });
  return response.data;
}

// 规则验证 Hook
export function useRuleValidation() {
  const queryClient = useQueryClient();

  // 使用 React Query 的 mutation 来实现验证，利用其内置缓存
  const mutation = useMutation({
    mutationFn: async ({ ruleType, rule }: { ruleType: 'filter' | 'rewrite'; rule: string }) => {
      // 使用 queryKey 缓存结果
      const cacheKey = ['rule-validation', ruleType, rule];

      // 先检查缓存
      const cached = queryClient.getQueryData<RuleValidationResult>(cacheKey);
      if (cached) {
        return cached;
      }

      // 缓存未命中，调用 API
      const result = await validateRule(ruleType, rule);

      // 缓存结果（5 分钟）
      queryClient.setQueryData(cacheKey, result);

      return result;
    },
  });

  return {
    validate: mutation.mutate,
    result: mutation.data,
    isLoading: mutation.isPending,
    error: mutation.error,
  };
}
