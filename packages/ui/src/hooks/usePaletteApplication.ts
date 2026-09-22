import { useEffect, useMemo, useState } from "react";
import { applyPaletteTokens, buildPaletteTokens } from "@/lib/palette.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { refreshBrowserThemeSurface, resolveTheme, type Theme } from "@/useTheme.js";

/**
 * 解析当前生效的明暗模式；system 偏好下订阅 OS 配色变化并 bump revision 强制重算
 * （store 的 theme 值不随 OS 切换变化，只依赖它会漏掉重放）。
 * 结构复制自 useThemePlugins.ts 的私有 useResolvedThemeMode——该文件按 spec 约束零改动，
 * 两处只读订阅不共享状态所有者（theme 的唯一所有者仍是 store）。
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

    // 某些 Electron / Chromium 组合仍然只支持旧版 MediaQueryList listener API。
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

/**
 * App 级挂载一次：调色盘 token 的唯一 DOM 应用点（spec §4）。
 * 必须紧跟在 useThemePluginApplication() 之后声明——插件 effect 先写/清自己的 token，
 * 本 effect 后跑并收敛：
 * - 主题插件激活 → applyPaletteTokens({}) 让位（独立 tracked keys 精确清除）；
 * - 否则 → 写入 buildPaletteTokens(resolvedMode, primary, base) 并刷新 meta theme-color。
 * 依赖 palette 两字段 + theme + activeThemePluginKey + 系统明暗解析结果，
 * 任一项变化都重放到正确状态；apply 先清 tracked keys 再写，重复调用幂等。
 */
export function usePaletteApplication(): void {
  const activeThemePluginKey = useZCodeStore((state) => state.activeThemePluginKey);
  const palettePrimaryId = useZCodeStore((state) => state.palettePrimaryId);
  const paletteBaseId = useZCodeStore((state) => state.paletteBaseId);
  const theme = useZCodeStore((state) => state.theme);
  const resolvedMode = useResolvedThemeMode(theme);

  useEffect(() => {
    if (activeThemePluginKey) {
      // 主题包与调色盘写同一批内联 key：插件生效期间调色盘整体让位（spec §1/§4）。
      applyPaletteTokens({});
    } else {
      applyPaletteTokens(buildPaletteTokens(resolvedMode, palettePrimaryId, paletteBaseId));
    }
    // 两个分支都会改变 computed --color-background（清 token / 写 token），
    // meta theme-color 需要跟随底色刷新（spec §1/§8.4）。
    refreshBrowserThemeSurface();
  }, [activeThemePluginKey, palettePrimaryId, paletteBaseId, theme, resolvedMode]);
}
