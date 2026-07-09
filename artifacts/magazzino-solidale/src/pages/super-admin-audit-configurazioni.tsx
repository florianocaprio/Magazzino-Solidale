import {
  getListSuperAdminAuditConfigurazioniQueryKey,
  useListSuperAdminAuditConfigurazioni,
  type AuditConfigurazione,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function JsonValue({ value }: { value: unknown }) {
  const { t } = useTranslation();
  if (value == null) return <span className="text-muted-foreground">{t("common.none")}</span>;
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="max-w-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        {t("superAdmin.audit.viewJson")}
      </summary>
      <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
        {text}
      </pre>
    </details>
  );
}

function fmtDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function SuperAdminAuditConfigurazioni() {
  const { t } = useTranslation();
  const query = useListSuperAdminAuditConfigurazioni(
    { limit: 50 },
    {
      query: {
        queryKey: getListSuperAdminAuditConfigurazioniQueryKey({ limit: 50 }),
      },
    },
  );

  const rows = (query.data ?? []) as AuditConfigurazione[];

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{t("superAdmin.audit.error")}</AlertTitle>
          <AlertDescription>{t("superAdmin.audit.loadError")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("superAdmin.audit.title")}</h1>
        <p className="text-muted-foreground">{t("superAdmin.audit.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("superAdmin.audit.recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("superAdmin.audit.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("superAdmin.audit.area")}</TableHead>
                  <TableHead>{t("superAdmin.audit.key")}</TableHead>
                  <TableHead>{t("superAdmin.audit.action")}</TableHead>
                  <TableHead>{t("superAdmin.audit.user")}</TableHead>
                  <TableHead>{t("superAdmin.audit.previous")}</TableHead>
                  <TableHead>{t("superAdmin.audit.next")}</TableHead>
                  <TableHead>{t("superAdmin.audit.ip")}</TableHead>
                  <TableHead>{t("common.notes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(row.dataOra)}</TableCell>
                    <TableCell>{row.area}</TableCell>
                    <TableCell>{row.chiave}</TableCell>
                    <TableCell>{row.azione}</TableCell>
                    <TableCell>{row.utenteId ?? t("common.none")}</TableCell>
                    <TableCell><JsonValue value={row.valorePrecedente} /></TableCell>
                    <TableCell><JsonValue value={row.valoreNuovo} /></TableCell>
                    <TableCell>{row.ip ?? t("common.none")}</TableCell>
                    <TableCell>{row.note ?? t("common.none")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
