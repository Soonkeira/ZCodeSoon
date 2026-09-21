# 主题插件作者指南

主题以插件形式分发。一个主题插件可以携带一个或多个主题；一个主题 = **design token 覆盖**（配色、圆角）+ **受限附加 CSS**。
用户在「设置 → 外观 → 界面设置 → 主题包」中选择主题；主题只在插件安装并启用后出现，停用或卸载插件会自动回退默认外观。

仓库内可直接安装的完整示例：[`apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme/`](../apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme/)。

## 1. 快速开始

最小主题插件的目录结构：

```
sereno-theme/
├── .zcode-plugin/
│   └── plugin.json          # 插件清单
└── themes/                  # 主题目录（默认约定）
    └── sereno-dark/
        ├── theme.json       # 主题定义（必需）
        └── overrides.css    # 附加样式（可选）
```

1. 复制示例目录，或按上面的结构新建，内容参考 `apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme/`。
2. 安装插件：设置 → 插件 → 插件市场 → 添加插件市场 → 选择目录，指向插件根目录；安装后启用。
3. 应用主题：设置 → 外观 → 界面设置 → 主题包，选择「Sereno Dark（sereno-theme）」。

主题文件没有热更新：修改 `theme.json` 或 CSS 后，重新进入设置页（重新拉取主题清单）或重新选择主题才会生效。

## 2. plugin.json：`themes` 字段

插件清单位于 `.zcode-plugin/plugin.json`（同时兼容 `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`）：

```json
{
  "name": "sereno-theme",
  "version": "1.0.0",
  "description": "Sereno 主题示例：演示 themes 组件类型的最低要求",
  "author": { "name": "ZCode Example" },
  "themes": "themes"
}
```

- `themes` 可以是字符串，也可以是字符串数组，用于声明主题目录；路径相对插件根，允许 `./` 前缀，不允许 `..` 越出插件根。
- 缺省 `themes` 时仍会扫描插件根下的 `themes/` 目录：目录存在即扫描，不依赖声明。
- 声明的目录与默认 `themes/` 目录合并去重；主题目录下的每个子目录若含 `theme.json` 即视为一个主题包（子目录名与主题 `id` 无关）。
- 主题只在插件**安装且启用**后进入设置页；同一次扫描中相同 `id` 只保留第一个。

## 3. theme.json 格式

每个主题放在自己的目录：`themes/<目录名>/theme.json`。

```json
{
  "id": "sereno-dark",
  "name": "Sereno Dark",
  "tokens": {
    "light": { "--color-brand": "#6d5bd0", "--radius-lg": "0.75rem" },
    "dark": { "--color-brand": "#a996ff" }
  },
  "suggestedFonts": { "ui": "Inter", "code": "JetBrains Mono" },
  "css": "overrides.css"
}
```

| 字段             | 必填 | 约束                                                                                              |
| ---------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `id`             | 是   | 匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`：小写字母或数字开头，只允许 `a-z0-9._-`，总长 ≤ 64 字符        |
| `name`           | 是   | 非空字符串，≤ 64 字符（首尾空白会被裁剪），用于选择器展示                                         |
| `tokens`         | 是   | 对象，只允许 `light` / `dark` 两个键；值是 `{ "--变量名": "值" }`；两组都可以是空对象             |
| `suggestedFonts` | 否   | 对象；**`ui` 与 `code` 必须同时提供**，各 1–128 字符；只作建议，不会静默覆盖用户字体选择（见 §6） |
| `css`            | 否   | 相对当前主题目录的 CSS 文件路径，1–256 字符；允许 `./` 前缀，不允许绝对路径或 `..` 越出主题目录   |

`theme.json` 采用严格 schema：出现表中以外的字段，或 `tokens` 下出现 `light` / `dark` 以外的键，整个主题判为无效。

### 3.1 token 变量名与取值

- **白名单**：只有 `--color-*` 与 `--radius-*` 两个前缀可覆盖；变量名还须匹配 `^--(color|radius)-[a-z0-9][a-z0-9-]*$`，长度 ≤ 64 字符。
- **保留变量**：`--ui-font-size`（界面字号）与全部 `--font-*`（字体族）禁止在 token 中声明；命中即整个主题无效。字号与字体族由用户在设置页管理，主题影响字体的唯一通道是 `suggestedFonts`（见 §6）。
- `--color-*` 取值（值 ≤ 128 字符）：
  - hex：`#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`，如 `#6d5bd0`；
  - 函数：`rgb()` / `rgba()` / `hsl()` / `hsla()` / `hwb()` / `lab()` / `lch()` / `oklab()` / `oklch()` / `color()` / `color-mix()` / `var()`，允许一层嵌套括号，如 `color-mix(in oklab, var(--color-sky-500) 32%, transparent)`；
  - 关键字：`transparent` / `currentcolor` / `inherit` / `initial`（大小写不敏感）。
- `--radius-*` 取值：数字 + `px` 或 `rem`，可带负号，如 `0.75rem`、`-0.25rem`；`em`、`%` 或无单位都会被拒绝。

## 4. tokens 语义

- 生效方式：选中主题后，token 被写成**根元素（`<html>`）上的内联 CSS 变量**，覆盖内置变量；切换主题时会精确清除旧主题声明过的变量，不残留。
- 明暗分别生效：`tokens.light` 在浅色模式下生效，`tokens.dark` 在深色模式下生效；主题为 `system` 时按解析后的实际明暗模式取值。
- 只声明一组时做**半覆盖**：另一模式沿用内置配色，不报错；设置页会在选择器下方标注「该主题仅覆盖深色/浅色模式，另一模式沿用内置配色。」（建议两个模式都声明。）
- 取值建议对照内置变量清单：`packages/ui/src/styles.css` 的 `@theme` 块（如 `--color-brand`、`--color-background`、`--color-foreground`、`--color-border`、`--radius-lg` 等）。

## 5. 附加 CSS：黑名单、体积上限与作用域

`css` 指向的文件在主题应用时读取，并作为唯一的 `<style id="zcode-theme-plugin">` 整体替换注入。没有 `css` 字段或文件不存在时只是没有附加样式，token 不受影响。

**黑名单**：命中任一构造即整个 CSS 文件被丢弃（token 仍然生效）。

| 被拒构造      | 说明                                                          |
| ------------- | ------------------------------------------------------------- |
| `@import`     | 禁止引入外部样式                                              |
| `@charset`    | 禁止字符集声明                                                |
| `url(`        | 禁止任何 URL（含 `data:` 与外链图片/字体），主题 CSS 不能联网 |
| `image-set(`  | 禁止响应式图片集                                              |
| `javascript:` | 禁止脚本伪协议                                                |

匹配是**纯文本正则匹配**（大小写不敏感），不区分选择器、属性值还是注释：字符串或注释里出现 `url(` 同样会导致整包 CSS 被拒。

**体积上限**：256 KiB，按 UTF-8 字节计量（262144 字节）；超出即整包拒绝。

**作用域**：注入时整个文件被 `@scope (#root) { … }` 包裹，因此直接写普通选择器即可，例如 `.markdown-body h1 { … }`。`@scope` 需要 Chromium 118+；不支持 `@scope` 的浏览器会整块忽略该样式块（附加样式静默降级，token 不受影响）。

**符号链接与路径**：主题目录本身、`theme.json`、css 文件中任何一个是符号链接（含 Windows junction）都会被拒绝——主题目录级链接整体跳过；`theme.json` 为链接判为无效主题；`css` 为链接或路径越出主题目录则丢弃 CSS（token 仍生效）。

## 6. suggestedFonts 行为

- `suggestedFonts` 仅作建议：选中该主题时，设置页显示「该主题建议字体：ui / code」和「一键应用」按钮。
- 只有用户点击「一键应用」才会把建议字体写入界面字体与代码字体设置；未点击时用户已选字体完全不受影响。
- 应用后就是普通用户设置，可随时在设置页改回。

## 7. 安全与威胁模型

- token 白名单、长度与取值校验、CSS 黑名单、`@scope (#root)` 作用域，目标是**防误操作与低级注入**：让主题不会意外破坏宿主界面、不会外联网络。
- 上述机制**不是恶意对抗级沙箱**。不要假设它能抵御精心构造的恶意主题；分发渠道可信度同样重要。具体边界：
  - 主题 CSS 无法发起网络请求（`url(` 被禁），也无脚本执行能力（`javascript:` 被禁，CSS 本身不具备脚本能力）；
  - 主题不能通过 token 覆盖界面字号与字体族（保留变量在 token 层被拒）；
  - 附加样式被限制在 `#root` 子树内（`@scope` 前提）。
- 停用或卸载插件后清理根元素残留变量与 `<style id="zcode-theme-plugin">`，自动回退默认外观。

## 8. 本地调试

1. 安装：设置 → 插件 → 插件市场 → 添加插件市场 → 选择目录，选中示例 `apps/zcode-cli/packages/adapters/test/fixtures/sereno-theme`，安装并启用。
2. 应用：设置 → 外观 → 界面设置 → 主题包，选择「Sereno Dark（sereno-theme）」。
3. 校验：
   - `<html>` 元素上出现主题声明的内联变量（如 `--color-brand`），切换深/浅色模式时取值随之变化；
   - 附加样式生效时 `<head>` 中存在单个 `<style id="zcode-theme-plugin">`，内容被 `@scope (#root) { … }` 包裹。
4. 迭代：主题清单在进入设置页时重新拉取，无文件监听。修改 `theme.json` 或 CSS 后重新进入设置页（或重新选择主题）即可看到结果。
5. 建议从最小主题开始：先只写 `id` / `name` / `tokens` 确认配色生效，再逐项加入 `css`、`suggestedFonts`。

## 9. 故障排查

| 现象                             | 可能原因                                                                 | 处理                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 选择器里没有我的主题             | 插件未安装或未启用；主题目录没有 `theme.json`；`themes` 声明的路径不存在 | 确认插件已启用，`themes/<id>/theme.json` 存在且路径相对插件根                                 |
| 主题置灰并显示「（无效：原因）」 | `theme.json` 未通过 schema 或 token 校验                                 | 按原因修正：常见为字段拼写、token 用了白名单外变量、颜色/圆角取值非法；完整原因在选项悬停提示 |
| 配色生效但附加样式没生效         | CSS 命中黑名单、超过 256 KiB、文件不存在，或 css 是链接/路径越界         | 用最小 CSS 二分定位；重点检查字符串或注释中的 `url(`；确认文件体积与路径                      |
| 改了文件但界面没变化             | 主题清单只在进入设置页时拉取，无热更新                                   | 重新进入设置页，或先切到其他主题再切回                                                        |
| 多个主题只有一个出现             | 主题包之间 `id` 重复                                                     | 同一插件内同 `id` 只保留扫描到的第一个，修改重复 `id`                                         |
| 主题目录未被识别                 | 主题目录、`theme.json` 或 css 是符号链接                                 | 用真实目录与文件替换符号链接                                                                  |

> CSS 被拒不会让主题失效：token 仍然生效（表现为配色正常但附加样式缺失）。拒绝原因随 `plugins/listThemes` 响应的 `cssStatus` / `cssRejectReason` 返回；当前设置页只为无效主题（theme.json 校验失败）显示原因，CSS 拒绝需按上表自查。
