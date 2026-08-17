import type { ReportQualityItem } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { localizeReportingText } from "@/lib/reporting-text";

export function ReportDataQuality({ items }: { items: ReportQualityItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="report-data-quality-title">
      <h2 id="report-data-quality-title" className="text-xl font-semibold">
        {t("reporting.quality.title")}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => {
          const Icon = item.availability === "missing" ? AlertTriangle : item.availability === "ok" ? CheckCircle2 : Info;
          return (
            <Alert key={item.key} variant={item.availability === "missing" ? "destructive" : "default"}>
              <Icon className="h-4 w-4" />
              <AlertTitle>{t(`reporting.quality.${item.key}`)}</AlertTitle>
              <AlertDescription>
                {item.count != null && <span className="font-medium">{item.count}. </span>}
                {item.note ? localizeReportingText(t, item.note) : t(`reporting.availability.${item.availability}`)}
              </AlertDescription>
            </Alert>
          );
        })}
      </div>
    </section>
  );
}
