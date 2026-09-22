/* oxlint-disable eslint(max-lines) -- 外观设置卡集中界面/代码两组行与皮肤行控件；按 SettingsPage/App 先例豁免行数，避免为行数把外观区块拆散。 */
import type { ZCodeThemePackage } from "@zcode/shared";
import type { Theme } from "@/useTheme.js";
import { useRef, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { resolveTheme } from "@/useTheme.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import {
  getThemeOptionLabel,
  SettingsRow,
  ThemePreviewCard,
  ThemeSelect,
} from "@/settings/SettingsPageParts.js";
import { getCodePreviewTheme } from "@/lib/codePreviewPreferences.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CodePreviewSettings } from "@/store/index.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { THEME_MODES } from "@/settings/settingsPageConfig.js";
import { FontFamilySelect } from "@/settings/fontFamilySelect.js";
import { ThemePluginSelect } from "@/settings/themePluginSelect.js";
import { MAX_UI_FONT_SIZE_PX, MIN_UI_FONT_SIZE_PX } from "@/lib/uiFontSize.js";
import {
  getPaletteBase,
  getPalettePrimary,
  PALETTE_BASE_COLORS,
  PALETTE_PRIMARY_COLORS,
  type PaletteColor,
} from "@/lib/palette.js";
import {
  compressSkinImage,
  customSkinErrorCode,
  CUSTOM_SKIN_MAX_BLUR_PX,
} from "@/lib/customSkin.js";

/** 结构化错误码 → i18n key（spec §6）；未知错误按无法读取图片提示。 */
function skinErrorTextId(code: string | null): string {
  if (code === "SKIN_IMAGE_TOO_LARGE") {
    return "settings.customSkin.errorTooLarge";
  }
  if (code === "SKIN_PERSIST_FAILED") {
    return "settings.customSkin.errorStorage";
  }
  return "settings.customSkin.errorNotImage";
}

function FontSizeInput({
  value,
  min,
  max,
  ariaLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const parsed = draft.trim() === "" ? Number.NaN : Number(draft);
    const nextValue = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.round(parsed)))
      : value;
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  return (
    <div className="relative w-28">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(value));
          }
        }}
        className="pr-8 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ui-lg text-foreground-subtle">
        px
      </span>
    </div>
  );
}

/** 调色盘胶囊 chip：选中态 border-foreground 强调 + 色点取色表明式 hex（spec §5）。 */
function PaletteChip({
  selected,
  disabled,
  dotColor,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  dotColor?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-ui-sm",
        selected
          ? "border-foreground font-medium text-foreground"
          : "border-border text-foreground-subtle",
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface",
      )}
    >
      {dotColor ? (
        <span className="size-3 rounded-full" style={{ backgroundColor: dotColor }} />
      ) : null}
      {children}
    </button>
  );
}

/** 调色盘行：分隔线/内边距对齐 SettingsRow，chips 可换行铺开（spec §5 原位替换主题行）。 */
function PaletteRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="text-ui-base font-medium text-foreground">{label}</div>
      {description ? (
        <div className="mt-1 text-ui-sm leading-6 text-foreground-subtle">{description}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** 明暗选择的展示名 key：夜间 / 日间 / 系统（spec §5 参考图口径）；light/dark 归一化前老值回退既有 themeMode 键。 */
function modeLabelId(mode: Theme): string {
  if (mode === "system") return "settings.palette.modeSystem";
  if (mode === "zai-dark") return "settings.palette.modeNight";
  if (mode === "zai-light") return "settings.palette.modeDay";
  return `settings.themeMode.${mode}`;
}

/**
 * 外观卡「明暗三 chips + 主色 6 chips + 底色 8 chips + 恢复默认」三行
 * （spec §5）。主题包（activeThemePluginKey）生效时整组 disabled 并给出行下提示——
 * activeThemePluginKey 直接 useZCodeStore 读，不新增 props。
 */
function PaletteThemeControls({
  theme,
  setTheme,
  palettePrimaryId,
  paletteBaseId,
  setPalettePrimaryId,
  setPaletteBaseId,
  resetPalette,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  palettePrimaryId: string;
  paletteBaseId: string;
  setPalettePrimaryId: (id: string) => void;
  setPaletteBaseId: (id: string) => void;
  resetPalette: () => void;
}) {
  const { intl } = useZCodeIntl();
  const activeThemePluginKey = useZCodeStore((state) => state.activeThemePluginKey);
  const disabled = Boolean(activeThemePluginKey);
  // 色点跟随当前明暗取对应组的显式 hex（spec §5）。
  const dotMode = resolveTheme(theme);
  const dotOf = (color: PaletteColor, token: string) =>
    (dotMode === "dark" ? color.dark : color.light)[token];

  return (
    <>
      <PaletteRow
        label={intl.formatMessage({ id: "settings.themeMode" })}
        description={intl.formatMessage(
          { id: "settings.palette.summary" },
          {
            primary: intl.formatMessage({
              id: `settings.palette.primary.${getPalettePrimary(palettePrimaryId).id}`,
            }),
            base: intl.formatMessage({
              id: `settings.palette.base.${getPaletteBase(paletteBaseId).id}`,
            }),
            mode: intl.formatMessage({ id: modeLabelId(theme) }),
          },
        )}
      >
        {THEME_MODES.map(({ mode, icon: Icon }) => (
          <PaletteChip
            key={mode}
            selected={theme === mode}
            disabled={disabled}
            onClick={() => setTheme(mode)}
          >
            <Icon className="size-4" />
            {intl.formatMessage({ id: modeLabelId(mode) })}
          </PaletteChip>
        ))}
      </PaletteRow>
      <PaletteRow label={intl.formatMessage({ id: "settings.palette.primary" })}>
        {PALETTE_PRIMARY_COLORS.map((color) => (
          <PaletteChip
            key={color.id}
            selected={palettePrimaryId === color.id}
            disabled={disabled}
            dotColor={dotOf(color, "--color-brand")}
            onClick={() => setPalettePrimaryId(color.id)}
          >
            {intl.formatMessage({ id: `settings.palette.primary.${color.id}` })}
          </PaletteChip>
        ))}
      </PaletteRow>
      <PaletteRow label={intl.formatMessage({ id: "settings.palette.base" })}>
        {PALETTE_BASE_COLORS.map((color) => (
          <PaletteChip
            key={color.id}
            selected={paletteBaseId === color.id}
            disabled={disabled}
            dotColor={dotOf(color, "--color-background")}
            onClick={() => setPaletteBaseId(color.id)}
          >
            {intl.formatMessage({ id: `settings.palette.base.${color.id}` })}
          </PaletteChip>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={disabled}
          onClick={resetPalette}
        >
          <RotateCcw className="mr-2 size-4" />
          {intl.formatMessage({ id: "settings.palette.reset" })}
        </Button>
      </PaletteRow>
      {disabled ? (
        <div className="px-4 pb-3 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.palette.pluginActive" })}
        </div>
      ) : null}
    </>
  );
}

export function AppearanceSectionContent({
  codePreviewSettings,
  setCodePreviewSettings,
  theme,
  setTheme,
  uiFontSizePx,
  setUiFontSizePx,
  themePlugins,
  activeThemePluginKey,
  setActiveThemePluginKey,
  uiFontFamily,
  setUiFontFamily,
  codeFontFamily,
  setCodeFontFamily,
  customSkinImage,
  customSkinBlurPx,
  customSkinError,
  setCustomSkinImage,
  setCustomSkinBlurPx,
  clearCustomSkin,
  palettePrimaryId,
  paletteBaseId,
  setPalettePrimaryId,
  setPaletteBaseId,
  resetPalette,
}: {
  codePreviewSettings: CodePreviewSettings;
  setCodePreviewSettings: (settings: Partial<CodePreviewSettings>) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  uiFontSizePx: number;
  setUiFontSizePx: (fontSizePx: number) => void;
  themePlugins: ZCodeThemePackage[];
  activeThemePluginKey: string | null;
  setActiveThemePluginKey: (key: string | null) => void;
  uiFontFamily: string;
  setUiFontFamily: (family: string) => void;
  codeFontFamily: string;
  setCodeFontFamily: (family: string) => void;
  customSkinImage: string | null;
  customSkinBlurPx: number;
  customSkinError: string | null;
  setCustomSkinImage: (image: string) => void;
  setCustomSkinBlurPx: (blurPx: number) => void;
  clearCustomSkin: () => void;
  palettePrimaryId: string;
  paletteBaseId: string;
  setPalettePrimaryId: (id: string) => void;
  setPaletteBaseId: (id: string) => void;
  resetPalette: () => void;
}) {
  const { intl } = useZCodeIntl();
  const activePreviewMode = resolveTheme(theme);
  const skinInputRef = useRef<HTMLInputElement>(null);

  // 选图：压缩（异步，可能抛 TOO_LARGE/DECODE）→ 提交（可能抛 PERSIST）→ 成功/失败 toast（spec §5/§6）。
  const handleSkinImagePick = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const dataUrl = await compressSkinImage(file);
      setCustomSkinImage(dataUrl);
      toast(intl.formatMessage({ id: "settings.customSkin.applied" }));
    } catch (error) {
      toast(intl.formatMessage({ id: skinErrorTextId(customSkinErrorCode(error)) }), {
        variant: "warning",
      });
    }
  };

  const handleSkinClear = () => {
    try {
      clearCustomSkin();
    } catch (error) {
      toast(intl.formatMessage({ id: skinErrorTextId(customSkinErrorCode(error)) }), {
        variant: "warning",
      });
    }
  };

  return (
    <>
      <div className="min-w-0 space-y-3">
        <div>
          <h3 className="text-ui-lg font-semibold text-foreground">
            {intl.formatMessage({ id: "settings.appearance.interfaceTitle" })}
          </h3>
          <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            {intl.formatMessage({
              id: "settings.appearance.interfaceDescription",
            })}
          </p>
        </div>
        <Card className="border border-border bg-card py-0 shadow-none">
          <CardContent className="space-y-0 px-0">
            {/* 原主题 Select 行已替换为调色盘三行（spec §5）；明暗仍绑定同一 theme/setTheme。 */}
            <PaletteThemeControls
              theme={theme}
              setTheme={setTheme}
              palettePrimaryId={palettePrimaryId}
              paletteBaseId={paletteBaseId}
              setPalettePrimaryId={setPalettePrimaryId}
              setPaletteBaseId={setPaletteBaseId}
              resetPalette={resetPalette}
            />
            <SettingsRow
              label={intl.formatMessage({ id: "settings.uiFontSize" })}
              description={intl.formatMessage({
                id: "settings.uiFontSizeDescription",
              })}
              control={
                <FontSizeInput
                  key={uiFontSizePx}
                  min={MIN_UI_FONT_SIZE_PX}
                  max={MAX_UI_FONT_SIZE_PX}
                  value={uiFontSizePx}
                  onChange={setUiFontSizePx}
                  ariaLabel={intl.formatMessage({ id: "settings.uiFontSize" })}
                />
              }
            />
            <ThemePluginSelect
              themePlugins={themePlugins}
              value={activeThemePluginKey}
              onChange={setActiveThemePluginKey}
              setUiFontFamily={setUiFontFamily}
              setCodeFontFamily={setCodeFontFamily}
            />
            <SettingsRow
              label={intl.formatMessage({ id: "settings.uiFontFamily" })}
              description={intl.formatMessage({
                id: "settings.uiFontFamilyDescription",
              })}
              control={
                <FontFamilySelect kind="ui" value={uiFontFamily} onChange={setUiFontFamily} />
              }
            />
            <SettingsRow
              label={intl.formatMessage({ id: "settings.customSkin" })}
              description={intl.formatMessage({
                id: "settings.customSkinDescription",
              })}
              detail={
                customSkinError ? (
                  <span className="text-ui-sm text-destructive">
                    {intl.formatMessage({ id: skinErrorTextId(customSkinError) })}
                  </span>
                ) : null
              }
              control={
                <div className="flex w-full flex-nowrap items-center justify-end gap-2">
                  <input
                    ref={skinInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      // 清空 value：否则同一张图改完再选不会触发 change。
                      event.currentTarget.value = "";
                      void handleSkinImagePick(file);
                    }}
                  />
                  {customSkinImage ? (
                    <img
                      src={customSkinImage}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => skinInputRef.current?.click()}
                  >
                    {intl.formatMessage({
                      id: customSkinImage
                        ? "settings.customSkinReplace"
                        : "settings.customSkinSelect",
                    })}
                  </Button>
                  {customSkinImage ? (
                    <Button type="button" size="sm" variant="ghost" onClick={handleSkinClear}>
                      {intl.formatMessage({ id: "settings.customSkinClear" })}
                    </Button>
                  ) : null}
                </div>
              }
            />
            <SettingsRow
              label={intl.formatMessage({ id: "settings.customSkinBlur" })}
              description={intl.formatMessage({ id: "settings.customSkinBlurDescription" })}
              control={
                <div className="flex w-full flex-nowrap items-center justify-end gap-2">
                  <input
                    type="range"
                    min={0}
                    max={CUSTOM_SKIN_MAX_BLUR_PX}
                    step={1}
                    value={customSkinBlurPx}
                    disabled={!customSkinImage}
                    aria-label={intl.formatMessage({ id: "settings.customSkinBlur" })}
                    onChange={(event) => setCustomSkinBlurPx(Number(event.target.value))}
                    className="h-7 w-32 accent-primary disabled:opacity-50"
                  />
                  <span className="w-10 shrink-0 text-right text-ui-base tabular-nums text-foreground-subtle">
                    {customSkinBlurPx}px
                  </span>
                </div>
              }
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <div className="min-w-0 space-y-3">
          <div>
            <h3 className="text-ui-lg font-semibold text-foreground">
              {intl.formatMessage({ id: "settings.appearance.codeTitle" })}
            </h3>
            <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
              {intl.formatMessage({
                id: "settings.appearance.codeDescription",
              })}
            </p>
          </div>
          <Card className="border border-border bg-card py-0 shadow-none [&_[data-slot=select-trigger]]:w-full">
            <CardContent className="space-y-0 px-0">
              <SettingsRow
                label={intl.formatMessage({ id: "settings.lightTheme" })}
                description={intl.formatMessage({
                  id: "settings.lightThemeDescription",
                })}
                control={
                  <ThemeSelect
                    value={codePreviewSettings.lightTheme}
                    onValueChange={(value) => setCodePreviewSettings({ lightTheme: value })}
                  />
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.darkTheme" })}
                description={intl.formatMessage({
                  id: "settings.darkThemeDescription",
                })}
                control={
                  <ThemeSelect
                    value={codePreviewSettings.darkTheme}
                    onValueChange={(value) => setCodePreviewSettings({ darkTheme: value })}
                  />
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.showLineNumbers" })}
                description={intl.formatMessage({
                  id: "settings.showLineNumbersDescription",
                })}
                control={
                  <Switch
                    checked={codePreviewSettings.showLineNumbers}
                    onCheckedChange={(checked) =>
                      setCodePreviewSettings({ showLineNumbers: checked })
                    }
                  />
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.wrapLongLines" })}
                description={intl.formatMessage({
                  id: "settings.wrapLongLinesDescription",
                })}
                control={
                  <Switch
                    checked={codePreviewSettings.wrapLongLines}
                    onCheckedChange={(checked) =>
                      setCodePreviewSettings({ wrapLongLines: checked })
                    }
                  />
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.fontSize" })}
                description={intl.formatMessage({
                  id: "settings.fontSizeDescription",
                })}
                control={
                  <FontSizeInput
                    key={codePreviewSettings.fontSizePx}
                    min={12}
                    max={20}
                    value={codePreviewSettings.fontSizePx}
                    onChange={(fontSizePx) => setCodePreviewSettings({ fontSizePx })}
                    ariaLabel={intl.formatMessage({ id: "settings.fontSize" })}
                  />
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.codeFontFamily" })}
                description={intl.formatMessage({
                  id: "settings.codeFontFamilyDescription",
                })}
                control={
                  <FontFamilySelect
                    kind="code"
                    value={codeFontFamily}
                    onChange={setCodeFontFamily}
                  />
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <h3 className="text-ui-base font-semibold text-foreground">
              {intl.formatMessage({ id: "settings.previewSectionTitle" })}
            </h3>
            <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.previewDescription" })}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ThemePreviewCard
              mode="light"
              title={intl.formatMessage({ id: "settings.previewLight" })}
              themeName={getThemeOptionLabel(codePreviewSettings.lightTheme)}
              theme={getCodePreviewTheme("light", codePreviewSettings)}
              isActive={activePreviewMode === "light"}
              showLineNumbers={codePreviewSettings.showLineNumbers}
              wrapLongLines={codePreviewSettings.wrapLongLines}
              fontSizePx={codePreviewSettings.fontSizePx}
            />
            <ThemePreviewCard
              mode="dark"
              title={intl.formatMessage({ id: "settings.previewDark" })}
              themeName={getThemeOptionLabel(codePreviewSettings.darkTheme)}
              theme={getCodePreviewTheme("dark", codePreviewSettings)}
              isActive={activePreviewMode === "dark"}
              showLineNumbers={codePreviewSettings.showLineNumbers}
              wrapLongLines={codePreviewSettings.wrapLongLines}
              fontSizePx={codePreviewSettings.fontSizePx}
            />
          </div>
        </div>
      </div>
    </>
  );
}
