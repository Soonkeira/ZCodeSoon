# 自定义皮肤（背景图 + 模糊度）设计 spec

- 日期：2026-09-22
- 分支：main
- 状态：已批准，待实现

## 1. 背景与可行性结论

用户希望"上传图片、调节清晰度，做自定义皮肤"。调研结论：

- 主题插件通道**不可用**：`theme-package.ts` schema 为 strict，token 白名单仅 `--color-*|--radius-*`，附加 CSS 黑名单禁 `url(`/`image-set(`——皮肤图不能走插件分发；且插件是"分发"语义，而皮肤是"用户本地偏好"，职责不同。
- 现有可复用基础：文件选择（`<input type=file>` 先例 ×3、`IPlatformService.selectFile` 桌面端）、`FileReader → dataURL`、原生 `input[type=range]` 先例（`WhiteboardPane.tsx:296`）、`uiFontSize`/`uiFontFamily` 的「localStorage + zustand slice + 广播 + 启动重放」标杆模式、单 `<style>`/属性门控注入先例（`themePlugin.ts`）。
- 渲染约束：body/#root 背景在两端均被 `!important` 钉死（Web `index.html:88-100` 服务 overscroll/theme-color；`styles.css:46-55` 服务 Electron vibrancy），**皮肤不得写 html/body/#root 背景**；`--color-background` 被 Web theme-color meta（`useTheme.ts:52-55`）依赖，不得改值。
- 可见性约束：聊天区/设置面板为不透明 `bg-background`，窗口 frame 为 `bg-background-win-alt`（`DesktopWindowFrame.tsx:43`）——皮肤开启时这些表面必须半透明化，否则背景图不可见。

**已否决备选方案**：
1. 走主题插件 schema（放开图片字段）——违反插件分发语义与 CSS 安全模型，且主题包不可携带任意二进制。
2. 图片存服务端资产目录（改协议 + 双 schema + 读回接口）——工作量翻倍，且用户确认本机生效即可。
3. IndexedDB 存原图——全仓零基础设施，localStorage 压缩图（≤600KB）已在 5MB 配额内，YAGNI。
4. 全屏 `filter: blur()` 于内容层——大面积合成成本高；只对皮肤层单元素做模糊。

## 2. 目标与非目标

**目标**：
- 设置 → 外观 → 界面设置新增「自定义皮肤」：选图（压缩后持久化）、模糊度滑块（0–50px，即"清晰度"）、清除。
- 皮肤开启时**全局半透明毛玻璃**：背景图经皮肤层透出，窗口 frame 与所有 `bg-background` 面板半透明 + backdrop-blur；关闭皮肤后 DOM/样式与现状逐字节一致。
- 与主题包、明暗模式**可叠加**：主题管配色，皮肤管背景图，互不覆盖。
- 双窗口同步、刷新持久、桌面与 Web 同一套代码生效。

**非目标（YAGNI 边界）**：
- 不改主题插件 schema；不做插件分发皮肤。
- 不做图片裁剪/位置/对齐、多图轮播、明暗各一张、EXIF 方向、视频壁纸。
- 不做跨设备同步（localStorage 本机本浏览器生效）。
- 不动 `--color-background`、html/body/#root 的 `!important` 背景、vibrancy/overscroll/theme-color 机制。

## 3. 数据模型

| 项 | 值 |
|---|---|
| localStorage 键（图片） | `zcode-custom-skin-image`：压缩后 `data:image/jpeg;base64,…`，**≤600KB 字符** |
| localStorage 键（模糊度） | `zcode-custom-skin-blur-px`：整数 0–50，默认 0 |
| store 字段 | `customSkinImage: string \| null`、`customSkinBlurPx: number`（+ 两个 setter、`customSkinError?: string \| null` 供 UI 展示拒绝原因） |
| DOM 门控 | `html[data-zcode-skin="on"]`（有图时置位，无图移除） |
| 图片压缩规格 | MIME 校验（image/*）→ canvas 缩放长边 ≤1920 → `toDataURL("image/jpeg", 0.78)`；产物 base64 >600KB 时降档重试（长边 1536 → 1280，或质量 0.6），仍超则拒绝 |
| 广播 | 新元组 `CUSTOM_SKIN_BROADCAST_FIELDS = ["customSkinImage", "customSkinBlurPx"]`；persist + 广播对 blur 做 **300ms debounce**（防滑块连发）；若 image 广播 payload 实测有传输问题，退化为「广播 `customSkinImageVersion`（时间戳），收端从 localStorage 读」——实现时以实测为准，接口保持字段名不变 |

压缩、归一化、persist/load、DOM 属性应用全部为 `packages/ui/src/lib/customSkin.ts` 的**纯函数/无组件依赖函数**（可被 node:test 直接测）。

## 4. 状态所有权与应用机制

### 4.1 所有权图（唯一写路径）

```
设置 UI（选图/滑块/清除）
   │ setters（normalize → persist → setState）
   ▼
zustand slice customSkinState  ←—— 唯一所有者
   │ persist                    │ broadcast（store.subscribe 比较 → broadcastService）
   ▼                            ▼ 其他窗口
localStorage              applyCustomSkinBroadcast（收端 setState，不回环）
   │
   │ 启动：applyStoredCustomSkin（createZCodeStore 内重放）
   ▼
applyCustomSkinDom() → html[data-zcode-skin] 属性（CSS 门控钩子）
渲染层 CustomSkinLayer 只读 store（customSkinImage / customSkinBlurPx），不持有状态
```

- 职责边界：lib = 纯函数；slice = 状态与持久化；组件 = 只读渲染；styles.css = 无属性不生效的门控规则。
- 防回环：广播分发路径设 `applyingBroadcast` 标记（复用 `store/index.ts` 现有机制），收端只 setState 不再 persist。

### 4.2 幂等应用

`applyCustomSkinDom(image)`：`image` 非空 → `documentElement.setAttribute("data-zcode-skin","on")`；空 → `removeAttribute`。重复调用同值无副作用。启动重放与 setter 均经此函数。

### 4.3 明暗交互

皮肤层 `::after` 遮罩消费 `--skin-scrim`，在 styles.css 四个主题块分别定义：

- `.theme-zai-light` / 默认 light：`rgba(255,255,255,0.55)` 级白纱
- `.dark` / `.theme-zai-dark`：`rgba(0,0,0,0.5)` 级黑纱

随 `applyTheme` 切 class 自动跟随，无需皮肤层感知主题。目的：半透明面板上的文字对比度。

### 4.4 渲染与门控

1. `CustomSkinLayer` 挂 `RootShell` 根 div **第一个子节点**（`Root.tsx` 分支之前），根 div 加 `isolate`（建立层叠上下文，影响面仅限其子元素负 z）：
   - 层：`absolute inset-0 -z-10 pointer-events-none`
   - 图：`background-image: url(<store image>); background-size: cover; background-position: center; filter: blur(var(--zcode-skin-blur)); transform: scale(1.08)`（scale 补偿模糊边缘露白，层身 `overflow` 由父级裁切）
   - 遮罩：`::after { content:""; inset:0; background: var(--skin-scrim) }`
2. 门控规则（styles.css 静态存在，无属性不生效）：
   - `html[data-zcode-skin="on"] [data-desktop-window-frame]` → 背景改半透明 color-mix
   - `html[data-zcode-skin="on"] .bg-background` → `background-color: color-mix(in oklab, var(--color-background) 45%, transparent) !important`；`@supports (backdrop-filter: blur(1px))` 内追加 `backdrop-filter: blur(10px)`
   - `.bg-card` / `.bg-panel` / `.bg-popover` 不动（可读性）
3. 不得触碰：`html,body,#root` 背景规则、`--color-background`、theme-color meta、vibrancy。

## 5. 设置 UI

位置：`settingsCodePreview.tsx` 界面卡，「界面字体」行之后（L187 附近）新增两行 `SettingsRow`：

1. **自定义皮肤**（`settings.customSkin`）：
   - 无图：「选择图片」按钮（隐藏 `<input type="file" accept="image/*">`，先例 `FeedbackScreenshotPicker.tsx:113`）
   - 有图：64×40 缩略图（`<img src={image}>`）+ 「更换」+「清除」
   - 描述文案说明"本机生效，不随账号同步"
2. **背景模糊度**（`settings.customSkinBlur`）：原生 `<input type="range" min=0 max=50 step=1>` + 当前值 `Npx`；`customSkinImage` 为空时 `disabled`

接线：props 走 `SettingsPage.tsx:1795-1823` 同一通道；setter 调用包 `runUserAction` 遥测（`featureId: "settings.appearance"`，仿字号 L1801-1815）。选图成功/失败经现有 toast 通道提示（失败含结构化原因）。

i18n（en-US.ts ~L1800 外观块 / zh-CN.ts ~L1697，两文件顺序一致）：
`settings.customSkin`、`settings.customSkinDescription`、`settings.customSkinSelect`、`settings.customSkinReplace`、`settings.customSkinClear`、`settings.customSkinBlur`、`settings.customSkinBlurDescription`（约 7 key）。

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 非图片文件 / 解码失败 | 拒绝，toast 结构化原因，状态不变 |
| 超大输入（>20MB 拒绝在前）/ 压缩后仍 >600KB | 拒绝并提示"图片过大，请换小图"，不写入 |
| localStorage 写入 quota 异常 | 捕获 → `customSkinError` + toast，状态回滚，不静默 |
| 广播 payload 传输失败 | image 字段退化为版本号信号（§3），blur 正常 |
| 皮肤未开启 | 门控规则与皮肤层均不产生任何 DOM/样式副作用（验收标准之一） |

## 7. 测试场景（node:test，先写测试再实现）

`packages/ui/test/customSkin.test.ts`：
1. `normalizeBlurPx`：0/-5/50/99/NaN → 0/0/50/50/0（clamp + 非数回默认）
2. persist/load 往返：mock localStorage，image + blur 写入后读回一致；空值 load 返回默认
3. `applyCustomSkinDom`：有图置属性、无图移除、重复调用幂等
4. 压缩超限路径：mock canvas/toDataURL 返回超 600KB → 降档重试 → 最终仍超抛结构化错误（纯可测部分；canvas 解码部分 mock）

`packages/ui/test/customSkinState.test.ts`（仿 `themePluginState.test.ts`）：
1. setter：normalize → persist → state 顺序与值正确
2. `CUSTOM_SKIN_BROADCAST_FIELDS` 注册且收端 apply 不回环
3. `applyStoredCustomSkin` 启动重放：读 localStorage → state + DOM 属性

## 8. 验收标准

1. 选图后：图片可见于背景（聊天区/设置区半透明毛玻璃透出），`html[data-zcode-skin="on"]` 存在。
2. 模糊滑块 0→50 实时改变背景模糊；刷新后保持。
3. 清除后：属性移除、皮肤层不渲染、门控规则零副作用——与改动前 DOM/样式一致。
4. 双窗口：一端改图/模糊，另一窗口 1s 内同步。
5. 深浅模式切换：遮罩自动跟随（深色压暗/浅色提亮），文字可读。
6. 与 sereno 主题包同时开启：配色与背景图同时生效，互不覆盖。
7. Web overscroll 区、theme-color meta 值不受皮肤影响。
8. `pnpm typecheck`、`pnpm lint` 通过（真实执行）；新增 node:test 全绿。

## 9. 实施涉及面

**Create**：本 spec；`packages/ui/src/lib/customSkin.ts`；`packages/ui/src/store/customSkinState.ts`；`packages/ui/src/root/CustomSkinLayer.tsx`；`packages/ui/test/customSkin.test.ts`；`packages/ui/test/customSkinState.test.ts`

**Modify**：`packages/ui/src/root/RootShell.tsx`（isolate + 挂层）；`packages/ui/src/store/index.ts`（slice 接线、广播、启动重放）；`packages/ui/src/styles.css`（门控规则 + 四主题 `--skin-scrim`）；`packages/ui/src/settingsCodePreview.tsx`（两 SettingsRow）；`packages/ui/src/SettingsPage.tsx`（props + 遥测）；`packages/ui/src/i18n/locales/en-US.ts`、`zh-CN.ts`；必要时 `packages/ui/src/index.ts` 导出。

**不改**：`theme-package.ts` schema、`useThemePluginApplication`、`--color-background` 定义、html/body/#root 背景规则、Web/desktop 两端 index.html。
