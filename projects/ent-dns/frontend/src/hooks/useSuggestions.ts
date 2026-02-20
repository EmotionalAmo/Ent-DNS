// Smart suggestions hook with debouncing and caching
// File: frontend/src/hooks/useSuggestions.ts
// Author: ui-duarte (Matías Duarte)
// Design Principle: Intentional - Reduce API calls with caching and debouncing

import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSuggestions, SuggestionResponse } from '@/api/queryLogAdvanced';

// Cache with 5-minute TTL
const CACHE_TTL_MS = 5 * 60 * 1000;
const suggestionCache = new Map<string, { data: string[]; timestamp: number }>();

export function useSuggestions(field: string) {
  const [prefix, setPrefix] = useState('');
  const [debouncedPrefix, setDebouncedPrefix] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout>();

  // 300ms debouncing
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (prefix.length < 2) {
      setDebouncedPrefix('');
      return;
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedPrefix(prefix);
    }, 300);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [prefix]);

  // Query with caching
  const cacheKey = `${field}:${debouncedPrefix}`;
  const cached = suggestionCache.get(cacheKey);
  const isCacheValid = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

  const {
    data: suggestions,
    isLoading,
    error,
  } = useQuery<SuggestionResponse>({
    queryKey: ['suggest', field, debouncedPrefix],
    queryFn: () => fetchSuggestions(field, debouncedPrefix),
    enabled: debouncedPrefix.length >= 2 && !isCacheValid,
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS * 2,
  });

  // Update cache when data arrives
  useEffect(() => {
    if (suggestions && !isCacheValid) {
      suggestionCache.set(cacheKey, {
        data: suggestions.suggestions || [],
        timestamp: Date.now(),
      });
    }
  }, [suggestions, isCacheValid, cacheKey]);

  // Return cached data while loading
  const displaySuggestions = isLoading && isCacheValid
    ? cached?.data || []
    : suggestions?.suggestions || [];

  const handlePrefixChange = useCallback((newPrefix: string) => {
    setPrefix(newPrefix);
  }, []);

  return {
    suggestions: displaySuggestions,
    isLoading: isLoading && !isCacheValid,
    error,
    handlePrefixChange,
  };
}

// Clear cache utility (for testing or forced refresh)
export function clearSuggestionCache() {
  suggestionCache.clear();
}

// Get cache size utility (for monitoring)
export function getSuggestionCacheSize(): number {
  return suggestionCache.size;
}
