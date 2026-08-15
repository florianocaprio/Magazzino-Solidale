import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ReportEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
      <BarChart3 className="h-8 w-8" aria-hidden="true" />
      <p className="font-medium">{t("reporting.empty.title")}</p>
      <p className="text-sm">{t("reporting.empty.description")}</p>
    </div>
  );
}

