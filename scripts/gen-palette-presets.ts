/**
 * 生成「调色盘预设」本地目录主题市场：docs/palette-presets-marketplace/
 * （给不想构建 fork 的用户：设置 → 插件 → 添加插件市场 → 选该目录安装）。
 *
 * 色值唯一来源 = packages/ui/src/lib/palette.ts 色表（直接 import，不手抄）：
 * - tokens 原值直出，不做构建期 var() 代入——color-mix(var(--…)) 形态是
 *   theme-package.ts token 白名单允许的运行时函数值，由 CSS 变量按元素级联自解；
 * - mist 底色对象为空 → 对应组合仅含主色键，背景回落内置主题值（与内置调色盘一致）。
 *
 * 自校验：每个 theme.json 过运行时同款 parsePluginThemeFile（schema + token 语义
 * 白名单）；任一失败 → 列出 id+原因并以非零码退出，不写任何产物。
 *
 * 执行：node --import tsx scripts/gen-palette-presets.ts
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLUGIN_THEME_ID_PATTERN,
  parsePluginThemeFile,
} from "../apps/zcode-cli/packages/contracts/src/plugins/theme-package.ts";
import zhCN from "../packages/ui/src/i18n/locales/zh-CN.ts";
import {
  PALETTE_BASE_COLORS,
  PALETTE_PRIMARY_COLORS,
  buildPaletteTokens,
} from "../packages/ui/src/lib/palette.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKETPLACE_DIR = join(REPO_ROOT, "docs", "palette-presets-marketplace");
const PLUGIN_NAME = "palette-presets";
const PLUGIN_DIR = join(MARKETPLACE_DIR, "plugins", PLUGIN_NAME);
const THEMES_DIR = join(PLUGIN_DIR, "themes");

interface ThemeJson {
  id: string;
  name: string;
  tokens: { light: Record<string, string>; dark: Record<string, string> };
}

interface GeneratedTheme {
  id: string;
  json: ThemeJson;
}

/** 中文色名直接读 i18n 现有 key（settings.palette.*），避免第二份硬编码色名表。 */
function zhColorName(kind: "primary" | "base", id: string): string {
  const key = `settings.palette.${kind}.${id}`;
  const value = zhCN[key];
  if (!value) {
    throw new Error(`zh-CN.ts 缺少色名 key: ${key}`);
  }
  return value;
}

function buildThemeCatalog(): GeneratedTheme[] {
  const seen = new Set<string>();
  const themes: GeneratedTheme[] = [];
  for (const primary of PALETTE_PRIMARY_COLORS) {
    for (const base of PALETTE_BASE_COLORS) {
      const id = `${primary.id}-${base.id}`;
      if (seen.has(id)) {
        throw new Error(`theme id 重复: ${id}`);
      }
      if (!PLUGIN_THEME_ID_PATTERN.test(id)) {
        throw new Error(`theme id 不符合 ^[a-z0-9][a-z0-9._-]{0,63}$: ${id}`);
      }
      seen.add(id);
      themes.push({
        id,
        json: {
          id,
          name: `${zhColorName("primary", primary.id)} · ${zhColorName("base", base.id)}`,
          tokens: {
            light: buildPaletteTokens("light", primary.id, base.id),
            dark: buildPaletteTokens("dark", primary.id, base.id),
          },
        },
      });
    }
  }
  return themes;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Windows 控制台默认 GBK，写产物必须显式 UTF-8。
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function main(): Promise<void> {
  const themes = buildThemeCatalog();

  // 自校验（先校验后写盘）：schema + id 正则 + token 白名单/色值形态全走运行时同一条路径。
  const failures: string[] = [];
  for (const theme of themes) {
    const result = parsePluginThemeFile(theme.json);
    if (!result.ok) {
      failures.push(`${theme.id}: ${result.reason}`);
    }
  }
  if (failures.length > 0) {
    console.error(
      `[gen-palette-presets] ${failures.length}/${themes.length} 个 theme.json 校验失败：`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  // themes 目录是纯生成物：重跑先清空，色表缩编时不残留旧组合目录。
  await rm(THEMES_DIR, { recursive: true, force: true });
  for (const theme of themes) {
    await writeJson(join(THEMES_DIR, theme.id, "theme.json"), theme.json);
  }

  const primaryCount = PALETTE_PRIMARY_COLORS.length;
  const baseCount = PALETTE_BASE_COLORS.length;
  const modeTokenSets = themes.length * 2; // 每个主题包 light + dark 各一组 token
  await writeJson(join(PLUGIN_DIR, ".zcode-plugin", "plugin.json"), {
    name: PLUGIN_NAME,
    version: "1.0.0",
    description: `调色盘静态预设：色值与 Soonkeira/ZCodeSoon 内置调色盘同源（${primaryCount} 主色 × ${baseCount} 底色，浅色/深色各一组 token）`,
    author: { name: "Soonkeira" },
    themes: "themes",
  });
  await writeJson(join(MARKETPLACE_DIR, "marketplace.json"), {
    name: PLUGIN_NAME,
    description: `共 ${modeTokenSets} 组主色×底色×明暗预设（${themes.length} 个主题包 = ${primaryCount} 主色 × ${baseCount} 底色），源自 fork 内置调色盘，浅色/深色各一组 token`,
    plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}` }],
  });

  console.log(
    `[gen-palette-presets] ${themes.length} 个 theme.json 全部通过 parsePluginThemeFile 校验（schema + token 白名单）`,
  );
  console.log(`[gen-palette-presets] 输出市场目录: ${MARKETPLACE_DIR}`);
  console.log(`  - marketplace.json`);
  console.log(`  - plugins/${PLUGIN_NAME}/.zcode-plugin/plugin.json`);
  console.log(`  - plugins/${PLUGIN_NAME}/themes/<primary>-<base>/theme.json × ${themes.length}`);
}

await main();
