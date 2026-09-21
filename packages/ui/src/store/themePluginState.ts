/**
 * 主题插件 Store 切片 —— 当前生效主题与字体偏好的唯一所有者（spec §4.1）。
 *
 * 本文件收拢 activeThemePluginKey / 字体族字段的持久化、DOM 应用与跨窗口广播分发，
 * 避免全局 Store 因新增字段超出 max-lines 约束（对齐 codingPlanQuotaResetState 先例）。
 */
import type { IPluginManagementService } from "@zcode/services";
import type { ZCodeThemePackage } from "@zcode/shared";
import { logger } from "@/logger.js";
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

export type ThemePluginsStatus = "idle" | "loading" | "ready" | "error";

export interface LoadThemePluginsParams {
  service: IPluginManagementService;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  configScope?: "user" | "workspace";
  /** 插件列表变更后强制重取；默认按请求 key 去重（spec §4.4）。 */
  force?: boolean;
}

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
  /**
   * 已安装主题插件的主题清单（spec §4.4 单一来源）：App 级应用点与设置页选择器
   * 共享同一份，插件变更后由变更点 force 刷新，见 loadThemePlugins。
   */
  themePlugins: ZCodeThemePackage[];
  themePluginsStatus: ThemePluginsStatus;
  /**
   * 已就绪清单对应的请求 key（spec §4.4）：成功时写入 requestKey，loading/失败为 null。
   * App 应用点用它识别「当前清单可能来自旧快照」，避免跨窗口/跨主机误判主题已卸载。
   */
  themePluginsLoadedKey: string | null;
  loadThemePlugins: (params: LoadThemePluginsParams) => Promise<void>;
}

/** 参与跨窗口广播的主题插件字段；Store 的 BroadcastField 由本元组派生。 */
export const THEME_PLUGIN_BROADCAST_FIELDS = [
  "activeThemePluginKey",
  "uiFontFamily",
  "codeFontFamily",
] as const;

type ThemePluginStateWriter = (patch: Partial<ThemePluginStateSlice>) => void;

/**
 * 过期响应丢弃计数器（spec §4.4）：每次发起请求递增，响应回来时不匹配即忽略。
 * stale agent 回收期间旧请求可能长时间挂起，不能让它覆盖后发请求的清单。
 */
let themePluginsRequestId = 0;

/**
 * 主题插件字段的初始值与 setter；写入模式与既有 setUiFontSizePx 一致：
 * normalize → persist → apply → set（activeThemePluginKey 仅 persist + set）。
 */
export function createThemePluginState(writeState: ThemePluginStateWriter): ThemePluginStateSlice {
  // 去重判定所需的「最近一次成功的请求 key + 正在加载的请求 key + 当前状态」只属于本切片，
  // 闭包持有即可，不再去外面读一份 store 副本（第二状态源）。
  let loadedKey: string | null = null;
  let loadingKey: string | null = null;
  let status: ThemePluginsStatus = "idle";

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
    themePlugins: [],
    themePluginsStatus: "idle",
    themePluginsLoadedKey: null,
    loadThemePlugins: async ({
      service,
      workspacePath,
      workspaceIdentity,
      remoteSessionId,
      configScope,
      force,
    }) => {
      const normalizedIdentity = workspaceIdentity?.trim() || undefined;
      // 身份 key 统一按 Workspace Identity 规范：优先 identity，路径只作本地 fallback。
      const requestKey = `${normalizedIdentity || workspacePath}|${configScope ?? ""}`;
      // spec §4.4：loading 只对「请求 key 相同」去重；加载中切换 workspace/identity 必须发起新请求，
      // 否则新来源的清单永远不会加载（旧响应仍由 requestId 丢弃）。
      if (!force) {
        if (status === "loading" && loadingKey === requestKey) return;
        if (status === "ready" && loadedKey === requestKey) return;
      }
      themePluginsRequestId += 1;
      const requestId = themePluginsRequestId;
      status = "loading";
      loadingKey = requestKey;
      // 切换 workspace 或插件集合时先清空旧清单与 loadedKey，
      // 避免用上一个来源的主题短暂匹配 key（应用点据此识别清单来源）。
      writeState({ themePlugins: [], themePluginsStatus: "loading", themePluginsLoadedKey: null });
      try {
        const result = await service.listThemes({
          workspacePath,
          ...(normalizedIdentity ? { workspaceIdentity: normalizedIdentity } : {}),
          ...(remoteSessionId ? { remoteSessionId } : {}),
          ...(configScope ? { configScope } : {}),
        });
        if (requestId !== themePluginsRequestId) return;
        status = "ready";
        loadedKey = requestKey;
        loadingKey = null;
        writeState({
          themePlugins: result.themes,
          themePluginsStatus: "ready",
          themePluginsLoadedKey: requestKey,
        });
      } catch (error) {
        if (requestId !== themePluginsRequestId) return;
        // spec §4.2 第 4 步：加载失败只有 error 状态，不清空用户选择；
        // loadedKey 不更新，保证下次 effect 重跑仍会真正重试。
        status = "error";
        loadedKey = null;
        loadingKey = null;
        writeState({ themePlugins: [], themePluginsStatus: "error", themePluginsLoadedKey: null });
        logger.warn("[theme-plugin] 主题清单加载失败", {
          workspacePath,
          configScope: configScope ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * 分发跨窗口广播：返回该 field 是否由本切片认领（未认领时调用方继续处理其他字段）。
 * 字体族字段仅在 payload 为字符串时写回 setter；activeThemePluginKey 对非字符串
 * payload 归一化为 null。
 */
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
