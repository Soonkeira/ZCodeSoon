/**
 * 调色盘 Store 切片 —— 主色/底色选择的唯一所有者（spec §4 状态所有权图）。
 *
 * 收拢 palettePrimaryId / paletteBaseId 的持久化与跨窗口广播分发，写入模式
 * 对齐 customSkinState 切片（normalize → persist → set）；html 内联 token 的
 * DOM 应用不在本切片——由 App 级 usePaletteApplication effect 唯一负责
 * （应用需要明暗上下文，且必须让位在主题插件 effect 之后收敛）。
 */
import {
  DEFAULT_PALETTE_BASE_ID,
  DEFAULT_PALETTE_PRIMARY_ID,
  clearPalettePersist,
  loadPalette,
  normalizePaletteBaseId,
  normalizePalettePrimaryId,
  persistPaletteBaseId,
  persistPalettePrimaryId,
} from "@/lib/palette.js";

export interface PaletteStateSlice {
  /** 当前主色 id；取值限定在 PALETTE_PRIMARY_COLORS 内。 */
  palettePrimaryId: string;
  /** 当前底色 id；取值限定在 PALETTE_BASE_COLORS 内。 */
  paletteBaseId: string;
  setPalettePrimaryId: (id: string) => void;
  setPaletteBaseId: (id: string) => void;
  /** 恢复默认（spec §5）：清两持久化 key + 回 石墨·沙丘，明暗不动。 */
  resetPalette: () => void;
}

/** 参与跨窗口广播的调色盘字段；Store 的 BroadcastField 由本元组派生。 */
export const PALETTE_BROADCAST_FIELDS = ["palettePrimaryId", "paletteBaseId"] as const;

type PaletteStateWriter = (patch: Partial<PaletteStateSlice>) => void;

/**
 * 调色盘字段的初始值与 setter：normalize → persist → set；
 * token 的 DOM 重放交给 App 级 effect（spec §4 唯一挂点）。
 */
export function createPaletteState(writeState: PaletteStateWriter): PaletteStateSlice {
  const stored = loadPalette();
  return {
    palettePrimaryId: stored.primaryId,
    paletteBaseId: stored.baseId,
    setPalettePrimaryId: (id) => {
      const normalizedId = normalizePalettePrimaryId(id);
      persistPalettePrimaryId(normalizedId);
      writeState({ palettePrimaryId: normalizedId });
    },
    setPaletteBaseId: (id) => {
      const normalizedId = normalizePaletteBaseId(id);
      persistPaletteBaseId(normalizedId);
      writeState({ paletteBaseId: normalizedId });
    },
    resetPalette: () => {
      clearPalettePersist();
      writeState({
        palettePrimaryId: DEFAULT_PALETTE_PRIMARY_ID,
        paletteBaseId: DEFAULT_PALETTE_BASE_ID,
      });
    },
  };
}

/**
 * 分发跨窗口广播：返回该 field 是否由本切片认领。
 * 收端只 normalize + setState、不回写 localStorage（防回环，spec §4）；
 * DOM 应用同样由本窗口的 usePaletteApplication effect 重放。
 */
export function applyPaletteBroadcast(
  target: { setState: (patch: Partial<PaletteStateSlice>) => void },
  field: string,
  payload: unknown,
): boolean {
  if (field === "palettePrimaryId") {
    target.setState({ palettePrimaryId: normalizePalettePrimaryId(payload) });
    return true;
  }
  if (field === "paletteBaseId") {
    target.setState({ paletteBaseId: normalizePaletteBaseId(payload) });
    return true;
  }
  return false;
}

/** 启动时重放已持久化的调色盘选择（spec §4：load → set；DOM 由 App effect 负责）。 */
export function applyStoredPalette(target: {
  setState: (patch: Partial<PaletteStateSlice>) => void;
}): void {
  const stored = loadPalette();
  target.setState({ palettePrimaryId: stored.primaryId, paletteBaseId: stored.baseId });
}
