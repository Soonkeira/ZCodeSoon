import type { ReactNode } from "react";
import { AlertDialogHost } from "@/AlertDialogHost.js";
import { ConfirmDialogHost } from "@/ConfirmDialog.js";
import { CuaPermissionObservationAttachment } from "@/cua-permission/CuaPermissionObservationAttachment.js";
import { CustomSkinLayer } from "@/root/CustomSkinLayer.js";

export function RootShell({ children }: { children: ReactNode }) {
  // Web 远控在手机浏览器里不能用固定 100vh，
  // 地址栏收放会让底部输入区被裁到视口外；根节点改用动态视口高度。
  // isolate 建立层叠上下文，把皮肤层的 -z-10 限制在根子树内（spec §4.4）。
  return (
    <div className="relative isolate h-dvh">
      <CustomSkinLayer />
      {children}
      <CuaPermissionObservationAttachment />
      <AlertDialogHost />
      <ConfirmDialogHost />
    </div>
  );
}
