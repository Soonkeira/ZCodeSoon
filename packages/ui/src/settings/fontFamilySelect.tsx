import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const UI_FONT_OPTIONS = [
  "system-ui",
  "Segoe UI",
  "PingFang SC",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Inter",
  "Roboto",
  "Arial",
];
const CODE_FONT_OPTIONS = [
  "Consolas",
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Courier New",
  "Sarasa Mono SC",
];
// Radix Select 的 SelectItem 不允许空字符串 value（会抛错），空值用哨兵值映射。
const DEFAULT_FONT_SENTINEL = "__default__";
const CUSTOM_FONT_SENTINEL = "__custom__";

export function FontFamilySelect({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (family: string) => void;
  kind: "ui" | "code";
}) {
  const { intl } = useZCodeIntl();
  const options = kind === "ui" ? UI_FONT_OPTIONS : CODE_FONT_OPTIONS;
  const [isCustom, setIsCustom] = useState(() => value.length > 0 && !options.includes(value));

  // 「一键应用」等外部写入可能把值改成列表外字体；同步回自定义态，避免触发器显示为空。
  useEffect(() => {
    if (value.length === 0) return;
    const presetOptions = kind === "ui" ? UI_FONT_OPTIONS : CODE_FONT_OPTIONS;
    setIsCustom(!presetOptions.includes(value));
  }, [kind, value]);

  return (
    <div className="flex w-[260px] min-w-0 flex-col gap-1">
      <Select
        value={isCustom ? CUSTOM_FONT_SENTINEL : value || DEFAULT_FONT_SENTINEL}
        onValueChange={(next) => {
          if (next === CUSTOM_FONT_SENTINEL) {
            setIsCustom(true);
            return;
          }
          setIsCustom(false);
          onChange(next === DEFAULT_FONT_SENTINEL ? "" : next);
        }}
      >
        <SelectTrigger size="lg" className="w-full min-w-0 justify-between">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_FONT_SENTINEL}>
            {intl.formatMessage({ id: "settings.fontFamily.default" })}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_FONT_SENTINEL}>
            {intl.formatMessage({ id: "settings.fontFamily.custom" })}
          </SelectItem>
        </SelectContent>
      </Select>
      {isCustom ? (
        <Input
          value={value}
          placeholder={intl.formatMessage({ id: "settings.fontFamily.customPlaceholder" })}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}
