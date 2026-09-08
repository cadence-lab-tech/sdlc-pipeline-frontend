import {createContext, useContext, useEffect, useState} from 'react';

// Тема живёт классом на <html> — так её видит и Tailwind (@custom-variant dark),
// и портальные слои Radix, которые рисуются вне дерева приложения.
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'sdlc.theme';

const ThemeContext = createContext<{theme: Theme; setTheme: (t: Theme) => void}>({
  theme: 'system',
  setTheme: () => {},
});

function stored(): Theme {
  const value = localStorage.getItem(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

// resolve превращает выбор в реальную тему: «системная» спрашивает браузер.
function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('dark', resolve(theme) === 'dark');
    apply();
    if (theme !== 'system') return;
    // Системная тема может смениться, пока страница открыта.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const choose = (next: Theme) => {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    setTheme(next);
  };

  return <ThemeContext.Provider value={{theme, setTheme: choose}}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
