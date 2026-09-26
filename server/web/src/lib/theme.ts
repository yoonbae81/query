/**
 * 테마(auto/light/dark) 저장·적용. 색상 토큰은 app.css의 :root(다크) / :root[data-theme="light"].
 * public/theme-init.js가 첫 페인트 전에 저장값을 data-theme에 반영하고, 이 모듈은 이후의 전환을 맡는다.
 */
export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE = "query_theme";
export const THEME_ORDER: readonly ThemeMode[] = ["auto", "light", "dark"];
export const THEME_LABEL: Record<ThemeMode, string> = { auto: "자동", light: "라이트", dark: "다크" };

const isMode = (v: string | null): v is ThemeMode => v === "auto" || v === "light" || v === "dark";

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "auto") return mode;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.getElementById("meta-theme-color")?.setAttribute("content", resolved === "light" ? "#f8fafc" : "#0b0f19");
}

export function getStoredThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE);
    return isMode(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE, mode);
  } catch {
    /* 저장할 수 없는 환경(프라이버시 모드 등)에서는 화면 전환만 적용한다 */
  }
  applyTheme(mode);
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]!;
}
