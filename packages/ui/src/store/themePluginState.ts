/**
 * 主题插件 Store 切片 —— 当前生效主题与字体偏好的唯一所有者（spec §4.1）。
 *
 * 本文件收拢 activeThemePluginKey / 字体族字段的持久化、DOM 应用与跨窗口广播分发，
 * 避免全局 Store 因新增字段超出 max-lines 约束（对齐 codingPlanQuotaResetState 先例）。
 */
import {
  applyCodeFontFamily,
  applyUiFontFamily,
  CODE_FONT_FAMILY_STORAGE_KEY,
  loadActiveThemePluginKey,
  loadFontFamilyPreference,
  normalizeFontFamilyInput,
  persistActiveThemePluginKey,
  persistFontFamily,
  UI_FONT_FAMILY_STORAGE_KEY,
} from "@/lib/themePlugin.js";

export interface ThemePluginStateSlice {
  /** 当前生效的主题插件主题 key（`${pluginId}/${themeId}`）；null 表示未启用。 */
  activeThemePluginKey: string | null;
  setActiveThemePluginKey: (key: string | null) => void;
  /** 界面字体族；空字符串表示跟随默认字体栈。 */
  uiFontFamily: string;
  setUiFontFamily: (family: string) => void;
  /** 代码字体族；空字符串表示跟随默认等宽字体栈。 */
  codeFontFamily: string;
  setCodeFontFamily: (family: string) => void;
}

/** 参与跨窗口广播的主题插件字段；Store 的 BroadcastField 由本元组派生。 */
export const THEME_PLUGIN_BROADCAST_FIELDS = [
  "activeThemePluginKey",
  "uiFontFamily",
  "codeFontFamily",
] as const;

type ThemePluginStateWriter = (patch: Partial<ThemePluginStateSlice>) => void;

/**
 * 主题插件字段的初始值与 setter；写入模式与既有 setUiFontSizePx 一致：
 * normalize → persist → apply → set（activeThemePluginKey 仅 persist + set）。
 */
export function createThemePluginState(writeState: ThemePluginStateWriter): ThemePluginStateSlice {
  return {
    activeThemePluginKey: loadActiveThemePluginKey(),
    setActiveThemePluginKey: (key) => {
      const normalizedKey = typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
      persistActiveThemePluginKey(normalizedKey);
      // token/CSS 的 DOM 应用由 App 级 useThemePluginApplication effect 重放（需要主题数据）。
      writeState({ activeThemePluginKey: normalizedKey });
    },
    uiFontFamily: loadFontFamilyPreference(UI_FONT_FAMILY_STORAGE_KEY),
    setUiFontFamily: (family) => {
      const normalizedFamily = normalizeFontFamilyInput(family);
      persistFontFamily(UI_FONT_FAMILY_STORAGE_KEY, normalizedFamily);
      applyUiFontFamily(normalizedFamily);
      writeState({ uiFontFamily: normalizedFamily });
    },
    codeFontFamily: loadFontFamilyPreference(CODE_FONT_FAMILY_STORAGE_KEY),
    setCodeFontFamily: (family) => {
      const normalizedFamily = normalizeFontFamilyInput(family);
      persistFontFamily(CODE_FONT_FAMILY_STORAGE_KEY, normalizedFamily);
      applyCodeFontFamily(normalizedFamily);
      writeState({ codeFontFamily: normalizedFamily });
    },
  };
}

/** 分发跨窗口广播：命中本切片字段即调用对应 setter 并返回 true，否则返回 false。 */
export function applyThemePluginBroadcast(
  state: Pick<
    ThemePluginStateSlice,
    "setActiveThemePluginKey" | "setUiFontFamily" | "setCodeFontFamily"
  >,
  field: string,
  payload: unknown,
): boolean {
  if (field === "activeThemePluginKey") {
    state.setActiveThemePluginKey(typeof payload === "string" && payload ? payload : null);
    return true;
  }
  if (field === "uiFontFamily" && typeof payload === "string") {
    state.setUiFontFamily(payload);
    return true;
  }
  if (field === "codeFontFamily" && typeof payload === "string") {
    state.setCodeFontFamily(payload);
    return true;
  }
  return false;
}

/** 启动时重放已持久化的字体偏好；token/CSS 由 App 级 useThemePluginApplication effect 负责。 */
export function applyStoredThemePluginAppearance(
  state: Pick<ThemePluginStateSlice, "uiFontFamily" | "codeFontFamily">,
): void {
  applyUiFontFamily(state.uiFontFamily);
  applyCodeFontFamily(state.codeFontFamily);
}
