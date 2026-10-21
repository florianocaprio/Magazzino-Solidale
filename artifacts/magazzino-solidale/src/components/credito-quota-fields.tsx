import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { RequiredField } from "./ui/required-field";

/** Campi unici per la quota mensile totale, nella gestione e nella conferma iniziale. */
export function CreditoQuotaFields({
  suggested,
  value,
  reason,
  onValueChange,
  onReasonChange,
  disabled,
  submitted,
  children,
}: {
  suggested: number | null;
  value: string;
  reason: string;
  onValueChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  disabled?: boolean;
  submitted?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const manual =
    value !== "" && suggested != null && Number(value) !== suggested;
  return (
    <div className="rounded-md border bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-medium">
            {t("creditoSolidale.quotaMensileAssegnata")}
          </h5>
          <p className="text-xs text-muted-foreground">
            {t("creditoSolidale.suggeritoDalCalcolo")}: {suggested ?? "—"}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            manual
              ? "bg-amber-500/10 text-amber-700"
              : "bg-emerald-500/10 text-emerald-700"
          }
        >
          {t(
            manual
              ? "creditoSolidale.modificatoManualmente"
              : "creditoSolidale.allineatoAlCalcolo",
          )}
        </Badge>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-quota`} className="text-sm font-medium">
          {t("creditoSolidale.quotaMensileAssegnata")}
        </label>
        <Input
          id={`${id}-quota`}
          type="number"
          min="0"
          max="99999999"
          step="1"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      {manual ? (
        <RequiredField
          label={t("creditoSolidale.motivoModificaQuota")}
          missing={Boolean(submitted && !reason.trim())}
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={disabled}
            maxLength={10000}
          />
        </RequiredField>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-motivo`} className="text-sm font-medium">
            {t("creditoSolidale.motivoModificaQuota")}
          </label>
          <Textarea
            id={`${id}-motivo`}
            rows={2}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={disabled}
            maxLength={10000}
          />
        </div>
      )}
      {children}
    </div>
  );
}
