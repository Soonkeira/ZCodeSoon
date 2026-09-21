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
