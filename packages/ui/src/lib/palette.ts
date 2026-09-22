/**
 * 主色 × 底色调色盘 —— 预设色表、持久化与 html 内联 token 应用
 * （spec：docs/superpowers/specs/2026-09-22-color-palette-design.md）。
 * 色值转录自用户 schemes.css/surfaces.css（2026-09-22）。
 *
 * 与主题插件（themePlugin.ts 的 appliedThemeTokenKeys）各自维护独立的
 * tracked keys：两系统写同一批内联变量，但记录互不共享，插件↔调色盘切换时
 * 各自只清自己的 key，保证任一方向都由后跑的 effect 收敛（spec §1/§4）。
 */
import { readSafeLocalStorage, writeSafeLocalStorage } from "@/lib/browserEnvironment.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

export const PALETTE_PRIMARY_STORAGE_KEY = "zcode-palette-primary";
export const PALETTE_BASE_STORAGE_KEY = "zcode-palette-base";

export const DEFAULT_PALETTE_PRIMARY_ID = "graphite";
export const DEFAULT_PALETTE_BASE_ID = "dune";

export type PaletteMode = "light" | "dark";

/** 每个预设色：同一 id 的 light/dark 两组 token（spec §3 色表结构）。 */
export interface PaletteColor {
  id: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 底色阶梯派生公式
//
// 全部基于该组显式基值（--color-background / --color-card / --color-foreground）
// 用 color-mix 展开；明暗两组共用同一串公式——公式里的 var() 在运行时取到
// 当前模式各自的基值，浅组自然得到「浅底深字」的阶梯、深组得到「深底浅字」。
// 意图对照默认实现：
// - header/panel/sidebar 等结构面贴底色微抬（mix 向 foreground 4%）；
// - popover/input/menu/toast/tab-active 与卡片同层（直接取 --color-card）；
// - card-selected/tag/secondary 向 foreground 沉降 10%/16%，形成选中与弱化层级；
// - background-alt 是结构面色 60% 的半透明纱（原实现为 neutral-100 60% 纱）。
// ---------------------------------------------------------------------------
const BASE_SURFACE_DERIVED: Record<string, string> = {
  "--color-background-alt": "color-mix(in oklab, var(--color-header) 60%, transparent)",
  "--color-header": "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-panel": "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-sidebar": "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-popover-header":
    "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-tooltip": "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-tab": "color-mix(in oklab, var(--color-background) 96%, var(--color-foreground))",
  "--color-menu-hover": "color-mix(in oklab, var(--color-background) 94%, var(--color-foreground))",
  "--color-card-selected":
    "color-mix(in oklab, var(--color-background) 90%, var(--color-foreground))",
  "--color-tag": "color-mix(in oklab, var(--color-background) 90%, var(--color-foreground))",
  "--color-tooltip-tag": "color-mix(in oklab, var(--color-background) 90%, var(--color-foreground))",
  "--color-secondary": "color-mix(in oklab, var(--color-background) 84%, var(--color-foreground))",
  "--color-popover": "var(--color-card)",
  "--color-input": "var(--color-card)",
  "--color-menu": "var(--color-card)",
  "--color-toast": "var(--color-card)",
  "--color-tab-active": "var(--color-card)",
  "--color-input-focused": "var(--color-background)",
};

// ---------------------------------------------------------------------------
// 主色族派生公式
//
// 除 --color-brand（← 用户 --accent hex）与 --color-accent（← 用户 --accent-soft
// rgba 原值，每 scheme 显式给出）外，其余全部引用 var(--color-brand) 与基值
// var()，六个主色共用同一套公式。用户块的 accent-strong/deep/ink/on-soft/softer/
// line/glow/aura-* 不映射——派生公式已覆盖同等语义。意图对照默认实现：
// - ask-surface：品牌在卡片（浅）或背景（深）上的淡染弱强调面；
// - ask-foreground：浅组把品牌压暗、深组把品牌提亮，保证弱强调面上的可读；
// - file-node*：品牌色纱（16%/24% 透明），foreground 浅组直取品牌、深组提亮；
// - git-renamed / usage-chart-1 / input-border-focused：直接跟随品牌
//   （zai 两块的 input-border-focused 原本引用 border-hover，必须显式覆盖，spec §1）；
// - context-breakdown-1..7：品牌 → 背景色的 7 级梯度，明暗两组方向都成立。
const PRIMARY_LIGHT_DERIVED: Record<string, string> = {
  "--color-interaction-ask-surface":
    "color-mix(in oklab, var(--color-brand) 10%, var(--color-card))",
  "--color-interaction-ask-foreground":
    "color-mix(in oklab, var(--color-brand) 72%, #0b1220)",
  "--color-file-node": "color-mix(in oklab, var(--color-brand) 16%, transparent)",
  "--color-file-node-hover": "color-mix(in oklab, var(--color-brand) 24%, transparent)",
  "--color-file-node-foreground": "var(--color-brand)",
  "--color-git-renamed": "var(--color-brand)",
  "--color-usage-chart-1": "var(--color-brand)",
  "--color-input-border-focused": "var(--color-brand)",
  "--color-context-breakdown-1": "color-mix(in oklab, var(--color-brand) 100%, var(--color-background))",
  "--color-context-breakdown-2": "color-mix(in oklab, var(--color-brand) 78%, var(--color-background))",
  "--color-context-breakdown-3": "color-mix(in oklab, var(--color-brand) 60%, var(--color-background))",
  "--color-context-breakdown-4": "color-mix(in oklab, var(--color-brand) 46%, var(--color-background))",
  "--color-context-breakdown-5": "color-mix(in oklab, var(--color-brand) 34%, var(--color-background))",
  "--color-context-breakdown-6": "color-mix(in oklab, var(--color-brand) 24%, var(--color-background))",
  "--color-context-breakdown-7": "color-mix(in oklab, var(--color-brand) 16%, var(--color-background))",
};

const PRIMARY_DARK_DERIVED: Record<string, string> = {
  "--color-interaction-ask-surface":
    "color-mix(in oklab, var(--color-brand) 20%, var(--color-background))",
  "--color-interaction-ask-foreground": "color-mix(in oklab, var(--color-brand) 65%, #ffffff)",
  "--color-file-node": "color-mix(in oklab, var(--color-brand) 18%, transparent)",
  "--color-file-node-hover": "color-mix(in oklab, var(--color-brand) 26%, transparent)",
  "--color-file-node-foreground": "color-mix(in oklab, var(--color-brand) 75%, #ffffff)",
  "--color-git-renamed": "var(--color-brand)",
  "--color-usage-chart-1": "var(--color-brand)",
  "--color-input-border-focused": "var(--color-brand)",
  "--color-context-breakdown-1": "color-mix(in oklab, var(--color-brand) 100%, var(--color-background))",
  "--color-context-breakdown-2": "color-mix(in oklab, var(--color-brand) 78%, var(--color-background))",
  "--color-context-breakdown-3": "color-mix(in oklab, var(--color-brand) 60%, var(--color-background))",
  "--color-context-breakdown-4": "color-mix(in oklab, var(--color-brand) 46%, var(--color-background))",
  "--color-context-breakdown-5": "color-mix(in oklab, var(--color-brand) 34%, var(--color-background))",
  "--color-context-breakdown-6": "color-mix(in oklab, var(--color-brand) 24%, var(--color-background))",
  "--color-context-breakdown-7": "color-mix(in oklab, var(--color-brand) 16%, var(--color-background))",
};

// ---------------------------------------------------------------------------
// 色表（spec §3；色值终版转录自用户 schemes.css/surfaces.css，2026-09-22）
//
// 底色映射（[data-surface] 块，每 mode 仅 4 项显式输入，其余 18 项走阶梯派生）：
// - background ← --canvas；card ← light: --panel / dark: --raised；
//   background-win-alt ← light: --sunken（浅色略深于底）/ dark: --raised（深色略亮于底）；
// - foreground ← --ink：surface 块未直接给出 --ink（仅 contrast 主色块有），
//   转录取同块 --line 的 rgba 基色（去 alpha）——每块唯一且全块同基色的
//   文本向对比色，即该面 ink（浅组深字、深组浅字；AA 断言见 palette.test.ts）；
// - --line/--line-strong/--line-quiet/--track/--floating/--overlay/--scrim 不映射：
//   本仓 border/surface 用黑白 alpha 自适应新底色（spec §1 非目标）；
// - mist（基准面）：用户 surfaces.css 不含 mist → 4 输入皆空 → buildSurfaceTokens
//   返回 {}，选中即零覆盖、整体回退内置主题值。
// ---------------------------------------------------------------------------

type SurfaceExplicitTokens = {
  "--color-background": string;
  "--color-foreground": string;
  "--color-card": string;
  "--color-background-win-alt": string;
};

/** 4 项显式基值 + 18 项 color-mix 阶梯；null → 空对象（mist 基准面零覆盖）。 */
function buildSurfaceTokens(explicit: SurfaceExplicitTokens | null): Record<string, string> {
  if (!explicit) {
    return {};
  }
  return { ...explicit, ...BASE_SURFACE_DERIVED };
}

// contrast 块的 --ok/--warn/--danger/--info/--idle/--meter 语义色**不映射**：
// styles.css grep 无 --color-ok/warn/danger/info/idle/meter 同名消费方；
// 语义最近的 success/warning/destructive 是「填充 + 固定前景字」配对
// （styles.css L264-272），深色组亮色填充（如 --ok:#4bc95f）配白字对比跌到 ~2:1；
// 且 --color-idle-task 是紫色 idle 队列专用色而非中性 idle——按回退条款跳过。
const CONTRAST_SURFACE: { light: SurfaceExplicitTokens; dark: SurfaceExplicitTokens } = {
  light: {
    "--color-background": "#fdfefe",
    "--color-foreground": "#0b1618",
    "--color-card": "#ffffff",
    "--color-background-win-alt": "#eef3f3",
  },
  dark: {
    "--color-background": "#05080b",
    "--color-foreground": "#e9f1f2",
    "--color-card": "#121b21",
    "--color-background-win-alt": "#121b21",
  },
};

function baseColor(
  id: string,
  light: SurfaceExplicitTokens | null,
  dark: SurfaceExplicitTokens | null,
): PaletteColor {
  return {
    id,
    light: buildSurfaceTokens(light),
    dark: buildSurfaceTokens(dark),
  };
}

function primaryColor(
  id: string,
  light: { brand: string; accentSoft: string },
  dark: { brand: string; accentSoft: string },
  // contrast 特例：块内除 accent 外还带表层（canvas/sunken/panel/raised/ink…），
  // 按底色同一映射函数构建一套 base tokens；buildPaletteTokens 合并顺序为
  // 底色在前、主色覆盖在后 → contrast 表层盖掉所选底色（对应用户文件
  // "contrast 会盖掉所选底色" 的级联语义）。
  surface?: { light: SurfaceExplicitTokens; dark: SurfaceExplicitTokens },
): PaletteColor {
  return {
    id,
    light: {
      ...(surface ? buildSurfaceTokens(surface.light) : {}),
      // brand ← --accent（hex 原值）；accent ← --accent-soft（rgba 原值，主色淡染 wash）。
      "--color-brand": light.brand,
      "--color-accent": light.accentSoft,
      ...PRIMARY_LIGHT_DERIVED,
    },
    dark: {
      ...(surface ? buildSurfaceTokens(surface.dark) : {}),
      "--color-brand": dark.brand,
      "--color-accent": dark.accentSoft,
      ...PRIMARY_DARK_DERIVED,
    },
  };
}

/** 主色 6（spec §3）：aurora 极光青绿 / cyan 冰青 / indigo 靛蓝 / violet 紫罗兰 / graphite 石墨 / contrast 高对比 AAA。 */
export const PALETTE_PRIMARY_COLORS: readonly PaletteColor[] = [
  primaryColor(
    "aurora",
    { brand: "#0b7a5c", accentSoft: "rgba(11,127,96,0.09)" },
    { brand: "#35dcae", accentSoft: "rgba(53,220,174,0.12)" },
  ),
  primaryColor(
    "cyan",
    { brand: "#0a6f86", accentSoft: "rgba(10,111,134,0.09)" },
    { brand: "#2ac2e0", accentSoft: "rgba(42,194,224,0.12)" },
  ),
  primaryColor(
    "indigo",
    { brand: "#2f4bc0", accentSoft: "rgba(47,75,192,0.09)" },
    { brand: "#7f9dff", accentSoft: "rgba(127,157,255,0.12)" },
  ),
  primaryColor(
    "violet",
    { brand: "#7318e2", accentSoft: "rgba(115,24,226,0.09)" },
    { brand: "#bf97ef", accentSoft: "rgba(191,151,239,0.12)" },
  ),
  primaryColor(
    "graphite",
    { brand: "#22302f", accentSoft: "rgba(34,48,47,0.07)" },
    { brand: "#dfe8e8", accentSoft: "rgba(223,232,232,0.1)" },
  ),
  primaryColor(
    "contrast",
    { brand: "#085a44", accentSoft: "rgba(8,90,68,0.09)" },
    { brand: "#35dcae", accentSoft: "rgba(53,220,174,0.12)" },
    CONTRAST_SURFACE,
  ),
];

/** 底色 8（spec §3）：mist 冷雾（基准零覆盖）/ paper 暖砂 / dune 沙丘 / moss 苔痕 / slate 石板 / midnight 夜蓝 / clay 藕荷 / ink 深墨。 */
export const PALETTE_BASE_COLORS: readonly PaletteColor[] = [
  baseColor("mist", null, null),
  baseColor(
    "paper",
    { "--color-background": "#f8f3eb", "--color-foreground": "#1f1a14", "--color-card": "#fefdfb", "--color-background-win-alt": "#f3ece0" },
    { "--color-background": "#0f0d09", "--color-foreground": "#f5f3ef", "--color-card": "#211c14", "--color-background-win-alt": "#211c14" },
  ),
  baseColor(
    "dune",
    { "--color-background": "#f3f6e3", "--color-foreground": "#1a1c12", "--color-card": "#fdfdf9", "--color-background-win-alt": "#ebefcf" },
    { "--color-background": "#0d0e07", "--color-foreground": "#f3f4ed", "--color-card": "#1c1e10", "--color-background-win-alt": "#1c1e10" },
  ),
  baseColor(
    "moss",
    { "--color-background": "#eaf7ec", "--color-foreground": "#131d15", "--color-card": "#fbfefb", "--color-background-win-alt": "#dbf2e0" },
    { "--color-background": "#070f09", "--color-foreground": "#eff5f0", "--color-card": "#102013", "--color-background-win-alt": "#102013" },
  ),
  baseColor(
    "slate",
    { "--color-background": "#f0f4f9", "--color-foreground": "#161b22", "--color-card": "#fcfdfe", "--color-background-win-alt": "#e6edf4" },
    { "--color-background": "#080d15", "--color-foreground": "#f1f3f6", "--color-card": "#111d2d", "--color-background-win-alt": "#111d2d" },
  ),
  baseColor(
    "midnight",
    { "--color-background": "#f5f3fb", "--color-foreground": "#1d1927", "--color-card": "#fdfdfe", "--color-background-win-alt": "#efebf8" },
    { "--color-background": "#0f0a1b", "--color-foreground": "#f4f2f7", "--color-card": "#21163a", "--color-background-win-alt": "#21163a" },
  ),
  baseColor(
    "clay",
    { "--color-background": "#faf2f4", "--color-foreground": "#25171c", "--color-card": "#fefdfd", "--color-background-win-alt": "#f6e9ed" },
    { "--color-background": "#150a0e", "--color-foreground": "#f6f2f3", "--color-card": "#2e151d", "--color-background-win-alt": "#2e151d" },
  ),
  baseColor(
    "ink",
    { "--color-background": "#f3f4f4", "--color-foreground": "#1a1b1b", "--color-card": "#fcfdfd", "--color-background-win-alt": "#ececec" },
    { "--color-background": "#0d0d0e", "--color-foreground": "#f2f3f3", "--color-card": "#1c1d1d", "--color-background-win-alt": "#1c1d1d" },
  ),
];

const PRIMARY_BY_ID = new Map(PALETTE_PRIMARY_COLORS.map((color) => [color.id, color]));
const BASE_BY_ID = new Map(PALETTE_BASE_COLORS.map((color) => [color.id, color]));

// ---------------------------------------------------------------------------
// normalize / load / persist（spec §3/§6：脏数据回默认，不报错）
// ---------------------------------------------------------------------------

export function normalizePalettePrimaryId(value: unknown): string {
  return typeof value === "string" && PRIMARY_BY_ID.has(value)
    ? value
    : DEFAULT_PALETTE_PRIMARY_ID;
}

export function normalizePaletteBaseId(value: unknown): string {
  return typeof value === "string" && BASE_BY_ID.has(value) ? value : DEFAULT_PALETTE_BASE_ID;
}

export interface StoredPalette {
  primaryId: string;
  baseId: string;
}

export function loadPalette(): StoredPalette {
  return {
    primaryId: normalizePalettePrimaryId(readSafeLocalStorage(PALETTE_PRIMARY_STORAGE_KEY)),
    baseId: normalizePaletteBaseId(readSafeLocalStorage(PALETTE_BASE_STORAGE_KEY)),
  };
}

export function persistPalettePrimaryId(id: string): void {
  writeSafeLocalStorage(PALETTE_PRIMARY_STORAGE_KEY, id);
}

export function persistPaletteBaseId(id: string): void {
  writeSafeLocalStorage(PALETTE_BASE_STORAGE_KEY, id);
}

/** 恢复默认（spec §5）：清两持久化 key，load 时自然回落默认 id。 */
export function clearPalettePersist(): void {
  writeSafeLocalStorage(PALETTE_PRIMARY_STORAGE_KEY, "");
  writeSafeLocalStorage(PALETTE_BASE_STORAGE_KEY, "");
}

export function getPalettePrimary(id: string): PaletteColor {
  const color = PRIMARY_BY_ID.get(normalizePalettePrimaryId(id));
  if (!color) {
    // normalize 只返回表内 id，此分支仅为类型收窄（DEFAULT 一定在表内）。
    throw new Error(`palette primary id out of table: ${String(id)}`);
  }
  return color;
}

export function getPaletteBase(id: string): PaletteColor {
  const color = BASE_BY_ID.get(normalizePaletteBaseId(id));
  if (!color) {
    throw new Error(`palette base id out of table: ${String(id)}`);
  }
  return color;
}

// ---------------------------------------------------------------------------
// 构建与应用（spec §4）
// ---------------------------------------------------------------------------

/**
 * 组合当前模式下的完整内联 token 集。合并顺序：底色在前、主色覆盖在后——
 * 两组 key 默认不相交；contrast 主色自带表层集，与底色 key 相交并按此顺序
 * 覆盖（级联：主色 > 底色，见 primaryColor 注释）。mode 传 resolved 明暗或
 * system 均可——system 由 resolveTheme 折算（spec §3 mode 分支）。
 */
export function buildPaletteTokens(
  mode: Theme,
  primaryId: string,
  baseId: string,
): Record<string, string> {
  const resolved: PaletteMode = resolveTheme(mode);
  const base = getPaletteBase(baseId);
  const primary = getPalettePrimary(primaryId);
  return { ...base[resolved], ...primary[resolved] };
}

function rootStyle(): CSSStyleDeclaration | undefined {
  if (typeof document === "undefined") return undefined;
  return document.documentElement?.style;
}

/**
 * 调色盘专属已应用 token 记录：key → 自己最后一次写入的值（trim 后）。
 * 与 themePlugin 的 appliedThemeTokenKeys 结构复刻但完全独立；额外记录「值」
 * 是为了解决同名 key 的 remove-by-key 归属问题（浏览器验收 bug 修复）：
 * 内联 style 的 removeProperty 只按 key 名删除、不分辨当前值是谁写的，
 * effect 顺序（插件先、调色盘后）下，让位清空会把插件刚覆盖的同名值一并误删。
 */
let appliedPaletteTokens: Map<string, string> = new Map();

/**
 * 幂等应用：先按值归属清 stale keys，再全量写入当前集合（spec §4）。
 * - stale key 当前内联值 === 自己记录的写入值 → 归属调色盘，removeProperty 正常清除；
 * - 不相等 → 已被外部系统（主题插件）覆盖，保留不动；插件停用后由调色盘
 *   下一轮全量写入收回，两条路径都收敛到正确状态（与 effect 声明顺序无关）。
 * - 等值巧合边界：外部系统恰好写入与调色盘完全相同的值会被误删，概率极低，
 *   且视觉偏差仅为回退默认色，可接受。
 * 写入后按浏览器回读值重建记录，避免内联序列化差异导致后续归属比较失真。
 */
export function applyPaletteTokens(tokens: Record<string, string>): void {
  const style = rootStyle();
  if (!style?.setProperty) return;
  for (const [key, ownValue] of appliedPaletteTokens) {
    if (key in tokens) continue;
    if (style.getPropertyValue(key).trim() === ownValue) {
      style.removeProperty(key);
    }
  }
  const next = new Map<string, string>();
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(key, value);
    next.set(key, style.getPropertyValue(key).trim());
  }
  appliedPaletteTokens = next;
}
