import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_THEME_CSS_LENGTH,
  findThemeTokenProblem,
  parsePluginThemeFile,
  pluginThemeFileSchema,
  scanThemeCssSafety,
} from "../src/plugins/theme-package.ts";

const validThemeFile = {
  id: "sereno-dark",
  name: "Sereno Dark",
  tokens: {
    // 白名单要求 --radius-* 带后缀；裸 --radius 按 spec §3.3 会被拒
    light: { "--color-brand": "#7c5cff", "--radius-lg": "0.75rem" },
    dark: { "--color-brand": "#9d85ff" },
  },
  suggestedFonts: { ui: "Inter", code: "JetBrains Mono" },
  css: "overrides.css",
};

test("valid theme file passes schema", () => {
  assert.equal(pluginThemeFileSchema.safeParse(validThemeFile).success, true);
});

test("valid theme file passes parse-level validation", () => {
  assert.equal(parsePluginThemeFile(validThemeFile).ok, true);
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
    tokens: { light: { "--radius-lg": "10" } },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /px or rem/);
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
  assert.equal(scanThemeCssSafety('a { background: image-set("x" 1x) }').ok, false);
  assert.equal(scanThemeCssSafety(".chat-bubble { border-radius: 12px; }").ok, true);
});

test("parsePluginThemeFile merges token problems from both modes", () => {
  const result = parsePluginThemeFile({
    ...validThemeFile,
    tokens: {
      light: { "--color-brand": "oops" },
      // 深色 token 名合法但值非法，才能验证两个 mode 的问题都合并进 reason
      // （原 fixture 的 "#111" 是合法 CSS 颜色，在 spec §3.3 前缀白名单下不构成问题）
      dark: { "--color-x": "oops" },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /--color-brand/);
  assert.match(result.ok ? "" : result.reason, /--color-x/);
});

test("multi-byte css over the byte limit is rejected", () => {
  const css = "主".repeat(90_000); // UTF-16 length 90000 < 256KiB，UTF-8 字节 270000 > 256KiB
  assert.equal(scanThemeCssSafety(css).ok, false);
});

test("MAX_THEME_CSS_LENGTH is the exported 256 KiB limit used by size pre-checks", () => {
  assert.equal(MAX_THEME_CSS_LENGTH, 256 * 1024);
  // 边界与 scanThemeCssSafety 的「> 上限才拒绝」一致：恰好等于上限仍然通过。
  assert.equal(scanThemeCssSafety("a".repeat(MAX_THEME_CSS_LENGTH)).ok, true);
  assert.equal(scanThemeCssSafety("a".repeat(MAX_THEME_CSS_LENGTH + 1)).ok, false);
});

test("light-only theme keeps dark tokens empty", () => {
  const result = parsePluginThemeFile({
    id: "light-only",
    name: "Light Only",
    tokens: { light: { "--color-brand": "#111111" } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.theme.tokensDark : null, {});
});

test("unknown top-level key is rejected by strict schema", () => {
  assert.equal(pluginThemeFileSchema.safeParse({ ...validThemeFile, unknownKey: true }).success, false);
});

test("oversized token key is rejected without unbounded reason", () => {
  const result = parsePluginThemeFile({
    id: "huge-key",
    name: "Huge Key",
    tokens: { light: { [`--color-${"k".repeat(100_000)}`]: "#111111" } },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.reason.length <= 512, `reason too long: ${result.reason.length}`);
  }
});
