import { z } from "zod";

/** 主题 id：小写字母/数字开头，允许 . _ -，总长 ≤ 64（spec §3.2）。 */
export const PLUGIN_THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** token 白名单：仅 --color-* / --radius-*；字号与字体族归用户设置管辖（spec §3.3）。 */
const THEME_TOKEN_ALLOWED_PATTERN = /^--(?:color|radius)-[a-z0-9][a-z0-9-]*$/;
const RESERVED_THEME_TOKEN_KEYS = new Set(["--ui-font-size", "--font-sans", "--font-mono"]);

const THEME_HEX_COLOR_PATTERN = /^#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const THEME_FUNCTIONAL_COLOR_PATTERN =
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^\n()]*\)$/i;
const THEME_COLOR_KEYWORDS = new Set(["transparent", "currentcolor", "inherit", "initial"]);
const THEME_GEOMETRY_PATTERN = /^-?(?:\d+|\d*\.\d+)(?:px|rem)$/;
const MAX_THEME_TOKEN_VALUE_LENGTH = 128;

export function isValidThemeColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_THEME_TOKEN_VALUE_LENGTH) {
    return false;
  }
  if (THEME_HEX_COLOR_PATTERN.test(trimmed)) return true;
  if (THEME_FUNCTIONAL_COLOR_PATTERN.test(trimmed)) return true;
  return THEME_COLOR_KEYWORDS.has(trimmed.toLowerCase());
}

export function isValidThemeGeometryValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= MAX_THEME_TOKEN_VALUE_LENGTH && THEME_GEOMETRY_PATTERN.test(trimmed);
}

/** 单条 token 校验；返回 null 表示合法。 */
export function findThemeTokenProblem(key: string, value: string): string | null {
  if (RESERVED_THEME_TOKEN_KEYS.has(key)) {
    return `theme token "${key}" is reserved for user settings and cannot be overridden`;
  }
  if (!THEME_TOKEN_ALLOWED_PATTERN.test(key)) {
    return `theme token "${key}" is outside the --color-* / --radius-* whitelist`;
  }
  if (key.startsWith("--color-") && !isValidThemeColorValue(value)) {
    return `theme token "${key}" has an unsupported color value: ${value}`;
  }
  if (key.startsWith("--radius-") && !isValidThemeGeometryValue(value)) {
    return `theme token "${key}" must use px or rem units: ${value}`;
  }
  return null;
}

export function findThemeTokenProblems(tokens: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    const problem = findThemeTokenProblem(key, value);
    if (problem) {
      problems.push(problem);
    }
  }
  return problems;
}

export const pluginThemeFontSuggestionSchema = z
  .object({
    ui: z.string().trim().min(1).max(128),
    code: z.string().trim().min(1).max(128),
  })
  .strict();

export const pluginThemeFileSchema = z
  .object({
    id: z.string().regex(PLUGIN_THEME_ID_PATTERN),
    name: z.string().trim().min(1).max(64),
    tokens: z
      .object({
        light: z.record(z.string(), z.string()).optional(),
        dark: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    suggestedFonts: pluginThemeFontSuggestionSchema.optional(),
    css: z.string().min(1).max(256).optional(),
  })
  .strict();

export type PluginThemeFile = z.infer<typeof pluginThemeFileSchema>;
export type PluginThemeFontSuggestion = z.infer<typeof pluginThemeFontSuggestionSchema>;

export interface PluginThemeFileParsed {
  id: string;
  name: string;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  suggestedFonts?: PluginThemeFontSuggestion;
  cssFile?: string;
}

/** schema + 语义校验的合并入口；失败时返回首因（含字段路径），供选择器置灰展示。 */
export function parsePluginThemeFile(
  raw: unknown,
): { ok: true; theme: PluginThemeFileParsed } | { ok: false; reason: string } {
  const parsed = pluginThemeFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const prefix = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, reason: `${prefix}${issue?.message ?? "invalid theme.json"}` };
  }
  const data = parsed.data;
  const tokensLight = data.tokens.light ?? {};
  const tokensDark = data.tokens.dark ?? {};
  const problems = [...findThemeTokenProblems(tokensLight), ...findThemeTokenProblems(tokensDark)];
  if (problems.length > 0) {
    return { ok: false, reason: problems.join("; ") };
  }
  return {
    ok: true,
    theme: {
      id: data.id,
      name: data.name,
      tokensLight,
      tokensDark,
      suggestedFonts: data.suggestedFonts,
      cssFile: data.css,
    },
  };
}

/** 受限附加 CSS 黑名单（spec §3.4）：命中任一即整包拒绝；256 KiB 上限。 */
const THEME_CSS_BLOCKED_PATTERN =
  /@import\b|@charset\b|\burl\s*\(|\bimage-set\s*\(|javascript\s*:/i;
const MAX_THEME_CSS_LENGTH = 256 * 1024;

export interface ThemeCssSafetyResult {
  ok: boolean;
  reason?: string;
}

export function scanThemeCssSafety(cssText: string): ThemeCssSafetyResult {
  // 上限按 UTF-8 字节计量，与 spec §3.4「256 KiB」及 reason 文案一致
  if (Buffer.byteLength(cssText, "utf8") > MAX_THEME_CSS_LENGTH) {
    return { ok: false, reason: `theme css exceeds ${MAX_THEME_CSS_LENGTH} bytes` };
  }
  const blocked = THEME_CSS_BLOCKED_PATTERN.exec(cssText);
  if (!blocked) {
    return { ok: true };
  }
  return { ok: false, reason: `theme css contains blocked construct: ${blocked[0].trim()}` };
}

/** 单个主题包（目录）解析后的运行时形态；解析失败 valid=false 并携带原因。 */
export interface PluginThemePackage {
  themeId: string;
  name: string;
  valid: boolean;
  invalidReason?: string;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  suggestedFonts?: PluginThemeFontSuggestion;
  cssText?: string;
  cssStatus: "ok" | "missing" | "rejected";
  cssRejectReason?: string;
}
