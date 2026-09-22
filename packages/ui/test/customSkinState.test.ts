import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_SKIN_BLUR_STORAGE_KEY,
  CUSTOM_SKIN_IMAGE_STORAGE_KEY,
} from "../src/lib/customSkin.ts";
import {
  CUSTOM_SKIN_BROADCAST_FIELDS,
  applyCustomSkinBroadcast,
  applyStoredCustomSkin,
  createBlurBroadcastScheduler,
  createCustomSkinState,
  type CustomSkinStateSlice,
} from "../src/store/customSkinState.ts";

// 共享时间线：persist / apply / set 三类事件按真实发生顺序入队，用于断言写入次序（spec §7.1）。
const timeline: string[] = [];

interface FakeStorage {
  map: Map<string, string>;
  restore: () => void;
}

function installFakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      timeline.push("persist");
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

interface FakeDocument {
  attributes: Map<string, string>;
  restore: () => void;
}

function installFakeDocument(): FakeDocument {
  const attributes = new Map<string, string>();
  (globalThis as { document?: unknown }).document = {
    documentElement: {
      setAttribute: (key: string, value: string) => {
        timeline.push("apply");
        attributes.set(key, value);
      },
      removeAttribute: (key: string) => {
        timeline.push("apply");
        attributes.delete(key);
      },
      hasAttribute: (key: string) => attributes.has(key),
    },
  };
  return {
    attributes,
    restore: () => {
      delete (globalThis as { document?: unknown }).document;
    },
  };
}

function createWriter() {
  const patches: Array<Partial<CustomSkinStateSlice>> = [];
  const record = (patch: Partial<CustomSkinStateSlice>) => {
    timeline.push("set");
    patches.push(patch);
  };
  return {
    patches,
    write: record,
    // applyCustomSkinBroadcast / applyStoredCustomSkin 以 setState 形状的目标为入参。
    target: { setState: record },
  };
}

test("createCustomSkinState loads persisted preferences and defaults without storage", (t) => {
  const storage = installFakeStorage();
  t.after(storage.restore);

  const empty = createCustomSkinState(() => {});
  assert.equal(empty.customSkinImage, null);
  assert.equal(empty.customSkinBlurPx, 0);
  assert.equal(empty.customSkinError, null);

  storage.map.set(CUSTOM_SKIN_IMAGE_STORAGE_KEY, "data:image/jpeg;base64,abc");
  storage.map.set(CUSTOM_SKIN_BLUR_STORAGE_KEY, "35");
  const seeded = createCustomSkinState(() => {});
  assert.equal(seeded.customSkinImage, "data:image/jpeg;base64,abc");
  assert.equal(seeded.customSkinBlurPx, 35);
});

test("setCustomSkinImage follows normalize → persist → apply → set order (spec §7.1)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const doc = installFakeDocument();
  t.after(doc.restore);
  const { patches, write } = createWriter();
  const state = createCustomSkinState(write);

  // 归一化：空串按无图处理。
  state.setCustomSkinImage("");
  assert.equal(storage.map.get(CUSTOM_SKIN_IMAGE_STORAGE_KEY), "");
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
  assert.deepEqual(patches, [{ customSkinImage: null, customSkinError: null }]);
  assert.deepEqual(timeline, ["persist", "apply", "set"]);

  timeline.length = 0;
  patches.length = 0;
  state.setCustomSkinImage("data:image/jpeg;base64,new");
  assert.equal(storage.map.get(CUSTOM_SKIN_IMAGE_STORAGE_KEY), "data:image/jpeg;base64,new");
  assert.equal(doc.attributes.get("data-zcode-skin"), "on");
  assert.deepEqual(patches, [
    { customSkinImage: "data:image/jpeg;base64,new", customSkinError: null },
  ]);
  assert.deepEqual(timeline, ["persist", "apply", "set"]);
});

test("setCustomSkinImage rolls back state and records customSkinError on quota failure", (t) => {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  t.after(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  const doc = installFakeDocument();
  t.after(doc.restore);
  const { patches, write } = createWriter();
  const state = createCustomSkinState(write);

  assert.throws(() => state.setCustomSkinImage("data:image/jpeg;base64,x"));
  // 状态回滚：image 不写入，仅记录错误码；DOM 门控不动。
  assert.deepEqual(patches, [{ customSkinError: "SKIN_PERSIST_FAILED" }]);
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
});

test("setCustomSkinBlurPx updates state immediately and persists after the 300ms debounce", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const { patches, write } = createWriter();
  const state = createCustomSkinState(write);

  state.setCustomSkinBlurPx(99);
  // state 立即更新保证滑块流畅（spec §3）。
  assert.deepEqual(patches, [{ customSkinBlurPx: 50, customSkinError: null }]);
  assert.equal(storage.map.has(CUSTOM_SKIN_BLUR_STORAGE_KEY), false);

  // 快速连发合并为最后一次落盘：每次 setter 重置 300ms 计时器。
  state.setCustomSkinBlurPx(10);
  t.mock.timers.tick(200);
  assert.equal(storage.map.has(CUSTOM_SKIN_BLUR_STORAGE_KEY), false);
  state.setCustomSkinBlurPx(20);
  t.mock.timers.tick(299);
  assert.equal(storage.map.has(CUSTOM_SKIN_BLUR_STORAGE_KEY), false);
  t.mock.timers.tick(1);
  assert.equal(storage.map.get(CUSTOM_SKIN_BLUR_STORAGE_KEY), "20");
});

test("clearCustomSkin removes persisted keys, DOM attribute, and resets state", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const doc = installFakeDocument();
  t.after(doc.restore);
  const { patches, write } = createWriter();
  const state = createCustomSkinState(write);

  storage.map.set(CUSTOM_SKIN_IMAGE_STORAGE_KEY, "data:image/jpeg;base64,abc");
  storage.map.set(CUSTOM_SKIN_BLUR_STORAGE_KEY, "40");
  state.setCustomSkinImage("data:image/jpeg;base64,abc");
  patches.length = 0;

  state.clearCustomSkin();
  assert.equal(storage.map.get(CUSTOM_SKIN_IMAGE_STORAGE_KEY), "");
  assert.equal(storage.map.get(CUSTOM_SKIN_BLUR_STORAGE_KEY), "");
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
  assert.deepEqual(patches.at(-1), {
    customSkinImage: null,
    customSkinBlurPx: 0,
    customSkinError: null,
  });
});

test("CUSTOM_SKIN_BROADCAST_FIELDS lists the two slice fields without duplicates", () => {
  assert.deepEqual([...CUSTOM_SKIN_BROADCAST_FIELDS].sort(), [
    "customSkinBlurPx",
    "customSkinImage",
  ]);
  assert.equal(new Set(CUSTOM_SKIN_BROADCAST_FIELDS).size, CUSTOM_SKIN_BROADCAST_FIELDS.length);
});

test("applyCustomSkinBroadcast claims skin fields, sets state and DOM, and never persists (spec §7.2)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const doc = installFakeDocument();
  t.after(doc.restore);
  const { patches, target } = createWriter();

  assert.equal(
    applyCustomSkinBroadcast(target, "customSkinImage", "data:image/jpeg;base64,remote"),
    true,
  );
  assert.equal(doc.attributes.get("data-zcode-skin"), "on");
  assert.equal(applyCustomSkinBroadcast(target, "customSkinBlurPx", 42), true);
  // 防回环：收端只 setState + DOM，不写 localStorage。
  assert.equal(
    timeline.some((event) => event === "persist"),
    false,
  );
  assert.deepEqual(patches, [
    { customSkinImage: "data:image/jpeg;base64,remote" },
    { customSkinBlurPx: 42 },
  ]);

  // 非皮肤字段不认领；非字符串 image 载荷按无图处理。
  assert.equal(applyCustomSkinBroadcast(target, "theme", "dark"), false);
  assert.equal(applyCustomSkinBroadcast(target, "customSkinBlurPx", "not-a-number"), false);
  assert.equal(applyCustomSkinBroadcast(target, "customSkinImage", null), true);
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
  assert.deepEqual(patches.at(-1), { customSkinImage: null });
});

test("applyStoredCustomSkin replays storage into state and the DOM gate (spec §7.3)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const doc = installFakeDocument();
  t.after(doc.restore);
  const { patches, target } = createWriter();

  storage.map.set(CUSTOM_SKIN_IMAGE_STORAGE_KEY, "data:image/jpeg;base64,stored");
  storage.map.set(CUSTOM_SKIN_BLUR_STORAGE_KEY, "25");
  applyStoredCustomSkin(target);
  assert.deepEqual(patches, [
    { customSkinImage: "data:image/jpeg;base64,stored", customSkinBlurPx: 25 },
  ]);
  assert.equal(doc.attributes.get("data-zcode-skin"), "on");

  // 空存储重放：回到默认并移除门控属性。
  storage.map.clear();
  patches.length = 0;
  applyStoredCustomSkin(target);
  assert.deepEqual(patches, [{ customSkinImage: null, customSkinBlurPx: 0 }]);
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
});

test("createBlurBroadcastScheduler coalesces slider bursts into the last value after 300ms (spec §3)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: number[] = [];
  const schedule = createBlurBroadcastScheduler((value) => sent.push(value));

  schedule(1);
  schedule(2);
  t.mock.timers.tick(299);
  assert.deepEqual(sent, []);
  schedule(3);
  t.mock.timers.tick(300);
  assert.deepEqual(sent, [3]);

  // 静默期结束后再调度，独立发送下一次。
  t.mock.timers.tick(300);
  schedule(7);
  t.mock.timers.tick(300);
  assert.deepEqual(sent, [3, 7]);
});
