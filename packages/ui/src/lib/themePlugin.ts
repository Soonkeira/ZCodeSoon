import { readSafeLocalStorage, writeSafeLocalStorage } from "./browserEnvironment.js";

const THEME_PLUGIN_STYLE_ELEMENT_ID = "zcode-theme-plugin";
const ACTIVE_THEME_PLUGIN_STORAGE_KEY = "zcode-active-theme-plugin";
export const UI_FONT_FAMILY_STORAGE_KEY = "zcode-ui-font-family";
export const CODE_FONT_FAMILY_STORAGE_KEY = "zcode-code-font-family";

// 两条默认栈必须与 styles.css @theme 中的 --font-sans / --font-mono 定义保持一致。
export const DEFAULT_UI_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
export const DEFAULT_CODE_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", monospace';

const THEME_SCOPE_CONTAINER = "#root";
const MAX_FONT_FAMILY_LENGTH = 128;

type ThemeMode = "light" | "dark";

export function themeEntryKey(entry: { pluginId: string; themeId: string }): string {
  return `${entry.pluginId}/${entry.themeId}`;
}

/** 缺失模式回退内置对应模式值（半覆盖，返回空 token 即不覆盖），complete 供「仅深色/浅色」标注。 */
export function pickTokensForMode(
  tokensLight: Record<string, string>,
  tokensDark: Record<string, string>,
  mode: ThemeMode,
): { tokens: Record<string, string>; complete: boolean } {
  return {
    tokens: mode === "dark" ? tokensDark : tokensLight,
    complete: Object.keys(tokensLight).length > 0 && Object.keys(tokensDark).length > 0,
  };
}

/** 返回主题实际声明的唯一模式；两个模式都声明或都未声明时返回 null（用于「仅深色/仅浅色」提示）。 */
export function resolveDeclaredThemeMode(
  tokensLight: Record<string, string>,
  tokensDark: Record<string, string>,
): ThemeMode | null {
  const hasLight = Object.keys(tokensLight).length > 0;
  const hasDark = Object.keys(tokensDark).length > 0;
  if (hasLight === hasDark) return null;
  return hasDark ? "dark" : "light";
}

export function wrapThemeCss(cssText: string): string {
  return `@scope (${THEME_SCOPE_CONTAINER}) {\n${cssText}\n}`;
}

export function normalizeFontFamilyInput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .slice(0, MAX_FONT_FAMILY_LENGTH);
}

export function buildFontStack(family: string, defaultStack: string): string {
  const normalized = normalizeFontFamilyInput(family);
  if (!normalized) return defaultStack;
  return `"${normalized}", ${defaultStack}`;
}

export function loadActiveThemePluginKey(): string | null {
  return readSafeLocalStorage(ACTIVE_THEME_PLUGIN_STORAGE_KEY) || null;
}

export function persistActiveThemePluginKey(key: string | null): void {
  writeSafeLocalStorage(ACTIVE_THEME_PLUGIN_STORAGE_KEY, key ?? "");
}

export function loadFontFamilyPreference(key: string): string {
  return normalizeFontFamilyInput(readSafeLocalStorage(key));
}

export function persistFontFamily(key: string, family: string): void {
  writeSafeLocalStorage(key, normalizeFontFamilyInput(family));
}

function rootStyle(): CSSStyleDeclaration | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement?.style;
}

/** 已应用 token 键记录：切走主题时精确清除旧键，保证幂等。 */
let appliedThemeTokenKeys: string[] = [];

export function applyPluginThemeTokens(tokens: Record<string, string>): void {
  const style = rootStyle();
  if (!style?.setProperty) return;
  for (const key of appliedThemeTokenKeys) {
    if (!(key in tokens)) style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(key, value);
  }
  appliedThemeTokenKeys = Object.keys(tokens);
}

/** 单 <style id="zcode-theme-plugin"> 整体替换，null 即移除；css 经 @scope (#root) 包裹。 */
export function applyPluginThemeCss(cssText: string | null): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(THEME_PLUGIN_STYLE_ELEMENT_ID);
  if (!cssText) {
    existing?.remove();
    return;
  }
  let styleElement = existing instanceof HTMLStyleElement ? existing : null;
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.id = THEME_PLUGIN_STYLE_ELEMENT_ID;
    document.head.appendChild(styleElement);
  }
  styleElement.textContent = wrapThemeCss(cssText);
}

export function applyUiFontFamily(family: string): void {
  const style = rootStyle();
  if (!style?.setProperty) return;
  const normalized = normalizeFontFamilyInput(family);
  if (!normalized) {
    style.removeProperty("--font-sans");
    return;
  }
  style.setProperty("--font-sans", buildFontStack(normalized, DEFAULT_UI_FONT_STACK));
}

export function applyCodeFontFamily(family: string): void {
  const style = rootStyle();
  if (!style?.setProperty) return;
  const normalized = normalizeFontFamilyInput(family);
  if (!normalized) {
    style.removeProperty("--font-mono");
    return;
  }
  style.setProperty("--font-mono", buildFontStack(normalized, DEFAULT_CODE_FONT_STACK));
}
