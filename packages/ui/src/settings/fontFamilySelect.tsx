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
const FONT_OPTIONS_BY_KIND: Record<"ui" | "code", string[]> = {
  ui: UI_FONT_OPTIONS,
  code: CODE_FONT_OPTIONS,
};

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
  const options = FONT_OPTIONS_BY_KIND[kind];
  const [isCustom, setIsCustom] = useState(() => value.length > 0 && !options.includes(value));

  // 外部写入（跨窗口广播、一键应用后清空）也要确定性同步自定义态：
  // 值非空且不在预设列表 → 展开输入框；值回到空或预设 → 收起（输入框内清空即「默认字体」语义）。
  useEffect(() => {
    setIsCustom(value.length > 0 && !options.includes(value));
  }, [options, value]);

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
