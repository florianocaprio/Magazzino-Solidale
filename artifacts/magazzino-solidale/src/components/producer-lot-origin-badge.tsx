import i18n from "@/lib/i18n";
import { registerBlocco07 } from "@/lib/i18n/namespaces/blocco07";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
registerBlocco07(i18n);
export function ProducerLotOriginBadge({ origin }: { origin?: string | null }) {
  const { t } = useTranslation();
  const key =
    origin === "MANUALE"
      ? "manual"
      : origin === "AUTOMATICO"
        ? "automatic"
        : origin === "IMPORTATO"
          ? "imported"
          : "historical";
  const color =
    origin === "MANUALE"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
      : origin === "IMPORTATO"
        ? "border-teal-200 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-200"
        : "border-slate-200 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return (
    <Badge variant="outline" className={color}>
      {t(`blocco07.${key}`)}
    </Badge>
  );
}
