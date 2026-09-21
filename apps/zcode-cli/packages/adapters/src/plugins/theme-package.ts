import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_THEME_CSS_LENGTH,
  parsePluginThemeFile,
  scanThemeCssSafety,
  type PluginThemePackage,
} from "@zcode/contracts";
import { fileExists, resolveInside } from "./helpers.js";
import { collectComponentDirs } from "./plugin-components.js";

const THEME_DEFAULT_DIR = "themes";
const THEME_MANIFEST_FILE = "theme.json";

interface CollectThemePackagesResult {
  packages: PluginThemePackage[];
}

/**
 * 扫描插件根下的主题目录（默认 themes/，可由 manifest.themes 以字符串/数组追加）。
 * 插件内容不可信，主题包按三层拒绝符号链接（含 Windows junction）：
 * 1) 主题容器目录：collectComponentDirs 返回的每个 themesDir 自身是链接则整目录跳过；
 * 2) 目录条目：readdirSync withFileTypes 的 isDirectory() 对链接返回 false，链接子目录不入选；
 * 3) 文件：theme.json 与 css 都要求常规文件，链接分别记为 invalid / cssStatus=rejected。
 * css 相对路径另经 resolveInside 防越界；与 skills 的差别在于文件级链接会产出带原因的结果供 UI 展示。
 */
export function collectThemePackages(rootPath: string, manifestField: unknown): CollectThemePackagesResult {
  const packages: PluginThemePackage[] = [];
  const seenThemeIds = new Set<string>();
  for (const themesDir of collectComponentDirs(rootPath, manifestField, THEME_DEFAULT_DIR)) {
    // themesDir 自身是符号链接（含 junction）时整体跳过，不跟随到插件根之外。
    if (isSymbolicLinkSync(themesDir)) continue;
    let dirNames: string[];
    try {
      dirNames = readdirSync(themesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const dirName of dirNames) {
      const themePackage = readThemePackage(join(themesDir, dirName), dirName);
      // 同 themeId 只保留首个声明（含 invalid 包），后续同 id 跳过。
      if (!themePackage || seenThemeIds.has(themePackage.themeId)) continue;
      seenThemeIds.add(themePackage.themeId);
      packages.push(themePackage);
    }
  }
  return { packages };
}

function readThemePackage(themeDir: string, dirName: string): PluginThemePackage | null {
  const manifestPath = join(themeDir, THEME_MANIFEST_FILE);
  if (isSymbolicLinkSync(manifestPath)) {
    return invalidThemePackage(dirName, "theme.json must not be a symbolic link");
  }
  if (!fileExists(manifestPath)) return null;
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (error) {
    return invalidThemePackage(dirName, `theme.json could not be read: ${String(error)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
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
    } else if (isSymbolicLinkSync(cssPath)) {
      cssStatus = "rejected";
      cssRejectReason = "theme css must not be a symbolic link";
    } else if (fileExists(cssPath)) {
      try {
        // 体积预检（spec §3.4）：插件内容不可信，先按磁盘字节数拒绝超大 CSS，
        // 不把整个文件读进内存；statSync 失败（文件被替换/删除）走下面的读取失败分支。
        const cssSize = statSync(cssPath).size;
        if (cssSize > MAX_THEME_CSS_LENGTH) {
          cssStatus = "rejected";
          // reason 带上实际字节数，便于作者定位（扫描分支只会报告上限本身）。
          cssRejectReason = `theme css exceeds ${MAX_THEME_CSS_LENGTH} bytes (${cssSize} bytes)`;
        } else {
          const candidate = readFileSync(cssPath, "utf8");
          // 读取后仍按内容的 UTF-8 字节数复核一次（双保险）：statSync 与实际内容之间
          // 存在被替换/增长的时间窗，scan 的字节校验才是最终判据。
          const safety = scanThemeCssSafety(candidate);
          if (safety.ok) {
            cssText = candidate;
            cssStatus = "ok";
          } else {
            cssStatus = "rejected";
            cssRejectReason = safety.reason;
          }
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

/** 只判定链接自身（不跟随），缺失或 lstat 失败均视为非链接。 */
function isSymbolicLinkSync(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
