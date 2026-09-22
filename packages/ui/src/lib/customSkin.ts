import { getSafeLocalStorage, readSafeLocalStorage } from "@/lib/browserEnvironment.js";

export const CUSTOM_SKIN_IMAGE_STORAGE_KEY = "zcode-custom-skin-image";
export const CUSTOM_SKIN_BLUR_STORAGE_KEY = "zcode-custom-skin-blur-px";

export const CUSTOM_SKIN_MAX_BLUR_PX = 50;
const DEFAULT_BLUR_PX = 0;

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
// 600KB 上限：localStorage 总配额约 5MB，且 setItem 是同步写——超大字符串会卡 UI 线程，
// 也会挤占同域其他键的余量；写失败按 quota 异常上报（spec §6）。
const MAX_IMAGE_CHARS = 600_000;
const DECODE_TIMEOUT_MS = 15_000;

const IMAGE_MIME_PREFIX = "image/";

export type CustomSkinErrorCode =
  | "SKIN_IMAGE_TOO_LARGE"
  | "SKIN_IMAGE_DECODE_FAILED"
  | "SKIN_PERSIST_FAILED";

/** 结构化错误：UI 按 code 映射 toast 文案（spec §6）。 */
export class CustomSkinError extends Error {
  readonly code: CustomSkinErrorCode;

  constructor(code: CustomSkinErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CustomSkinError";
    this.code = code;
  }
}

export function customSkinErrorCode(error: unknown): CustomSkinErrorCode | null {
  return error instanceof CustomSkinError ? error.code : null;
}

/** clamp 0–50 取整；NaN/非法值回默认 0（spec §7.1）。 */
export function normalizeBlurPx(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BLUR_PX;
  }
  return Math.min(CUSTOM_SKIN_MAX_BLUR_PX, Math.max(DEFAULT_BLUR_PX, Math.round(value)));
}

export interface StoredCustomSkin {
  image: string | null;
  blurPx: number;
}

export function loadCustomSkin(): StoredCustomSkin {
  const rawImage = readSafeLocalStorage(CUSTOM_SKIN_IMAGE_STORAGE_KEY);
  const rawBlur = readSafeLocalStorage(CUSTOM_SKIN_BLUR_STORAGE_KEY);
  const parsedBlur = rawBlur === null ? Number.NaN : Number(rawBlur);
  return {
    image: rawImage && rawImage.length > 0 ? rawImage : null,
    blurPx: normalizeBlurPx(Number.isFinite(parsedBlur) ? parsedBlur : undefined),
  };
}

function persistValue(key: string, value: string): void {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // quota/隐私模式写失败不能静默：抛结构化错误，由 slice 记入 customSkinError 并回滚（spec §6）。
    throw new CustomSkinError("SKIN_PERSIST_FAILED");
  }
}

export function persistCustomSkinImage(image: string | null): void {
  persistValue(CUSTOM_SKIN_IMAGE_STORAGE_KEY, image ?? "");
}

export function persistCustomSkinBlurPx(blurPx: number): void {
  persistValue(CUSTOM_SKIN_BLUR_STORAGE_KEY, String(normalizeBlurPx(blurPx)));
}

export function clearCustomSkinPersist(): void {
  persistValue(CUSTOM_SKIN_IMAGE_STORAGE_KEY, "");
  persistValue(CUSTOM_SKIN_BLUR_STORAGE_KEY, "");
}

/** 幂等门控：有图置 html[data-zcode-skin="on"]，无图移除（spec §4.2）。 */
export function applyCustomSkinDom(image: string | null): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (!root?.setAttribute) {
    return;
  }
  if (image) {
    root.setAttribute("data-zcode-skin", "on");
  } else {
    root.removeAttribute("data-zcode-skin");
  }
}

interface EncodeAttempt {
  maxLongEdge: number;
  quality: number;
}

// 降档阶梯（spec §3）：1920/0.78 → 1536/0.6 → 1280/0.6；全部超 600KB 才拒绝。
const ENCODE_ATTEMPTS: readonly EncodeAttempt[] = [
  { maxLongEdge: 1920, quality: 0.78 },
  { maxLongEdge: 1536, quality: 0.6 },
  { maxLongEdge: 1280, quality: 0.6 },
];

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeWithCreateImageBitmap(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }
  const bitmap = await createImageBitmap(file);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      const timer = setTimeout(
        () => reject(new CustomSkinError("SKIN_IMAGE_DECODE_FAILED")),
        DECODE_TIMEOUT_MS,
      );
      element.onload = () => {
        clearTimeout(timer);
        resolve(element);
      };
      element.onerror = () => {
        clearTimeout(timer);
        reject(new CustomSkinError("SKIN_IMAGE_DECODE_FAILED"));
      };
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeSkinImage(file: File): Promise<DecodedImage> {
  try {
    const fromBitmap = await decodeWithCreateImageBitmap(file);
    if (fromBitmap) {
      return fromBitmap;
    }
    return await decodeWithImageElement(file);
  } catch (error) {
    if (error instanceof CustomSkinError) {
      throw error;
    }
    throw new CustomSkinError("SKIN_IMAGE_DECODE_FAILED");
  }
}

function encodeAttempt(decoded: DecodedImage, attempt: EncodeAttempt): string {
  const longEdge = Math.max(decoded.width, decoded.height);
  const scale = Math.min(1, attempt.maxLongEdge / longEdge);
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new CustomSkinError("SKIN_IMAGE_DECODE_FAILED");
  }
  context.drawImage(decoded.source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", attempt.quality);
}

/**
 * 选图压缩（spec §3）：MIME 与 20MB 前置校验 → 解码 → canvas 降档阶梯 →
 * 首个 ≤600KB 的产物返回；全部超限抛 SKIN_IMAGE_TOO_LARGE。
 */
export async function compressSkinImage(file: File): Promise<string> {
  if (!file.type.startsWith(IMAGE_MIME_PREFIX)) {
    throw new CustomSkinError("SKIN_IMAGE_DECODE_FAILED");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new CustomSkinError("SKIN_IMAGE_TOO_LARGE");
  }
  const decoded = await decodeSkinImage(file);
  try {
    for (const attempt of ENCODE_ATTEMPTS) {
      const dataUrl = encodeAttempt(decoded, attempt);
      if (dataUrl.length <= MAX_IMAGE_CHARS) {
        return dataUrl;
      }
    }
    throw new CustomSkinError("SKIN_IMAGE_TOO_LARGE");
  } finally {
    decoded.release();
  }
}
