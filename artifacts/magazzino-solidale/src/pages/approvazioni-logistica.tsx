import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getListApprovazioniLogisticaQueryKey,
  useApprovaMezzoLogistica,
  useApprovaVolontarioLogistica,
  useListApprovazioniLogistica,
  useRespingiMezzoLogistica,
  useRespingiVolontarioLogistica,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { volontarioLabel } from "@/lib/volontari-label";
import { Check, X } from "lucide-react";

export default function ApprovazioniLogistica() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListApprovazioniLogistica();
  const approvaVolontario = useApprovaVolontarioLogistica();
  const respingiVolontario = useRespingiVolontarioLogistica();
  const approvaMezzo = useApprovaMezzoLogistica();
  const respingiMezzo = useRespingiMezzoLogistica();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListApprovazioniLogisticaQueryKey() });
  };

  const onDone = (message: string) => {
    refresh();
    toast({ description: message });
  };

  const onError = (e: unknown) => {
    const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
    toast({
      variant: "destructive",
      description: msg ?? t("approvazioniLogistica.error", { defaultValue: "Operazione non riuscita" }),
    });
  };

  const pending = approvaVolontario.isPending || respingiVolontario.isPending || approvaMezzo.isPending || respingiMezzo.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("approvazioniLogistica.title", { defaultValue: "Approva nuovi inserimenti" })}</h1>
        <p className="text-muted-foreground text-sm">
          {t("approvazioniLogistica.subtitle", { defaultValue: "Volontari e mezzi inseriti dalla pianificazione turni." })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("approvazioniLogistica.volontariTitle", { defaultValue: "Volontari da approvare" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.volontari.length ?? 0) === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {isLoading ? t("common.loading") : t("approvazioniLogistica.noVolontari", { defaultValue: "Nessun volontario in attesa." })}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("volontari.matricola", { defaultValue: "Matricola" })}</TableHead>
                  <TableHead>{t("common.centro")}</TableHead>
                  <TableHead>{t("common.notes")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.volontari.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="font-medium">{volontarioLabel(v)}</div>
                      <div className="text-muted-foreground text-xs">{v.telefono ?? v.email ?? "—"}</div>
                    </TableCell>
                    <TableCell>{v.matricola ?? "—"}</TableCell>
                    <TableCell>{v.centroAscoltoNome ?? t("common.tuttiCentri")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{t("approvazioniLogistica.pending", { defaultValue: "In attesa" })}</Badge>
                        <span className="text-sm">{v.note ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => approvaVolontario.mutate({ id: v.id }, { onSuccess: () => onDone(t("approvazioniLogistica.volApproved", { defaultValue: "Volontario approvato" })), onError })}
                          disabled={pending}
                        >
                          <Check className="me-1 h-4 w-4" /> {t("common.confirm")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respingiVolontario.mutate({ id: v.id }, { onSuccess: () => onDone(t("approvazioniLogistica.volRejected", { defaultValue: "Volontario respinto" })) })}
                          disabled={pending}
                        >
                          <X className="me-1 h-4 w-4" /> {t("approvazioniLogistica.reject", { defaultValue: "Respingi" })}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("approvazioniLogistica.mezziTitle", { defaultValue: "Mezzi da approvare" })}</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.mezzi.length ?? 0) === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {isLoading ? t("common.loading") : t("approvazioniLogistica.noMezzi", { defaultValue: "Nessun mezzo in attesa." })}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.code")}</TableHead>
                  <TableHead>{t("common.type")}</TableHead>
                  <TableHead>{t("common.centro")}</TableHead>
                  <TableHead>{t("common.notes")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.mezzi.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.codice}</div>
                      <div className="text-muted-foreground text-xs">{m.targa ?? "—"}</div>
                    </TableCell>
                    <TableCell>{m.tipo}</TableCell>
                    <TableCell>{m.centroAscoltoNome ?? t("common.tuttiCentri")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{t("approvazioniLogistica.pending", { defaultValue: "In attesa" })}</Badge>
                        <span className="text-sm">{m.note ?? m.descrizione ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => approvaMezzo.mutate({ id: m.id }, { onSuccess: () => onDone(t("approvazioniLogistica.mezzoApproved", { defaultValue: "Mezzo approvato" })) })}
                          disabled={pending}
                        >
                          <Check className="me-1 h-4 w-4" /> {t("common.confirm")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => respingiMezzo.mutate({ id: m.id }, { onSuccess: () => onDone(t("approvazioniLogistica.mezzoRejected", { defaultValue: "Mezzo respinto" })) })}
                          disabled={pending}
                        >
                          <X className="me-1 h-4 w-4" /> {t("approvazioniLogistica.reject", { defaultValue: "Respingi" })}
                        </Button>
                      </div>
                    </TableCell>
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
