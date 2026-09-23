import { useEffect, useState } from "react";
import {
  useListTrasferimenti,
  useCreateTrasferimento,
  useUpdateTrasferimento,
  useAvviaTrasferimento,
  useConfermaTrasferimento,
  useListMagazzini,
  useListGiacenze,
  useListLotti,
  useListProdotti,
  useListVolontari,
  useGetImpostazioniStampa,
  listTrasferimenti,
  getListTrasferimentiQueryKey,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  type Trasferimento,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import {
  Plus,
  ArrowRight,
  Play,
  CheckCircle2,
  Trash2,
  Download,
  CheckCircle,
  Pencil,
  Truck,
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { loadAllPages } from "@/lib/paged-export";
import { todayEuropeRome } from "@/lib/europe-rome";
import {
  transferLotIsAvailable,
  transferRowsForPayload,
  transferRowsHaveRequiredLots,
  trasferimentoDraftIsDirty,
} from "@/lib/trasferimento-draft";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/hooks/use-unsaved-changes-guard";

interface RigaDraft {
  key: string;
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
  lottoId: string;
}

function newRiga(): RigaDraft {
  return {
    key: Math.random().toString(36).slice(2),
    prodottoId: "",
    quantita: "",
    unitaMisura: "pz",
    lottoId: "",
  };
}

// ─── Editor righe (dipende dal magazzino origine) ────────────────────────────

export function RigheEditor({
  magazzinoId,
  areaOperativaId,
  righe,
  setRighe,
}: {
  magazzinoId: number;
  areaOperativaId: number;
  righe: RigaDraft[];
  setRighe: (r: RigaDraft[]) => void;
}) {
  const { t } = useTranslation();
  const { data: giacenze } = useListGiacenze(
    { areaOperativaId, magazzinoId },
    {
      query: {
        enabled: areaOperativaId > 0 && magazzinoId > 0,
        queryKey: getListGiacenzeQueryKey({ areaOperativaId, magazzinoId }),
      },
    },
  );
  const { data: prodotti } = useListProdotti();
  const { data: lotti } = useListLotti(
    { magazzinoId },
    {
      query: {
        enabled: areaOperativaId > 0 && magazzinoId > 0,
        queryKey: getListLottiQueryKey({ magazzinoId }),
      },
    },
  );
  useEffect(() => {
    if (!lotti) return;
    if (
      righe.some(
        (r) =>
          r.lottoId &&
          !lotti.some(
            (lotto) =>
              lotto.id === Number(r.lottoId) &&
              transferLotIsAvailable(
                lotto,
                Number(r.prodottoId),
                magazzinoId,
                todayEuropeRome(),
              ),
          ),
      )
    ) {
      setRighe(
        righe.map((r) =>
          r.lottoId &&
          !lotti.some(
            (lotto) =>
              lotto.id === Number(r.lottoId) &&
              transferLotIsAvailable(
                lotto,
                Number(r.prodottoId),
                magazzinoId,
                todayEuropeRome(),
              ),
          )
            ? { ...r, lottoId: "" }
            : r,
        ),
      );
    }
  }, [lotti, magazzinoId, righe, setRighe]);

  const update = (key: string, patch: Partial<RigaDraft>) =>
    setRighe(righe.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRighe(righe.filter((r) => r.key !== key));

  const usedIds = righe.map((r) => r.prodottoId).filter(Boolean);

  return (
    <div className="space-y-3">
      {(!giacenze || giacenze.length === 0) && (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
          {t("trasferimenti.noProdottiOrigine")}
        </p>
      )}

      {righe.map((r, index) => {
        const giac = giacenze?.find(
          (g) => g.prodottoId === parseInt(r.prodottoId),
        );
        const prodotto = prodotti?.find((p) => p.id === Number(r.prodottoId));
        const lottiDisponibili =
          lotti?.filter((lotto) =>
            transferLotIsAvailable(
              lotto,
              Number(r.prodottoId),
              magazzinoId,
              todayEuropeRome(),
            ),
          ) ?? [];
        const lottoScelto = lottiDisponibili.find(
          (lotto) => lotto.id === Number(r.lottoId),
        );
        const max = Math.max(
          0,
          r.lottoId
            ? (lottoScelto?.disponibileReale ?? 0)
            : (giac?.disponibileReale ?? 0),
        );
        const qNum = parseFloat(r.quantita || "0");
        const eccede = !!r.prodottoId && qNum > max;
        return (
          <div key={r.key} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <Label className="text-xs">{t("trasferimenti.prodotto")}</Label>
                <Select
                  value={r.prodottoId}
                  onValueChange={(v) => {
                    const g = giacenze?.find(
                      (x) => x.prodottoId === parseInt(v),
                    );
                    update(r.key, {
                      prodottoId: v,
                      unitaMisura: g?.unitaMisura ?? "pz",
                      quantita: "",
                      lottoId: "",
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label={`${t("trasferimenti.prodotto")} ${index + 1}`}
                  >
                    <SelectValue
                      placeholder={t("trasferimenti.selezionaProdotto")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {giacenze
                      ?.filter(
                        (g) =>
                          g.prodottoId === parseInt(r.prodottoId) ||
                          !usedIds.includes(String(g.prodottoId)),
                      )
                      .map((g) => (
                        <SelectItem
                          key={g.prodottoId}
                          value={String(g.prodottoId)}
                        >
                          {g.prodottoNome} — {Math.max(0, g.disponibileReale)}{" "}
                          {g.unitaMisura} {t("trasferimenti.disponibileSuffix")}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => remove(r.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {r.prodottoId && (
              <div className="space-y-2">
                <Label className="text-xs">
                  {t("trasferimenti.lottoFisico")}
                  {prodotto?.lottoFisicoObbligatorio ? " *" : ""}
                </Label>
                <Select
                  value={r.lottoId || "fefo"}
                  onValueChange={(value) =>
                    update(r.key, { lottoId: value === "fefo" ? "" : value })
                  }
                >
                  <SelectTrigger
                    aria-label={`${t("trasferimenti.lottoFisico")} ${index + 1}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!prodotto?.lottoFisicoObbligatorio && (
                      <SelectItem value="fefo">
                        {t("trasferimenti.fefoAutomatico")}
                      </SelectItem>
                    )}
                    {lottiDisponibili.map((lotto) => (
                      <SelectItem key={lotto.id} value={String(lotto.id)}>
                        {lotto.codiceLotto ||
                          t("trasferimenti.lottoSenzaCodice")}{" "}
                        ·{" "}
                        {lotto.dataScadenza ||
                          t("trasferimenti.lottoSenzaScadenza")}{" "}
                        ·{" "}
                        {t("trasferimenti.disponibile", {
                          max: lotto.disponibileRealePrecisa,
                          um: giac?.unitaMisura ?? "",
                        })}
                        {lotto.fornitoreNome ? ` · ${lotto.fornitoreNome}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">{t("common.quantity")}</Label>
                <Input
                  type="number"
                  aria-label={`${t("common.quantity")} ${index + 1}`}
                  min="0.01"
                  step="0.000001"
                  max={max || undefined}
                  value={r.quantita}
                  onChange={(e) => update(r.key, { quantita: e.target.value })}
                  placeholder="0"
                  className={
                    eccede
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
                {r.prodottoId && (
                  <p
                    className={`text-xs ${eccede ? "text-destructive font-medium" : "text-muted-foreground"}`}
                  >
                    {eccede
                      ? t("trasferimenti.massimoDisponibile", { max })
                      : t("trasferimenti.disponibile", {
                          max,
                          um: giac?.unitaMisura ?? "",
                        })}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  {t("trasferimenti.unitaMisura")}
                </Label>
                <Select
                  value={r.unitaMisura}
                  onValueChange={(v) => update(r.key, { unitaMisura: v })}
                >
                  <SelectTrigger
                    aria-label={`${t("trasferimenti.unitaMisura")} ${index + 1}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "pz",
                      "kg",
                      "g",
                      "lt",
                      "ml",
                      "conf",
                      "scatola",
                      "busta",
                    ].map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={() => setRighe([...righe, newRiga()])}
        disabled={!giacenze || giacenze.length === 0}
      >
        <Plus className="h-4 w-4" /> {t("trasferimenti.aggiungiProdotto")}
      </Button>
    </div>
  );
}

// ─── Form nuovo trasferimento ────────────────────────────────────────────────

export function NuovoTrasferimentoForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (t: Trasferimento) => void;
}) {
  const [origineId, setOrigineId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreAltro, setTrasportatoreAltro] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([newRiga()]);

  const { t } = useTranslation();
  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari();
  const createTrasferimento = useCreateTrasferimento();
  const { toast } = useToast();
  const commandIntents = useCommandIntentRegistry();

  const origineIdNum = origineId ? parseInt(origineId) : 0;
  const origineAreaId =
    magazzini?.find((m) => m.id === origineIdNum)?.areaOperativaId ?? 0;
  const giacenzeParams = {
    areaOperativaId: origineAreaId,
    magazzinoId: origineIdNum,
  };
  const { data: origineGiacenze } = useListGiacenze(giacenzeParams, {
    query: {
      enabled: !!origineId && origineAreaId > 0,
      queryKey: getListGiacenzeQueryKey(giacenzeParams),
    },
  });
  const { data: prodotti } = useListProdotti();

  const reset = () => {
    commandIntents.discard("trasferimento:create");
    setOrigineId("");
    setDestinoId("");
    setTrasportatore("");
    setTrasportatoreAltro("");
    setNote("");
    setRighe([newRiga()]);
  };
  const isDirty =
    !!origineId ||
    !!destinoId ||
    !!trasportatore ||
    !!trasportatoreAltro ||
    !!note ||
    righe.length !== 1 ||
    righe.some(
      (riga) => !!riga.prodottoId || !!riga.quantita || !!riga.lottoId,
    );
  const unsavedGuard = useUnsavedChangesGuard(open && isDirty);
  const requestClose = () => {
    if (createTrasferimento.isPending) return;
    unsavedGuard.requestClose(() => {
      reset();
      onClose();
    });
  };

  const righeValide = righe.filter(
    (r) => r.prodottoId && parseFloat(r.quantita || "0") > 0,
  );
  const hasEccesso = righeValide.some((r) => {
    const giac = origineGiacenze?.find(
      (g) => g.prodottoId === parseInt(r.prodottoId),
    );
    return parseFloat(r.quantita) > Math.max(0, giac?.disponibileReale ?? 0);
  });
  const trasportatoreValido =
    (!!trasportatore && trasportatore !== "altro") ||
    (trasportatore === "altro" && trasportatoreAltro.trim().length > 0);
  const canSubmit =
    !!origineId &&
    origineAreaId > 0 &&
    !!destinoId &&
    origineId !== destinoId &&
    righeValide.length > 0 &&
    !!prodotti &&
    transferRowsHaveRequiredLots(righeValide, prodotti) &&
    !hasEccesso &&
    trasportatoreValido &&
    !createTrasferimento.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    const slot = "trasferimento:create";
    const semanticInput = {
      magazzinoOrigineId: parseInt(origineId),
      magazzinoDestinoId: parseInt(destinoId),
      trasportatoreVolontarioId:
        trasportatore && trasportatore !== "altro"
          ? parseInt(trasportatore)
          : undefined,
      trasportatoreNome:
        trasportatore === "altro"
          ? trasportatoreAltro.trim() || undefined
          : undefined,
      note: note || undefined,
      righe: transferRowsForPayload(righeValide),
    };
    createTrasferimento.mutate(
      {
        data: commandIntents.prepare(slot, semanticInput, {
          ...semanticInput,
          dataRichiesta: todayEuropeRome(),
        }),
      },
      {
        onSuccess: (t) => {
          commandIntents.complete(slot);
          reset();
          onClose();
          onCreated(t);
        },
        onError: (error) => {
          commandIntents.fail(slot, error);
          toast({
            title: t("trasferimenti.errorTitle"),
            description: t("trasferimenti.errorCreate"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("trasferimenti.formTitle")}</SheetTitle>
          <SheetDescription>
            {t("trasferimenti.formDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label>{t("trasferimenti.magazzinoPartenza")}</Label>
              <Select
                value={origineId}
                onValueChange={(v) => {
                  setOrigineId(v);
                  setRighe([newRiga()]);
                }}
              >
                <SelectTrigger
                  aria-label={t("trasferimenti.magazzinoPartenza")}
                >
                  <SelectValue placeholder={t("trasferimenti.selectOrigine")} />
                </SelectTrigger>
                <SelectContent>
                  {magazzini
                    ?.filter(
                      (m) => m.stato === "attivo" && m.areaOperativaId != null,
                    )
                    .map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("trasferimenti.magazzinoDestinazione")}</Label>
              <Select value={destinoId} onValueChange={setDestinoId}>
                <SelectTrigger
                  aria-label={t("trasferimenti.magazzinoDestinazione")}
                >
                  <SelectValue
                    placeholder={t("trasferimenti.selectDestinazione")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {magazzini
                    ?.filter(
                      (m) => m.stato === "attivo" && String(m.id) !== origineId,
                    )
                    .map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {origineId && destinoId && origineId === destinoId && (
                <p className="text-xs text-destructive">
                  {t("trasferimenti.origineDestinazioneDiverse")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {t("trasferimenti.trasportatore")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Select
              value={trasportatore}
              onValueChange={(v) => {
                setTrasportatore(v);
                if (v !== "altro") setTrasportatoreAltro("");
              }}
            >
              <SelectTrigger aria-label={t("trasferimenti.trasportatore")}>
                <SelectValue
                  placeholder={t("trasferimenti.selectTrasportatore")}
                />
              </SelectTrigger>
              <SelectContent>
                {volontari
                  ?.filter((v) => v.operativo)
                  .map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.nome} {v.cognome}
                    </SelectItem>
                  ))}
                <SelectItem value="altro">
                  {t("trasferimenti.altro")}
                </SelectItem>
              </SelectContent>
            </Select>
            {trasportatore === "altro" && (
              <Input
                value={trasportatoreAltro}
                onChange={(e) => setTrasportatoreAltro(e.target.value)}
                placeholder={t("trasferimenti.nomeTrasportatore")}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("trasferimenti.prodottiDaTrasferire")}</Label>
            {origineId ? (
              <RigheEditor
                magazzinoId={parseInt(origineId)}
                areaOperativaId={origineAreaId}
                righe={righe}
                setRighe={setRighe}
              />
            ) : (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
                {t("trasferimenti.selezionaPrimaMagazzino")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("trasferimenti.noteOpzionale")}</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("trasferimenti.notePlaceholder")}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            <Plus className="h-4 w-4" /> {t("trasferimenti.crea")}
          </Button>
        </div>
        <UnsavedChangesDialog guard={unsavedGuard} />
      </SheetContent>
    </Sheet>
  );
}

// ─── Form modifica trasferimento (note + righe, solo stati editabili) ────────

export function ModificaTrasferimentoForm({
  trasferimento,
  open,
  onClose,
  onDirtyChange,
}: {
  trasferimento: Trasferimento;
  open: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(trasferimento.note ?? "");
  const [righe, setRighe] = useState<RigaDraft[]>(
    (trasferimento.righe ?? []).map((r) => ({
      key: Math.random().toString(36).slice(2),
      prodottoId: String(r.prodottoId),
      lottoId: r.lottoId == null ? "" : String(r.lottoId),
      quantita: String(r.quantita),
      unitaMisura: r.unitaMisura,
    })),
  );

  const updateTrasferimento = useUpdateTrasferimento();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const commandIntents = useCommandIntentRegistry();
  const { data: magazzini } = useListMagazzini();
  const updateSlot = `trasferimento:${trasferimento.id}:update`;
  const initialDraft = {
    note: trasferimento.note ?? "",
    righe: (trasferimento.righe ?? []).map((riga) => ({
      prodottoId: String(riga.prodottoId),
      lottoId: riga.lottoId == null ? "" : String(riga.lottoId),
      quantita: String(riga.quantita),
      unitaMisura: riga.unitaMisura,
    })),
  };
  const isDirty = trasferimentoDraftIsDirty(initialDraft, {
    note,
    righe,
  });
  const unsavedGuard = useUnsavedChangesGuard(open && isDirty);

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  const requestClose = () => {
    if (updateTrasferimento.isPending) return;
    unsavedGuard.requestClose(() => {
      commandIntents.discard(updateSlot);
      onDirtyChange?.(false);
      onClose();
    });
  };

  const origineIdNum = trasferimento.magazzinoOrigineId;
  const origineAreaId =
    magazzini?.find((m) => m.id === origineIdNum)?.areaOperativaId ?? 0;
  const giacenzeParams = {
    areaOperativaId: origineAreaId,
    magazzinoId: origineIdNum,
  };
  const { data: origineGiacenze } = useListGiacenze(giacenzeParams, {
    query: {
      enabled: open && origineAreaId > 0,
      queryKey: getListGiacenzeQueryKey(giacenzeParams),
    },
  });
  const { data: prodotti } = useListProdotti();

  const righeValide = righe.filter(
    (r) => r.prodottoId && parseFloat(r.quantita || "0") > 0,
  );
  const hasEccesso = righeValide.some((r) => {
    const giac = origineGiacenze?.find(
      (g) => g.prodottoId === parseInt(r.prodottoId),
    );
    return parseFloat(r.quantita) > Math.max(0, giac?.disponibileReale ?? 0);
  });
  const canSubmit =
    origineAreaId > 0 &&
    righeValide.length > 0 &&
    !!prodotti &&
    transferRowsHaveRequiredLots(righeValide, prodotti) &&
    !hasEccesso &&
    !updateTrasferimento.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    const semanticInput = {
      note,
      righe: transferRowsForPayload(righeValide),
    };
    updateTrasferimento.mutate(
      {
        id: trasferimento.id,
        data: commandIntents.prepare(updateSlot, semanticInput, {
          ...semanticInput,
          versione: trasferimento.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(updateSlot);
          queryClient.invalidateQueries({
            queryKey: getListTrasferimentiQueryKey(),
          });
          toast({ title: t("trasferimenti.toastAggiornato") });
          onDirtyChange?.(false);
          onClose();
        },
        onError: (error) => {
          commandIntents.fail(updateSlot, error);
          toast({
            title: t("trasferimenti.errorTitle"),
            description: t("trasferimenti.errorUpdate"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("trasferimenti.modificaTitle")}</SheetTitle>
          <SheetDescription>
            {t("trasferimenti.modificaDescPrefix")}{" "}
            <span className="font-mono font-medium text-foreground">
              {trasferimento.codice}
            </span>
            . {t("trasferimenti.modificaDescSuffix")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="rounded-lg border p-3 text-sm flex items-center gap-2 bg-muted/40">
            <span className="font-medium">
              {trasferimento.magazzinoOrigineNome}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {trasferimento.magazzinoDestinoNome}
            </span>
          </div>

          <div className="space-y-2">
            <Label>{t("trasferimenti.prodottiDaTrasferire")}</Label>
            <RigheEditor
              magazzinoId={origineIdNum}
              areaOperativaId={origineAreaId}
              righe={righe}
              setRighe={setRighe}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("trasferimenti.noteOpzionale")}</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("trasferimenti.notePlaceholder")}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={requestClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            <Pencil className="h-4 w-4" /> {t("trasferimenti.salvaModifiche")}
          </Button>
        </div>
        <UnsavedChangesDialog guard={unsavedGuard} />
      </SheetContent>
    </Sheet>
  );
}

// ─── Trasportatore: display + riassegnazione ─────────────────────────────────

function trasportatoreLabel(
  t: Trasferimento,
  volontarioFallback = "Volontario",
): string | null {
  if (t.trasportatoreVolontarioId)
    return t.trasportatoreVolontarioNome ?? volontarioFallback;
  if (t.trasportatoreNome) return t.trasportatoreNome;
  return null;
}

function TrasportatoreCell({
  t: tras,
  canEdit,
}: {
  t: Trasferimento;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreAltro, setTrasportatoreAltro] = useState("");

  const { data: volontari } = useListVolontari();
  const updateTrasferimento = useUpdateTrasferimento();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const commandIntents = useCommandIntentRegistry();
  const updateTransporterSlot = `trasferimento:${tras.id}:update-transporter`;

  const label = trasportatoreLabel(tras, t("trasferimenti.volontario"));

  const openDialog = () => {
    if (tras.trasportatoreVolontarioId) {
      setTrasportatore(String(tras.trasportatoreVolontarioId));
      setTrasportatoreAltro("");
    } else if (tras.trasportatoreNome) {
      setTrasportatore("altro");
      setTrasportatoreAltro(tras.trasportatoreNome);
    } else {
      setTrasportatore("");
      setTrasportatoreAltro("");
    }
    setOpen(true);
  };

  const valido =
    (!!trasportatore && trasportatore !== "altro") ||
    (trasportatore === "altro" && trasportatoreAltro.trim().length > 0);

  const onSave = () => {
    if (!valido) return;
    const semanticInput = {
      trasportatoreVolontarioId:
        trasportatore && trasportatore !== "altro"
          ? parseInt(trasportatore)
          : null,
      trasportatoreNome:
        trasportatore === "altro" ? trasportatoreAltro.trim() : null,
    };
    updateTrasferimento.mutate(
      {
        id: tras.id,
        data: commandIntents.prepare(updateTransporterSlot, semanticInput, {
          ...semanticInput,
          versione: tras.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(updateTransporterSlot);
          queryClient.invalidateQueries({
            queryKey: getListTrasferimentiQueryKey(),
          });
          toast({ title: t("trasferimenti.toastTrasportatoreAggiornato") });
          setOpen(false);
        },
        onError: (error) => {
          commandIntents.fail(updateTransporterSlot, error);
          toast({
            title: t("trasferimenti.errorTitle"),
            description: t("trasferimenti.errorTrasportatore"),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1.5 text-sm">
        <Truck className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{label ?? "—"}</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="group flex min-h-11 items-center gap-1.5 text-left text-sm hover:text-foreground"
      >
        <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className={label ? "font-medium" : "text-muted-foreground"}>
          {label ?? "—"}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !updateTrasferimento.isPending) {
            commandIntents.discard(updateTransporterSlot);
            setOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("trasferimenti.riassegnaTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("trasferimenti.codiceLabel")}{" "}
              <span className="font-mono font-medium text-foreground">
                {tras.codice}
              </span>
            </p>
            <div className="space-y-2">
              <Label>{t("trasferimenti.trasportatore")}</Label>
              <Select
                value={trasportatore}
                onValueChange={(v) => {
                  setTrasportatore(v);
                  if (v !== "altro") setTrasportatoreAltro("");
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("trasferimenti.selectTrasportatore")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {volontari
                    ?.filter((v) => v.operativo)
                    .map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.nome} {v.cognome}
                      </SelectItem>
                    ))}
                  <SelectItem value="altro">
                    {t("trasferimenti.altro")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {trasportatore === "altro" && (
                <Input
                  value={trasportatoreAltro}
                  onChange={(e) => setTrasportatoreAltro(e.target.value)}
                  placeholder={t("trasferimenti.nomeTrasportatore")}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                commandIntents.discard(updateTransporterSlot);
                setOpen(false);
              }}
              disabled={updateTrasferimento.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={onSave}
              disabled={!valido || updateTrasferimento.isPending}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function Trasferimenti() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("magazzino.transfers.create");
  const canDispatch = hasPermission("magazzino.transfers.dispatch");
  const canReceive = hasPermission("magazzino.transfers.receive");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data: trasferimenti, isLoading } = useListTrasferimenti({
    page,
    limit: pageSize,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: impostazioni } = useGetImpostazioniStampa();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [created, setCreated] = useState<Trasferimento | null>(null);
  const [editing, setEditing] = useState<Trasferimento | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const avviaTrasferimento = useAvviaTrasferimento();
  const confermaTrasferimento = useConfermaTrasferimento();
  const commandIntents = useCommandIntentRegistry();

  const handleAction = (tr: Trasferimento) => {
    if (tr.stato === "richiesto" || tr.stato === "preparato") {
      const slot = `trasferimento:${tr.id}:start`;
      avviaTrasferimento.mutate(
        {
          id: tr.id,
          data: commandIntents.prepare(slot, {}, { versione: tr.versione }),
        },
        {
          onSuccess: () => {
            commandIntents.complete(slot);
            queryClient.invalidateQueries({
              queryKey: getListTrasferimentiQueryKey(),
            });
            toast({ title: t("trasferimenti.toastAvviato") });
          },
          onError: (error) => {
            commandIntents.fail(slot, error);
            toast({
              title: t("trasferimenti.errorTitle"),
              description: t("trasferimenti.errorUpdate"),
              variant: "destructive",
            });
          },
        },
      );
    } else if (tr.stato === "in_transito") {
      const slot = `trasferimento:${tr.id}:receive`;
      confermaTrasferimento.mutate(
        {
          id: tr.id,
          data: commandIntents.prepare(
            slot,
            {},
            {
              versione: tr.versione,
              dataConferma: new Date().toISOString(),
            },
          ),
        },
        {
          onSuccess: () => {
            commandIntents.complete(slot);
            queryClient.invalidateQueries({
              queryKey: getListTrasferimentiQueryKey(),
            });
            toast({ title: t("trasferimenti.toastRicezioneConfermata") });
          },
          onError: (error) => {
            commandIntents.fail(slot, error);
            toast({
              title: t("trasferimenti.errorTitle"),
              description: t("trasferimenti.errorUpdate"),
              variant: "destructive",
            });
          },
        },
      );
    }
  };

  const downloadBolla = async (tr: Trasferimento) => {
    setDownloadingId(tr.id);
    try {
      const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
      await generateTrasferimentoPdf({
        trasferimento: tr,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl: logoDataUrl,
        branding,
      });
    } catch {
      toast({
        title: t("trasferimenti.errorTitle"),
        description: t("trasferimenti.errorBolla"),
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCreated = (tr: Trasferimento) => {
    queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
    setCreated(tr);
  };

  const getStatusBadge = (stato: string) => {
    switch (stato) {
      case "richiesto":
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-800">
            {t("trasferimenti.statusRichiesto")}
          </Badge>
        );
      case "preparato":
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            {t("trasferimenti.statusPreparato")}
          </Badge>
        );
      case "in_transito":
        return (
          <Badge
            variant="outline"
            className="bg-amber-500 text-white border-amber-600 shadow-sm animate-pulse"
          >
            {t("trasferimenti.statusInTransito")}
          </Badge>
        );
      case "completato":
        return (
          <Badge
            variant="outline"
            className="bg-green-500/10 text-green-700 border-none"
          >
            {t("trasferimenti.statusCompletato")}
          </Badge>
        );
      case "annullato":
        return (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200"
          >
            {t("trasferimenti.statusAnnullato")}
          </Badge>
        );
      default:
        return <Badge>{stato}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("trasferimenti.title")}
          </h1>
          <p className="text-muted-foreground">{t("trasferimenti.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={trasferimenti ?? []}
            loadRows={() =>
              loadAllPages((exportPage, limit) =>
                listTrasferimenti({ page: exportPage, limit }),
              )
            }
            columns={[
              { header: t("common.code"), accessor: (tr) => tr.codice },
              {
                header: t("trasferimenti.colDataRichiesta"),
                accessor: (tr) =>
                  tr.dataRichiesta
                    ? new Date(tr.dataRichiesta).toLocaleDateString("it-IT")
                    : "",
              },
              {
                header: t("trasferimenti.colOrigine"),
                accessor: (tr) => tr.magazzinoOrigineNome,
              },
              {
                header: t("trasferimenti.colDestinazione"),
                accessor: (tr) => tr.magazzinoDestinoNome,
              },
              {
                header: t("trasferimenti.colTrasportatore"),
                accessor: (tr) =>
                  trasportatoreLabel(tr, t("trasferimenti.volontario")) ?? "—",
              },
              {
                header: t("trasferimenti.colArticoli"),
                accessor: (tr) => tr.righe?.length ?? 0,
              },
              {
                header: t("common.status"),
                accessor: (tr) => tr.stato?.replace("_", " "),
              },
            ]}
            filename="trasferimenti"
            title={t("trasferimenti.exportTitle")}
            orientation="landscape"
          />
          {canCreate && (
            <Button onClick={() => setIsFormOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> {t("common.new")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("trasferimenti.colPercorso")}</TableHead>
                <TableHead>{t("trasferimenti.colTrasportatore")}</TableHead>
                <TableHead>{t("common.details")}</TableHead>
                <TableHead className="text-center">
                  {t("common.status")}
                </TableHead>
                <TableHead className="text-right w-[320px]">
                  {t("trasferimenti.colAzione")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-28" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-6 w-24 mx-auto rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-24 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
              ) : trasferimenti?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-muted-foreground"
                  >
                    {t("trasferimenti.emptyState")}
                  </TableCell>
                </TableRow>
              ) : (
                trasferimenti?.map((tr) => (
                  <TableRow key={tr.id}>
                    <TableCell className="font-mono text-sm font-medium">
                      {tr.codice}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(tr.dataRichiesta), "dd MMM yyyy", {
                        locale: it,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{tr.magazzinoOrigineNome}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span>{tr.magazzinoDestinoNome}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TrasportatoreCell t={tr} canEdit={canCreate} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t("trasferimenti.articoliCount", {
                        count: tr.righe?.length || 0,
                      })}
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(tr.stato)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => downloadBolla(tr)}
                          disabled={downloadingId === tr.id}
                        >
                          <Download className="h-3.5 w-3.5" />{" "}
                          {t("trasferimenti.bolla")}
                        </Button>
                        {(tr.stato === "richiesto" ||
                          tr.stato === "preparato") &&
                          (canCreate || canDispatch) && (
                            <>
                              {canCreate && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => setEditing(tr)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />{" "}
                                  {t("common.edit")}
                                </Button>
                              )}
                              {canDispatch && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                                  onClick={() => handleAction(tr)}
                                  disabled={avviaTrasferimento.isPending}
                                >
                                  <Play className="h-3.5 w-3.5" />{" "}
                                  {t("trasferimenti.avvia")}
                                </Button>
                              )}
                            </>
                          )}
                        {tr.stato === "in_transito" && canReceive && (
                          <Button
                            size="sm"
                            className="gap-1 bg-green-600 hover:bg-green-700"
                            onClick={() => handleAction(tr)}
                            disabled={confermaTrasferimento.isPending}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                            {t("trasferimenti.confermaRic")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1 || isLoading}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          Precedente
        </Button>
        <span className="text-sm text-muted-foreground">Pagina {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || (trasferimenti?.length ?? 0) < pageSize}
          onClick={() => setPage((value) => value + 1)}
        >
          Successiva
        </Button>
      </div>

      <NuovoTrasferimentoForm
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onCreated={handleCreated}
      />

      {editing && (
        <ModificaTrasferimentoForm
          key={editing.id}
          trasferimento={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Conferma creazione + download bolla */}
      <Dialog
        open={!!created}
        onOpenChange={(o) => {
          if (!o) setCreated(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />{" "}
              {t("trasferimenti.bollaCreata")}
            </DialogTitle>
          </DialogHeader>
          {created && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                {t("trasferimenti.codiceLabel")}{" "}
                <span className="font-mono font-medium text-foreground">
                  {created.codice}
                </span>{" "}
                {t("trasferimenti.createdSuffix")}
              </p>
              <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
                <span className="font-medium">
                  {created.magazzinoOrigineNome}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">
                  {created.magazzinoDestinoNome}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {t("trasferimenti.articoliCount", {
                    count: created.righe?.length || 0,
                  })}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>
              {t("common.close")}
            </Button>
            <Button
              className="gap-2"
              disabled={!created || downloadingId === created.id}
              onClick={() => created && downloadBolla(created)}
            >
              <Download className="h-4 w-4" /> {t("trasferimenti.scaricaBolla")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
