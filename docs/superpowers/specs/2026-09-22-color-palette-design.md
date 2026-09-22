# 主色 × 底色调色盘设计 spec

- 日期：2026-09-22
- 分支：main
- 状态：已批准，待实现（色值终值待用户提供，先以自设计初版跑通，数据文件独立可整包替换）

## 1. 背景与可行性结论

用户要求实现其另一份实现中的「主色 × 底色自由组合」调色盘外观面板（主色 6 × 底色 8 × 明暗 2 = 96 组，全部通过 WCAG AA）。

调研结论：
- 四个主题块（light/.dark/.theme-zai-light/.theme-zai-dark）中，background 家族与全部固定面色（card/panel/popover/input/menu/toast/tooltip/tag/sidebar/header/tab/secondary 等 ~19 项）**均为 neutral-* 字面量或写死 hex，不从 background 派生**——底色必须逐项覆盖，否则出现彩底浮白卡。
- 主色一族：`--color-brand` 及其全部 `var()` 消费自动跟随；但 `--color-accent`、`interaction-ask-*`、`file-node*`、`git-renamed`、`usage-chart-1`、`context-breakdown-1..7` 为独立字面量需覆盖；**zai 两块的 `--color-input-border-focused` 引用 `--color-border-hover` 而非 brand，必须显式覆盖**否则 zai 主题下输入聚焦不跟随主色。
- `border/surface/hover` 系为黑白 alpha，自适应新底色，不覆盖。
- 内联 token 写入无 schema 门槛（`applyPluginThemeTokens` 裸 setProperty）；但调色盘**不得复用**该函数与其 `appliedThemeTokenKeys` 记录（共享记录会互相清错），须独立 applier。
- 主题插件与调色盘写同一批内联变量，同一 html style 上 `removeProperty` 按 key 生效不分辨写入者 → 协调策略为**插件激活时调色盘让位**，靠 `App.tsx` 内 effect 声明顺序（插件先、调色盘后）保证任一方向切换都由后跑者收敛到正确状态。
- meta theme-color 读 computed `--color-background`（`useTheme.ts:52`），调色盘改色后需主动刷新一次。
- 首屏启动脚本不接调色盘：与主题插件 token 同基线（插件也没接），首帧默认配色可接受。

**已否决备选**：
1. 调色盘优先/双写共存——同名内联 key 无法区分写入者，必然互相误清。
2. 底色只改 `--color-background`——固定面色不派生，视觉割裂。
3. 复用 `applyPluginThemeTokens`——共享 applied 记录导致跨系统清错残留。
4. 折叠 system 模式进日夜两选——丢失系统监听与广播语义。

## 2. 目标与非目标

**目标**：
- 外观页「主题」Select 行替换为调色盘面板：明暗三 chips（夜间/日间/系统）+ 主色 6 chips + 底色 8 chips + 恢复默认。
- 切换即时生效（html 内联 token 覆盖）、持久化（localStorage）、跨窗口广播、刷新重放。
- 主题插件（sereno 等）激活时调色盘让位：token 清空、三排置灰 + 提示；插件停用/失效自动恢复。
- 96 组搭配全部通过 WCAG AA（脚本验证，以用户提供的终值色表为准）。
- 与图片皮肤、主题插件三者独立叠加。

**非目标**：
- 不改主题插件逻辑/schema/`useThemePlugins.ts`/`themePlugin.ts`/`themePluginSelect.tsx`/`index.html`/`styles.css` 静态规则。
- 不做任意自选色（仅预设 chips）；不做 per-app 主题；不接首屏启动脚本。
- 不动图片皮肤功能；不接管侧栏 footer 快捷切主题（共写同一 theme 字段，天然一致）。

## 3. 数据模型

| 项 | 值 |
|---|---|
| 键 | `zcode-palette-primary`（主色 id）、`zcode-palette-base`（底色 id）；默认值 `graphite` / `dune`（石墨/沙丘，对齐用户截图当前值） |
| store 字段 | `palettePrimaryId: string`、`paletteBaseId: string` + 两个 setter |
| 广播 | `PALETTE_BROADCAST_FIELDS = ["palettePrimaryId","paletteBaseId"]` |
| 色表结构（lib/palette.ts 内独立常量，**终值来源=用户提供的 schemes.css/surfaces.css，2026-09-22 收到**） | 每色 `{ id, light: Record<token,string>, dark: Record<token,string> }`；主色 6（id 对齐用户文件）：`aurora`（极光青绿）`cyan`（冰青）`indigo`（靛蓝）`violet`（紫罗兰）`graphite`（石墨）`contrast`（高对比 AAA，附带表层收紧覆盖）；底色 8：`mist`（冷雾，基准=不产生覆盖、沿用内置主题值）`paper`（暖砂）`dune`（沙丘）`moss`（苔痕）`slate`（石板）`midnight`（夜蓝）`clay`（藕荷）`ink`（深墨）；i18n 展示名。映射：主色 `--accent→--color-brand`、`--accent-soft→--color-accent`，其余主色族沿用 brand 派生公式；底色取 `canvas→background`、`ink→foreground`、`card=light?panel:raised`、`win-alt=light?sunken:raised`，其余 18 项阶梯沿用 color-mix 派生；`contrast` 的表层按同一映射函数覆盖所选底色（级联：主色 > 底色），其 `ok/warn/danger/info/idle/meter` 若与内置语义 token 同名则一并映射；用户的 `line*/track/floating/overlay/scrim/aura-*/accent-strong/deep/ink/on-soft` 不映射（本仓 border/surface 走既有黑白 alpha 自适应，见非目标） |
| 底色覆盖集（每色每模式需给出或可派生） | `--color-background`、`--color-background-alt`、`--color-background-win-alt`、`--color-header`、`--color-panel`、`--color-sidebar`、`--color-card`、`--color-card-selected`、`--color-popover`、`--color-popover-header`、`--color-input`、`--color-input-focused`、`--color-tab`、`--color-tab-active`、`--color-menu`、`--color-menu-hover`、`--color-toast`、`--color-tooltip`、`--color-tooltip-tag`、`--color-tag`、`--color-secondary`；明度变化大时加 `--color-foreground`。色表未显式给出的项由 `color-mix` 派生公式补齐（基于该色 background/card 基值） |
| 主色覆盖集 | `--color-brand`、`--color-accent`、`--color-interaction-ask-surface`、`--color-interaction-ask-foreground`、`--color-file-node-*`（3 项）、`--color-git-renamed`、`--color-usage-chart-1`、`--color-context-breakdown-1..7`、`--color-input-border-focused` |
| mode 分支 | resolved 明暗（system 按 `resolveTheme` 折算）决定取 light/dark 组；theme 字段仍由现有 `setTheme` 管理 |

## 4. 状态所有权与应用机制

```
调色盘 UI（chips / 恢复默认）
   │ setters：normalize(id ∈ 内置表) → persist → setState
   ▼
zustand slice paletteState ←—— 唯一所有者
   ├─ localStorage（两键）
   ├─ 广播 PALETTE_BROADCAST_FIELDS（收端只 set 不 persist，防回环）
   └─ 启动重放：load → set
DOM 应用唯一挂点：usePaletteApplication effect（App.tsx，挂在 useThemePluginApplication() 之后）
   ├─ activeThemePluginKey != null → applyPaletteTokens({})   ← 让位（独立 appliedPaletteTokenKeys 精确清除）
   └─ 否则 applyPaletteTokens(buildPaletteTokens(resolvedMode, primary, base))
        → 完成后调 refreshBrowserThemeSurface() 刷新 meta theme-color
```

- effect 顺序契约：插件 effect 先跑（apply/clear 插件 token），调色盘 effect 后跑并收敛——插件激活时调色盘后清自己的 key；插件失效时插件先删自己的 key、调色盘随后重写自己的值。两系统各自独立 tracked keys，互不误清。
- 主题模式切换（setTheme）会重跑 applyTheme（class 变化）→ 调色盘 effect 依赖 resolvedMode/theme，重放取新 light/dark 组。
- 幂等：apply 先清 tracked keys 再写当前集合，重复调用收敛到同一 DOM。

## 5. 设置 UI

`settingsCodePreview.tsx` 外观界面卡：**删除主题 Select 行（L189-213），原位新增**：
1. 明暗行：三胶囊 chips（复用 THEME_MODES 的 mode+icon，含系统），绑定 `theme/setTheme`（沿用 `handleFooterThemeChange` 包装保持遥测一致）
2. 主色行：6 胶囊 chips（色点圆点 + 名称），选中态边框强调
3. 底色行：8 胶囊 chips + 右侧「恢复默认」按钮（outline + RotateCcw，照 ShortcutSettingsSection L222-230 先例；点击清两 key + 清 token + 回默认 id）
- 主题包激活时三排 `disabled`，行下 `text-ui-sm text-foreground-subtle` 提示「主题包生效中，停用后调色盘恢复」（照 themePluginSelect L95-112 样式）；`activeThemePluginKey` 直接 `useZCodeStore` 读（免 prop）
- 面包屑展示「主色 · 底色 · 明暗」现状（默认 `appearance.interfaceDescription` 位置或行内 hint）
- props：`SettingsPage.tsx` 新增 palette 字段/ setter，setter 包 `runUserAction({featureId:"settings.appearance", action:"change_palette_primary|change_palette_base|reset_palette"})`
- i18n `settings.palette.*` 两 locale（行标签、6+8 色名、恢复默认、让位提示、面包屑）

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 存储值不在内置表（脏数据/旧版本残留） | normalize 回默认 id，不报错 |
| 主题包激活期间 setter 被调（理论不可达，UI 已 disabled） | 仍 persist+set；DOM 不变（effect 让位分支覆盖），插件停用后自然生效 |
| 色表 token 值非法 | 构建期常量 + 测试断言；AA 脚本兜底 |
| localStorage 写失败 | 复用 writeSafeLocalStorage 静默语义（与主题/皮肤一致） |

## 7. 测试场景（node:test，先写后实现）

`packages/ui/test/palette.test.ts`：
1. normalize：合法 id 透传、未知 id 回默认
2. persist/load 往返（mock localStorage）+ 空值默认
3. `buildPaletteTokens`：light/dark 各产出完整覆盖集（底色 19+ / 主色 13+ 项全在）；system 模式按 resolve 折算
4. `applyPaletteTokens`：写入 tracked keys；二次不同集合调用精确清除旧 key 不残留；`{}` 清空全部

`packages/ui/test/paletteState.test.ts`：
1. setter normalize→persist→set 顺序
2. 广播字段注册 + 收端不回环
3. 启动重放 load→set

## 8. 验收标准

1. 切主色/底色全 UI 即时变化（含 win-alt 窗口 frame、zai 主题下 input 聚焦跟随主色）
2. 明暗三 chips 与原 Select 等价（system 监听、侧栏 footer 快捷切换、跨窗口广播无回归）
3. sereno 激活：调色盘 token 清空、三排置灰+提示；停用后自动恢复
4. meta theme-color 跟随底色；刷新持久 + 双窗口同步
5. 恢复默认一键回 石墨·沙丘（+当前明暗不变）
6. AA 脚本 6×8×2=96 组全过
7. `pnpm typecheck` / `pnpm lint` / 新增单测全绿；图片皮肤与主题插件无回归

## 9. 实施涉及面

**Create**：本 spec；`packages/ui/src/lib/palette.ts`；`packages/ui/src/store/paletteState.ts`；`packages/ui/src/hooks/usePaletteApplication.ts`；`packages/ui/test/palette.test.ts`；`packages/ui/test/paletteState.test.ts`；AA 验证脚本（`packages/ui/scripts/verify-palette-aa.mjs` 或 test 内断言）

**Modify**：`packages/ui/src/store/index.ts`（slice 接线 4 处）；`packages/ui/src/App.tsx`（挂 hook 1 行）；`packages/ui/src/useTheme.ts`（导出刷新包装）；`packages/ui/src/settingsCodePreview.tsx`（主题行替换为三行 chips + 恢复默认）；`packages/ui/src/SettingsPage.tsx`（props + 遥测）；`packages/ui/src/i18n/locales/en-US.ts`、`zh-CN.ts`；`packages/ui/src/lib/userActionTraceCatalog.ts`（3 个 action）；必要时 `packages/ui/src/index.ts` 导出

**不改**：`lib/themePlugin.ts`、`hooks/useThemePlugins.ts`、`settings/themePluginSelect.tsx`、`styles.css` 静态规则、`packages/web/index.html`、图片皮肤相关文件、`settingsPageConfig.ts`（THEME_MODES 保留继续消费）
