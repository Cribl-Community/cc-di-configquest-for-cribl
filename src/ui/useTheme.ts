// Light/dark theme, defaulting to dark. The choice persists to the KV store
// (the app has no localStorage in its iframe sandbox) and is reflected onto the
// document root as data-theme, which the CSS palette keys off.

import { useEffect, useState } from 'react';
import { getJSON, setJSON } from '../kv';

const THEME_KEY = 'ui:theme';

export type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('dark');

  // Load the persisted choice once (default dark until then — no flash for the 99%).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getJSON<Theme>(THEME_KEY);
      if (!cancelled && (stored === 'light' || stored === 'dark')) setTheme(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Briefly enable color transitions so a change cross-fades instead of hard-cutting.
  const crossfade = () => {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 240);
  };

  const setThemeTo = (next: Theme) => {
    crossfade();
    setTheme(() => {
      void setJSON(THEME_KEY, next);
      return next;
    });
  };

  const toggle = () => setThemeTo(theme === 'dark' ? 'light' : 'dark');

  return [theme, toggle, setThemeTo];
}
