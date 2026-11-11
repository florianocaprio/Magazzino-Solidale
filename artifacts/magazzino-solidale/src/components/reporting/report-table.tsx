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
import { formatLogisticsQuantity } from "@/lib/reporting-number";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

function cell(
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (value == null) return "—";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "boolean") return value ? "✓" : "—";
  return localizeReportingText(t, String(value));
}

const stockQuantityColumns: Readonly<Record<string, readonly string[]>> = {
  giacenze: ["quantita"],
  causali: ["quantita"],
  disponibilitaCorrente: [
    "fisica",
    "distribuibile",
    "impegnato",
    "disponibile",
    "soglia",
  ],
};

export function ReportTable({
  table,
  stockPresentation = false,
}: {
  table: ReportTableData;
  stockPresentation?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { hasArea, hasPermission } = useAuth();
  const quantityColumns = stockPresentation
    ? stockQuantityColumns[table.key]
    : undefined;
  const requestPath =
    (hasArea("sociale") || hasArea("magazzino")) &&
    hasPermission("richieste_magazzino.view")
      ? "/richieste-magazzino"
      : "/mensa/trasferimenti";
  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search,
  );
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
                            href={`${requestPath}?richiestaId=${row.id}&returnTo=${returnTo}`}
                          >
                            {cell(row[column], t)}
                          </Link>
                        ) : (
                          ((quantityColumns?.includes(column)
                            ? formatLogisticsQuantity(
                                row[column],
                                row.unitaMisura ?? row.unita,
                                i18n.resolvedLanguage,
                              )
                            : undefined) ?? cell(row[column], t))
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
