import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConfigurazioneAmbientePubblicaQueryKey,
  getListSuperAdminAuditConfigurazioniQueryKey,
  getListSuperAdminModuliQueryKey,
  useListSuperAdminModuli,
  useUpdateSuperAdminModulo,
  type ModuloFunzionale,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";

function statusBadge(attivo: boolean, t: (key: string) => string) {
  return (
    <Badge variant="outline" className={attivo ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}>
      {attivo ? t("superAdmin.modules.enabled") : t("superAdmin.modules.disabled")}
    </Badge>
  );
}

export default function SuperAdminModuli() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [toDisable, setToDisable] = useState<ModuloFunzionale | null>(null);
  const [pendingCodice, setPendingCodice] = useState<string | null>(null);

  const query = useListSuperAdminModuli({
    query: {
      queryKey: getListSuperAdminModuliQueryKey(),
    },
  });

  const moduli = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => {
      const byCategory = a.categoria.localeCompare(b.categoria);
      if (byCategory !== 0) return byCategory;
      return a.ordine - b.ordine;
    }),
    [query.data],
  );

  const update = useUpdateSuperAdminModulo({
    mutation: {
      onMutate: ({ codice }) => {
        setPendingCodice(codice);
      },
      onSuccess: (modulo) => {
        queryClient.invalidateQueries({ queryKey: getListSuperAdminModuliQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetConfigurazioneAmbientePubblicaQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSuperAdminAuditConfigurazioniQueryKey({ limit: 50 }) });
        toast({
          title: modulo.attivo ? t("superAdmin.modules.enabledToast") : t("superAdmin.modules.disabledToast"),
          description: modulo.nome,
        });
      },
      onError: (err) => {
        toast({
          title: t("superAdmin.modules.error"),
          description: errorMessage(err, t("superAdmin.modules.errorDescription")),
          variant: "destructive",
        });
      },
      onSettled: () => {
        setPendingCodice(null);
      },
    },
  });

  const setModulo = (modulo: ModuloFunzionale, attivo: boolean) => {
    if (modulo.core) return;
    if (!attivo) {
      setToDisable(modulo);
      return;
    }
    update.mutate({ codice: modulo.codice, data: { attivo: true } });
  };

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
          <AlertTitle>{t("superAdmin.modules.error")}</AlertTitle>
          <AlertDescription>{t("superAdmin.modules.loadError")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("superAdmin.modules.title")}</h1>
        <p className="text-muted-foreground">{t("superAdmin.modules.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("superAdmin.modules.catalog")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("superAdmin.modules.code")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.description")}</TableHead>
                <TableHead>{t("superAdmin.modules.category")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("superAdmin.modules.order")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moduli.map((modulo) => {
                const isPending = pendingCodice === modulo.codice;
                const actionLabel = modulo.attivo
                  ? t("superAdmin.modules.disableAction")
                  : t("superAdmin.modules.enableAction");
                return (
                  <TableRow key={modulo.codice}>
                    <TableCell className="font-mono text-xs">{modulo.codice}</TableCell>
                    <TableCell className="font-medium">{modulo.nome}</TableCell>
                    <TableCell className="max-w-md text-muted-foreground">{modulo.descrizione}</TableCell>
                    <TableCell>{modulo.categoria}</TableCell>
                    <TableCell>
                      <Badge variant={modulo.core ? "default" : "secondary"}>
                        {modulo.core ? t("superAdmin.modules.core") : t("superAdmin.modules.optional")}
                      </Badge>
                    </TableCell>
                    <TableCell>{statusBadge(modulo.attivo, t)}</TableCell>
                    <TableCell>{modulo.ordine}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-col items-end gap-1">
                        <div className="inline-flex min-w-36 items-center justify-end gap-2">
                          {isPending && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                          <Switch
                            checked={modulo.attivo}
                            disabled={modulo.core || isPending}
                            onCheckedChange={(checked) => setModulo(modulo, checked)}
                            aria-label={modulo.core ? t("superAdmin.modules.cannotDisableCore") : actionLabel}
                            title={modulo.core ? t("superAdmin.modules.cannotDisableCore") : actionLabel}
                          />
                          <span className="w-24 text-left text-xs text-muted-foreground">
                            {isPending ? t("superAdmin.modules.updating") : actionLabel}
                          </span>
                        </div>
                        {modulo.core && (
                          <span className="text-xs text-muted-foreground">
                            {t("superAdmin.modules.cannotDisableCore")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!toDisable} onOpenChange={(open) => !open && setToDisable(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("superAdmin.modules.disableConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("superAdmin.modules.disableConfirmDescription", { nome: toDisable?.nome ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDisable) {
                  update.mutate({ codice: toDisable.codice, data: { attivo: false } });
                  setToDisable(null);
                }
              }}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
