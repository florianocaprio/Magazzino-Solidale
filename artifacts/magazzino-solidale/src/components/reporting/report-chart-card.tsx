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
import { reportingSeriesLabel } from "@/lib/reporting-metadata";
import { reportingColumnLabel } from "@/lib/reporting-text";

export function ReportChartCard({ series }: { series: ReportSeries }) {
  const { t } = useTranslation();
  const data = series.points.slice(0, 36);
  const measures =
    series.secondary || data.some((point) => point.secondaryValue != null)
      ? [false, true]
      : [false];
  const labels = {
    column: (key: string) => reportingColumnLabel(t, key),
    unit: (key: string) => t(`reporting.units.${key}`),
    metadata: { value: t("reporting.chart.primary") },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`reporting.series.${series.key}`)}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <ReportEmptyState />
        ) : (
          <div className="space-y-6">
            {measures.map((secondary) => (
              <div key={secondary ? "secondary" : "primary"}>
                <p className="mb-2 text-sm font-medium">
                  {reportingSeriesLabel(series, secondary, labels)}
                </p>
                <div
                  className="h-72 w-full"
                  aria-label={reportingSeriesLabel(series, secondary, labels)}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data}
                      margin={{ top: 8, right: 12, left: 0, bottom: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        angle={-25}
                        textAnchor="end"
                        height={60}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        allowDecimals={
                          (secondary ? series.secondary : series.primary)
                            ?.unit !== "count"
                        }
                      />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey={secondary ? "secondaryValue" : "value"}
                        name={reportingSeriesLabel(series, secondary, labels)}
                        fill={
                          secondary
                            ? "hsl(var(--chart-4))"
                            : "hsl(var(--primary))"
                        }
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
