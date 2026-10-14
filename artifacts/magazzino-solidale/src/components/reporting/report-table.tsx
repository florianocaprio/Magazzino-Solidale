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
import { Link } from "wouter";

function cell(
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
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
              {table.rows.length > 100 && (
                <caption className="p-2 text-sm">
                  {t("reporting.export.tablePreview", {
                    shown: 100,
                    total: table.rows.length,
                  })}
                </caption>
              )}
              <TableHeader>
                <TableRow>
                  {table.columns.map((column) => (
                    <TableHead key={column}>
                      {t(`reporting.columns.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.slice(0, 100).map((row, index) => (
                  <TableRow
                    key={String(
                      row.id ?? row.prodottoId ?? row.mensaId ?? index,
                    )}
                  >
                    {table.columns.map((column) => (
                      <TableCell key={column}>
                        {table.key === "richiesteTop200" &&
                        column === "codice" &&
                        typeof row.id === "number" ? (
                          <Link
                            className="inline-flex min-h-11 items-center underline"
                            href={`/richieste-magazzino?richiestaId=${row.id}`}
                          >
                            {cell(row[column], t)}
                          </Link>
                        ) : (
                          cell(row[column], t)
                        )}
                      </TableCell>
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
