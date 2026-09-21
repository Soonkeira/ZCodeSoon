import type { ZCodeThemePackage } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { themeEntryKey } from "@/lib/themePlugin.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

// Radix Select 的 SelectItem 不允许空字符串 value（会抛错），「不使用」用哨兵值映射为 null。
const NONE_THEME_SENTINEL = "__none__";

/** 主题包选择行与半覆盖/建议字体提示，放在外观设置「界面设置」卡内。 */
export function ThemePluginSelect({
  themePlugins,
  value,
  onChange,
  setUiFontFamily,
  setCodeFontFamily,
}: {
  themePlugins: ZCodeThemePackage[];
  value: string | null;
  onChange: (key: string | null) => void;
  setUiFontFamily: (family: string) => void;
  setCodeFontFamily: (family: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const activeThemeEntry = themePlugins.find((candidate) => themeEntryKey(candidate) === value);
  // spec §4.3：只声明一组 token 的主题在缺失模式沿用内置配色，这里标注被覆盖的模式。
  const partialMode =
    activeThemeEntry?.valid === true
      ? Object.keys(activeThemeEntry.tokensLight).length === 0
        ? "light"
        : Object.keys(activeThemeEntry.tokensDark).length === 0
          ? "dark"
          : null
      : null;
  const suggestedFonts = activeThemeEntry?.valid ? activeThemeEntry.suggestedFonts : undefined;

  return (
    <>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.themePlugin" })}
        description={intl.formatMessage({
          id: "settings.themePluginDescription",
        })}
        control={
          <Select
            value={value ?? NONE_THEME_SENTINEL}
            onValueChange={(next) => onChange(next === NONE_THEME_SENTINEL ? null : next)}
          >
            <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_THEME_SENTINEL}>
                {intl.formatMessage({ id: "settings.themePlugin.none" })}
              </SelectItem>
              {themePlugins.map((entry) => (
                <SelectItem
                  key={themeEntryKey(entry)}
                  value={themeEntryKey(entry)}
                  disabled={!entry.valid}
                >
                  {entry.valid
                    ? intl.formatMessage(
                        { id: "settings.themePlugin.entry" },
                        { name: entry.name, plugin: entry.pluginName },
                      )
                    : intl.formatMessage(
                        { id: "settings.themePlugin.invalid" },
                        { name: entry.name, reason: entry.invalidReason ?? "" },
                      )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {partialMode ? (
        <div className="px-4 pb-2 text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.themePlugin.partialMode" },
            {
              mode:
                partialMode === "dark"
                  ? intl.formatMessage({ id: "settings.themeMode.dark" })
                  : intl.formatMessage({ id: "settings.themeMode.light" }),
            },
          )}
        </div>
      ) : null}
      {suggestedFonts ? (
        <div className="flex items-center gap-2 px-4 pb-3">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage(
              { id: "settings.themePlugin.suggestedFonts" },
              {
                fonts: [suggestedFonts.ui, suggestedFonts.code].filter(Boolean).join(" / "),
              },
            )}
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              if (suggestedFonts.ui) setUiFontFamily(suggestedFonts.ui);
              if (suggestedFonts.code) setCodeFontFamily(suggestedFonts.code);
            }}
          >
            {intl.formatMessage({ id: "settings.themePlugin.applySuggested" })}
          </Button>
        </div>
      ) : null}
    </>
  );
}
