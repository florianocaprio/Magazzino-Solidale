import type {
  GetMaterialeDaPrepararePeriodo,
  MaterialeDaPreparare,
  MaterialeDaPreparareDettaglio,
} from "@workspace/api-client-react";
import { Check, ChevronDown, PackageOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InterventoAvvisoBadge } from "@/components/intervento-avviso";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  data?: MaterialeDaPreparare;
  periodo: GetMaterialeDaPrepararePeriodo;
  da: string;
  a: string;
  isLoading?: boolean;
  isError?: boolean;
  pendingMaterialId?: number | null;
  onPeriodoChange: (value: GetMaterialeDaPrepararePeriodo) => void;
  onDaChange: (value: string) => void;
  onAChange: (value: string) => void;
  onOpenIntervento: (id: number) => void;
  onChangeState: (
    detail: MaterialeDaPreparareDettaglio,
    state: "da_preparare" | "pronto",
  ) => void;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function quantity(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(
    value,
  );
}

export function MaterialeDaPreparareView({
  data,
  periodo,
  da,
  a,
  isLoading = false,
  isError = false,
  pendingMaterialId = null,
  onPeriodoChange,
  onDaChange,
  onAChange,
  onOpenIntervento,
  onChangeState,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" data-testid="materiale-da-preparare">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            {t("interventi.preparation.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Select value={periodo} onValueChange={onPeriodoChange}>
            <SelectTrigger aria-label={t("interventi.preparation.range")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["oggi", "3", "7", "14", "personalizzato"] as const).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {t(`interventi.preparation.periods.${value}`)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          {periodo === "personalizzato" && (
            <>
              <Input
                type="date"
                value={da}
                onChange={(event) => onDaChange(event.target.value)}
                aria-label={t("interventi.filters.from")}
              />
              <Input
                type="date"
                value={a}
                onChange={(event) => onAChange(event.target.value)}
                aria-label={t("interventi.filters.to")}
              />
            </>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isError ? (
        <p className="rounded-lg border border-destructive p-4 text-destructive">
          {t("interventi.preparation.error")}
        </p>
      ) : !data || data.gruppi.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-muted-foreground">
          {t("interventi.preparation.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("interventi.preparation.interval", { da: data.da, a: data.a })}
          </p>
          {data.gruppi.map((group) => (
            <details
              key={group.chiave}
              className="group rounded-lg border bg-card"
            >
              <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{group.descrizione}</span>
                    <Badge variant="secondary">{group.unitaMisura}</Badge>
                    <InterventoAvvisoBadge avviso={group.avviso} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {group.magazzinoNome ||
                      t("interventi.preparation.noWarehouse")}
                    {` · ${t("interventi.preparation.firstDeadline")}: ${dateLabel(group.primaScadenza)}`}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span>
                    <strong>{quantity(group.quantitaTotale)}</strong>{" "}
                    {t("interventi.preparation.total")}
                  </span>
                  <span className="text-emerald-700">
                    {quantity(group.quantitaPronta)}{" "}
                    {t("interventi.preparation.ready")}
                  </span>
                  <span className="text-amber-700">
                    {quantity(group.quantitaDaPreparare)}{" "}
                    {t("interventi.preparation.toPrepare")}
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="space-y-3 border-t p-4">
                {group.interventi.map((detail) => (
                  <div
                    key={detail.materialeId}
                    className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="font-medium underline-offset-4 hover:underline"
                          onClick={() => onOpenIntervento(detail.interventoId)}
                        >
                          {detail.beneficiarioNome}
                        </button>
                        <span className="text-xs text-muted-foreground">
                          {detail.beneficiarioCodice}
                        </span>
                        <InterventoAvvisoBadge avviso={detail.avviso} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {dateLabel(detail.dataOraPianificata)} ·{" "}
                        {detail.sede || "–"} · {detail.operatoreNome || "–"}
                      </p>
                      <p className="mt-1 text-sm">
                        {quantity(detail.quantitaResidua)} {group.unitaMisura}
                        {detail.note ? ` · ${detail.note}` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        detail.statoPreparazione === "pronto"
                          ? "outline"
                          : "default"
                      }
                      disabled={pendingMaterialId === detail.materialeId}
                      onClick={() =>
                        onChangeState(
                          detail,
                          detail.statoPreparazione === "pronto"
                            ? "da_preparare"
                            : "pronto",
                        )
                      }
                    >
                      <Check className="mr-2 h-4 w-4" />
                      {detail.statoPreparazione === "pronto"
                        ? t("interventi.preparation.markToPrepare")
                        : t("interventi.preparation.markReady")}
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
