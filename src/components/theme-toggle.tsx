"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
let sessionChoice: Theme | null = null;
function commitTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove("theme-switching")),
  );
}
export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  const choice = useRef(sessionChoice !== null);
  useEffect(() => {
    function apply(theme: Theme) {
      commitTheme(theme);
      setDark(theme === "reach-dark");
    }
    function sync() {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        /* Storage is optional. */
      }
      if (saved === "reach" || saved === "reach-dark") {
        sessionChoice = saved;
        choice.current = true;
        apply(saved);
      } else if (!choice.current) apply(DEFAULT_THEME);
      else setDark(document.documentElement.dataset.theme === "reach-dark");
    }
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        // A removed/cleared preference returns to the dark default.
        sessionChoice = null;
        choice.current = false;
        sync();
      }
    };
    sync();
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("storage", storage);
    };
  }, []);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-square reach-theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      onClick={() => {
        const next: Theme = dark ? "reach" : "reach-dark";
        sessionChoice = next;
        choice.current = true;
        commitTheme(next);
        setDark(next === "reach-dark");
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          /* Remains usable in memory. */
        }
      }}
    >
      {dark ? (
        <Sun size={20} aria-hidden="true" />
      ) : (
        <Moon size={20} aria-hidden="true" />
      )}
    </button>
  );
}
