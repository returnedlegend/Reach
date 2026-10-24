export const THEME_STORAGE_KEY = "reach-theme";
// Runs before content paints. Only a non-sensitive appearance preference is read.
export const DEFAULT_THEME = "reach-dark" as const;
export type Theme = "reach" | "reach-dark";

export function resolveTheme(saved: string | null): Theme {
  return saved === "reach" || saved === "reach-dark" ? saved : DEFAULT_THEME;
}

export const themeBootstrap = `(function(){var t;try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}document.documentElement.dataset.theme=(t==='reach'||t==='reach-dark')?t:'${DEFAULT_THEME}'})()`;
