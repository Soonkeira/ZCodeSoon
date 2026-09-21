import { useCallback, useEffect, useState } from "react";
import type { ZCodeThemePackage } from "@zcode/shared";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import {
  applyPluginThemeCss,
  applyPluginThemeTokens,
  pickTokensForMode,
  themeEntryKey,
} from "@/lib/themePlugin.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { resolveTheme } from "@/useTheme.js";

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

/** App 级挂载一次：activeThemePluginKey 的唯一 DOM 应用点（幂等，明暗切换与主题列表变化时重放）。 */
export function useThemePluginApplication(): void {
  const activeThemePluginKey = useZCodeStore((state) => state.activeThemePluginKey);
  const theme = useZCodeStore((state) => state.theme);
  const activeWorkspacePath = useTabStore((state) => state.activeWorkspacePath);
  const { themes, status } = useThemePlugins(activeWorkspacePath);

  useEffect(() => {
    if (!activeThemePluginKey) {
      applyPluginThemeTokens({});
      applyPluginThemeCss(null);
      return;
    }
    const entry = themes.find((candidate) => themeEntryKey(candidate) === activeThemePluginKey);
    if (!entry) {
      if (status === "ready") {
        // 主题列表就绪仍找不到主题（插件被卸载/停用）→ 回退默认外观。
        applyPluginThemeTokens({});
        applyPluginThemeCss(null);
      }
      return;
    }
    const resolved = resolveTheme(theme);
    const { tokens } = pickTokensForMode(entry.tokensLight, entry.tokensDark, resolved);
    applyPluginThemeTokens(tokens);
    applyPluginThemeCss(
      entry.cssStatus === "ok" && typeof entry.cssText === "string" ? entry.cssText : null,
    );
  }, [activeThemePluginKey, themes, status, theme]);
}
