import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored;
    }
    return 'system';
  });

  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      setActualTheme(isDark ? 'dark' : 'light');
    };

    // System theme detection
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = () => {
      if (theme === 'system') {
        applyTheme(mediaQuery.matches);
      } else {
        applyTheme(theme === 'dark');
      }
    };

    // Apply immediately
    updateTheme();

    // Listen for system theme changes
    const handler = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        applyTheme(e.matches);
      }
    };
    mediaQuery.addEventListener('change', handler);

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
