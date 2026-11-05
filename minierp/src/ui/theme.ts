import { useCallback, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'minierp.theme';

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* storage may be blocked */
  }
  return 'system';
}

function apply(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* not saving the choice is fine */
    }
  }, []);
  return [choice, set];
}
