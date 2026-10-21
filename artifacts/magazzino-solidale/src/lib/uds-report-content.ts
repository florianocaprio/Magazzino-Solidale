import type { UdsInterventoGiornaliero } from "@workspace/api-client-react";

export function udsReportSections(
  row: UdsInterventoGiornaliero,
  t: (key: string) => string,
) {
  return [
    {
      label: t("udsInterventi.colBisogni"),
      text: row.descrizione || t("udsReportGiornaliero.notRecorded"),
    },
    {
      label: t("udsInterventi.colMateriale"),
      text: row.note || t("udsReportGiornaliero.notRecorded"),
    },
    {
      label: t("udsReportGiornaliero.operationalNotes"),
      text: row.noteUds || t("udsReportGiornaliero.notRecorded"),
    },
    {
      label: t("udsReportGiornaliero.linkedNeeds"),
      text:
        row.bisogniPianificati
          .map((b) =>
            [
              `${t(`udsInterventi.bisognoTipo.${b.tipo}`)}: ${b.descrizione}`,
              t(`udsInterventi.bisognoStato.${b.stato}`),
              t(`udsInterventi.bisognoPriorita.${b.priorita}`),
              b.dataPrevista
                ? `${t("udsReportGiornaliero.plannedDate")}: ${b.dataPrevista}`
                : null,
              b.note,
              b.dataCompletamento
                ? `${t("udsReportGiornaliero.completedDate")}: ${new Date(b.dataCompletamento).toLocaleString()}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          )
          .join("\n\n") || t("udsInterventi.noBisogniPianificati"),
    },
  ];
}
