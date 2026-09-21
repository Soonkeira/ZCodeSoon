import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_PLUGIN_BROADCAST_FIELDS,
  applyStoredThemePluginAppearance,
  applyThemePluginBroadcast,
  createThemePluginState,
  type ThemePluginStateSlice,
} from "../src/store/themePluginState.ts";

type RecordedCall =
  | { member: "setActiveThemePluginKey"; key: string | null }
  | { member: "setUiFontFamily"; family: string }
  | { member: "setCodeFontFamily"; family: string };

/** 最小 state stub：只记录 setter 调用与入参，不依赖真实 zustand store。 */
function createStateStub() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    setActiveThemePluginKey: (key: string | null) => {
      calls.push({ member: "setActiveThemePluginKey", key });
    },
    setUiFontFamily: (family: string) => {
      calls.push({ member: "setUiFontFamily", family });
    },
    setCodeFontFamily: (family: string) => {
      calls.push({ member: "setCodeFontFamily", family });
    },
  };
}

function createWriter() {
  const patches: Array<Partial<ThemePluginStateSlice>> = [];
  return {
    patches,
    write: (patch: Partial<ThemePluginStateSlice>) => {
      patches.push(patch);
    },
  };
}

test("createThemePluginState falls back to empty preferences without localStorage", () => {
  const { write } = createWriter();
  const state = createThemePluginState(write);
  assert.equal(state.activeThemePluginKey, null);
  assert.equal(state.uiFontFamily, "");
  assert.equal(state.codeFontFamily, "");
  assert.doesNotThrow(() => applyStoredThemePluginAppearance(state));
});

test("setActiveThemePluginKey trims the key and normalizes blanks to null", () => {
  const { patches, write } = createWriter();
  const state = createThemePluginState(write);
  state.setActiveThemePluginKey("  acme/dark  ");
  state.setActiveThemePluginKey("   ");
  state.setActiveThemePluginKey(null);
  assert.deepEqual(patches, [
    { activeThemePluginKey: "acme/dark" },
    { activeThemePluginKey: null },
    { activeThemePluginKey: null },
  ]);
});

test("setUiFontFamily normalizes quotes and caps the family length", () => {
  const { patches, write } = createWriter();
  const state = createThemePluginState(write);
  state.setUiFontFamily('  "JetBrains Mono"  ');
  state.setUiFontFamily("x".repeat(200));
  assert.deepEqual(patches, [
    { uiFontFamily: "JetBrains Mono" },
    { uiFontFamily: "x".repeat(128) },
  ]);
});

test("setCodeFontFamily normalizes quotes and caps the family length", () => {
  const { patches, write } = createWriter();
  const state = createThemePluginState(write);
  state.setCodeFontFamily("  'Fira Code'  ");
  state.setCodeFontFamily("y".repeat(200));
  assert.deepEqual(patches, [{ codeFontFamily: "Fira Code" }, { codeFontFamily: "y".repeat(128) }]);
});

test("applyThemePluginBroadcast claims activeThemePluginKey and nulls non-string payloads", () => {
  const stub = createStateStub();
  assert.equal(applyThemePluginBroadcast(stub, "activeThemePluginKey", "p/t"), true);
  assert.equal(applyThemePluginBroadcast(stub, "activeThemePluginKey", ""), true);
  assert.equal(applyThemePluginBroadcast(stub, "activeThemePluginKey", null), true);
  assert.equal(applyThemePluginBroadcast(stub, "activeThemePluginKey", 123), true);
  assert.deepEqual(stub.calls, [
    { member: "setActiveThemePluginKey", key: "p/t" },
    { member: "setActiveThemePluginKey", key: null },
    { member: "setActiveThemePluginKey", key: null },
    { member: "setActiveThemePluginKey", key: null },
  ]);
});

test("applyThemePluginBroadcast only writes font families for string payloads", () => {
  const stub = createStateStub();
  assert.equal(applyThemePluginBroadcast(stub, "uiFontFamily", "Inter"), true);
  assert.equal(applyThemePluginBroadcast(stub, "uiFontFamily", 123), false);
  assert.equal(applyThemePluginBroadcast(stub, "codeFontFamily", "Fira Code"), true);
  assert.equal(applyThemePluginBroadcast(stub, "codeFontFamily", null), false);
  assert.deepEqual(stub.calls, [
    { member: "setUiFontFamily", family: "Inter" },
    { member: "setCodeFontFamily", family: "Fira Code" },
  ]);
});

test("applyThemePluginBroadcast ignores fields outside the slice", () => {
  const stub = createStateStub();
  for (const field of ["theme", "locale", "uiFontSizePx", "interfaceMode"]) {
    assert.equal(applyThemePluginBroadcast(stub, field, "dark"), false);
  }
  assert.deepEqual(stub.calls, []);
});

test("THEME_PLUGIN_BROADCAST_FIELDS lists the three slice fields without duplicates", () => {
  assert.deepEqual([...THEME_PLUGIN_BROADCAST_FIELDS].sort(), [
    "activeThemePluginKey",
    "codeFontFamily",
    "uiFontFamily",
  ]);
  assert.equal(new Set(THEME_PLUGIN_BROADCAST_FIELDS).size, THEME_PLUGIN_BROADCAST_FIELDS.length);
});
