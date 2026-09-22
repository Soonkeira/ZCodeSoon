import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_SKIN_BLUR_STORAGE_KEY,
  CUSTOM_SKIN_IMAGE_STORAGE_KEY,
  CUSTOM_SKIN_MAX_BLUR_PX,
  applyCustomSkinDom,
  clearCustomSkinPersist,
  compressSkinImage,
  loadCustomSkin,
  normalizeBlurPx,
  persistCustomSkinBlurPx,
  persistCustomSkinImage,
} from "../src/lib/customSkin.ts";

interface FakeStorage {
  map: Map<string, string>;
  restore: () => void;
}

function installFakeStorage(options?: { quota?: boolean }): FakeStorage {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options?.quota) {
        throw new Error("QuotaExceededError");
      }
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
        attributes.set(key, value);
      },
      removeAttribute: (key: string) => {
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

interface CompressMocks {
  canvasCalls: Array<{ width: number; height: number; quality: number | undefined }>;
  restore: () => void;
}

/**
 * 压缩链路的可测替身：createImageBitmap 提供固定尺寸源图，
 * canvas.toDataURL 按脚本返回，用于驱动降档重试路径（spec §7.4）。
 */
function installCompressMocks(dataUrls: string[]): CompressMocks {
  const canvasCalls: Array<{ width: number; height: number; quality: number | undefined }> = [];
  const documentMock = {
    documentElement: {
      setAttribute: () => {},
      removeAttribute: () => {},
      hasAttribute: () => false,
    },
    createElement: (tag: string) => {
      assert.equal(tag, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: (_type: string, quality?: number) => {
          canvasCalls.push({ width: canvas.width, height: canvas.height, quality });
          const index = canvasCalls.length - 1;
          return dataUrls[index] ?? dataUrls[dataUrls.length - 1] ?? "";
        },
      };
      return canvas;
    },
  };
  (globalThis as { document?: unknown }).document = documentMock;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({
    width: 4000,
    height: 3000,
    close: () => {},
  });
  return {
    canvasCalls,
    restore: () => {
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    },
  };
}

// ---------------------------------------------------------------------------
// normalizeBlurPx：clamp 0-50 整数，非数回默认 0（spec §7.1）
// ---------------------------------------------------------------------------

test("normalizeBlurPx clamps to 0-50 integers and falls back to 0 for invalid values", () => {
  assert.equal(normalizeBlurPx(0), 0);
  assert.equal(normalizeBlurPx(-5), 0);
  assert.equal(normalizeBlurPx(50), CUSTOM_SKIN_MAX_BLUR_PX);
  assert.equal(normalizeBlurPx(99), CUSTOM_SKIN_MAX_BLUR_PX);
  assert.equal(normalizeBlurPx(Number.NaN), 0);
  assert.equal(normalizeBlurPx(undefined), 0);
  assert.equal(normalizeBlurPx("12"), 0);
  assert.equal(normalizeBlurPx(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeBlurPx(12.6), 13);
});

// ---------------------------------------------------------------------------
// persist/load 往返（spec §7.2）
// ---------------------------------------------------------------------------

test("persist and load round-trip image and blur; empty storage loads defaults", (t) => {
  const storage = installFakeStorage();
  t.after(storage.restore);

  const empty = loadCustomSkin();
  assert.deepEqual(empty, { image: null, blurPx: 0 });

  persistCustomSkinImage("data:image/jpeg;base64,abc123");
  persistCustomSkinBlurPx(30);
  assert.deepEqual(loadCustomSkin(), { image: "data:image/jpeg;base64,abc123", blurPx: 30 });

  // 超界 blur 落盘前归一化，读回仍是合法值。
  persistCustomSkinBlurPx(99);
  assert.equal(loadCustomSkin().blurPx, 50);

  clearCustomSkinPersist();
  assert.deepEqual(loadCustomSkin(), { image: null, blurPx: 0 });
});

test("persist throws structured SKIN_PERSIST_FAILED error when storage rejects writes", (t) => {
  const storage = installFakeStorage({ quota: true });
  t.after(storage.restore);

  assert.throws(
    () => persistCustomSkinImage("data:image/jpeg;base64,abc"),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_PERSIST_FAILED",
  );
  assert.throws(
    () => persistCustomSkinBlurPx(10),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_PERSIST_FAILED",
  );
  assert.throws(
    () => clearCustomSkinPersist(),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_PERSIST_FAILED",
  );
});

test("load falls back to defaults when stored blur is corrupted", (t) => {
  const storage = installFakeStorage();
  t.after(storage.restore);
  storage.map.set(CUSTOM_SKIN_IMAGE_STORAGE_KEY, "data:image/jpeg;base64,xyz");
  storage.map.set(CUSTOM_SKIN_BLUR_STORAGE_KEY, "not-a-number");
  assert.deepEqual(loadCustomSkin(), { image: "data:image/jpeg;base64,xyz", blurPx: 0 });
});

// ---------------------------------------------------------------------------
// applyCustomSkinDom：置/移除属性，重复调用幂等（spec §7.3、§4.2）
// ---------------------------------------------------------------------------

test("applyCustomSkinDom sets the gate attribute for an image and removes it for null", (t) => {
  const doc = installFakeDocument();
  t.after(doc.restore);

  applyCustomSkinDom("data:image/jpeg;base64,abc");
  assert.equal(doc.attributes.get("data-zcode-skin"), "on");

  // 幂等：重复应用同值不产生额外状态。
  applyCustomSkinDom("data:image/jpeg;base64,abc");
  assert.equal(doc.attributes.get("data-zcode-skin"), "on");

  applyCustomSkinDom(null);
  assert.equal(doc.attributes.has("data-zcode-skin"), false);

  // 无图时重复移除同样幂等。
  applyCustomSkinDom(null);
  assert.equal(doc.attributes.has("data-zcode-skin"), false);
});

test("applyCustomSkinDom is a no-op without a document", () => {
  delete (globalThis as { document?: unknown }).document;
  assert.doesNotThrow(() => applyCustomSkinDom("data:image/jpeg;base64,abc"));
  assert.doesNotThrow(() => applyCustomSkinDom(null));
});

// ---------------------------------------------------------------------------
// compressSkinImage：MIME/体积前置校验（spec §3、§6）
// ---------------------------------------------------------------------------

test("compressSkinImage rejects non-image files before touching the decoder", async () => {
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  await assert.rejects(
    () => compressSkinImage(file),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_IMAGE_DECODE_FAILED",
  );
});

test("compressSkinImage rejects inputs over 20MB before decoding", async () => {
  const file = { type: "image/png", size: 21 * 1024 * 1024 } as File;
  await assert.rejects(
    () => compressSkinImage(file),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_IMAGE_TOO_LARGE",
  );
});

test("compressSkinImage surfaces decode failures as SKIN_IMAGE_DECODE_FAILED", async () => {
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => {
    throw new Error("decode boom");
  };
  try {
    const file = new File(["broken"], "broken.png", { type: "image/png" });
    await assert.rejects(
      () => compressSkinImage(file),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "SKIN_IMAGE_DECODE_FAILED",
    );
  } finally {
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  }
});

// ---------------------------------------------------------------------------
// 压缩超限路径：降档重试 → 最终仍超抛结构化错误（spec §7.4）
// ---------------------------------------------------------------------------

const OVERSIZED_DATA_URL = `data:image/jpeg;base64,${"a".repeat(610_000)}`;

test("compressSkinImage downgrades through the ladder and rejects when every attempt exceeds 600KB", async (t) => {
  const mocks = installCompressMocks([OVERSIZED_DATA_URL, OVERSIZED_DATA_URL, OVERSIZED_DATA_URL]);
  t.after(mocks.restore);

  const file = new File(["img"], "big.jpg", { type: "image/jpeg" });
  await assert.rejects(
    () => compressSkinImage(file),
    (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SKIN_IMAGE_TOO_LARGE",
  );

  // 降档重试：1920 → 1536 → 1280，质量 0.78 → 0.6 → 0.6。
  assert.equal(mocks.canvasCalls.length, 3);
  assert.deepEqual(
    mocks.canvasCalls.map((call) => call.width),
    [1920, 1536, 1280],
  );
  assert.deepEqual(
    mocks.canvasCalls.map((call) => call.quality),
    [0.78, 0.6, 0.6],
  );
});

test("compressSkinImage returns the first attempt within budget at quality 0.78", async (t) => {
  const small = `data:image/jpeg;base64,${"b".repeat(1000)}`;
  const mocks = installCompressMocks([small]);
  t.after(mocks.restore);

  const file = new File(["img"], "ok.jpg", { type: "image/jpeg" });
  const result = await compressSkinImage(file);
  assert.equal(result, small);
  assert.equal(mocks.canvasCalls.length, 1);
  assert.equal(mocks.canvasCalls[0]?.width, 1920);
  assert.equal(mocks.canvasCalls[0]?.quality, 0.78);
});

test("compressSkinImage returns a downgraded attempt once it fits the budget", async (t) => {
  const small = `data:image/jpeg;base64,${"c".repeat(2000)}`;
  const mocks = installCompressMocks([OVERSIZED_DATA_URL, small]);
  t.after(mocks.restore);

  const file = new File(["img"], "mid.jpg", { type: "image/jpeg" });
  const result = await compressSkinImage(file);
  assert.equal(result, small);
  assert.equal(mocks.canvasCalls.length, 2);
  assert.equal(mocks.canvasCalls[1]?.width, 1536);
  assert.equal(mocks.canvasCalls[1]?.quality, 0.6);
});
