import type {
  BisognoPianificato,
  Intervento,
  InterventoStoricoStato,
} from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  InterventoStatoBadge,
  interventoDataLabel,
} from "@/components/intervento-workflow";

interface Props {
  open: boolean;
  intervento?: Intervento;
  storico?: InterventoStoricoStato[];
  bisogni?: BisognoPianificato[];
  isLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

function timestampLabel(value: string | null | undefined): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap text-sm">{value || "–"}</dd>
    </div>
  );
}

export function InterventoSocialeDetailSheet({
  open,
  intervento,
  storico = [],
  bisogni = [],
  isLoading = false,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("interventi.detail.title")}</SheetTitle>
          <SheetDescription>{t("interventi.detail.readOnly")}</SheetDescription>
        </SheetHeader>
        {isLoading || !intervento ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <dl className="divide-y">
              <DetailRow
                label={t("interventi.beneficiario")}
                value={
                  <>
                    <span className="font-semibold">
                      {intervento.beneficiarioNome}
                    </span>
                    {intervento.beneficiarioCodice && (
                      <span className="ml-2 text-muted-foreground">
                        {intervento.beneficiarioCodice}
                      </span>
                    )}
                  </>
                }
              />
              <DetailRow
                label={t("interventi.detail.family")}
                value={intervento.nucleoFamiliareSintesi}
              />
              <DetailRow
                label={t("interventi.detail.state")}
                value={<InterventoStatoBadge stato={intervento.stato} />}
              />
              <DetailRow
                label={t("interventi.detail.scope")}
                value={
                  intervento.ambitoLegacy ? (
                    <Badge variant="outline">
                      {t("interventi.legacy.label")}
                    </Badge>
                  ) : (
                    t("interventi.scopeSociale")
                  )
                }
              />
              <DetailRow
                label={t("interventi.detail.priority")}
                value={t(`interventi.priorita.${intervento.priorita}`)}
              />
              <DetailRow
                label={t("interventi.detail.plannedAt")}
                value={timestampLabel(intervento.dataOraPianificata)}
              />
              <DetailRow
                label={t("interventi.detail.startedAt")}
                value={timestampLabel(intervento.dataOraAvvio)}
              />
              <DetailRow
                label={t("interventi.detail.concludedAt")}
                value={
                  intervento.dataOraConclusione
                    ? timestampLabel(intervento.dataOraConclusione)
                    : intervento.dataIntervento
                      ? interventoDataLabel(intervento)
                      : "–"
                }
              />
              <DetailRow
                label={t("interventi.detail.site")}
                value={intervento.sede}
              />
              <DetailRow
                label={t("interventi.detail.center")}
                value={intervento.centroAscoltoNome}
              />
              <DetailRow
                label={t("interventi.operatore")}
                value={intervento.operatoreNome ?? intervento.operatoreCodice}
              />
              <DetailRow
                label={t("interventi.tipoIntervento")}
                value={intervento.tipoIntervento}
              />
              <DetailRow
                label={t("common.description")}
                value={intervento.descrizione}
              />
              <DetailRow
                label={t("interventi.esito")}
                value={intervento.esito}
              />
              <DetailRow label={t("interventi.note")} value={intervento.note} />
              <DetailRow
                label={t("interventi.detail.previous")}
                value={intervento.interventoPrecedenteId?.toString()}
              />
              <DetailRow
                label={t("interventi.detail.following")}
                value={
                  intervento.successoriIds.length > 0
                    ? intervento.successoriIds.join(", ")
                    : undefined
                }
              />
            </dl>

            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("interventi.detail.history")}
              </h3>
              {storico.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("interventi.detail.noHistory")}
                </p>
              ) : (
                <ol className="space-y-3 border-l pl-4">
                  {storico.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <InterventoStatoBadge stato={entry.statoNuovo} />
                      <span className="ml-2 text-muted-foreground">
                        {timestampLabel(entry.dataTransizione)}
                      </span>
                      {entry.motivo && <p className="mt-1">{entry.motivo}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <Separator />
            <section className="space-y-3">
              <h3 className="font-semibold">{t("interventi.detail.needs")}</h3>
              {bisogni.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("interventi.detail.noNeeds")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {bisogni.map((bisogno) => (
                    <li
                      key={bisogno.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{bisogno.tipo}</Badge>
                        <Badge variant="outline">{bisogno.stato}</Badge>
                      </div>
                      <p className="mt-2">{bisogno.descrizione}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
