# 主题插件系统设计（自定义皮肤/主题 + 字体设置）

- 日期：2026-09-21
- 分支：`feature/theme-plugin`
- 状态：已评审（用户逐节确认）

## 1. 背景与可行性结论

ZCode 现有外观能力：内置 5 种主题值（`light` / `dark` / `zai-light` / `zai-dark` / `system`）、界面字号（12–20px，`--ui-font-size`）、代码区独立字号。缺失：自定义皮肤/主题、字体族设置。

插件系统现状（`apps/zcode-cli/packages/adapters/src/plugins/`）：`plugin.json` 仅支持 `commands` / `agents` / `skills` / `hooks` / `mcpServers` / `userConfig`，全部为 Agent 侧能力，无 UI 样式注入通道（全仓库无 `injectCss` / `customTheme` / `addTheme` 等机制）。

**结论：纯插件无法实现主题/字体定制，必须先扩展核心。** 本设计选择扩展插件系统：新增 `themes` 插件组件类型 + 渲染端加载应用机制，使主题以插件形式分发（复用安装/启停/卸载/内置恢复全生命周期）。

已否决的备选方案：

- 纯核心功能（设置页直接加自定义主题）：与插件生态割裂。
- 用户级样式文件（`~/.zcode/themes/`）：无分发与生命周期管理。
- 任意 CSS 注入：安全风险不可接受。
- Shadow DOM/iframe 全隔离沙箱：需全量改造 UI，工程量不可接受。

## 2. 目标与非目标

### 目标

1. 主题以插件形式安装（复用现有插件商店与个人来源链路：本地目录、git、URL、官方市场）。
2. 主题能力 = 结构化 design token 覆盖 + 受限自定义 CSS。
3. 设置页新增：主题包选择器、界面字体族选择器、代码字体族选择器。
4. Desktop 与 Web 共用实现（`packages/ui`），一次实现两端生效。

### 非目标（YAGNI 边界）

- 在线主题市场收录流程（分发完全复用插件渠道，市场侧零改动）。
- 打包字体文件 / webfont（版权与第三方声明合规负担）。
- TUI 端主题（终端渲染，另行设计）。
- token 编辑器 / 可视化调色板（只做选择，不做创作）。
- 主题文件热更新（文件变化不自动重载，重进设置页生效）。

## 3. 主题包数据模型

### 3.1 manifest 扩展

`plugin.json` 新增可选字段 `themes`（字符串或字符串数组），沿用 skills/commands 的 `collectComponentDirs` 目录声明约定：

```json
{
  "name": "my-theme-pack",
  "version": "1.0.0",
  "themes": "themes"
}
```

默认目录约定为 `themes/`（存在即扫描，同 skills 行为）。

### 3.2 主题文件

每个主题为 `themes/<theme-id>/theme.json`（+ 可选附加 CSS）：

```json
{
  "id": "sereno-dark",
  "name": "Sereno Dark",
  "tokens": {
    "light": { "--color-brand": "#7c5cff", "--radius-lg": "0.75rem" },
    "dark": { "--color-brand": "#9d85ff" }
  },
  "suggestedFonts": { "ui": "Inter", "code": "JetBrains Mono" },
  "css": "overrides.css"
}
```

### 3.3 token 校验规则（zod，运行时校验）

跨插件边界的数据必须可运行时校验（遵守仓库 AGENTS.md 模块边界规范）：

- 变量名白名单：仅允许 `--color-*`、`--radius-*` 前缀。
- **禁止** `--ui-font-size` 与 `--font-*`：字号与字体族归用户设置管辖（§3.5、§5），避免主题与用户设置互相覆盖。主题影响字体的唯一通道是 `suggestedFonts` 建议。
- 值校验：颜色必须可解析为合法 CSS 颜色；几何值必须带 `px` / `rem` 单位。

### 3.4 受限 CSS 规则

1. 注入时使用 CSS 原生 `@scope (#root)` 包裹（挂载点 `#root` 在 Desktop renderer 与 Web 的 index.html 中均已存在）。`@scope` 需 Chromium 118+；不支持的浏览器整块忽略，主题附加样式静默降级（token 不受影响）。
2. 加载前静态扫描黑名单：`@import`、`url(`（含数据与外链地址）、`image-set(`、`javascript:`、`@charset`。命中任一 → 整个 CSS 文件拒绝（token 仍生效），主题标记为「CSS 未通过安全校验」。CSS 上限 256 KiB。
3. **威胁模型声明**：黑名单机制防误操作与低级注入，不是恶意对抗级沙箱。此声明写入本 spec 与主题作者文档。

### 3.5 字体原则

- 不打包字体文件，仅使用系统字体。
- 设置页提供常见字体静态列表 + 「自定义…」输入框（跨平台：列表按 Windows/macOS/Linux 常见字体合并）。
- 主题包 `suggestedFonts` 仅在设置页显示建议（「此主题建议使用 X」+ 一键应用按钮），**不静默覆盖**用户已选字体。

## 4. 状态所有权与应用机制

### 4.1 所有权图

```
┌─ CLI/Agent 侧（事实源）──────────────────────────────┐
│ 插件系统：已安装主题包清单、启用/停用状态               │
│ → 复用现有插件生命周期（安装/启停/卸载/                │
│   卸载内置后的抑制/恢复），语义不变                     │
│ → 新增：listThemes 查询（返回校验后的主题数据：        │
│   tokens + CSS 内容 + suggestedFonts +                │
│   valid/invalidReason；返回内容而非文件路径——          │
│   Web 端渲染进程无法读取 CLI 文件系统）                 │
└──────────────────┬─────────────────────────────────┘
               │ IPluginsService 扩展（RPC，现有通道）
┌──────────────▼───────────────────────────┐
│ UI zustand store（唯一应用所有者）          │
│ activeThemePluginKey + 字体设置              │
│ localStorage 持久化 + 跨窗口广播            │
│ （BROADCAST_FIELDS 新增字段，复用防回环机制）│
└──────────────┬───────────────────────────┘
               │ applyTheme()（幂等，可重放）
┌──────────────▼───────────────────────────┐
│ 渲染端：rootStyle.setProperty 写 token；    │
│ 注入/移除 <style id="zcode-theme-plugin">； │
│ 更新 --font-sans / --font-mono             │
└───────────────────────────────────────────┘
```

职责边界：

- CLI 插件系统：主题包「存在与启用」的事实源，不做应用。
- UI store：「当前应用哪个主题 + 字体选择」的唯一所有者，不持久化 token 内容。
- 渲染端 apply 函数：纯函数式应用，无状态，可重放。

### 4.2 应用算法（幂等，启动时重放）

1. 读 store 的 `activeThemePluginKey`（格式 `${pluginId}/${themeId}`，一个主题插件可携带多个主题）→ 在主题清单中查找。不存在（被卸载/停用）→ 回退默认主题并清空该 store 字段。
2. 按当前明暗模式取 `tokens.light` / `tokens.dark` 写 CSS 变量；系统明暗切换事件触发时**重放**（挂接 `useTheme` 模式变化）。
3. CSS 存在且校验通过 → 注入单个 `<style id="zcode-theme-plugin">`；切走主题 → 移除该标签（单标签整体替换，无残留）。
4. 失败路径（文件丢失/读取失败/校验失败）→ 回退默认主题 + toast 提示原因；store 保留用户选择（修复后可恢复）。

### 4.3 明暗模式交互

- 主题包应同时声明 `tokens.light` 与 `tokens.dark`。
- 只声明一组的主题在选择器中标注「仅深色/仅浅色」，缺失模式回退内置对应模式的值（半覆盖，不报错）。

### 4.4 主题清单的单一来源与插件变更刷新（实现补充）

主题清单同样是「唯一所有者」：清单必须由 UI store 的 `themePlugins` 承载，App 级应用点与设置页选择器只读同一份，
不允许各自 fetch（否则安装/卸载插件后两边清单分叉，见 §4.2 第 1 步的回退条件）。

```text
插件列表变更（安装/停用/卸载/更新/手动刷新/远端同步）
        └─ force:true → store.loadThemePlugins（唯一写入路径）
                              └─ themePlugins/status 更新 → App effect 重放 → 应用或回退
```

- 请求 key = `${workspaceIdentity?.trim() || workspacePath}|${configScope ?? ""}`；非 force 时：
  正在 loading，或已 ready 且 key 未变 → 直接返回（去重）。
- 过期响应丢弃：请求发起时递增模块级 requestId，响应返回时不匹配即忽略（回收 stale agent 期间的挂起请求
  不能覆盖后发请求的结果）。
- loading 立即清空清单，避免用上一个 workspace/插件集合的主题短暂匹配 key。
- 请求失败 → `status="error"` 并清空清单；此时 App 既不应用也不清空用户选择（§4.2 第 4 步）。

## 5. 设置 UI

位置：设置页「外观」卡片（`packages/ui/src/settingsCodePreview.tsx` 分区结构）新增：

1. **主题包选择器**：选项 = 内置 5 模式（现有 theme 值）+ 已启用主题插件的主题（按插件名分组，invalid 项置灰并显示原因）。
2. **界面字体**选择器：影响 `--font-sans`（需在 `styles.css` 将 Tailwind `font-sans` 栈提取为该变量）。
3. **代码字体**选择器：影响 `--font-mono`（变量已存在于 `styles.css`）。
4. 主题建议字体在选择器下方显示提示行 + 一键应用按钮。

交互：所有变更即时生效；不做撤销栈（重选即可），符合 DESIGN.md「calm、keyboard-driven」原则。

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| theme.json 缺字段 / schema 不符 | 主题标记 invalid；商店详情页与选择器置灰 + 原因文案 |
| token 变量名越权（如 `--ui-font-size`） | 同上；错误信息列出被拒变量名 |
| CSS 黑名单命中 | 主题可加载，CSS 丢弃；token 生效；toast「附加样式未通过安全校验」 |
| 应用时文件丢失 / 读取失败 | 回退默认主题 + toast；store 保留选择 |
| 已选主题被打成 invalid（更新后 schema 变化等） | 不应用 token/CSS、回退默认外观；按主题 key 去重提示一次主题名与原因；store 保留选择 |
| 插件被卸载 / 停用 | 静默回退默认主题（用户主动操作，不打扰） |

## 7. 测试场景

| # | 层 | 场景 |
|---|---|---|
| 1 | CLI 单测 | schema 校验：合法包通过；越权变量名、非法颜色值、缺 mode 组分别被拒且原因正确 |
| 2 | CLI 单测 | CSS 安全校验：`@import` / `url()` / `javascript:` 样例全部拦截；合法 CSS 包裹后作用域正确 |
| 3 | UI 单测 | 应用算法：切换→回退→再切换；明暗切换重放；卸载插件后回退 |
| 4 | UI 单测 | store：持久化恢复、跨窗口广播防回环 |
| 5 | E2E | 本地目录安装主题插件 → 设置页选择 → 断言根节点变量值与 `<style>` 内容 |

测试入口以各目标包当前 `package.json` 与实际测试文件为准，不假定统一命令。

## 8. 验收标准

1. 本地目录安装示例主题包后，Desktop 与 Web 外观设置页出现该主题；选择后 `--color-brand` 等变量按明暗模式正确切换。
2. 卸载主题插件后干净回退默认主题，无残留 `<style>` 与变量。
3. `pnpm typecheck` 与 `pnpm lint` 通过；架构检查（`pnpm architecture:check --changed`）通过。

## 9. 实施涉及面（供实现计划参考）

| 层 | 位置 | 改动 |
|---|---|---|
| 插件发现 | `apps/zcode-cli/packages/adapters/src/plugins/` | manifest 解析 `themes` 字段、主题包扫描与 zod 校验 |
| 协议/类型 | `packages/shared` | 主题清单与 token schema 类型 |
| 服务通道 | `packages/services/src/plugins/` | `IPluginsService` 扩展 `listThemes` |
| UI store | `packages/ui/src/store/` | `activeThemePluginKey` + 字体字段 + 广播 |
| UI 应用 | `packages/ui/src/lib/`（新 `themePlugin.ts`，对齐 `uiFontSize.ts` 模式） | `applyTheme()` |
| 设置 UI | `packages/ui/src/settingsCodePreview.tsx` 及外观分区 | 三个新选择器 |
| 基础 CSS | `packages/ui/src/styles.css` | 提取 `--font-sans` 变量、`#zcode-theme-scope` 说明 |
| 示例与文档 | 主题作者文档 + 示例主题包 | 威胁模型与格式说明 |
