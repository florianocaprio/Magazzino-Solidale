import { useEffect, useState } from "react";
import {
  useGetApprovvigionamento,
  useUpdateApprovvigionamento,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api-error";

type Party = {
  rigaId: number;
  quantita: string;
  codiceLotto: string;
  dataScadenza: string;
};
export function SupplyReceipt({
  id,
  onClose,
  onSuccess,
}: {
  id: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const detail = useGetApprovvigionamento(id);
  const mutation = useUpdateApprovvigionamento();
  const [parties, setParties] = useState<Party[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState<number>();
  useEffect(() => {
    if (detail.data && parties === null) {
      setVersion(detail.data.versione);
      setParties(
        (detail.data.righe ?? [])
          .filter(
            (r) =>
              r.quantitaResiduaEsatta &&
              !/^0\.0+$/.test(r.quantitaResiduaEsatta),
          )
          .map((r) => ({
            rigaId: r.id,
            quantita: r.quantitaResiduaEsatta!,
            codiceLotto: "",
            dataScadenza: "",
          })),
      );
    }
  }, [detail.data, parties]);
  const edit = (
    index: number,
    field: keyof Omit<Party, "rigaId">,
    value: string,
  ) =>
    setParties((p) =>
      p!.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("approvvigionamenti.receiptTitle")}</SheetTitle>
          <SheetDescription>
            {t("approvvigionamenti.receiptDescription")}
          </SheetDescription>
        </SheetHeader>
        {detail.isError ? (
          <p role="alert">
            {errorMessage(detail.error, t("approvvigionamenti.receiptError"))}
          </p>
        ) : detail.data && parties ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                await mutation.mutateAsync({
                  id,
                  data: {
                    versione: version!,
                    stato: "completato",
                    partite: parties.map((p) => ({
                      ...p,
                      codiceLotto: p.codiceLotto.trim() || undefined,
                      dataScadenza: p.dataScadenza || undefined,
                    })),
                  },
                });
                onSuccess();
              } catch (err) {
                setError(
                  errorMessage(err, t("approvvigionamenti.receiptError")),
                );
              }
            }}
          >
            {parties.map((p, i) => {
              const row = detail.data!.righe?.find((r) => r.id === p.rigaId);
              if (!row) return null;
              return (
                <fieldset
                  disabled={mutation.isPending}
                  className="border rounded p-3 space-y-2"
                  key={i}
                >
                  <legend>
                    {row.prodottoNome} — {row.unitaMisura}
                  </legend>
                  <label className="block">
                    {t("common.quantity")} *
                    <Input
                      required
                      inputMode="decimal"
                      value={p.quantita}
                      onChange={(e) => edit(i, "quantita", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {t("approvvigionamenti.receiptLot")}
                    {row.lottoFisicoObbligatorio ? " *" : ""}
                    <Input
                      required={row.lottoFisicoObbligatorio}
                      value={p.codiceLotto}
                      onChange={(e) => edit(i, "codiceLotto", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    {t("approvvigionamenti.receiptExpiry")}
                    {row.gestioneScadenza ? " *" : ""}
                    <Input
                      type="date"
                      required={row.gestioneScadenza}
                      value={p.dataScadenza}
                      onChange={(e) => edit(i, "dataScadenza", e.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setParties((v) => [
                        ...v!,
                        {
                          rigaId: p.rigaId,
                          quantita: "",
                          codiceLotto: "",
                          dataScadenza: "",
                        },
                      ])
                    }
                  >
                    {t("approvvigionamenti.receiptAddParty")}
                  </Button>
                  {parties.filter((x) => x.rigaId === p.rigaId).length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setParties((v) => v!.filter((_, n) => n !== i))
                      }
                    >
                      {t("common.delete")}
                    </Button>
                  )}
                </fieldset>
              );
            })}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending || !parties.length}
            >
              {t("approvvigionamenti.receiptConfirm")}
            </Button>
          </form>
        ) : (
          <p>{t("common.loading")}</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
