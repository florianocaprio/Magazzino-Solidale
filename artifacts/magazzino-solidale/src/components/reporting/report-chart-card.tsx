import type { ReportSeries } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportEmptyState } from "./report-empty-state";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";

export function ReportChartCard({ series }: { series: ReportSeries }) {
  const { t } = useTranslation();
  const data = series.points.slice(0, 36);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`reporting.series.${series.key}`)}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <ReportEmptyState />
        ) : (
          <div className="h-72 w-full" aria-label={t(`reporting.series.${series.key}`)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" angle={-25} textAnchor="end" height={60} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name={t("reporting.chart.primary")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                {data.some((point) => point.secondaryValue != null) && (
                  <Bar dataKey="secondaryValue" name={t("reporting.chart.secondary")} fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

