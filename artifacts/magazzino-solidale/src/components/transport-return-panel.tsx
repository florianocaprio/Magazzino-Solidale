import { useState } from "react";
import {
  getGetRientroBollaQueryKey,
  getGetRientroTrasferimentoQueryKey,
  useGetRientroBolla,
  useGetRientroTrasferimento,
  useRegistraRientroBolla,
  useRegistraRientroTrasferimento,
  type RientroTrasportoDettaglio,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import {
  RETURN_FIELDS,
  formatReturnUnits,
  returnLineDifference,
  returnQuantityUnits,
  type ReturnField,
} from "@/lib/transport-return";
import { generateTransportReturnPdf } from "@/lib/transport-return-pdf";

type Classified = Record<ReturnField, string> & { nota: string };
const emptyClassification = (): Classified => ({
  idonea: "0",
  deteriorata: "0",
  scaduta: "0",
  mancante: "0",
  rubata: "0",
  nota: "",
});

export function TransportReturnPanel({
  owner,
  id,
  version,
  documentNumber,
  canReceive,
  onComplete,
}: {
  owner: "bolla" | "trasferimento";
  id: number;
  version: number;
  documentNumber: string;
  canReceive: boolean;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const intents = useCommandIntentRegistry();
  const [open, setOpen] = useState(false);
  const [classified, setClassified] = useState<Record<number, Classified>>({});
  const [note, setNote] = useState("");
  const bolla = useGetRientroBolla(id, {
    query: {
      queryKey: getGetRientroBollaQueryKey(id),
      enabled: owner === "bolla",
    },
  });
  const transfer = useGetRientroTrasferimento(id, {
    query: {
      queryKey: getGetRientroTrasferimentoQueryKey(id),
      enabled: owner === "trasferimento",
    },
  });
  const registerBolla = useRegistraRientroBolla();
  const registerTransfer = useRegistraRientroTrasferimento();
  const detail = (owner === "bolla" ? bolla.data : transfer.data) as
    | RientroTrasportoDettaglio
    | undefined;
  const pending = registerBolla.isPending || registerTransfer.isPending;
  const parts = detail?.partite ?? [];
  let totalOut = 0n;
  let totalClassified = 0n;
  let valid = parts.length > 0;
  for (const part of parts) {
    const amount = returnQuantityUnits(part.quantitaUscita);
    const values = classified[part.movimentoUscitaId] ?? emptyClassification();
    const difference = returnLineDifference(part.quantitaUscita, values);
    if (amount == null || difference == null || difference !== 0n)
      valid = false;
    if (
      part.quantitaFrazionabile === false &&
      RETURN_FIELDS.some((field) => {
        const units = returnQuantityUnits(values[field] || "0");
        return units != null && units % 1_000_000n !== 0n;
      })
    )
      valid = false;
    if (amount != null) totalOut += amount;
    if (amount != null && difference != null)
      totalClassified += amount - difference;
  }
  const canSubmit =
    valid &&
    totalOut === totalClassified &&
    detail?.stato === "rientro_atteso" &&
    canReceive;
  const slot = `${owner}:${id}:return`;

  const update = (movementId: number, key: keyof Classified, value: string) => {
    setClassified((current) => ({
      ...current,
      [movementId]: {
        ...(current[movementId] ?? emptyClassification()),
        [key]: value,
      },
    }));
  };
  const submit = () => {
    if (!canSubmit) return;
    const righe = parts.map((part) => ({
      movimentoUscitaId: part.movimentoUscitaId,
      ...Object.fromEntries(
        RETURN_FIELDS.map((field) => [
          field,
          classified[part.movimentoUscitaId]?.[field] || "0",
        ]),
      ),
      nota: classified[part.movimentoUscitaId]?.nota?.trim() || null,
    }));
    const semantic = { righe, note: note.trim() || null };
    const data = intents.prepare(slot, semantic, {
      ...semantic,
      versione: version,
    });
    const options = {
      onSuccess: () => {
        intents.complete(slot);
        queryClient.invalidateQueries({
          queryKey:
            owner === "bolla"
              ? getGetRientroBollaQueryKey(id)
              : getGetRientroTrasferimentoQueryKey(id),
        });
        setOpen(false);
        onComplete();
        toast({ title: t("transportReturn.saved") });
      },
      onError: (error: unknown) => {
        intents.fail(slot, error);
        toast({ title: t("transportReturn.error"), variant: "destructive" });
      },
    };
    if (owner === "bolla") registerBolla.mutate({ id, data }, options);
    else registerTransfer.mutate({ id, data }, options);
  };

  return (
    <>
      {detail?.stato === "rientro_atteso" && canReceive && (
        <Button onClick={() => setOpen(true)}>
          {t("transportReturn.record")}
        </Button>
      )}
      {detail?.stato === "rientrato" && (
        <div className="rounded-md border p-3 text-sm space-y-2">
          <p className="font-medium">
            {t("transportReturn.closed")} #{detail.rientroId}
          </p>
          {(detail.documenti ?? []).map((document, index) => (
            <div
              key={`${document.movimentoUscitaId}-${document.tipo}-${index}`}
              className="flex items-center justify-between gap-2"
            >
              <p>
                {t(`transportReturn.document.${document.tipo}`)} ·{" "}
                {formatReturnUnits(
                  returnQuantityUnits(document.quantita) ?? 0n,
                )}
                {document.scaricoId != null ? ` · #${document.scaricoId}` : ""}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  generateTransportReturnPdf(detail, documentNumber, t, index)
                }
              >
                {t("transportReturn.download")}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              generateTransportReturnPdf(detail, documentNumber, t)
            }
          >
            {t("transportReturn.download")}
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("transportReturn.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("transportReturn.originFixed")}
          </p>
          <div className="space-y-4">
            {parts.map((part) => {
              const values =
                classified[part.movimentoUscitaId] ?? emptyClassification();
              const difference = returnLineDifference(
                part.quantitaUscita,
                values,
              );
              return (
                <div
                  key={part.movimentoUscitaId}
                  className="rounded-md border p-3 space-y-3"
                >
                  <p className="font-medium">
                    {part.prodottoNome} ·{" "}
                    {part.codiceLotto || `#${part.lottoId}`}
                  </p>
                  <p className="text-sm">
                    {t("transportReturn.departed")}: {part.quantitaUscita}{" "}
                    {part.unitaMisura}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {RETURN_FIELDS.map((field) => (
                      <div key={field}>
                        <Label
                          htmlFor={`return-${part.movimentoUscitaId}-${field}`}
                        >
                          {t(`transportReturn.${field}`)}
                        </Label>
                        <Input
                          id={`return-${part.movimentoUscitaId}-${field}`}
                          inputMode="decimal"
                          value={values[field]}
                          onChange={(event) =>
                            update(
                              part.movimentoUscitaId,
                              field,
                              event.target.value,
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p
                    className={
                      difference === 0n
                        ? "text-sm text-green-700"
                        : "text-sm text-destructive"
                    }
                  >
                    {t("transportReturn.classified")}:{" "}
                    {difference == null
                      ? "—"
                      : formatReturnUnits(
                          (returnQuantityUnits(part.quantitaUscita) ?? 0n) -
                            difference,
                        )}{" "}
                    · {t("transportReturn.difference")}:{" "}
                    {difference == null ? "—" : formatReturnUnits(difference)}
                  </p>
                  <Input
                    value={values.nota}
                    maxLength={500}
                    placeholder={t("transportReturn.lineNote")}
                    onChange={(event) =>
                      update(part.movimentoUscitaId, "nota", event.target.value)
                    }
                  />
                </div>
              );
            })}
          </div>
          <p className="text-sm font-medium">
            {t("transportReturn.totalDeparted")}: {formatReturnUnits(totalOut)}{" "}
            · {t("transportReturn.totalClassified")}:{" "}
            {formatReturnUnits(totalClassified)} ·{" "}
            {t("transportReturn.difference")}:{" "}
            {formatReturnUnits(totalOut - totalClassified)}
          </p>
          <Input
            value={note}
            maxLength={1000}
            placeholder={t("transportReturn.note")}
            onChange={(event) => setNote(event.target.value)}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={!canSubmit || pending}>
              {t("transportReturn.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
