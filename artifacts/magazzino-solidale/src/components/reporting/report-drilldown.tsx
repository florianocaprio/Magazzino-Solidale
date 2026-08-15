import {
  getGetReportDrilldownQueryKey,
  useGetReportDrilldown,
  type GetReportDrilldownParams,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function ReportDrilldown({
  open,
  onOpenChange,
  params,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  params: Omit<GetReportDrilldownParams, "page" | "pageSize"> | null;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const queryParams = { ...(params ?? { section: "pacchi" as const, metric: "" }), page, pageSize: 25 };
  const query = useGetReportDrilldown(queryParams, {
    query: {
      queryKey: getGetReportDrilldownQueryKey(queryParams),
      enabled: open && params != null,
    },
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setPage(1); onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("reporting.drilldown.title")}</DialogTitle>
          <DialogDescription>{t("reporting.drilldown.description")}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <p role="alert" className="rounded-md border border-destructive p-4 text-destructive">{t("reporting.error")}</p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow>{query.data?.columns.map((column) => <TableHead key={column}>{t(`reporting.columns.${column}`)}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {query.data?.rows.map((row, index) => (
                    <TableRow key={String(row.id ?? index)}>
                      {query.data?.columns.map((column) => <TableCell key={column}>{row[column] == null ? "—" : String(row[column])}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("reporting.drilldown.page", { page, totalPages, total: query.data?.total ?? 0 })}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t("reporting.drilldown.previous")}</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>{t("reporting.drilldown.next")}</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

