import { useEffect, useState } from "react";
import {
  getListBisogniPianificatiQueryKey,
  type BisognoPianificato,
  useListBisogniPianificati,
  useUpdateIntervento,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BisogniPianificatiEditor,
  type BisognoPianificatoDraft,
} from "./bisogni-pianificati-editor";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { useToast } from "@/hooks/use-toast";

function toDraft(row: BisognoPianificato): BisognoPianificatoDraft {
  return {
    clientKey: `bisogno-${row.id}`,
    id: row.id,
    versione: row.versione,
    tipo: row.tipo,
    descrizione: row.descrizione,
    stato: row.stato,
    dataPrevista: row.dataPrevista ?? "",
    priorita: row.priorita,
    note: row.note ?? "",
    dataCompletamento: row.dataCompletamento,
  };
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "status" in error &&
    (error as { status?: unknown }).status === 409
  );
}

function changed(
  draft: BisognoPianificatoDraft,
  original: BisognoPianificato,
): boolean {
  return (
    draft.tipo !== original.tipo ||
    draft.descrizione.trim() !== original.descrizione ||
    draft.stato !== original.stato ||
    (draft.dataPrevista || null) !== original.dataPrevista ||
    draft.priorita !== original.priorita ||
    (draft.note.trim() || null) !== original.note
  );
}

interface Props {
  interventoId: number | null;
  interventoVersione: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function UdsBisogniDialog({
  interventoId,
  interventoVersione,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<BisognoPianificatoDraft[]>([]);
  const [motivo, setMotivo] = useState("");
  const id = interventoId ?? 0;
  const query = useListBisogniPianificati(id, {
    query: {
      queryKey: getListBisogniPianificatiQueryKey(id),
      enabled: open && interventoId != null,
    },
  });
  const updateNeeds = useUpdateIntervento();

  useEffect(() => {
    if (!open || !query.data) return;
    setDrafts(query.data.map(toDraft));
    setMotivo("");
  }, [open, query.data]);

  const pending = updateNeeds.isPending;
  const save = async () => {
    if (interventoId == null || interventoVersione == null) return;
    if (drafts.some((item) => !item.descrizione.trim())) {
      toast({
        title: t("udsInterventi.manageBisogniTitle"),
        description: t("udsInterventi.bisognoDescrizioneRequired"),
        variant: "destructive",
      });
      return;
    }
    if (
      drafts.some((item) => item.stato === "pianificato" && !item.dataPrevista)
    ) {
      toast({
        title: t("udsInterventi.manageBisogniTitle"),
        description: t("udsInterventi.bisognoDataRequired"),
        variant: "destructive",
      });
      return;
    }
    try {
      const changedNeeds = drafts.filter((draft) => {
        if (draft.id == null) return true;
        const original = query.data?.find((item) => item.id === draft.id);
        return original != null && changed(draft, original);
      });
      if (changedNeeds.length > 0) {
        await updateNeeds.mutateAsync({
          id: interventoId,
          data: {
            versione: interventoVersione,
            bisogniPianificati: changedNeeds.map((draft) => ({
              ...(draft.id != null
                ? { id: draft.id, versione: draft.versione }
                : {}),
              tipo: draft.tipo,
              descrizione: draft.descrizione.trim(),
              stato: draft.stato,
              dataPrevista: draft.dataPrevista || null,
              priorita: draft.priorita,
              note: draft.note.trim() || null,
              motivo: motivo.trim() || null,
            })),
          },
        });
      }
      await queryClient.invalidateQueries({
        queryKey: getListBisogniPianificatiQueryKey(interventoId),
      });
      onChanged();
      toast({ title: t("udsInterventi.manageBisogniSaved") });
      onOpenChange(false);
    } catch (error) {
      if (isConflict(error)) {
        await queryClient.invalidateQueries({
          queryKey: getListBisogniPianificatiQueryKey(interventoId),
        });
        await query.refetch();
        onChanged();
      }
      toast({
        title: t("udsInterventi.manageBisogniTitle"),
        description: isConflict(error)
          ? t("udsInterventi.concurrencyConflict")
          : t("udsInterventi.manageBisogniError"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("udsInterventi.manageBisogniTitle")}</DialogTitle>
          <DialogDescription>
            {t("udsInterventi.manageBisogniDescription")}
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <BisogniPianificatiEditor
            value={drafts}
            onChange={setDrafts}
            disabled={pending}
          />
        )}
        <div className="space-y-2">
          <Label htmlFor="uds-bisogni-motivo">
            {t("udsInterventi.manageBisogniMotivo")}
          </Label>
          <Textarea
            id="uds-bisogni-motivo"
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            maxLength={2000}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={pending || query.isLoading}
          >
            {pending ? t("udsInterventi.savingNeeds") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
