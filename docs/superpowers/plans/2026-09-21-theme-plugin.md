# 主题插件系统实现计划（Theme Plugin Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在插件系统中新增 `themes` 组件类型：主题插件声明 token 覆盖与受限附加 CSS，经 `plugins/listThemes` 协议下发内容；设置页新增主题包选择器与界面/代码字体族选择器（Desktop + Web 生效）。

**Architecture:** CLI 侧发现并校验主题包（contracts schema + adapters 收集器）→ 新增 `plugins/listThemes` 协议词（返回 token 与 CSS **内容**，而非路径，Web 渲染端无法读 CLI 文件系统）→ services 薄链路转发 → UI store 持有 `activeThemePluginKey` 与字体偏好（localStorage + 跨窗口广播）→ App 级 effect 幂等应用（CSS 变量覆盖 + `@scope (#root)` 附加样式 + 字体栈覆盖）。

**Tech Stack:** TypeScript (Node 24, ESM)、zod（contracts v3 / shared v4）、zustand、node:test、React、Tailwind v4 `@theme`。

**Spec:** `docs/superpowers/specs/2026-09-21-theme-plugin-design.md`。状态所有权、安全规则、非目标以 spec 为准；本计划是唯一实现顺序。

---

## 基线事实（执行者必读，全部已核实）

1. 分支 `feature/theme-plugin`。Node 版本以 `mise.toml`（24.14.0）为准；本机 node 24.10 可运行 `node --test`。
2. `node --test` 可直接执行 TS 源码，但**只认显式 `.ts` 后缀相对导入**；仓库既有测试的 `.js` 后缀导入会 ERR_MODULE_NOT_FOUND（已验证）。本计划所有新测试一律 `../src/xxx.ts` 形式。
3. Node 不解析 `@/` 别名——被测试触达的新模块内**同目录导入用 `./xxx.js`**（`packages/ui/src/lib/cuaPermissionStatusStore.ts` 已有先例）。
4. zod 版本分裂：`apps/zcode-cli/packages/contracts` = **zod v3**（^3.24.0）；`packages/shared` = **zod v4**（4.6.5）。contracts 新 schema 按 v3 写；shared 按 v4 写（`z.record` 必须两参）。本计划 schema 均不用 refine，语义校验走独立纯函数，规避两版 API 差异。
5. CSS 作用域用 `@scope (#root)`：Desktop renderer `index.html:109` 与 Web `index.html:151` 均有 `<div id="root">`。
6. 全部行号基于 commit `872ad96`，若有漂移以内容定位。
7. `node_modules` 尚未安装（仓库为新 clone），Task 0 处理。

| 关键插入点 | 位置 |
| --- | --- |
| PluginManifest 接口 | `apps/zcode-cli/packages/contracts/src/plugins/index.ts:141-161` |
| contracts 导出桶 | `apps/zcode-cli/packages/contracts/src/index.ts:71`（`export * from "./plugins/index.js"`） |
| collectComponentDirs（补 export） | `apps/zcode-cli/packages/adapters/src/plugins/plugin-components.ts:183` |
| readManifest / findManifest（私有） | `apps/zcode-cli/packages/adapters/src/plugins/index.ts:945-965 / 930-943` |
| UNSUPPORTED_COMPONENT_KEYS（**不要**加 themes） | `apps/zcode-cli/packages/adapters/src/plugins/index.ts:107-112` |
| 协议词表 | `packages/shared/src/zcode-protocol/index.ts:3560`（pluginsList 在 3614） |
| plugins/list schemas | `packages/shared/src/zcode-protocol/index.ts:2578-2590` |
| listPlugins handler（listThemes 仿写） | `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugins.ts:201-227` |
| server case 注册 | `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts:61 / 646-647` |
| IZCodeAgentService | `packages/services/src/zcode-agent/zcodeAgent.ts:605` |
| listPlugins 实现 | `packages/services/src/zcode-agent/zcodeAgentService.ts:3866-3896` |
| IPluginManagementService | `packages/services/src/plugins/pluginManagement.ts:47-93` |
| store 字段/setter | `packages/ui/src/store/index.ts:107-121 / 257-294` |
| BROADCAST_FIELDS / onMessage / init | `packages/ui/src/store/index.ts:214-219 / 470-485 / 491-497` |
| `--font-mono`（--font-sans 加旁边） | `packages/ui/src/styles.css:140-142`（@theme 块 137-306） |
| 外观设置卡片区 | `packages/ui/src/settingsCodePreview.tsx:101-243` |
| SettingsPage 接线 | `packages/ui/src/SettingsPage.tsx:340-345 / 622 / 1785-1806` |
| App 组件 store 读取 | `packages/ui/src/App.tsx:356-357` |

---

### Task 0: 环境准备

**Files:** 无代码改动。

- [ ] **Step 1: 安装依赖**

Run（仓库根目录）: `pnpm install`
Expected: 退出码 0，生成根 `node_modules` 与各包 `node_modules`。

- [ ] **Step 2: 确认基线可编译**

Run: `pnpm exec tsc -b packages/shared packages/services`
Expected: 退出码 0（若基线本就失败，如实记录后再继续，不修复无关问题）。

---

### Task 1: contracts — manifest 字段 + 主题 schema + CSS 安全校验（TDD）

**Files:**
- Create: `apps/zcode-cli/packages/contracts/src/plugins/theme-package.ts`
- Modify: `apps/zcode-cli/packages/contracts/src/plugins/index.ts:141-161`（PluginManifest 加字段）与文件末尾（加 re-export）
- Test: `apps/zcode-cli/packages/contracts/test/theme-package.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/zcode-cli/packages/contracts/test/theme-package.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  findThemeTokenProblem,
  parsePluginThemeFile,
  pluginThemeFileSchema,
  scanThemeCssSafety,
} from "../src/plugins/theme-package.ts";

const validThemeFile = {
  id: "sereno-dark",
  name: "Sereno Dark",
  tokens: {
    light: { "--color-brand": "#7c5cff", "--radius-lg": "0.75rem" },
    dark: { "--color-brand": "#9d85ff" },
  },
  suggestedFonts: { ui: "Inter", code: "JetBrains Mono" },
  css: "overrides.css",
};

test("valid theme file passes schema", () => {
  assert.equal(pluginThemeFileSchema.safeParse(validThemeFile).success, true);
});

test("token key outside --color-*/--radius-* whitelist is rejected", () => {
  const result = parsePluginThemeFile({
    ...validThemeFile,
    tokens: { light: { "--spacing-x": "4px" } },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /whitelist/);
});

test("reserved tokens (font size/family) are rejected with explicit reason", () => {
  for (const key of ["--ui-font-size", "--font-sans", "--font-mono"]) {
    const problem = findThemeTokenProblem(key, "1px");
    assert.match(problem ?? "", /reserved for user settings/);
  }
});

test("invalid color value is rejected", () => {
  const result = parsePluginThemeFile({
    ...validThemeFile,
    tokens: { light: { "--color-brand": "definitely not a color" } },
  });
  assert.equal(result.ok, false);
});

test("radius without px/rem unit is rejected", () => {
  const result = parsePluginThemeFile({
    ...validThemeFile,
    tokens: { light: { "--radius": "10" } },
  });
  assert.equal(result.ok, false);
});

test("theme id pattern is enforced", () => {
  assert.equal(pluginThemeFileSchema.safeParse({ ...validThemeFile, id: "Bad Id!" }).success, false);
  assert.equal(pluginThemeFileSchema.safeParse({ ...validThemeFile, id: "ok-id.1" }).success, true);
});

test("css safety scan blocks dangerous constructs", () => {
  assert.equal(scanThemeCssSafety('.a { background: url("https://x/y.png") }').ok, false);
  assert.equal(scanThemeCssSafety("@import url('x.css');").ok, false);
  assert.equal(scanThemeCssSafety("a { color: javascript:red }").ok, false);
  assert.equal(scanThemeCssSafety('@charset "utf-8";').ok, false);
  assert.equal(scanThemeCssSafety(".chat-bubble { border-radius: 12px; }").ok, true);
});

test("parsePluginThemeFile merges token problems from both modes", () => {
  const result = parsePluginThemeFile({
    ...validThemeFile,
    tokens: {
      light: { "--color-brand": "oops" },
      dark: { "--color-x": "#111" },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /--color-brand/);
  assert.match(result.ok ? "" : result.reason, /--color-x/);
});
```

- [ ] **Step 2: 运行确认失败**

Run（`apps/zcode-cli/packages/contracts` 目录）: `node --test test/theme-package.test.ts`
Expected: FAIL —— `Cannot find module .../theme-package.ts`。

- [ ] **Step 3: 实现**

创建 `apps/zcode-cli/packages/contracts/src/plugins/theme-package.ts`：

```ts
import { z } from "zod";

/** 主题 id：小写字母/数字开头，允许 . _ -，总长 ≤ 64（spec §3.2）。 */
export const PLUGIN_THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** token 白名单：仅 --color-* / --radius-*；字号与字体族归用户设置管辖（spec §3.3）。 */
const THEME_TOKEN_ALLOWED_PATTERN = /^--(?:color|radius)-[a-z0-9][a-z0-9-]*$/;
const RESERVED_THEME_TOKEN_KEYS = new Set(["--ui-font-size", "--font-sans", "--font-mono"]);

const THEME_HEX_COLOR_PATTERN = /^#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const THEME_FUNCTIONAL_COLOR_PATTERN =
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^\n()]*\)$/i;
const THEME_COLOR_KEYWORDS = new Set(["transparent", "currentcolor", "inherit", "initial"]);
const THEME_GEOMETRY_PATTERN = /^-?(?:\d+|\d*\.\d+)(?:px|rem)$/;
const MAX_THEME_TOKEN_VALUE_LENGTH = 128;

export function isValidThemeColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_THEME_TOKEN_VALUE_LENGTH) {
    return false;
  }
  if (THEME_HEX_COLOR_PATTERN.test(trimmed)) return true;
  if (THEME_FUNCTIONAL_COLOR_PATTERN.test(trimmed)) return true;
  return THEME_COLOR_KEYWORDS.has(trimmed.toLowerCase());
}

export function isValidThemeGeometryValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= MAX_THEME_TOKEN_VALUE_LENGTH && THEME_GEOMETRY_PATTERN.test(trimmed);
}

/** 单条 token 校验；返回 null 表示合法。 */
export function findThemeTokenProblem(key: string, value: string): string | null {
  if (RESERVED_THEME_TOKEN_KEYS.has(key)) {
    return `theme token "${key}" is reserved for user settings and cannot be overridden`;
  }
  if (!THEME_TOKEN_ALLOWED_PATTERN.test(key)) {
    return `theme token "${key}" is outside the --color-* / --radius-* whitelist`;
  }
  if (key.startsWith("--color-") && !isValidThemeColorValue(value)) {
    return `theme token "${key}" has an unsupported color value: ${value}`;
  }
  if (key.startsWith("--radius-") && !isValidThemeGeometryValue(value)) {
    return `theme token "${key}" must use px or rem units: ${value}`;
  }
  return null;
}

export function findThemeTokenProblems(tokens: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    const problem = findThemeTokenProblem(key, value);
    if (problem) {
      problems.push(problem);
    }
  }
  return problems;
}

export const pluginThemeFontSuggestionSchema = z
  .object({
    ui: z.string().trim().min(1).max(128),
    code: z.string().trim().min(1).max(128),
  })
  .strict();

export const pluginThemeFileSchema = z
  .object({
    id: z.string().regex(PLUGIN_THEME_ID_PATTERN),
    name: z.string().trim().min(1).max(64),
    tokens: z
      .object({
        light: z.record(z.string(), z.string()).optional(),
        dark: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    suggestedFonts: pluginThemeFontSuggestionSchema.optional(),
    css: z.string().min(1).max(256).optional(),
  })
  .strict();

export type PluginThemeFile = z.infer<typeof pluginThemeFileSchema>;
export type PluginThemeFontSuggestion = z.infer<typeof pluginThemeFontSuggestionSchema>;

export interface PluginThemeFileParsed {
  id: string;
  name: string;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  suggestedFonts?: PluginThemeFontSuggestion;
  cssFile?: string;
}

/** schema + 语义校验的合并入口；失败时返回首因（含字段路径），供选择器置灰展示。 */
export function parsePluginThemeFile(
  raw: unknown,
): { ok: true; theme: PluginThemeFileParsed } | { ok: false; reason: string } {
  const parsed = pluginThemeFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const prefix = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, reason: `${prefix}${issue?.message ?? "invalid theme.json"}` };
  }
  const data = parsed.data;
  const tokensLight = data.tokens.light ?? {};
  const tokensDark = data.tokens.dark ?? {};
  const problems = [...findThemeTokenProblems(tokensLight), ...findThemeTokenProblems(tokensDark)];
  if (problems.length > 0) {
    return { ok: false, reason: problems.join("; ") };
  }
  return {
    ok: true,
    theme: {
      id: data.id,
      name: data.name,
      tokensLight,
      tokensDark,
      suggestedFonts: data.suggestedFonts,
      cssFile: data.css,
    },
  };
}

/** 受限附加 CSS 黑名单（spec §3.4）：命中任一即整包拒绝；256 KiB 上限。 */
const THEME_CSS_BLOCKED_PATTERN =
  /@import\b|@charset\b|\burl\s*\(|\bimage-set\s*\(|javascript\s*:/i;
const MAX_THEME_CSS_LENGTH = 256 * 1024;

export interface ThemeCssSafetyResult {
  ok: boolean;
  reason?: string;
}

export function scanThemeCssSafety(cssText: string): ThemeCssSafetyResult {
  if (cssText.length > MAX_THEME_CSS_LENGTH) {
    return { ok: false, reason: `theme css exceeds ${MAX_THEME_CSS_LENGTH} bytes` };
  }
  const blocked = THEME_CSS_BLOCKED_PATTERN.exec(cssText);
  if (!blocked) {
    return { ok: true };
  }
  return { ok: false, reason: `theme css contains blocked construct: ${blocked[0].trim()}` };
}

/** 单个主题包（目录）解析后的运行时形态；解析失败 valid=false 并携带原因。 */
export interface PluginThemePackage {
  themeId: string;
  name: string;
  valid: boolean;
  invalidReason?: string;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  suggestedFonts?: PluginThemeFontSuggestion;
  cssText?: string;
  cssStatus: "ok" | "missing" | "rejected";
  cssRejectReason?: string;
}
```

修改 `apps/zcode-cli/packages/contracts/src/plugins/index.ts`：

1. PluginManifest 接口（141-161 行）内按字母序加入字段（`themes` 位于 `skills` 与 `userConfig` 之间）：

```ts
  skills?: unknown;
  themes?: unknown;
  userConfig?: Record<string, PluginUserConfigOption>;
```

2. 文件末尾追加：

```ts
export * from "./theme-package.js";
```

- [ ] **Step 4: 运行确认通过**

Run（`apps/zcode-cli/packages/contracts` 目录）: `node --test test/theme-package.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/contracts/src/plugins/theme-package.ts apps/zcode-cli/packages/contracts/src/plugins/index.ts apps/zcode-cli/packages/contracts/test/theme-package.test.ts
git commit -m "feat(cli-contracts): add plugin theme package schema and css safety scan"
```

---

### Task 2: adapters — 主题包收集器（TDD）

**Files:**
- Modify: `apps/zcode-cli/packages/adapters/src/plugins/plugin-components.ts:183`（collectComponentDirs 加 export）
- Create: `apps/zcode-cli/packages/adapters/src/plugins/theme-package.ts`
- Modify: `apps/zcode-cli/packages/adapters/src/plugins/index.ts`（新增 loadPluginManifestFromRoot + re-export；位于 readManifest 之后 ~L965）
- Test: `apps/zcode-cli/packages/adapters/test/theme-package.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/zcode-cli/packages/adapters/test/theme-package.test.ts`：

```ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectThemePackages } from "../src/plugins/index.ts";

function makeThemeRoot(): string {
  return mkdtempSync(join(tmpdir(), "zcode-themes-"));
}

test("collects valid themes and flags broken ones from default themes dir", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "sereno-dark"), { recursive: true });
    writeFileSync(
      join(root, "themes", "sereno-dark", "theme.json"),
      JSON.stringify({
        id: "sereno-dark",
        name: "Sereno Dark",
        tokens: { light: { "--color-brand": "#7c5cff" }, dark: { "--color-brand": "#9d85ff" } },
        css: "overrides.css",
      }),
    );
    writeFileSync(join(root, "themes", "sereno-dark", "overrides.css"), ".chat-bubble { border-radius: 12px; }");
    mkdirSync(join(root, "themes", "broken"), { recursive: true });
    writeFileSync(join(root, "themes", "broken", "theme.json"), "{ not json");

    const { packages } = collectThemePackages(root, undefined);
    assert.equal(packages.length, 2);
    const valid = packages.find((pkg) => pkg.themeId === "sereno-dark");
    assert.ok(valid);
    assert.equal(valid.valid, true);
    assert.equal(valid.cssStatus, "ok");
    assert.equal(valid.tokensDark["--color-brand"], "#9d85ff");
    const broken = packages.find((pkg) => pkg.themeId === "broken");
    assert.ok(broken);
    assert.equal(broken.valid, false);
    assert.match(broken.invalidReason ?? "", /JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("css blacklist rejection keeps tokens usable with cssStatus rejected", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "badcss"), { recursive: true });
    writeFileSync(
      join(root, "themes", "badcss", "theme.json"),
      JSON.stringify({ id: "badcss", name: "Bad CSS", tokens: {}, css: "evil.css" }),
    );
    writeFileSync(join(root, "themes", "badcss", "evil.css"), '@import url("https://evil.example/x.css");');
    const { packages } = collectThemePackages(root, "themes");
    const pkg = packages.find((item) => item.themeId === "badcss");
    assert.ok(pkg);
    assert.equal(pkg.valid, true);
    assert.equal(pkg.cssStatus, "rejected");
    assert.match(pkg.cssRejectReason ?? "", /blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("css path escaping the theme directory is rejected", () => {
  const root = makeThemeRoot();
  try {
    mkdirSync(join(root, "themes", "escape"), { recursive: true });
    writeFileSync(
      join(root, "themes", "escape", "theme.json"),
      JSON.stringify({ id: "escape", name: "Escape", tokens: {}, css: "../evil.css" }),
    );
    const { packages } = collectThemePackages(root, "themes");
    const pkg = packages.find((item) => item.themeId === "escape");
    assert.ok(pkg);
    assert.equal(pkg.cssStatus, "rejected");
    assert.match(pkg.cssRejectReason ?? "", /escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate theme ids keep the first declaration only", () => {
  const root = makeThemeRoot();
  try {
    for (const dir of ["themes-a", "themes-b"]) {
      mkdirSync(join(root, dir, "dup"), { recursive: true });
      writeFileSync(
        join(root, dir, "dup", "theme.json"),
        JSON.stringify({ id: "dup", name: `Dup-${dir}`, tokens: {} }),
      );
    }
    const { packages } = collectThemePackages(root, ["themes-a", "themes-b"]);
    assert.equal(packages.length, 1);
    assert.equal(packages[0]?.name, "Dup-themes-a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run（`apps/zcode-cli/packages/adapters` 目录）: `node --import tsx --test test/theme-package.test.ts`
Expected: FAIL —— `does not provide an export named 'collectThemePackages'`（tsx 负责解析源码内部 `.js`→`.ts`；无需先构建）。

- [ ] **Step 3: 实现**

1. `plugin-components.ts:183` 把 `function collectComponentDirs(` 改为 `export function collectComponentDirs(`。

2. 创建 `apps/zcode-cli/packages/adapters/src/plugins/theme-package.ts`：

```ts
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
```

3. `apps/zcode-cli/packages/adapters/src/plugins/index.ts` 在 `readManifest`（~L965）之后新增：

```ts
/**
 * 按插件根目录读取 manifest（与 discover 相同的候选路径优先级）；失败返回 null。
 * 主题包收集等展示链路使用，不做启用状态判断。
 */
export function loadPluginManifestFromRoot(rootPath: string): PluginManifest | null {
  const manifestPath = findManifest(rootPath);
  // readManifest 内部已捕获解析异常并返回 null，这里无需重复 try/catch。
  return manifestPath ? readManifest(manifestPath, []) : null;
}
```

并在文件导出区（或末尾）追加：

```ts
export { collectThemePackages } from "./theme-package.js";
```

> **实现落地差异（审查后固化，以代码为准）**：最终实现比上面片段多了以下加固，测试从 4 条扩到 9 条：
> 1. 符号链接三层策略（lstat）：themesDir 是链接 → 跳过；`theme.json` 是链接 → invalid + `must not be a symbolic link`；css 是链接 → `cssStatus:"rejected"` + 同名原因。
> 2. `existsSync` 改用 `helpers.ts` 的 `fileExists`（isFile 语义）；theme.json 的 read 失败与 JSON parse 失败分开报错。
> 3. `themeRoot` 更名为 `themesDir`；去重处补注「同 themeId 保留首个声明（含 invalid 包）」。
> 4. 测试导入 `../src/plugins/index.ts`（tsx 解析源码，不依赖 dist）；新增 junction 目录跳过 ×2、css missing、reserved 语义无效、无 theme.json 子目录不计入等用例。

- [ ] **Step 4: 运行确认通过**

Run（`apps/zcode-cli/packages/adapters` 目录）: `node --import tsx --test test/theme-package.test.ts`
Expected: 全部 PASS（最终实现为 9 条）。

- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/adapters/src/plugins/theme-package.ts apps/zcode-cli/packages/adapters/src/plugins/plugin-components.ts apps/zcode-cli/packages/adapters/src/plugins/index.ts apps/zcode-cli/packages/adapters/test/theme-package.test.ts
git commit -m "feat(cli-adapters): collect theme packages from plugin directories"
```

---

### Task 3: shared — 协议词与 schema

**Files:**
- Modify: `packages/shared/src/zcode-protocol/index.ts`（~L2590 后加 schema；~L3614 pluginsList 旁加方法词）

- [ ] **Step 1: 加 schema（zod v4，两参 record）**

在 `zcodePluginsListResultSchema`（~L2590）之后插入：

```ts
export const zcodeThemeFontSuggestionSchema = z
  .object({
    ui: z.string().optional(),
    code: z.string().optional(),
  })
  .strict();
export type ZCodeThemeFontSuggestion = z.infer<typeof zcodeThemeFontSuggestionSchema>;

export const zcodeThemePackageSchema = z
  .object({
    pluginId: z.string().min(1),
    pluginName: z.string().min(1),
    themeId: z.string().min(1),
    name: z.string().min(1),
    valid: z.boolean(),
    invalidReason: z.string().optional(),
    tokensLight: z.record(z.string(), z.string()),
    tokensDark: z.record(z.string(), z.string()),
    suggestedFonts: zcodeThemeFontSuggestionSchema.optional(),
    cssText: z.string().optional(),
    cssStatus: z.enum(["ok", "missing", "rejected"]),
    cssRejectReason: z.string().optional(),
  })
  .strict();
export type ZCodeThemePackage = z.infer<typeof zcodeThemePackageSchema>;

export const zcodePluginsListThemesParamsSchema = z
  .object({
    workspace: zcodeWorkspaceRefSchema,
    configScope: zcodePluginScopeSchema.optional(),
  })
  .strict();
export type ZCodePluginsListThemesParams = z.infer<typeof zcodePluginsListThemesParamsSchema>;

export const zcodePluginsListThemesResultSchema = z
  .object({
    themes: z.array(zcodeThemePackageSchema),
    diagnostics: z.array(zcodePluginDiagnosticSchema),
  })
  .strict();
export type ZCodePluginsListThemesResult = z.infer<typeof zcodePluginsListThemesResultSchema>;
```

- [ ] **Step 2: 加方法词**

`zcodeProtocolMethods`（~L3614）`pluginsList` 一行后加：

```ts
    pluginsListThemes: "plugins/listThemes",
```

- [ ] **Step 3: 类型检查**

Run（仓库根）: `pnpm exec tsc -b packages/shared`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src/zcode-protocol/index.ts
git commit -m "feat(shared): add plugins/listThemes protocol schema"
```

---

### Task 4: bootstrap — listThemes handler + 注册

**Files:**
- Modify: `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugins.ts`（listPlugins L201-227 之后）
- Modify: `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts`（import ~L61；case ~L646-647）

- [ ] **Step 1: 实现 handler**

`plugins.ts` 中，先在既有 import 块补充：

```ts
// from "@zcode/shared" 的既有 import 追加：
import {
  // ...既有项...
  zcodePluginsListThemesParamsSchema,
  type ZCodePluginsListThemesResult,
  type ZCodeThemePackage,
} from "@zcode/shared";
// from "@zcode/adapters/plugins"（对齐同仓 bootstrap/src/plugins.ts:43 的既有导入写法）：
import { collectThemePackages, loadPluginManifestFromRoot } from "@zcode/adapters/plugins";
```

在 `listPlugins`（L201-227）函数之后新增。**context 参数类型与函数内上下文解析（configResult / logger / workingDirectory 的取得语句）逐字复制上方 listPlugins 的对应行**，其余如下：

```ts
export async function listThemes(
  context: /* 与 listPlugins 相同的 context 参数类型，从上方函数签名复制 */,
  rawParams: unknown,
): Promise<ZCodePluginsListThemesResult> {
  const params = parseParams(zcodePluginsListThemesParamsSchema, rawParams);
  // ↓ 与 listPlugins（同文件 L202-206）的上下文解析语句逐字一致 ↓
  // const { configResult, logger, workingDirectory } = ...（复制）
  const outcome = resolveZCodePlugins({ configResult, logger, workingDirectory });
  const themes: ZCodeThemePackage[] = [];
  for (const plugin of outcome.plugins) {
    if (!plugin.enabled) continue;
    // 无 manifest 或未声明 themes 时仍扫描默认 themes/ 目录（spec §3.1：存在即扫描）。
    const manifest = loadPluginManifestFromRoot(plugin.rootPath);
    const { packages } = collectThemePackages(plugin.rootPath, manifest?.themes);
    for (const pkg of packages) {
      themes.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        themeId: pkg.themeId,
        name: pkg.name,
        valid: pkg.valid,
        ...(pkg.invalidReason !== undefined ? { invalidReason: pkg.invalidReason } : {}),
        tokensLight: pkg.tokensLight,
        tokensDark: pkg.tokensDark,
        ...(pkg.suggestedFonts !== undefined ? { suggestedFonts: pkg.suggestedFonts } : {}),
        ...(pkg.cssText !== undefined ? { cssText: pkg.cssText } : {}),
        cssStatus: pkg.cssStatus,
        ...(pkg.cssRejectReason !== undefined ? { cssRejectReason: pkg.cssRejectReason } : {}),
      });
    }
  }
  return { themes, diagnostics: [] };
}
```

- [ ] **Step 2: 注册方法**

`server.ts`：

1. import 块（L55-70，listPlugins 在 L61）加入 `listThemes`。
2. switch（L646-647 `case zcodeProtocolMethods.pluginsList`）之后加：

```ts
        case zcodeProtocolMethods.pluginsListThemes:
          return await listThemes(this.context, request.params);
```

- [ ] **Step 3: 类型检查**

Run: `pnpm --dir apps/zcode-cli typecheck`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugins.ts apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts
git commit -m "feat(cli): serve plugins/listThemes for enabled plugins"
```

---

### Task 5: services — 链路打通（4 文件）

**Files:**
- Modify: `packages/services/src/zcode-agent/zcodeAgent.ts`（接口，~L605 listPlugins 旁）
- Modify: `packages/services/src/zcode-agent/zcodeAgentService.ts`（实现，~L3896 listPlugins 后）
- Modify: `packages/services/src/plugins/pluginManagement.ts`（接口，~L48）
- Modify: `packages/services/src/plugins/pluginManagementService.ts`（Pick ~L8-30 + 转发 ~L36-56）

- [ ] **Step 1: agent 接口**

`zcodeAgent.ts` L605 `listPlugins` 旁加（并从 `@zcode/shared` 补 `ZCodePluginsListThemesResult` 类型导入）：

```ts
  listThemes(params: ZCodeAgentPluginViewParams): Promise<ZCodePluginsListThemesResult>;
```

- [ ] **Step 2: agent 实现**

`zcodeAgentService.ts` 在 listPlugins 实现（L3866-3896）之后，按其 `client.request(...)` 与 `buildWorkspaceRef(params)` 的既有写法新增（result schema 换成 `zcodePluginsListThemesResultSchema`，方法词 `zcodeProtocolMethods.pluginsListThemes`；从 `@zcode/shared` 补充该 schema 导入）：

```ts
  async listThemes(params: ZCodeAgentPluginViewParams) {
    const client = await getPluginManagementClient();
    return client.request(
      zcodeProtocolMethods.pluginsListThemes,
      {
        workspace: buildWorkspaceRef(params),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      },
      zcodePluginsListThemesResultSchema,
    );
  }
```

- [ ] **Step 3: 薄服务接口与转发**

`pluginManagement.ts` 接口 L48 旁加（补 `ZCodePluginsListThemesResult` 类型导入）：

```ts
  listThemes(params: ZCodeAgentPluginViewParams): Promise<ZCodePluginsListThemesResult>;
```

`pluginManagementService.ts`：依赖 `Pick<IZCodeAgentService, ...>`（L8-30）加入 `"listThemes"`；转发体（L36-56）加入：

```ts
    listThemes: (params) => agent.listThemes(params),
```

RPC/client 层**零改动**（ProxyChannel 按方法名泛化分发，两端自动获得新方法）。

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc -b packages/services packages/shared`
Expected: 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add packages/services/src/zcode-agent/zcodeAgent.ts packages/services/src/zcode-agent/zcodeAgentService.ts packages/services/src/plugins/pluginManagement.ts packages/services/src/plugins/pluginManagementService.ts
git commit -m "feat(services): expose listThemes through plugin management"
```

---

### Task 6: UI 纯逻辑 lib/themePlugin.ts（TDD）+ styles.css 字体变量

**Files:**
- Create: `packages/ui/src/lib/themePlugin.ts`
- Test: `packages/ui/test/themePlugin.test.ts`
- Modify: `packages/ui/src/styles.css`（@theme 块，L139 `--font-mono` 之前）

- [ ] **Step 1: 写失败测试**

创建 `packages/ui/test/themePlugin.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  buildFontStack,
  normalizeFontFamilyInput,
  pickTokensForMode,
  themeEntryKey,
  wrapThemeCss,
} from "../src/lib/themePlugin.ts";

test("themeEntryKey pairs plugin and theme id", () => {
  assert.equal(themeEntryKey({ pluginId: "acme", themeId: "dark" }), "acme/dark");
});

test("pickTokensForMode returns the mode tokens and completeness flag", () => {
  const light = { "--color-brand": "#111111" };
  const dark = { "--color-brand": "#eeeeee" };
  assert.deepEqual(pickTokensForMode(light, dark, "light").tokens, light);
  assert.deepEqual(pickTokensForMode(light, dark, "dark").tokens, dark);
  assert.equal(pickTokensForMode(light, dark, "dark").complete, true);
});

test("pickTokensForMode half-covers when one mode is empty", () => {
  const onlyDark = { "--color-brand": "#eeeeee" };
  const pickedLight = pickTokensForMode({}, onlyDark, "light");
  assert.deepEqual(pickedLight.tokens, {});
  assert.equal(pickedLight.complete, false);
  assert.deepEqual(pickTokensForMode({}, onlyDark, "dark").tokens, onlyDark);
});

test("wrapThemeCss scopes css under #root", () => {
  const wrapped = wrapThemeCss(".chat-bubble { border-radius: 12px; }");
  assert.match(wrapped, /^@scope \(#root\)/);
  assert.match(wrapped, /border-radius: 12px/);
});

test("normalizeFontFamilyInput strips quotes and whitespace and caps length", () => {
  assert.equal(normalizeFontFamilyInput('  "JetBrains Mono"  '), "JetBrains Mono");
  assert.equal(normalizeFontFamilyInput(undefined), "");
  assert.equal(normalizeFontFamilyInput("x".repeat(200)).length, 128);
});

test("buildFontStack composes family with the default stack", () => {
  assert.equal(buildFontStack("", DEFAULT_UI_FONT_STACK), DEFAULT_UI_FONT_STACK);
  assert.equal(buildFontStack("Inter", DEFAULT_UI_FONT_STACK), `"Inter", ${DEFAULT_UI_FONT_STACK}`);
  assert.equal(
    buildFontStack("JetBrains Mono", DEFAULT_CODE_FONT_STACK),
    `"JetBrains Mono", ${DEFAULT_CODE_FONT_STACK}`,
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run（`packages/ui` 目录）: `node --import tsx --test test/themePlugin.test.ts`
Expected: FAIL —— `Cannot find module .../src/lib/themePlugin.ts`。

- [ ] **Step 3: 实现 lib**

创建 `packages/ui/src/lib/themePlugin.ts`。注意：同目录导入用相对路径（node --test 兼容，`cuaPermissionStatusStore.ts` 先例）：

```ts
import { readSafeLocalStorage, writeSafeLocalStorage } from "./browserEnvironment.js";

export const THEME_PLUGIN_STYLE_ELEMENT_ID = "zcode-theme-plugin";
export const ACTIVE_THEME_PLUGIN_STORAGE_KEY = "zcode-active-theme-plugin";
export const UI_FONT_FAMILY_STORAGE_KEY = "zcode-ui-font-family";
export const CODE_FONT_FAMILY_STORAGE_KEY = "zcode-code-font-family";

// 两条默认栈必须与 styles.css @theme 中的 --font-sans / --font-mono 定义保持一致。
export const DEFAULT_UI_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
export const DEFAULT_CODE_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", monospace';

const THEME_SCOPE_CONTAINER = "#root";
const MAX_FONT_FAMILY_LENGTH = 128;

export type ThemeMode = "light" | "dark";

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
```

- [ ] **Step 4: styles.css 加 --font-sans**

`packages/ui/src/styles.css` @theme 块内，`--font-mono:`（L140）之前插入（值与 `DEFAULT_UI_FONT_STACK` 一致）：

```css
  --font-sans:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
    "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
```

- [ ] **Step 5: 运行确认通过**

Run（`packages/ui` 目录）: `node --import tsx --test test/themePlugin.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/lib/themePlugin.ts packages/ui/test/themePlugin.test.ts packages/ui/src/styles.css
git commit -m "feat(ui): add theme plugin token/css/font application lib"
```

---

### Task 7: store — 三字段 + 跨窗口广播

**Files:**
- Modify: `packages/ui/src/store/index.ts`（5 个插入点）

- [ ] **Step 1: 导入**

文件顶部既有 `@/lib/uiFontSize.js` 导入旁加：

```ts
import {
  ACTIVE_THEME_PLUGIN_STORAGE_KEY,
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
```

- [ ] **Step 2: state 声明（L119-121 uiFontSizePx 声明旁）**

```ts
  /** 当前生效的主题插件主题 key（`${pluginId}/${themeId}`）；null 表示未启用。 */
  activeThemePluginKey: string | null;
  setActiveThemePluginKey: (key: string | null) => void;
  /** 界面字体族；空字符串表示跟随默认字体栈。 */
  uiFontFamily: string;
  setUiFontFamily: (family: string) => void;
  /** 代码字体族；空字符串表示跟随默认等宽字体栈。 */
  codeFontFamily: string;
  setCodeFontFamily: (family: string) => void;
```

- [ ] **Step 3: 广播字段（L214-219）**

```ts
const BROADCAST_FIELDS = new Set([
  "theme",
  "locale",
  "uiFontSizePx",
  "interfaceMode",
  "activeThemePluginKey",
  "uiFontFamily",
  "codeFontFamily",
]);

type BroadcastField =
  | "theme"
  | "locale"
  | "uiFontSizePx"
  | "interfaceMode"
  | "activeThemePluginKey"
  | "uiFontFamily"
  | "codeFontFamily";
```

- [ ] **Step 4: 初始值与 setter（L288-294 setUiFontSizePx 旁，模式一致：normalize → persist → apply → set）**

```ts
      activeThemePluginKey: loadActiveThemePluginKey(),
      setActiveThemePluginKey: (key) => {
        const normalizedKey = typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
        persistActiveThemePluginKey(normalizedKey);
        // token/CSS 的 DOM 应用由 App 级 useThemePluginApplication effect 重放（需要主题数据）。
        set({ activeThemePluginKey: normalizedKey });
      },
      uiFontFamily: loadFontFamilyPreference(UI_FONT_FAMILY_STORAGE_KEY),
      setUiFontFamily: (family) => {
        const normalizedFamily = normalizeFontFamilyInput(family);
        persistFontFamily(UI_FONT_FAMILY_STORAGE_KEY, normalizedFamily);
        applyUiFontFamily(normalizedFamily);
        set({ uiFontFamily: normalizedFamily });
      },
      codeFontFamily: loadFontFamilyPreference(CODE_FONT_FAMILY_STORAGE_KEY),
      setCodeFontFamily: (family) => {
        const normalizedFamily = normalizeFontFamilyInput(family);
        persistFontFamily(CODE_FONT_FAMILY_STORAGE_KEY, normalizedFamily);
        applyCodeFontFamily(normalizedFamily);
        set({ codeFontFamily: normalizedFamily });
      },
```

- [ ] **Step 5: onMessage 分发（L470-485 的 uiFontSizePx 分支后）**

```ts
        } else if (field === "activeThemePluginKey") {
          state.setActiveThemePluginKey(typeof msg.payload === "string" && msg.payload ? msg.payload : null);
        } else if (field === "uiFontFamily" && typeof msg.payload === "string") {
          state.setUiFontFamily(msg.payload);
        } else if (field === "codeFontFamily" && typeof msg.payload === "string") {
          state.setCodeFontFamily(msg.payload);
        }
```

- [ ] **Step 6: 初始化块（L491-497，applyUiFontSizePx 旁）**

```ts
        applyUiFontFamily(useStore.getState().uiFontFamily);
        applyCodeFontFamily(useStore.getState().codeFontFamily);
```

- [ ] **Step 7: 类型检查**

Run: `pnpm exec tsc -b packages/ui`
Expected: 退出码 0。

- [ ] **Step 8: 提交**

```bash
git add packages/ui/src/store/index.ts
git commit -m "feat(ui): persist theme plugin and font family preferences"
```

---

### Task 8: hooks/useThemePlugins.ts + App 接线

**Files:**
- Create: `packages/ui/src/hooks/useThemePlugins.ts`
- Modify: `packages/ui/src/App.tsx`（import 块 + 组件体 L356 附近）

- [ ] **Step 1: 实现钩子**

创建 `packages/ui/src/hooks/useThemePlugins.ts`：

```ts
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

export function useThemePlugins(
  workspacePath: string | null | undefined,
): { themes: ZCodeThemePackage[]; status: ThemePluginsStatus; refresh: () => void } {
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
    applyPluginThemeCss(entry.cssStatus === "ok" && typeof entry.cssText === "string" ? entry.cssText : null);
  }, [activeThemePluginKey, themes, status, theme]);
}
```

- [ ] **Step 2: App 接线**

`App.tsx` import 块加：

```ts
import { useThemePluginApplication } from "@/hooks/useThemePlugins.js";
```

App 组件体内、L356 `const theme = useZCodeStore((s) => s.theme);` 附近加：

```ts
  useThemePluginApplication();
```

> **实现落地差异（审查后固化，以代码为准）**：
> 1. 新增内部 `useResolvedThemeMode`（`theme === "system"` 时订阅 matchMedia change 并 bump revision），application effect 依赖 `resolvedMode` 而非 `theme`——否则 OS 明暗切换时 store 值不变、effect 不会重放（spec §4.2 第 2 步）。
> 2. 列表 ready 且找不到 entry 时，除 DOM 回退外还会 `setActiveThemePluginKey(null)`（spec §4.2 第 1 步的"清空 store 字段"）。
> 3. `useThemePlugins` 进入 loading 时同时 `setThemes([])`，避免用旧 workspace 列表短暂匹配 key。

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc -b packages/ui`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/hooks/useThemePlugins.ts packages/ui/src/App.tsx
git commit -m "feat(ui): apply active theme plugin at app level"
```

---

### Task 9: 设置 UI — 主题包/字体选择器 + i18n

**Files:**
- Create: `packages/ui/src/settings/fontFamilySelect.tsx`
- Modify: `packages/ui/src/settingsCodePreview.tsx`（props L81-95；界面卡 L154 后两行；代码卡 L240 后一行）
- Modify: `packages/ui/src/SettingsPage.tsx`（store 读取 L340-345；useThemePlugins ~L622；props 传递 L1785-1806）
- Modify: `packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`

- [ ] **Step 1: FontFamilySelect 组件**

创建 `packages/ui/src/settings/fontFamilySelect.tsx`：

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const UI_FONT_OPTIONS = [
  "system-ui",
  "Segoe UI",
  "PingFang SC",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Inter",
  "Roboto",
  "Arial",
];
const CODE_FONT_OPTIONS = [
  "Consolas",
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Courier New",
  "Sarasa Mono SC",
];
const CUSTOM_FONT_SENTINEL = "__custom__";

export function FontFamilySelect({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (family: string) => void;
  kind: "ui" | "code";
}) {
  const { intl } = useZCodeIntl();
  const options = kind === "ui" ? UI_FONT_OPTIONS : CODE_FONT_OPTIONS;
  const [isCustom, setIsCustom] = useState(() => value.length > 0 && !options.includes(value));
  return (
    <div className="flex w-[260px] min-w-0 flex-col gap-1">
      <Select
        value={isCustom ? CUSTOM_FONT_SENTINEL : value}
        onValueChange={(next) => {
          if (next === CUSTOM_FONT_SENTINEL) {
            setIsCustom(true);
            return;
          }
          setIsCustom(false);
          onChange(next);
        }}
      >
        <SelectTrigger size="lg" className="w-full min-w-0 justify-between">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{intl.formatMessage({ id: "settings.fontFamily.default" })}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_FONT_SENTINEL}>
            {intl.formatMessage({ id: "settings.fontFamily.custom" })}
          </SelectItem>
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          value={value}
          placeholder={intl.formatMessage({ id: "settings.fontFamily.customPlaceholder" })}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: settingsCodePreview.tsx 三行设置项**

`AppearanceSectionContent` props（L81-95）追加：

```ts
  themePlugins: ZCodeThemePackage[];
  activeThemePluginKey: string | null;
  setActiveThemePluginKey: (key: string | null) => void;
  uiFontFamily: string;
  setUiFontFamily: (family: string) => void;
  codeFontFamily: string;
  setCodeFontFamily: (family: string) => void;
```

组件体内计算（imports 补 `type { ZCodeThemePackage }` from `@zcode/shared`、`themeEntryKey`/`pickTokensForMode` from `@/lib/themePlugin.js`、`FontFamilySelect` from `@/settings/fontFamilySelect.js`、`Button` from `@/components/ui/button.js`）：

```ts
  const activeThemeEntry = themePlugins.find(
    (candidate) => themeEntryKey(candidate) === activeThemePluginKey,
  );
  const partialMode =
    activeThemeEntry && activeThemeEntry.valid
      ? Object.keys(activeThemeEntry.tokensLight).length === 0
        ? "light"
        : Object.keys(activeThemeEntry.tokensDark).length === 0
          ? "dark"
          : null
      : null;
```

界面设置卡（L154 uiFontSize 行 `/>` 之后、`</CardContent>` 之前）插入：

```tsx
            <SettingsRow
              label={intl.formatMessage({ id: "settings.themePlugin" })}
              description={intl.formatMessage({ id: "settings.themePluginDescription" })}
            >
              <Select
                value={activeThemePluginKey ?? ""}
                onValueChange={(value) => setActiveThemePluginKey(value === "" ? null : value)}
              >
                <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{intl.formatMessage({ id: "settings.themePlugin.none" })}</SelectItem>
                  {themePlugins.map((entry) => (
                    <SelectItem key={themeEntryKey(entry)} value={themeEntryKey(entry)} disabled={!entry.valid}>
                      {entry.valid
                        ? intl.formatMessage({ id: "settings.themePlugin.entry" }, { name: entry.name, plugin: entry.pluginName })
                        : intl.formatMessage({ id: "settings.themePlugin.invalid" }, { name: entry.name, reason: entry.invalidReason ?? "" })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            {partialMode ? (
              <div className="px-4 pb-2 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "settings.themePlugin.partialMode" }, { mode: partialMode === "dark" ? intl.formatMessage({ id: "settings.themeMode.dark" }) : intl.formatMessage({ id: "settings.themeMode.light" }) })}
              </div>
            ) : null}
            {activeThemeEntry?.valid && activeThemeEntry.suggestedFonts ? (
              <div className="flex items-center gap-2 px-4 pb-3">
                <span className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.themePlugin.suggestedFonts" }, {
                    fonts: [activeThemeEntry.suggestedFonts.ui, activeThemeEntry.suggestedFonts.code]
                      .filter(Boolean)
                      .join(" / "),
                  })}
                </span>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    if (activeThemeEntry.suggestedFonts?.ui) setUiFontFamily(activeThemeEntry.suggestedFonts.ui);
                    if (activeThemeEntry.suggestedFonts?.code) setCodeFontFamily(activeThemeEntry.suggestedFonts.code);
                  }}
                >
                  {intl.formatMessage({ id: "settings.themePlugin.applySuggested" })}
                </Button>
              </div>
            ) : null}
            <SettingsRow
              label={intl.formatMessage({ id: "settings.uiFontFamily" })}
              description={intl.formatMessage({ id: "settings.uiFontFamilyDescription" })}
            >
              <FontFamilySelect kind="ui" value={uiFontFamily} onChange={setUiFontFamily} />
            </SettingsRow>
```

代码设置卡（L240 fontSize 行 `/>` 之后、`</CardContent>` 之前）插入：

```tsx
            <SettingsRow
              label={intl.formatMessage({ id: "settings.codeFontFamily" })}
              description={intl.formatMessage({ id: "settings.codeFontFamilyDescription" })}
            >
              <FontFamilySelect kind="code" value={codeFontFamily} onChange={setCodeFontFamily} />
            </SettingsRow>
```

- [ ] **Step 3: SettingsPage 接线**

1. L340-345 store 读取区追加：

```ts
  const activeThemePluginKey = useZCodeStore((state) => state.activeThemePluginKey);
  const setActiveThemePluginKey = useZCodeStore((state) => state.setActiveThemePluginKey);
  const uiFontFamily = useZCodeStore((state) => state.uiFontFamily);
  const setUiFontFamily = useZCodeStore((state) => state.setUiFontFamily);
  const codeFontFamily = useZCodeStore((state) => state.codeFontFamily);
  const setCodeFontFamily = useZCodeStore((state) => state.setCodeFontFamily);
```

2. L622 `activeWorkspacePath` 之后加：

```ts
  const { themes: themePlugins, refresh: refreshThemePlugins } = useThemePlugins(activeWorkspacePath);
```

（import `useThemePlugins` from `@/hooks/useThemePlugins.js`。）

3. L1785-1806 外观内容传参处追加 props：

```tsx
                            themePlugins={themePlugins}
                            activeThemePluginKey={activeThemePluginKey}
                            setActiveThemePluginKey={setActiveThemePluginKey}
                            uiFontFamily={uiFontFamily}
                            setUiFontFamily={setUiFontFamily}
                            codeFontFamily={codeFontFamily}
                            setCodeFontFamily={setCodeFontFamily}
```

- [ ] **Step 4: i18n**

`zh-CN.ts`（`settings.uiFontSize` 附近）：

```ts
  "settings.themePlugin": "主题包",
  "settings.themePluginDescription": "选择已安装主题插件提供的主题，卸载对应插件后自动回退默认主题。",
  "settings.themePlugin.none": "不使用（内置主题）",
  "settings.themePlugin.entry": "{name}（{plugin}）",
  "settings.themePlugin.invalid": "{name}（无效：{reason}）",
  "settings.themePlugin.partialMode": "该主题仅覆盖{mode}模式，另一模式沿用内置配色。",
  "settings.themePlugin.suggestedFonts": "该主题建议字体：{fonts}",
  "settings.themePlugin.applySuggested": "一键应用",
  "settings.uiFontFamily": "界面字体",
  "settings.uiFontFamilyDescription": "选择界面文字使用的字体族，留空跟随默认字体栈。",
  "settings.codeFontFamily": "代码字体",
  "settings.codeFontFamilyDescription": "选择代码、终端和 Diff 使用的等宽字体族，独立于界面字体。",
  "settings.fontFamily.default": "默认字体",
  "settings.fontFamily.custom": "自定义…",
  "settings.fontFamily.customPlaceholder": "输入系统字体名称，如 JetBrains Mono",
```

`en-US.ts`：

```ts
  "settings.themePlugin": "Theme packs",
  "settings.themePluginDescription": "Pick a theme provided by an installed theme plugin. Uninstalling the plugin falls back to the built-in theme.",
  "settings.themePlugin.none": "None (built-in themes)",
  "settings.themePlugin.entry": "{name} ({plugin})",
  "settings.themePlugin.invalid": "{name} (invalid: {reason})",
  "settings.themePlugin.partialMode": "This theme only overrides the {mode} mode; the other mode keeps built-in colors.",
  "settings.themePlugin.suggestedFonts": "Suggested fonts: {fonts}",
  "settings.themePlugin.applySuggested": "Apply",
  "settings.uiFontFamily": "UI font",
  "settings.uiFontFamilyDescription": "Choose the font family for interface text. Leave empty to follow the default stack.",
  "settings.codeFontFamily": "Code font",
  "settings.codeFontFamilyDescription": "Choose the monospace font family for code, terminal, and diffs. Independent from the UI font.",
  "settings.fontFamily.default": "Default font",
  "settings.fontFamily.custom": "Custom…",
  "settings.fontFamily.customPlaceholder": "Enter a system font name, e.g. JetBrains Mono",
```

> **实现落地差异（审查后固化，以代码为准）**：
> 1. `SettingsRow` 实际 API 为 `control={...}`（非 children），三个选择器按其改写。
> 2. Radix `SelectItem` 不接受空字符串 value（运行期 throw）：主题选择器用 `__none__` 哨兵、字体选择器用 `__default__` 哨兵映射回 `null`/`""`（对齐 `RemoteConnectionFields` 的 `DEFAULT_WSL_DISTRO_VALUE` 先例）。
> 3. 为守住 `settingsCodePreview.tsx` 的 max-lines 400，主题包行与半覆盖/建议字体提示抽为 `settings/themePluginSelect.tsx`（与 `fontFamilySelect.tsx` 同构）。
> 4. 半覆盖提示改用 `lib/themePlugin.ts` 的 `resolveDeclaredThemeMode(tokensLight, tokensDark)`：返回主题实际覆盖的唯一模式，双声明/双空返回 null（不提示）。
> 5. `fontFamilySelect` 的 isCustom 由 value 确定性推导：外部重置为 `""` 时收起自定义输入框。

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc -b packages/ui` 然后 `pnpm lint`
Expected: 双双退出码 0（lint 若有基线问题，只处理本次新增文件的告警）。

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/settings/fontFamilySelect.tsx packages/ui/src/settingsCodePreview.tsx packages/ui/src/SettingsPage.tsx packages/ui/src/i18n/locales/zh-CN.ts packages/ui/src/i18n/locales/en-US.ts
git commit -m "feat(ui): add theme plugin and font family settings selectors"
```

---

### Task 10: 示例主题包 + 主题作者文档

> **路径已作废提示**：本节的 `fixtures/sereno-theme/` 原始路径已被实现取代为 `fixtures/sereno-marketplace/`（目录市场结构：根 `marketplace.json` + `plugins/sereno-theme/`），详见本任务末的"实现落地差异"注记与 Task 11 E2E 路径。

**Files:**
- Create: `apps/zcode-cli/packages/adapters/test/fixtures/sereno-marketplace/marketplace.json`
- Create: `apps/zcode-cli/packages/adapters/test/fixtures/sereno-marketplace/plugins/sereno-theme/.zcode-plugin/plugin.json`
- Create: `apps/zcode-cli/packages/adapters/test/fixtures/sereno-marketplace/plugins/sereno-theme/themes/sereno-dark/theme.json`
- Create: `apps/zcode-cli/packages/adapters/test/fixtures/sereno-marketplace/plugins/sereno-theme/themes/sereno-dark/overrides.css`
- Create: `docs/theme-plugin-authoring.md`

- [ ] **Step 1: 示例主题包**

`plugin.json`：

```json
{
  "name": "sereno-theme",
  "version": "1.0.0",
  "description": "Sereno 主题示例：演示 themes 组件类型的最低要求",
  "author": { "name": "ZCode Example" },
  "themes": "themes"
}
```

`themes/sereno-dark/theme.json`：

```json
{
  "id": "sereno-dark",
  "name": "Sereno Dark",
  "tokens": {
    "light": { "--color-brand": "#6d5bd0", "--radius-lg": "0.75rem" },
    "dark": { "--color-brand": "#a996ff" }
  },
  "suggestedFonts": { "ui": "Inter", "code": "JetBrains Mono" },
  "css": "overrides.css"
}
```

`themes/sereno-dark/overrides.css`：

```css
/* 示例附加样式：只在 #root 作用域内生效（注入时由 @scope 包裹）。 */
.markdown-body h1 {
  letter-spacing: 0.01em;
}
```

> **实现落地差异（审查后固化，以代码为准）**：
> 1. 目录型市场源要求所选目录内含市场清单（`marketplace.ts` `findMarketplaceManifestPath`：`.claude-plugin/marketplace.json` 优先，其次根 `marketplace.json`），只有插件根的 fixture 实测报 `Marketplace manifest not found in directory`；示例因此重组为本地目录市场 `sereno-marketplace/`（根 `marketplace.json` + `plugins/sereno-theme/`），旧 `sereno-theme/` 路径作废，作者文档同步改写。
> 2. 示例附加 CSS 的选择器改用应用真实存在的 `.text-wrap-phrase`（`packages/ui/src/styles.css:68`，用于自动化/已保存工作流描述文本），原 `.markdown-body` 在应用里不存在，无法观察。

- [ ] **Step 2: 作者文档**

创建 `docs/theme-plugin-authoring.md`（内容：manifest `themes` 字段说明、theme.json 格式与 token 白名单 `--color-*`/`--radius-*`、保留变量清单、附加 CSS 黑名单与 `@scope (#root)` 语义、256 KiB 上限、suggestedFonts 行为、威胁模型声明——黑名单非恶意对抗级沙箱、完整示例指向 `apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme/`）。

- [ ] **Step 3: 提交**

```bash
git add apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme docs/theme-plugin-authoring.md
git commit -m "docs: add theme plugin example and authoring guide"
```

---

### Task 11: 全量验证

- [ ] **Step 1: 单测**

Run:
```bash
node --test apps/zcode-cli/packages/contracts/test/theme-package.test.ts
node --test apps/zcode-cli/packages/adapters/test/theme-package.test.ts
node --test packages/ui/test/themePlugin.test.ts
```
（前两条在 `apps/zcode-cli` 目录下执行亦可。）Expected: 全部 PASS。

- [ ] **Step 2: 仓库级检查**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm architecture:check --changed
```
Expected: 退出码 0。如架构检查对新增文件报越界，按提示读取目标模块受控上下文后修正导入方向（UI 只经 hooks/service 访问、CLI 层不得反向依赖 UI）。

- [ ] **Step 3: knip（可选但推荐）**

Run: `pnpm knip`
Expected: 无本次新增导出被报未使用（`loadPluginManifestFromRoot`、`isValidThemeColorValue` 等如被报，确认是否确无消费方后收窄导出面）。

- [ ] **Step 4: 手动 E2E（Desktop）**

1. `pnpm dev:desktop` 启动。
2. 设置 → 插件商店 → 个人来源 → 添加本地目录：选 `apps/zcode-cli/packages/adapters/test/fixtures/sereno-marketplace`（目录市场），安装并启用 `sereno-theme`。
3. 设置 → 外观：主题包选择器出现「Sereno Dark（sereno-theme）」；选择后界面品牌色变化；切深/浅色模式 token 正确跟随。
4. 界面/代码字体选择器切换即时生效；「一键应用」写入建议字体。
5. 停用/卸载插件：自动回退默认主题，DevTools 确认 `<style id="zcode-theme-plugin">` 已移除、根节点无残留 token 内联变量。
6. 多窗口：另一窗口主题/字体同步（广播）。

- [ ] **Step 5: 手动 E2E（Web）**

Run: `pnpm dev:web`，浏览器打开 `http://localhost:5173`，重复上面 2-5（主题/字体生效即证明内容态下发链路可用）。

- [ ] **Step 6: 收尾**

如实记录已执行/未执行清单到 PR 描述；未覆盖平台（macOS/Linux）按 CLI AGENTS.md 跨平台规范在说明中标注剩余风险。

---

## 自审记录（writing-plans self-review）

1. **Spec 覆盖**：token 白名单（T1）、CSS 黑名单 + 256KiB（T1/T2）、目录发现与去重（T2）、协议内容态下发（T3/T4）、services 薄链路（T5）、幂等应用/回退/明暗重放（T6/T8）、store 持久化与广播（T7）、设置 UI 三选择器 + suggestedFonts 不静默覆盖（T9）、半覆盖标注（T6/T9）、示例与文档（T10）、验收（T11）。✔ 无缺口。
2. **占位符扫描**：唯一非完整代码点是 T4 handler 的 context 解析三行——已明确指示「逐字复制同文件 listPlugins L202-206」，执行者打开该文件即可完成，不属于 TBD。✔
3. **类型一致性**：`ZCodeThemePackage`（shared）↔ `PluginThemePackage`（contracts）字段一一对应；`themeEntryKey`/`pickTokensForMode` 在 T6 定义、T8/T9 使用一致；store 字段名 `activeThemePluginKey`/`uiFontFamily`/`codeFontFamily` 全程一致。✔
