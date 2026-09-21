import assert from "node:assert/strict";
import test from "node:test";
import type { ZCodeThemePackage } from "@zcode/shared";
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

// ---------------------------------------------------------------------------
// 主题清单加载（spec §4.4：单一来源 + 去重 + 过期响应丢弃）
// ---------------------------------------------------------------------------

type LoadThemePluginsParams = Parameters<ThemePluginStateSlice["loadThemePlugins"]>[0];
type ThemeService = LoadThemePluginsParams["service"];

function themePackage(pluginId: string, themeId: string): ZCodeThemePackage {
  return {
    pluginId,
    pluginName: pluginId.split("@")[0] ?? pluginId,
    themeId,
    name: themeId,
    valid: true,
    tokensLight: {},
    tokensDark: {},
    cssStatus: "missing",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

/** 记录调用并按顺序挂起（可手动 resolve）的主题服务 stub，用于验证去重与过期响应。 */
function createQueuedThemeService() {
  const calls: Array<Record<string, unknown>> = [];
  const pending: Array<ReturnType<typeof createDeferred<{ themes: ZCodeThemePackage[] }>>> = [];
  const service = {
    listThemes: (params: Record<string, unknown>) => {
      calls.push(params);
      const deferred = createDeferred<{ themes: ZCodeThemePackage[] }>();
      pending.push(deferred);
      return deferred.promise;
    },
  } as unknown as ThemeService;
  return { calls, pending, service };
}

/** state stub 折叠 patch：store action 只经 writeState 写入，测试按最后写入值读取。 */
function createCatalogHarness() {
  const patches: Array<Partial<ThemePluginStateSlice>> = [];
  let snapshot: Partial<ThemePluginStateSlice> = {};
  const state = createThemePluginState((patch) => {
    patches.push(patch);
    snapshot = { ...snapshot, ...patch };
  });
  return { patches, state, current: () => snapshot };
}

test("loadThemePlugins loads the catalog once and records ready", async () => {
  const themes = [themePackage("acme-theme@inline", "dark")];
  const { calls, pending, service } = createQueuedThemeService();
  const { state, current, patches } = createCatalogHarness();

  const loading = state.loadThemePlugins({
    service,
    workspacePath: "/ws/a",
    // 空白 identity 只按 workspacePath 构造请求 key，也不把空串下推给服务。
    workspaceIdentity: "   ",
  });
  assert.deepEqual(patches[0], { themePlugins: [], themePluginsStatus: "loading" });
  assert.deepEqual(calls[0], { workspacePath: "/ws/a" });

  pending[0]!.resolve({ themes });
  await loading;

  assert.deepEqual(current().themePlugins, themes);
  assert.equal(current().themePluginsStatus, "ready");
});

test("loadThemePlugins dedupes the same request key unless forced", async () => {
  const themes = [themePackage("acme-theme@inline", "dark")];
  const { calls, pending, service } = createQueuedThemeService();
  const { state, current } = createCatalogHarness();
  const target = { workspacePath: "/ws/a", workspaceIdentity: "remote://host-a" };

  const first = state.loadThemePlugins({ service, ...target });
  // loading 期间的重复请求直接返回，不会再打一次 listThemes。
  await state.loadThemePlugins({ service, ...target });
  assert.equal(calls.length, 1);

  pending[0]!.resolve({ themes });
  await first;
  assert.equal(current().themePluginsStatus, "ready");

  // ready 且 key 一致：非 force 去重。
  await state.loadThemePlugins({ service, ...target });
  assert.equal(calls.length, 1);

  // key 变化（同路径不同 identity）允许重取。
  const switched = state.loadThemePlugins({
    service,
    workspacePath: "/ws/a",
    workspaceIdentity: "remote://host-b",
  });
  assert.equal(calls.length, 2);
  pending[1]!.resolve({ themes: [] });
  await switched;
  assert.deepEqual(current().themePlugins, []);
});

test("loadThemePlugins refetches the same key when forced", async () => {
  const { calls, pending, service } = createQueuedThemeService();
  const { state } = createCatalogHarness();
  const target = { workspacePath: "/ws/a" };

  const first = state.loadThemePlugins({ service, ...target });
  pending[0]!.resolve({ themes: [themePackage("acme-theme@inline", "dark")] });
  await first;
  assert.equal(calls.length, 1);

  const forced = state.loadThemePlugins({ service, ...target, force: true });
  assert.equal(calls.length, 2);
  pending[1]!.resolve({ themes: [] });
  await forced;
});

test("loadThemePlugins drops stale responses when a newer request wins", async () => {
  const slowTheme = themePackage("slow@inline", "dark");
  const fastTheme = themePackage("fast@inline", "dark");
  const { calls, pending, service } = createQueuedThemeService();
  const { state, current } = createCatalogHarness();

  const slow = state.loadThemePlugins({ service, workspacePath: "/ws/slow", force: true });
  const fast = state.loadThemePlugins({ service, workspacePath: "/ws/fast", force: true });
  assert.equal(calls.length, 2);

  // 后发先至：fast 先回包并写入。
  pending[1]!.resolve({ themes: [fastTheme] });
  await fast;
  assert.deepEqual(current().themePlugins, [fastTheme]);

  // 先发的慢请求回包时必须被忽略，不能覆盖后发请求的清单。
  pending[0]!.resolve({ themes: [slowTheme] });
  await slow;
  assert.deepEqual(current().themePlugins, [fastTheme]);
  assert.equal(current().themePluginsStatus, "ready");
});

test("loadThemePlugins records error without throwing when the request fails", async () => {
  // 失败必须转成 error 状态，不能把异常抛给调用方（effect 不回滚用户选择，spec §4.2 第 4 步）。
  const service = {
    listThemes: () => Promise.reject(new Error("boom")),
  } as unknown as ThemeService;
  const { state, current } = createCatalogHarness();

  await assert.doesNotReject(() => state.loadThemePlugins({ service, workspacePath: "/ws/a" }));
  assert.equal(current().themePluginsStatus, "error");
  assert.deepEqual(current().themePlugins, []);
});
