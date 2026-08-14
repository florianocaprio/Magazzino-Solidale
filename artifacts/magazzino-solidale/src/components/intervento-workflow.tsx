import type { Intervento, InterventoAmbito } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

const STATO_CLASSI: Record<string, string> = {
  da_pianificare: "bg-slate-100 text-slate-700 border-slate-200",
  pianificato: "bg-blue-50 text-blue-700 border-blue-200",
  in_corso: "bg-amber-50 text-amber-800 border-amber-200",
  concluso: "bg-green-50 text-green-700 border-green-200",
  annullato: "bg-red-50 text-red-700 border-red-200",
  mancata_presentazione: "bg-orange-50 text-orange-800 border-orange-200",
};

export function withInterventoAmbito<T extends object>(
  data: T,
  ambito: InterventoAmbito,
): T & { ambito: InterventoAmbito } {
  return { ...data, ambito };
}

export function interventoDataLabel(
  intervento: Pick<Intervento, "dataIntervento" | "dataOraPianificata">,
): string {
  if (intervento.dataIntervento) {
    const [year, month, day] = intervento.dataIntervento.split("-");
    if (year && month && day) return `${day}/${month}/${year}`;
  }
  if (intervento.dataOraPianificata) {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(intervento.dataOraPianificata));
  }
  return "-";
}

export function InterventoStatoBadge({ stato }: { stato: string }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={STATO_CLASSI[stato] ?? STATO_CLASSI.da_pianificare}
    >
      {t(`interventi.workflowStati.${stato}`, {
        defaultValue: stato.replaceAll("_", " "),
      })}
    </Badge>
  );
}
