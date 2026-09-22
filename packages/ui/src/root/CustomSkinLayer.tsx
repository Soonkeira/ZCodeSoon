import { useZCodeStore } from "@/store/StoreProvider.js";

/**
 * 自定义皮肤背景层（spec §4.4）：只读 store 的图片与模糊度，不持有状态。
 * 无图返回 null——皮肤关闭时零 DOM 副作用；有图时铺满父级（RootShell 根 div），
 * -z-10 依赖根 div 的 isolate 把负 z 场景上下文限制在其子树内。
 */
export function CustomSkinLayer() {
  const image = useZCodeStore((state) => state.customSkinImage);
  const blurPx = useZCodeStore((state) => state.customSkinBlurPx);
  if (!image) {
    return null;
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${image})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          // 只对皮肤层单元素做模糊（spec §1 已否决全屏 filter）；scale 仅在有模糊时
          // 补偿边缘露白——0 档跳过 scale，避免重采样把清晰图软化（用户实测反馈）。
          filter: `blur(${blurPx}px)`,
          transform: blurPx > 0 ? "scale(1.08)" : undefined,
        }}
      />
      {/* 遮罩纱消费 --skin-scrim（四个主题块分别定义，随明暗切换，spec §4.3）。 */}
      <div className="custom-skin-scrim absolute inset-0" />
    </div>
  );
}
