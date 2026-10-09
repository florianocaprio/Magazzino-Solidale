import type { BeneficiarioAccessoEmporioSearchResult } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function EmporioBeneficiaryResults({
  results,
  selectedId,
  searching,
  requested,
  error,
  onSelect,
  canConfigureCredit,
}: {
  results: BeneficiarioAccessoEmporioSearchResult[];
  selectedId: string;
  searching: boolean;
  requested: boolean;
  error: boolean;
  onSelect: (id: number) => void;
  canConfigureCredit: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("accessiEmporio.risultatiBeneficiari")}
      className="space-y-2 max-h-64 overflow-y-auto"
    >
      <p role="status" className="text-sm text-muted-foreground">
        {t(
          !requested
            ? "accessiEmporio.iniziaRicerca"
            : searching
              ? "common.loading"
              : error
                ? "accessiEmporio.erroreRicerca"
                : !results.length
                  ? "accessiEmporio.nessunBeneficiario"
                  : "accessiEmporio.selezionaRisultato",
        )}
      </p>
      {requested &&
        !searching &&
        !error &&
        results.map((b) => (
          <div
            key={b.beneficiarioId}
            className="rounded-md border p-2 space-y-1"
          >
            <Button
              type="button"
              variant={
                selectedId === String(b.beneficiarioId)
                  ? "secondary"
                  : "outline"
              }
              className="h-auto w-full justify-start whitespace-normal text-left break-words"
              aria-pressed={selectedId === String(b.beneficiarioId)}
              disabled={b.pianificabile === false}
              onClick={() => onSelect(b.beneficiarioId)}
            >
              {b.beneficiarioNome} · {b.beneficiarioCodice}
              {b.centroAscoltoNome ? ` · ${b.centroAscoltoNome}` : ""}
            </Button>
            {b.pianificabile === false && (
              <div className="text-sm text-destructive">
                <p>{t("accessiEmporio.nonPianificabile")}</p>
                <ul>
                  {b.motiviNonPianificabile?.map((reason) => (
                    <li key={reason}>{t(`accessiEmporio.motivi.${reason}`)}</li>
                  ))}
                </ul>
                {canConfigureCredit &&
                  b.motiviNonPianificabile?.some((reason) =>
                    reason.startsWith("credito_"),
                  ) && (
                    <Link
                      className="underline"
                      href={`/beneficiari/${b.beneficiarioId}`}
                    >
                      {t("accessiEmporio.configuraCredito")}
                    </Link>
                  )}
              </div>
            )}
          </div>
        ))}
    </section>
  );
}
