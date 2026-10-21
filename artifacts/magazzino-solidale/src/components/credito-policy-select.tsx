import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function CreditoPolicySelect({
  value,
  onValueChange,
  options,
  disabled,
  automaticLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ id: number; nome: string; scope: string }>;
  disabled?: boolean;
  automaticLabel?: string;
}) {
  const id = useId(),
    { t } = useTranslation();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("creditoSolidale.chooseBeneficiaryPolicy")}
      </label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="min-w-0 [&>span]:min-w-0">
          <SelectValue
            placeholder={t("creditoSolidale.selectBeneficiaryPolicy")}
          />
        </SelectTrigger>
        <SelectContent className="max-h-[min(18rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)]">
          {automaticLabel && (
            <SelectItem value="auto">{automaticLabel}</SelectItem>
          )}
          {options.map((p) => (
            <SelectItem
              key={p.id}
              value={String(p.id)}
              className="whitespace-normal break-words"
            >
              {p.nome} · {p.scope}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
