import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PALETTE_BASE_ID,
  DEFAULT_PALETTE_PRIMARY_ID,
  PALETTE_BASE_STORAGE_KEY,
  PALETTE_PRIMARY_STORAGE_KEY,
} from "../src/lib/palette.ts";
import {
  PALETTE_BROADCAST_FIELDS,
  applyPaletteBroadcast,
  applyStoredPalette,
  createPaletteState,
  type PaletteStateSlice,
} from "../src/store/paletteState.ts";

// 共享时间线：persist / set 事件按真实发生顺序入队，用于断言写入次序（spec §4：normalize → persist → set）。
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

interface Writer {
  patches: Array<Partial<PaletteStateSlice>>;
  write: (patch: Partial<PaletteStateSlice>) => void;
  target: { setState: (patch: Partial<PaletteStateSlice>) => void };
}

function createWriter(): Writer {
  const patches: Array<Partial<PaletteStateSlice>> = [];
  const record = (patch: Partial<PaletteStateSlice>) => {
    timeline.push("set");
    patches.push(patch);
  };
  return { patches, write: record, target: { setState: record } };
}

test("createPaletteState loads persisted ids and falls back to defaults for dirty values", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);

  const empty = createPaletteState(() => {});
  assert.equal(empty.palettePrimaryId, DEFAULT_PALETTE_PRIMARY_ID);
  assert.equal(empty.paletteBaseId, DEFAULT_PALETTE_BASE_ID);

  storage.map.set(PALETTE_PRIMARY_STORAGE_KEY, "violet");
  storage.map.set(PALETTE_BASE_STORAGE_KEY, "moss");
  const seeded = createPaletteState(() => {});
  assert.equal(seeded.palettePrimaryId, "violet");
  assert.equal(seeded.paletteBaseId, "moss");

  storage.map.set(PALETTE_PRIMARY_STORAGE_KEY, "garbage");
  assert.equal(createPaletteState(() => {}).palettePrimaryId, DEFAULT_PALETTE_PRIMARY_ID);
});

test("setters follow normalize → persist → set order (spec §4)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const { patches, write } = createWriter();
  const state = createPaletteState(write);

  state.setPalettePrimaryId("indigo");
  assert.equal(storage.map.get(PALETTE_PRIMARY_STORAGE_KEY), "indigo");
  assert.deepEqual(patches, [{ palettePrimaryId: "indigo" }]);
  assert.deepEqual(timeline, ["persist", "set"]);

  timeline.length = 0;
  patches.length = 0;
  // 未知 id 先归一化再落盘（spec §6）。
  state.setPaletteBaseId("not-a-base");
  assert.equal(storage.map.get(PALETTE_BASE_STORAGE_KEY), DEFAULT_PALETTE_BASE_ID);
  assert.deepEqual(patches, [{ paletteBaseId: DEFAULT_PALETTE_BASE_ID }]);
  assert.deepEqual(timeline, ["persist", "set"]);
});

test("resetPalette clears both storage keys and returns defaults (spec §5)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const { patches, write } = createWriter();
  const state = createPaletteState(write);

  state.setPalettePrimaryId("aurora");
  state.setPaletteBaseId("moss");
  timeline.length = 0;
  patches.length = 0;

  state.resetPalette();
  assert.equal(storage.map.get(PALETTE_PRIMARY_STORAGE_KEY), "");
  assert.equal(storage.map.get(PALETTE_BASE_STORAGE_KEY), "");
  assert.deepEqual(patches, [
    {
      palettePrimaryId: DEFAULT_PALETTE_PRIMARY_ID,
      paletteBaseId: DEFAULT_PALETTE_BASE_ID,
    },
  ]);
  assert.deepEqual(timeline, ["persist", "persist", "set"]);
});

test("PALETTE_BROADCAST_FIELDS registers both slice fields without duplicates", () => {
  assert.deepEqual([...PALETTE_BROADCAST_FIELDS].sort(), ["paletteBaseId", "palettePrimaryId"]);
  assert.equal(new Set(PALETTE_BROADCAST_FIELDS).size, PALETTE_BROADCAST_FIELDS.length);
});

test("applyPaletteBroadcast claims palette fields, normalizes, and never persists (spec §4)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const { patches, target } = createWriter();

  assert.equal(applyPaletteBroadcast(target, "palettePrimaryId", "cyan"), true);
  assert.equal(applyPaletteBroadcast(target, "paletteBaseId", "slate"), true);
  // 防回环：收端只 set，不写 localStorage。
  assert.equal(timeline.includes("persist"), false);
  assert.deepEqual(patches, [{ palettePrimaryId: "cyan" }, { paletteBaseId: "slate" }]);

  // 非法载荷按默认归一化；其他字段不认领。
  assert.equal(applyPaletteBroadcast(target, "palettePrimaryId", "bogus"), true);
  assert.deepEqual(patches.at(-1), { palettePrimaryId: DEFAULT_PALETTE_PRIMARY_ID });
  assert.equal(applyPaletteBroadcast(target, "theme", "zai-dark"), false);
  assert.equal(applyPaletteBroadcast(target, "paletteBaseId", 123), true);
  assert.deepEqual(patches.at(-1), { paletteBaseId: DEFAULT_PALETTE_BASE_ID });
});

test("applyStoredPalette replays storage into state on startup (spec §4)", (t) => {
  timeline.length = 0;
  const storage = installFakeStorage();
  t.after(storage.restore);
  const { patches, target } = createWriter();

  storage.map.set(PALETTE_PRIMARY_STORAGE_KEY, "contrast");
  storage.map.set(PALETTE_BASE_STORAGE_KEY, "ink");
  applyStoredPalette(target);
  assert.deepEqual(patches, [{ palettePrimaryId: "contrast", paletteBaseId: "ink" }]);
  // 启动重放只 load → set，不重复落盘。
  assert.equal(timeline.includes("persist"), false);

  storage.map.clear();
  patches.length = 0;
  applyStoredPalette(target);
  assert.deepEqual(patches, [
    { palettePrimaryId: DEFAULT_PALETTE_PRIMARY_ID, paletteBaseId: DEFAULT_PALETTE_BASE_ID },
  ]);
});
