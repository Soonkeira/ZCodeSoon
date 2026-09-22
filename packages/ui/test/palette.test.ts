import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PALETTE_BASE_ID,
  DEFAULT_PALETTE_PRIMARY_ID,
  PALETTE_BASE_COLORS,
  PALETTE_PRIMARY_COLORS,
  PALETTE_PRIMARY_STORAGE_KEY,
  applyPaletteTokens,
  buildPaletteTokens,
  clearPalettePersist,
  getPaletteBase,
  getPalettePrimary,
  loadPalette,
  normalizePaletteBaseId,
  normalizePalettePrimaryId,
  persistPaletteBaseId,
  persistPalettePrimaryId,
} from "../src/lib/palette.ts";
import { applyPluginThemeTokens } from "../src/lib/themePlugin.ts";

interface FakeStorage {
  map: Map<string, string>;
  restore: () => void;
}

function installFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return {
    map,
    restore: () => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    },
  };
}

interface FakeStyle {
  props: Map<string, string>;
  restore: () => void;
}

function installFakeStyle(): FakeStyle {
  const props = new Map<string, string>();
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => {
          props.set(key, value);
        },
        removeProperty: (key: string) => {
          props.delete(key);
        },
        // 值归属检查依赖真实 CSSStyleDeclaration 的回读语义（spec §4 修复）。
        getPropertyValue: (key: string) => props.get(key) ?? "",
      },
    },
  };
  return {
    props,
    restore: () => {
      delete (globalThis as { document?: unknown }).document;
    },
  };
}

// ---------------------------------------------------------------------------
// normalize：合法 id 透传、未知 id 回默认（spec §7.1、§6）
// ---------------------------------------------------------------------------

test("normalizePalette ids pass through valid entries and fall back to defaults", () => {
  assert.equal(normalizePalettePrimaryId("indigo"), "indigo");
  assert.equal(normalizePalettePrimaryId("cyan"), "cyan");
  assert.equal(normalizePalettePrimaryId("contrast"), "contrast");
  assert.equal(normalizePalettePrimaryId("nope"), DEFAULT_PALETTE_PRIMARY_ID);
  assert.equal(normalizePalettePrimaryId(""), DEFAULT_PALETTE_PRIMARY_ID);
  assert.equal(normalizePalettePrimaryId(undefined), DEFAULT_PALETTE_PRIMARY_ID);
  assert.equal(normalizePalettePrimaryId(42), DEFAULT_PALETTE_PRIMARY_ID);
  // 旧版 id 一次性重置回默认，不迁移（色值替换约定）。
  assert.equal(normalizePalettePrimaryId("ice"), DEFAULT_PALETTE_PRIMARY_ID);
  assert.equal(normalizePalettePrimaryId("aaa"), DEFAULT_PALETTE_PRIMARY_ID);

  assert.equal(normalizePaletteBaseId("ink"), "ink");
  assert.equal(normalizePaletteBaseId("midnight"), "midnight");
  assert.equal(normalizePaletteBaseId("nope"), DEFAULT_PALETTE_BASE_ID);
  assert.equal(normalizePaletteBaseId(null), DEFAULT_PALETTE_BASE_ID);
  assert.equal(normalizePaletteBaseId("cold-mist"), DEFAULT_PALETTE_BASE_ID);
  assert.equal(normalizePaletteBaseId("deep-ink"), DEFAULT_PALETTE_BASE_ID);
});

// ---------------------------------------------------------------------------
// persist/load 往返 + 空值默认（spec §7.2）
// ---------------------------------------------------------------------------

test("persist and load round-trip both palette keys; empty or dirty storage loads defaults", (t) => {
  const storage = installFakeStorage();
  t.after(storage.restore);

  assert.deepEqual(loadPalette(), {
    primaryId: DEFAULT_PALETTE_PRIMARY_ID,
    baseId: DEFAULT_PALETTE_BASE_ID,
  });

  persistPalettePrimaryId("aurora");
  persistPaletteBaseId("midnight");
  assert.deepEqual(loadPalette(), { primaryId: "aurora", baseId: "midnight" });

  // 脏数据回默认，不报错（spec §6）。
  storage.map.set(PALETTE_PRIMARY_STORAGE_KEY, "leftover-id");
  assert.equal(loadPalette().primaryId, DEFAULT_PALETTE_PRIMARY_ID);

  clearPalettePersist();
  assert.deepEqual(loadPalette(), {
    primaryId: DEFAULT_PALETTE_PRIMARY_ID,
    baseId: DEFAULT_PALETTE_BASE_ID,
  });
});

test("load works without a localStorage implementation", () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.deepEqual(loadPalette(), {
    primaryId: DEFAULT_PALETTE_PRIMARY_ID,
    baseId: DEFAULT_PALETTE_BASE_ID,
  });
});

// ---------------------------------------------------------------------------
// buildPaletteTokens：light/dark 完整覆盖集，system 按 resolve 折算（spec §7.3）
// ---------------------------------------------------------------------------

test("color tables expose 6 primaries and 8 bases with light/dark groups", () => {
  assert.equal(PALETTE_PRIMARY_COLORS.length, 6);
  assert.equal(PALETTE_BASE_COLORS.length, 8);
  assert.deepEqual(
    PALETTE_PRIMARY_COLORS.map((color) => color.id),
    ["aurora", "cyan", "indigo", "violet", "graphite", "contrast"],
  );
  assert.deepEqual(
    PALETTE_BASE_COLORS.map((color) => color.id),
    ["mist", "paper", "dune", "moss", "slate", "midnight", "clay", "ink"],
  );
});

test("buildPaletteTokens merges full base and primary override sets for light and dark (spec §7.3)", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const base of PALETTE_BASE_COLORS) {
      // mist 基准面零覆盖（色值替换新增断言）；其余底色覆盖集 19+ 项全在（含 foreground）。
      if (base.id === "mist") {
        assert.equal(Object.keys(base[mode]).length, 0, "mist must produce no override tokens");
      } else {
        assert.ok(Object.keys(base[mode]).length >= 19, `${base.id}/${mode} base set >= 19`);
      }
      for (const primary of PALETTE_PRIMARY_COLORS) {
        const tokens = buildPaletteTokens(mode, primary.id, base.id);
        for (const key of Object.keys(base[mode])) {
          assert.ok(key in tokens, `${base.id}/${mode} token ${key} present`);
        }
        // 主色覆盖集 13+ 项全在（contrast 含表层集，项数更多）。
        assert.ok(Object.keys(primary[mode]).length >= 13, `${primary.id}/${mode} set >= 13`);
        for (const key of Object.keys(primary[mode])) {
          assert.ok(key in tokens, `${primary.id}/${mode} token ${key} present`);
        }
        // key 交集规则（色值替换调整）：非 contrast 主色与底色 key 集无交集；
        // contrast 允许交集（表层盖所选底色），级联顺序在循环外单独断言。
        if (primary.id === "contrast") continue;
        for (const key of Object.keys(primary[mode])) {
          if (key in base[mode]) {
            assert.fail(
              `token ${key} defined by both base and non-contrast primary ${primary.id}`,
            );
          }
        }
      }
    }

    // mist × 非 contrast：底色零覆盖，background 回退内置主题值；主色照常应用。
    const mistTokens = buildPaletteTokens(mode, "graphite", "mist");
    assert.equal("--color-background" in mistTokens, false, `${mode} mist adds no background`);
    assert.ok("--color-brand" in mistTokens, `${mode} mist still applies primary tokens`);

    // contrast 级联（色值替换新增）：合并顺序 = 底色在前、主色覆盖在后 → 表层盖掉所选底色。
    const contrastTokens = buildPaletteTokens(mode, "contrast", "paper");
    const contrastColor = getPalettePrimary("contrast");
    const paperColor = getPaletteBase("paper");
    assert.equal(
      contrastTokens["--color-background"],
      contrastColor[mode]["--color-background"],
      `${mode} contrast surface wins over base background`,
    );
    assert.notEqual(
      contrastTokens["--color-background"],
      paperColor[mode]["--color-background"],
      `${mode} base background must be overridden by contrast`,
    );
  }
});

test("buildPaletteTokens folds system mode through resolveTheme (spec §7.3)", (t) => {
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return { matches: true };
    },
  };
  t.after(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const systemTokens = buildPaletteTokens("system", "graphite", "dune");
  assert.deepEqual(systemTokens, buildPaletteTokens("dark", "graphite", "dune"));

  (globalThis as { window?: unknown }).window = {
    matchMedia: () => ({ matches: false }),
  };
  assert.deepEqual(
    buildPaletteTokens("system", "graphite", "dune"),
    buildPaletteTokens("light", "graphite", "dune"),
  );
});

// ---------------------------------------------------------------------------
// applyPaletteTokens：tracked keys 精确清除，重复调用幂等（spec §7.4）
// ---------------------------------------------------------------------------

test("applyPaletteTokens writes tracked keys, clears stale keys precisely, and empties on {}", (t) => {
  const style = installFakeStyle();
  t.after(style.restore);
  // 模块级 tracked keys 可能被同进程其他用例污染，先清空归零。
  applyPaletteTokens({});

  applyPaletteTokens({ "--color-brand": "#111111", "--color-background": "#fafafa" });
  assert.equal(style.props.get("--color-brand"), "#111111");
  assert.equal(style.props.get("--color-background"), "#fafafa");

  // 换一组不同的集合：旧 key 精确移除、共有 key 更新、新 key 写入、无关 key 不动。
  style.props.set("--color-unrelated", "#010101");
  applyPaletteTokens({ "--color-brand": "#222222", "--color-card": "#ffffff" });
  assert.equal(style.props.has("--color-background"), false);
  assert.equal(style.props.get("--color-brand"), "#222222");
  assert.equal(style.props.get("--color-card"), "#ffffff");
  // 独立 tracked keys：绝不清除其他系统（主题插件）写入的 key。
  assert.equal(style.props.get("--color-unrelated"), "#010101");

  // 让位分支：空集合清空全部调色盘 token（spec §4）。
  applyPaletteTokens({});
  assert.equal(style.props.has("--color-brand"), false);
  assert.equal(style.props.has("--color-card"), false);
  assert.equal(style.props.get("--color-unrelated"), "#010101");
});

test("applyPaletteTokens is a no-op without a document", () => {
  delete (globalThis as { document?: unknown }).document;
  assert.doesNotThrow(() => applyPaletteTokens({ "--color-brand": "#123456" }));
});

// ---------------------------------------------------------------------------
// 值归属检查：同名 key 被外部系统（主题插件）覆盖时，让位清空不得误删（浏览器验收 bug 1）
// ---------------------------------------------------------------------------

test("applyPaletteTokens({}) keeps externally overwritten keys and clears its own values", (t) => {
  const style = installFakeStyle();
  t.after(style.restore);
  applyPaletteTokens({});

  applyPaletteTokens({ "--color-brand": "#123456", "--color-background": "#fafafa" });
  // 外部系统（主题插件激活）在同名 key 上覆盖写入。
  style.props.set("--color-brand", "#a996ff");

  // 让位分支：brand 当前值 ≠ 自己写入值 → 保留插件值；
  // background 当前值 === 自己写入值 → 正常删除回默认。
  applyPaletteTokens({});
  assert.equal(style.props.get("--color-brand"), "#a996ff");
  assert.equal(style.props.has("--color-background"), false);

  // 记录已随空集合重建：后续让位不再触碰保留下来的外部值。
  style.props.set("--color-background", "#deadbeef");
  applyPaletteTokens({});
  assert.equal(style.props.get("--color-brand"), "#a996ff");
  assert.equal(style.props.get("--color-background"), "#deadbeef");
});

// ---------------------------------------------------------------------------
// 系统级归属：预设色值与内置调色盘同源（都出自 palette.ts），等值巧合从
// "极低概率"变成必现——让位清除必须先判"该 key 是否在主题插件已应用集合中"，
// 值相等判定降级为非插件外部写入者的兜底（spec §4 双重判定）。
// ---------------------------------------------------------------------------

test("yield keeps a plugin-owned key even when its value is identical to the palette record", (t) => {
  const style = installFakeStyle();
  t.after(style.restore);
  // 两系统模块级记录都归零，保证测试顺序无关。
  applyPluginThemeTokens({});
  applyPaletteTokens({});

  // 调色盘写入并记录（如默认 石墨·沙丘）。
  applyPaletteTokens({ "--color-brand": "#22302f", "--color-background": "#f3f6e3" });
  // 插件 effect 先跑：声明同名 key 且写入**完全相同**的值——graphite-dune 预设即此场景。
  applyPluginThemeTokens({ "--color-brand": "#22302f" });

  // 调色盘让位：brand 归属插件 → 无论值是否与自己记录值全等都必须保留（修复前此处红）。
  applyPaletteTokens({});
  assert.equal(style.props.get("--color-brand"), "#22302f");
});

test("yield still clears a palette-only key at equal value when the plugin never declared it", (t) => {
  const style = installFakeStyle();
  t.after(style.restore);
  applyPluginThemeTokens({});
  applyPaletteTokens({});

  applyPaletteTokens({ "--color-brand": "#22302f", "--color-background": "#f3f6e3" });
  // 插件只声明 brand，未声明 --color-background（同上一步的插件集合）。
  applyPluginThemeTokens({ "--color-brand": "#22302f" });

  // background 非插件 key → 当前值等于自己记录值 → 正常清除回内置默认。
  applyPaletteTokens({});
  assert.equal(style.props.has("--color-background"), false);
});

// ---------------------------------------------------------------------------
// WCAG AA 硬门禁：6 主色 × 8 底色 × 2 模式 = 96 组（spec §8.6）
// 只断显式 hex（background/foreground/brand）；color-mix 派生项不参与断言。
// ---------------------------------------------------------------------------

// mist 组合按内置 zai 主题实际渲染值断言（色值替换约定，styles.css）：
// zai-light background #f8f8f8（styles.css L471）、foreground var(--color-neutral-800)（L561）；
// zai-dark background #161616（styles.css L617）、foreground var(--color-neutral-300)（L707）；
// neutral hex 取 Tailwind v4 默认中性色（tailwindcss/theme.css L258/L253：
// --color-neutral-800: oklch(26.9% 0 0) → #262626；--color-neutral-300: oklch(87% 0 0) → #d4d4d4）。
const ZAI_BUILTIN_SURFACE = {
  light: { background: "#f8f8f8", foreground: "#262626" },
  dark: { background: "#161616", foreground: "#d4d4d4" },
} as const;

function parseHex(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(match, `expected a 6-digit hex color, got "${hex}"`);
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/** WCAG 2.x 相对亮度。 */
function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (raw: number) => {
    const srgb = raw / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x 对比度：(L1 + 0.05) / (L2 + 0.05)。 */
function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [high, low] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (high + 0.05) / (low + 0.05);
}

test("AA: all 6×8×2 = 96 palette combinations pass WCAG contrast (spec §8.6)", () => {
  const modes = ["light", "dark"] as const;
  let checked = 0;
  for (const primary of PALETTE_PRIMARY_COLORS) {
    for (const base of PALETTE_BASE_COLORS) {
      for (const mode of modes) {
        const context = `${primary.id} × ${base.id} × ${mode}`;
        // 按运行时合并口径取值（色值替换调整）：底色在前、主色覆盖在后——
        // contrast 表层盖底色；mist 零覆盖 → background/foreground 回退内置 zai 值。
        const merged = { ...base[mode], ...primary[mode] };
        const background = merged["--color-background"] ?? ZAI_BUILTIN_SURFACE[mode].background;
        const foreground = merged["--color-foreground"] ?? ZAI_BUILTIN_SURFACE[mode].foreground;
        const brand = primary[mode]["--color-brand"];
        // 三个 AA 参与项必须是字面 hex（派生项走 color-mix/var，不参与对比断言）。
        for (const [key, value] of Object.entries({ background, foreground, brand })) {
          assert.match(value, /^#[0-9a-f]{6}$/i, `${context} ${key} must be explicit hex`);
        }
        // 合并结果里出现的显式表层项（card / win-alt）同样必须是 hex。
        for (const key of ["--color-card", "--color-background-win-alt"]) {
          const value = merged[key];
          if (value !== undefined) {
            assert.match(value, /^#[0-9a-f]{6}$/i, `${context} ${key} must be explicit hex`);
          }
        }
        const textRatio = contrastRatio(foreground, background);
        assert.ok(
          textRatio >= 4.5,
          `${context} foreground vs background = ${textRatio.toFixed(2)}:1 (< 4.5:1)`,
        );
        const brandRatio = contrastRatio(brand, background);
        assert.ok(
          brandRatio >= 3,
          `${context} brand vs background = ${brandRatio.toFixed(2)}:1 (< 3:1)`,
        );
        checked += 1;
      }
    }
  }
  assert.equal(checked, 96);
});
