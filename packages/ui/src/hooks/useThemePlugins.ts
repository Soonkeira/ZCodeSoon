import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZCodeThemePackage } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  applyPluginThemeCss,
  applyPluginThemeTokens,
  pickTokensForMode,
  themeEntryKey,
} from "@/lib/themePlugin.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import type { ThemePluginsStatus } from "@/store/themePluginState.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

/**
 * 主题清单的只读消费口（spec §4.4 单一来源）：清单/状态都在主 store，App 与设置页共享，
 * 本 hook 只负责「什么时候发起加载」并暴露 refresh，不再自己持有 useState 副本。
 */
export function useThemePlugins(
  workspacePath: string | null | undefined,
  options?: { refreshOnMount?: boolean },
): {
  themes: ZCodeThemePackage[];
  status: ThemePluginsStatus;
  refresh: () => void;
} {
  const services = useBaseWorkspaceServices();
  const pluginManagementService = services.pluginManagementService;
  const workspaceIdentity = useTabStore((state) => state.activeWorkspaceIdentity ?? undefined);
  const themes = useZCodeStore((state) => state.themePlugins);
  const status = useZCodeStore((state) => state.themePluginsStatus);
  const loadThemePlugins = useZCodeStore((state) => state.loadThemePlugins);
  const refreshOnMount = options?.refreshOnMount === true;
  // refreshOnMount 只强制刷新一次：插件变更点已经负责后续 force 刷新，避免每次 effect 重跑都打网络。
  const forcedOnMountRef = useRef(false);

  useEffect(() => {
    if (!workspacePath) return;
    const force = refreshOnMount && !forcedOnMountRef.current;
    forcedOnMountRef.current = true;
    void loadThemePlugins({
      service: pluginManagementService,
      workspacePath,
      ...(workspaceIdentity?.trim() ? { workspaceIdentity } : {}),
      ...(force ? { force: true } : {}),
    });
  }, [loadThemePlugins, pluginManagementService, refreshOnMount, workspaceIdentity, workspacePath]);

  const refresh = useCallback(() => {
    if (!workspacePath) return;
    void loadThemePlugins({
      service: pluginManagementService,
      workspacePath,
      ...(workspaceIdentity?.trim() ? { workspaceIdentity } : {}),
      force: true,
    });
  }, [loadThemePlugins, pluginManagementService, workspaceIdentity, workspacePath]);

  return { themes, status, refresh };
}

/**
 * 解析当前生效的明暗模式；system 偏好下订阅 OS 配色变化并 bump revision 强制重算
 * （store 的 theme 值不随 OS 切换变化，只依赖它会漏掉重放）。不复用 useTheme()，
 * 避免出现第二个状态所有者。
 */
function useResolvedThemeMode(preference: Theme): "light" | "dark" {
  const [systemRevision, setSystemRevision] = useState(0);

  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemRevision((current) => current + 1);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    // 某些 Electron / Chromium 组合仍只支持旧版 MediaQueryList listener API。
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [preference]);

  return useMemo(() => {
    if (typeof window === "undefined") {
      return preference === "dark" || preference === "zai-dark" ? "dark" : "light";
    }
    return resolveTheme(preference);
  }, [preference, systemRevision]);
}

/** CSS 拒绝原因可能很长，toast 只展示截断摘要；完整原因仍由设置页与 listThemes 数据承载。 */
const MAX_CSS_REJECT_REASON_LENGTH = 120;

function truncateCssRejectReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= MAX_CSS_REJECT_REASON_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_CSS_REJECT_REASON_LENGTH)}…`;
}

/** App 级挂载一次：activeThemePluginKey 的唯一 DOM 应用点（幂等，明暗切换与主题列表变化时重放）。 */
export function useThemePluginApplication(): void {
  const activeThemePluginKey = useZCodeStore((state) => state.activeThemePluginKey);
  const setActiveThemePluginKey = useZCodeStore((state) => state.setActiveThemePluginKey);
  const theme = useZCodeStore((state) => state.theme);
  const activeWorkspacePath = useTabStore((state) => state.activeWorkspacePath);
  const { themes, status } = useThemePlugins(activeWorkspacePath);
  const resolvedMode = useResolvedThemeMode(theme);
  const { intl } = useZCodeIntl();
  // spec §6：CSS 被安全校验拒绝时仅丢弃样式、token 仍生效，静默处理会让用户误以为主题损坏。
  // 该 effect 会因明暗重放、列表刷新与重渲染反复执行，用「主题 key + 原因」签名去重：
  // 只有切换到别的被拒主题或原因变化（如插件更新）才再次提示。
  const cssRejectedNoticeRef = useRef<string | null>(null);
  // 选中的主题被打成 invalid（plugin 更新后 schema/变量越权等）时同样只提示一次：
  // 按「主题 key + invalid」签名去重，避免每次重放重复弹 toast。
  const invalidThemeNoticeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeThemePluginKey) {
      applyPluginThemeTokens({});
      applyPluginThemeCss(null);
      return;
    }
    const entry = themes.find((candidate) => themeEntryKey(candidate) === activeThemePluginKey);
    if (!entry) {
      if (status === "ready") {
        // spec §4.2 第 1 步：主题列表就绪仍找不到主题（插件被卸载/停用）→ 回退默认外观并清空 store 字段。
        applyPluginThemeTokens({});
        applyPluginThemeCss(null);
        setActiveThemePluginKey(null);
      }
      return;
    }
    const { tokens } = pickTokensForMode(entry.tokensLight, entry.tokensDark, resolvedMode);
    applyPluginThemeTokens(tokens);
    applyPluginThemeCss(
      entry.cssStatus === "ok" && typeof entry.cssText === "string" ? entry.cssText : null,
    );

    if (!entry.valid) {
      // spec §6「应用时文件丢失 / 读取失败」与 §4.2 第 4 步：invalid 时没有可应用的 token/CSS，
      // 只静默降级为默认外观，**不清空 activeThemePluginKey**，store 保留用户选择，
      // 插件修好后下一次重放即可恢复（与卸载/停用清 key 的回退不同）。
      const signature = `${themeEntryKey(entry)}|invalid`;
      if (invalidThemeNoticeRef.current !== signature) {
        invalidThemeNoticeRef.current = signature;
        toast(
          intl.formatMessage(
            { id: "settings.themePlugin.invalidActive" },
            {
              name: entry.name,
              reason: truncateCssRejectReason(entry.invalidReason ?? "") || "—",
            },
          ),
          { variant: "warning" },
        );
      }
    }

    if (entry.valid && entry.cssStatus === "rejected") {
      const signature = `${themeEntryKey(entry)}|${entry.cssRejectReason ?? ""}`;
      if (cssRejectedNoticeRef.current !== signature) {
        cssRejectedNoticeRef.current = signature;
        toast(
          intl.formatMessage(
            { id: "settings.themePlugin.cssRejected" },
            {
              name: entry.name,
              reason: truncateCssRejectReason(entry.cssRejectReason ?? "") || "—",
            },
          ),
          { variant: "warning" },
        );
      }
    }
  }, [activeThemePluginKey, themes, status, resolvedMode, setActiveThemePluginKey, intl]);
}
