/**
 * 自定义皮肤 Store 切片 —— 背景图与模糊度的唯一所有者（spec §4.1）。
 *
 * 收拢 customSkinImage / customSkinBlurPx / customSkinError 的持久化、
 * html[data-zcode-skin] 门控应用与跨窗口广播分发，避免全局 Store 膨胀
 * （对齐 themePluginState 切片先例）。
 */
import { logger } from "@/logger.js";
import {
  applyCustomSkinDom,
  clearCustomSkinPersist,
  customSkinErrorCode,
  loadCustomSkin,
  normalizeBlurPx,
  persistCustomSkinBlurPx,
  persistCustomSkinImage,
} from "@/lib/customSkin.js";

export interface CustomSkinStateSlice {
  /** 压缩后的 data:image/jpeg;base64,…；null 表示未设置皮肤。 */
  customSkinImage: string | null;
  /** 背景模糊度 0–50px（spec §3）。 */
  customSkinBlurPx: number;
  /** 最近一次持久化失败的结构化错误码；成功写入后清空（spec §6）。 */
  customSkinError: string | null;
  setCustomSkinImage: (image: string | null) => void;
  setCustomSkinBlurPx: (blurPx: number) => void;
  clearCustomSkin: () => void;
}

/** 参与跨窗口广播的皮肤字段；Store 的 BroadcastField 由本元组派生。 */
export const CUSTOM_SKIN_BROADCAST_FIELDS = ["customSkinImage", "customSkinBlurPx"] as const;

type CustomSkinStateWriter = (patch: Partial<CustomSkinStateSlice>) => void;

/** 广播/持久化共用的 blur 防抖窗口（spec §3）：滑块连发只落/发最后一次。 */
export const CUSTOM_SKIN_BLUR_DEBOUNCE_MS = 300;

function errorToCode(error: unknown): string {
  return customSkinErrorCode(error) ?? "UNKNOWN";
}

/**
 * 皮肤字段的初始值与 setter；写入模式与 setUiFontSizePx 一致：
 * normalize → persist → applyCustomSkinDom → set（blur 的 persist 走 300ms 防抖，
 * state 立即更新保证滑块流畅）。persist 失败按 spec §6 记 customSkinError 并回滚状态。
 */
export function createCustomSkinState(writeState: CustomSkinStateWriter): CustomSkinStateSlice {
  const stored = loadCustomSkin();
  let blurPersistTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelPendingBlurPersist = () => {
    if (blurPersistTimer !== undefined) {
      clearTimeout(blurPersistTimer);
      blurPersistTimer = undefined;
    }
  };

  return {
    customSkinImage: stored.image,
    customSkinBlurPx: stored.blurPx,
    customSkinError: null,
    setCustomSkinImage: (image) => {
      const nextImage = typeof image === "string" && image.length > 0 ? image : null;
      try {
        persistCustomSkinImage(nextImage);
      } catch (error) {
        // quota 失败：记录结构化错误码并回滚——image 不写入、门控不动（spec §6）。
        writeState({ customSkinError: errorToCode(error) });
        throw error;
      }
      applyCustomSkinDom(nextImage);
      writeState({ customSkinImage: nextImage, customSkinError: null });
    },
    setCustomSkinBlurPx: (blurPx) => {
      const nextBlurPx = normalizeBlurPx(blurPx);
      // state 立即更新（滑块流畅）；persist 300ms 防抖合并连发（spec §3）。
      writeState({ customSkinBlurPx: nextBlurPx, customSkinError: null });
      cancelPendingBlurPersist();
      blurPersistTimer = setTimeout(() => {
        blurPersistTimer = undefined;
        try {
          persistCustomSkinBlurPx(nextBlurPx);
        } catch (error) {
          // 异步落盘失败无法回滚已展示的滑块值，记错误码 + 日志，不静默（spec §6）。
          writeState({ customSkinError: errorToCode(error) });
          logger.warn("[custom-skin] 模糊度持久化失败", { code: errorToCode(error) });
        }
      }, CUSTOM_SKIN_BLUR_DEBOUNCE_MS);
    },
    clearCustomSkin: () => {
      cancelPendingBlurPersist();
      try {
        clearCustomSkinPersist();
      } catch (error) {
        writeState({ customSkinError: errorToCode(error) });
        throw error;
      }
      applyCustomSkinDom(null);
      writeState({ customSkinImage: null, customSkinBlurPx: 0, customSkinError: null });
    },
  };
}

/**
 * 分发跨窗口广播：返回该 field 是否由本切片认领。
 * 收端只 setState + 应用本窗口门控属性，不回写 localStorage（防回环，spec §4.1）。
 */
export function applyCustomSkinBroadcast(
  target: { setState: (patch: Partial<CustomSkinStateSlice>) => void },
  field: string,
  payload: unknown,
): boolean {
  if (field === "customSkinImage") {
    const image = typeof payload === "string" && payload.length > 0 ? payload : null;
    applyCustomSkinDom(image);
    target.setState({ customSkinImage: image });
    return true;
  }
  if (field === "customSkinBlurPx") {
    if (typeof payload !== "number") {
      return false;
    }
    target.setState({ customSkinBlurPx: normalizeBlurPx(payload) });
    return true;
  }
  return false;
}

/** 启动时重放已持久化的皮肤偏好（spec §4.1）：load → setState → 应用门控属性。 */
export function applyStoredCustomSkin(target: {
  setState: (patch: Partial<CustomSkinStateSlice>) => void;
}): void {
  const stored = loadCustomSkin();
  target.setState({ customSkinImage: stored.image, customSkinBlurPx: stored.blurPx });
  applyCustomSkinDom(stored.image);
}

/**
 * blur 广播的 300ms 防抖调度（spec §3）：滑块连发时只广播最后一次取值，
 * 与切片内 persist 防抖同窗口，state 本身仍即时更新。
 */
export function createBlurBroadcastScheduler(
  send: (value: number) => void,
): (value: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: number | undefined;
  return (value: number) => {
    pending = value;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      const next = pending;
      pending = undefined;
      if (next !== undefined) {
        send(next);
      }
    }, CUSTOM_SKIN_BLUR_DEBOUNCE_MS);
  };
}
