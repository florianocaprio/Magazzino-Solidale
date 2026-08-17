import type { ReportTable as ReportTableData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportEmptyState } from "./report-empty-state";
import { useTranslation } from "react-i18next";
import { localizeReportingText } from "@/lib/reporting-text";

function cell(value: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (value == null) return "—";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "boolean") return value ? "✓" : "—";
  return localizeReportingText(t, String(value));
}

export function ReportTable({ table }: { table: ReportTableData }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`reporting.tables.${table.key}`)}</CardTitle>
      </CardHeader>
      <CardContent>
        {table.rows.length === 0 ? (
          <ReportEmptyState />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((column) => (
                    <TableHead key={column}>{t(`reporting.columns.${column}`)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.slice(0, 100).map((row, index) => (
                  <TableRow key={String(row.id ?? row.prodottoId ?? row.mensaId ?? index)}>
                    {table.columns.map((column) => (
                      <TableCell key={column}>{cell(row[column], t)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
