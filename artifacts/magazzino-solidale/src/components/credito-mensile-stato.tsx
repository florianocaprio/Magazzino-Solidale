import {
  useGetCreditoSolidaleRicaricaMensileStato,
  getGetCreditoSolidaleRicaricaMensileStatoQueryKey,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import {
  emporioReadableData,
  useEmporioSecurity,
} from "@/hooks/use-emporio-security";
export function CreditoMensileStato() {
  const { t } = useTranslation();
  const security = useEmporioSecurity();
  const query = useGetCreditoSolidaleRicaricaMensileStato({
    query: security.readOptions(
      getGetCreditoSolidaleRicaricaMensileStatoQueryKey(),
    ),
  });
  const data = emporioReadableData(query);
  return (
    <section
      aria-label={t("creditoSolidale.ricaricaAutomatica")}
      className="rounded-md border bg-muted/30 p-4 text-sm space-y-1"
    >
      <h2 className="font-semibold">
        {t("creditoSolidale.ricaricaAutomatica")}
      </h2>
      <p>{t("creditoSolidale.ricaricaCalendario")}</p>
      {data && (
        <p>
          {data.periodo}: {t(`creditoSolidale.job.${data.stato}`)}
          {data.completataAt
            ? ` — ${new Date(data.completataAt).toLocaleString("it-IT")}`
            : ""}
        </p>
      )}
      {data?.esiti.map((item, i) => (
        <p key={i}>
          {t(`creditoSolidale.job.${item.stato}`)}: {item.numero}
          {item.causa ? ` (${t(`creditoSolidale.cause.${item.causa}`)})` : ""}
        </p>
      ))}
      <p>{t("creditoSolidale.recuperoCorrente")}</p>
      {query.isError && (
        <p role="alert">{t("creditoSolidale.statoNonDisponibile")}</p>
      )}
    </section>
  );
}
