import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parsePluginThemeFile,
  scanThemeCssSafety,
  type PluginThemePackage,
} from "@zcode/contracts";
import { resolveInside } from "./helpers.js";
import { collectComponentDirs } from "./plugin-components.js";

const THEME_DEFAULT_DIR = "themes";
const THEME_MANIFEST_FILE = "theme.json";

export interface CollectThemePackagesResult {
  packages: PluginThemePackage[];
}

/**
 * 扫描插件根下的主题目录（默认 themes/，可由 manifest.themes 以字符串/数组追加）。
 * 信任边界与 skills 一致：目录枚举不跟随符号链接（readdirSync withFileTypes 的
 * isDirectory() 对 symlink 返回 false）；css 相对路径经 resolveInside 防越界。
 */
export function collectThemePackages(rootPath: string, manifestField: unknown): CollectThemePackagesResult {
  const packages: PluginThemePackage[] = [];
  const seenThemeIds = new Set<string>();
  for (const themeRoot of collectComponentDirs(rootPath, manifestField, THEME_DEFAULT_DIR)) {
    let dirNames: string[];
    try {
      dirNames = readdirSync(themeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const dirName of dirNames) {
      const themePackage = readThemePackage(join(themeRoot, dirName), dirName);
      if (!themePackage || seenThemeIds.has(themePackage.themeId)) continue;
      seenThemeIds.add(themePackage.themeId);
      packages.push(themePackage);
    }
  }
  return { packages };
}

function readThemePackage(themeDir: string, dirName: string): PluginThemePackage | null {
  const manifestPath = join(themeDir, THEME_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return invalidThemePackage(dirName, `theme.json is not valid JSON: ${String(error)}`);
  }
  const parsed = parsePluginThemeFile(raw);
  if (!parsed.ok) {
    return invalidThemePackage(dirName, parsed.reason);
  }
  const theme = parsed.theme;
  let cssText: string | undefined;
  let cssStatus: PluginThemePackage["cssStatus"] = "missing";
  let cssRejectReason: string | undefined;
  if (typeof theme.cssFile === "string") {
    const cssPath = resolveInside(themeDir, theme.cssFile.replace(/^\.\//, ""));
    if (!cssPath) {
      cssStatus = "rejected";
      cssRejectReason = `theme css path escapes the theme directory: ${theme.cssFile}`;
    } else if (!existsSync(cssPath)) {
      cssStatus = "missing";
    } else {
      try {
        const candidate = readFileSync(cssPath, "utf8");
        const safety = scanThemeCssSafety(candidate);
        if (safety.ok) {
          cssText = candidate;
          cssStatus = "ok";
        } else {
          cssStatus = "rejected";
          cssRejectReason = safety.reason;
        }
      } catch (error) {
        cssStatus = "rejected";
        cssRejectReason = `theme css could not be read: ${String(error)}`;
      }
    }
  }
  return {
    themeId: theme.id,
    name: theme.name,
    valid: true,
    tokensLight: theme.tokensLight,
    tokensDark: theme.tokensDark,
    suggestedFonts: theme.suggestedFonts,
    cssText,
    cssStatus,
    cssRejectReason,
  };
}

function invalidThemePackage(themeId: string, reason: string): PluginThemePackage {
  return {
    themeId,
    name: themeId,
    valid: false,
    invalidReason: reason,
    tokensLight: {},
    tokensDark: {},
    cssStatus: "missing",
  };
}
