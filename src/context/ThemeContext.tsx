import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark";
const THEME_PREFERENCE_KEY = "codex-theme-preference";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
  isDark: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    try {
      const stored = localStorage.getItem(THEME_PREFERENCE_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch {}
    return "light";
  });

  const applyThemeToDom = useCallback((newTheme: Theme) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (newTheme === "dark") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    }
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    applyThemeToDom(newTheme);
    try {
      localStorage.setItem(THEME_PREFERENCE_KEY, newTheme);
    } catch {}

    // Also dispatch event so SiteConfigContext or preview listeners can react
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("codex_theme_changed", { detail: { theme: newTheme } }));
    }
  }, [applyThemeToDom]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme, applyThemeToDom]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        isDark: theme === "dark",
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
