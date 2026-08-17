import type { ReportKpi } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ReportKpiCard({
  item,
  onOpen,
}: {
  item: ReportKpi;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const unavailable = item.value == null;
  const formatted = item.value == null
    ? t("reporting.unavailable")
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: item.unit === "average" || item.unit === "credit" ? 2 : 1,
      }).format(item.value);
  return (
    <Card className={unavailable ? "border-dashed" : undefined}>
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t(`reporting.kpi.${item.key}`)}
          </CardTitle>
          {item.availability !== "ok" && (
            <Badge variant={item.availability === "missing" ? "destructive" : "secondary"}>
              {t(`reporting.availability.${item.availability}`)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">{formatted}</div>
            {!unavailable && item.unit !== "count" && (
              <div className="text-xs text-muted-foreground">
                {t(`reporting.units.${item.unit}`)}
              </div>
            )}
          </div>
          {onOpen && item.drilldownMetric && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpen}
              aria-label={t("reporting.drilldown.open")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
