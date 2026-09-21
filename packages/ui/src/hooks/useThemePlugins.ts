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
import { useTabStore } from "@/store/TabStoreProvider.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

export type ThemePluginsStatus = "idle" | "loading" | "ready" | "error";

export function useThemePlugins(workspacePath: string | null | undefined): {
  themes: ZCodeThemePackage[];
  status: ThemePluginsStatus;
  refresh: () => void;
} {
  const services = useBaseWorkspaceServices();
  const [themes, setThemes] = useState<ZCodeThemePackage[]>([]);
  const [status, setStatus] = useState<ThemePluginsStatus>("idle");
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((value) => value + 1), []);

  useEffect(() => {
    if (!workspacePath) {
      setThemes([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    // 切换 workspace 时先清空旧列表，避免用上一个 workspace 的主题短暂匹配 key。
    setThemes([]);
    setStatus("loading");
    services.pluginManagementService
      .listThemes({ workspacePath })
      .then((result) => {
        if (cancelled) return;
        setThemes(result.themes);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setThemes([]);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, services, refreshTick]);

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
