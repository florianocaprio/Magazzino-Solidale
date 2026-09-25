import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  analyzeFsePracticeImport,
  getGetFseImportSessionQueryKey,
  getListFseImportSourcesQueryKey,
  getListFseImportSessionsQueryKey,
  useAddFseImportToPractice,
  useCreateFseImportSource,
  useCreateProdotto,
  useGetFseImportSession,
  useListFseImportSessions,
  useListFseImportSources,
  useMapFseImportProduct,
  useReviseFseImportRow,
  type CaricoPraticaDettaglio,
  type FseImportMode,
  type FseImportRow,
  type Prodotto,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { newCommandKey } from "@/lib/carico-merce";
import {
  reconcileFseReadySelection,
  resolveFseAttachIntent,
  retainFseAttachIntentAfterError,
  type FseAttachIntent,
} from "@/lib/fse-import-attach-intent";
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
} from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practice: CaricoPraticaDettaglio;
  products: Prodotto[];
  onPracticeReady: (practiceId: number) => void;
};

type NewProduct = {
  name: string;
  unit: "pz" | "kg" | "l";
  barcode: string;
  fractional: boolean;
  physicalLot: boolean;
  expiry: boolean;
};

type CorrectionDraft = {
  quantity: string;
  documentNumber: string;
  documentDate: string;
  operationalDate: string;
  physicalLot: string;
  expiryDate: string;
  factor: string;
  disambiguator: string;
  reason: string;
  acceptDateFallback: boolean;
};

function correctionFromRow(row: FseImportRow): CorrectionDraft {
  return {
    quantity: row.quantitaOperativa ?? "",
    documentNumber: row.numeroDocumento ?? "",
    documentDate: row.dataDocumento ?? "",
    operationalDate: row.dataOperativaProposta ?? "",
    physicalLot: row.lottoFisico ?? "",
    expiryDate: row.dataScadenza ?? "",
    factor: row.fattoreKgLtPezzo ?? "",
    disambiguator: row.disambiguatore ?? "",
    reason: "",
    acceptDateFallback: false,
  };
}

const emptyProduct: NewProduct = {
  name: "",
  unit: "pz",
  barcode: "",
  fractional: false,
  physicalLot: false,
  expiry: false,
};

export function FseImportPracticeWizard({
  open,
  onOpenChange,
  practice,
  products,
  onPracticeReady,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const queryClient = useQueryClient();
  const canManageProducts = hasPermission("magazzino.products.manage");
  const canManageMappings = hasPermission("magazzino.agea.mapping.manage");
  const canCreateSource =
    canManageMappings && Boolean(user?.isAdmin || user?.isSuperAdmin);
  const canBootstrap = hasPermission("magazzino.agea.bootstrap");
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<FseImportMode>("NUOVI_CARICHI");
  const [sourceId, setSourceId] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [registryFile, setRegistryFile] = useState<File | null>(null);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [referenceDate, setReferenceDate] = useState("");
  const [historicalCoverageConfirmed, setHistoricalCoverageConfirmed] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [mappingProduct, setMappingProduct] = useState<Record<string, string>>(
    {},
  );
  const [newSourceCode, setNewSourceCode] = useState("");
  const [newSourceDescription, setNewSourceDescription] = useState("");
  const [newProduct, setNewProduct] = useState<NewProduct>(emptyProduct);
  const [newProductFor, setNewProductFor] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const selectedSession = useRef<number | null>(null);
  const attachIntent = useRef<FseAttachIntent | null>(null);

  const sourcesQuery = useListFseImportSources({
    query: { enabled: open, queryKey: getListFseImportSourcesQueryKey() },
  });
  const sessionsQuery = useListFseImportSessions(
    { magazzinoId: practice.magazzinoId },
    {
      query: {
        enabled: open,
        queryKey: getListFseImportSessionsQueryKey({
          magazzinoId: practice.magazzinoId,
        }),
      },
    },
  );
  const detailQuery = useGetFseImportSession(sessionId ?? 0, {
    query: {
      enabled: open && sessionId != null,
      queryKey: getGetFseImportSessionQueryKey(sessionId ?? 0),
    },
  });
  const createSource = useCreateFseImportSource();
  const mapProduct = useMapFseImportProduct();
  const addToPractice = useAddFseImportToPractice();
  const createProduct = useCreateProdotto();
  const reviseRow = useReviseFseImportRow();
  const detail = detailQuery.data;
  const pending =
    busy ||
    createSource.isPending ||
    mapProduct.isPending ||
    addToPractice.isPending ||
    createProduct.isPending ||
    reviseRow.isPending;
  useEffect(() => {
    if (!detail) return;
    setMode(detail.modalita);
    setSourceId(String(detail.sourceRegistryId));
    const initialize = selectedSession.current !== detail.id;
    setSelectedRows((current) =>
      reconcileFseReadySelection(
        current,
        detail.rows
          .filter((row) => row.stato === "PRONTO")
          .map((row) => row.id),
        initialize,
      ),
    );
    selectedSession.current = detail.id;
  }, [detail]);

  useEffect(() => {
    if (!sourceId && sourcesQuery.data?.length === 1)
      setSourceId(String(sourcesQuery.data[0].id));
  }, [sourceId, sourcesQuery.data]);

  const descriptionsToMap = useMemo(
    () => [
      ...new Set([
        ...(detail?.rows ?? [])
          .filter((row) => row.stato === "DA_ASSOCIARE")
          .map((row) => row.prodottoEsterno),
        ...(detail?.stockRows ?? [])
          .filter((row) => row.stato === "DA_ASSOCIARE")
          .map((row) => row.prodottoEsterno),
      ]),
    ],
    [detail],
  );

  const showError = (error: unknown) =>
    toast({
      title: t("caricoPratiche.fseError"),
      description: errorMessage(error, t("caricoPratiche.error")),
      variant: "destructive",
    });

  const upload = async () => {
    if (!registryFile || !sourceId) return;
    if (mode === "SALDO_INIZIALE" && (!stockFile || !referenceDate)) return;
    setBusy(true);
    try {
      const base = {
        sourceRegistryId: Number(sourceId),
        areaOperativaId: practice.areaOperativaId,
        magazzinoId: practice.magazzinoId,
        lottoLogicoId: practice.lottoLogicoId,
        caricoPraticaId: practice.id,
        modalita: mode,
      } as const;
      const registry = await analyzeFsePracticeImport(registryFile, {
        ...base,
        profilo: "REGISTRO",
        nomeFile: registryFile.name,
      });
      let acquiredSessionId = registry.sessionId;
      if (stockFile) {
        const stock = await analyzeFsePracticeImport(stockFile, {
          ...base,
          caricoPraticaId: practice.id,
          sessionId: acquiredSessionId,
          profilo: "GIACENZE",
          nomeFile: stockFile.name,
          dataRiferimento: referenceDate || undefined,
        });
        acquiredSessionId = stock.sessionId;
      }
      setSessionId(acquiredSessionId);
      setStep(1);
      await queryClient.invalidateQueries({
        queryKey: ["/api/fse-importazioni/sessioni"],
      });
      toast({ title: t("caricoPratiche.fseAnalyzed") });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const saveSource = async () => {
    try {
      const created = await createSource.mutateAsync({
        data: {
          codice: newSourceCode.trim(),
          descrizione: newSourceDescription.trim(),
          areaOperativaId: practice.areaOperativaId,
        },
      });
      setSourceId(String(created.id));
      setNewSourceCode("");
      setNewSourceDescription("");
      await sourcesQuery.refetch();
    } catch (error) {
      showError(error);
    }
  };

  const confirmMapping = async (
    externalDescription: string,
    productId?: number,
  ) => {
    if (!detail || (!productId && !mappingProduct[externalDescription])) return;
    try {
      await mapProduct.mutateAsync({
        id: detail.id,
        data: {
          versione: detail.versione,
          descrizioneEsterna: externalDescription,
          prodottoId: productId ?? Number(mappingProduct[externalDescription]),
          motivo: t("caricoPratiche.fseMappingReason"),
          accettaFallbackData: false,
        },
      });
      await detailQuery.refetch();
      attachIntent.current = null;
    } catch (error) {
      showError(error);
    }
  };

  const createAndMapProduct = async () => {
    if (!newProductFor || !newProduct.name.trim()) return;
    try {
      const created = await createProduct.mutateAsync({
        data: {
          nome: newProduct.name.trim(),
          tipoProdotto: "alimentare",
          unitaMisura: newProduct.unit,
          codiceBarre: newProduct.barcode.trim() || undefined,
          quantitaFrazionabile: newProduct.fractional,
          lottoFisicoObbligatorio: newProduct.physicalLot,
          gestioneScadenza: newProduct.expiry,
          fsePlus: true,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/prodotti"] });
      await confirmMapping(newProductFor, created.id);
      setNewProductFor(null);
      setNewProduct(emptyProduct);
    } catch (error) {
      showError(error);
    }
  };

  const saveCorrection = async () => {
    if (!detail || editingRowId == null || !correction?.reason.trim()) return;
    try {
      await reviseRow.mutateAsync({
        id: detail.id,
        rigaId: editingRowId,
        data: {
          versione: detail.versione,
          quantita: correction.quantity || undefined,
          numeroDocumento: correction.documentNumber || null,
          dataDocumento: correction.documentDate || null,
          dataOperativa: correction.operationalDate || null,
          lottoFisico: correction.physicalLot || null,
          dataScadenza: correction.expiryDate || null,
          fattoreKgLtPezzo: correction.factor || null,
          disambiguatore: correction.disambiguator || null,
          accettaFallbackData: correction.acceptDateFallback,
          motivo: correction.reason.trim(),
        },
      });
      setEditingRowId(null);
      setCorrection(null);
      await detailQuery.refetch();
      attachIntent.current = null;
    } catch (error) {
      showError(error);
    }
  };

  const attach = async () => {
    if (!detail) return;
    const intent = resolveFseAttachIntent(
      attachIntent.current,
      {
        sessionId: detail.id,
        practiceId: practice.id,
        mode: detail.modalita,
        sessionVersion: detail.versione,
        practiceVersion: practice.versione,
        rowIds:
          detail.modalita === "NUOVI_CARICHI" ? [...selectedRows] : undefined,
        historicalCoverageConfirmed:
          detail.modalita === "SALDO_INIZIALE"
            ? historicalCoverageConfirmed
            : false,
      },
      () => newCommandKey(),
    );
    attachIntent.current = intent;
    try {
      const result = await addToPractice.mutateAsync({
        id: intent.sessionId,
        data: intent.payload,
      });
      attachIntent.current = null;
      toast({
        title: t("caricoPratiche.fseAdded", {
          count: result.addedRows ?? 0,
        }),
        description: t("caricoPratiche.fseNoStockChange"),
      });
      onOpenChange(false);
      onPracticeReady(result.practiceId);
    } catch (error) {
      if (!retainFseAttachIntentAfterError(error)) attachIntent.current = null;
      showError(error);
    }
  };

  const reset = () => {
    setStep(0);
    setSessionId(null);
    setRegistryFile(null);
    setStockFile(null);
    setReferenceDate("");
    setHistoricalCoverageConfirmed(false);
    setSelectedRows(new Set());
    selectedSession.current = null;
    attachIntent.current = null;
    setNewProductFor(null);
    setEditingRowId(null);
    setCorrection(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("caricoPratiche.fseImport")}</DialogTitle>
          <DialogDescription>
            {t("caricoPratiche.fseSteps", { step: step + 1 })}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          {step === 0 && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("caricoPratiche.fseMode")}</Label>
                  <Select
                    value={mode}
                    onValueChange={(value) => setMode(value as FseImportMode)}
                  >
                    <SelectTrigger aria-label={t("caricoPratiche.fseMode")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NUOVI_CARICHI">
                        {t("caricoPratiche.fseNewLoads")}
                      </SelectItem>
                      {canBootstrap && (
                        <SelectItem value="SALDO_INIZIALE">
                          {t("caricoPratiche.fseInitialBalance")}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("caricoPratiche.fseSource")}</Label>
                  <Select value={sourceId} onValueChange={setSourceId}>
                    <SelectTrigger aria-label={t("caricoPratiche.fseSource")}>
                      <SelectValue
                        placeholder={t("caricoPratiche.fseSelectSource")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {sourcesQuery.data?.map((source) => (
                        <SelectItem key={source.id} value={String(source.id)}>
                          {source.descrizione}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {canCreateSource && (sourcesQuery.data?.length ?? 0) === 0 && (
                <div className="grid gap-2 rounded-md border p-3 md:grid-cols-3">
                  <Input
                    value={newSourceCode}
                    onChange={(event) => setNewSourceCode(event.target.value)}
                    placeholder={t("caricoPratiche.fseSourceCode")}
                  />
                  <Input
                    value={newSourceDescription}
                    onChange={(event) =>
                      setNewSourceDescription(event.target.value)
                    }
                    placeholder={t("caricoPratiche.fseSourceDescription")}
                  />
                  <Button
                    variant="outline"
                    disabled={
                      !newSourceCode.trim() ||
                      !newSourceDescription.trim() ||
                      pending
                    }
                    onClick={() => void saveSource()}
                  >
                    {t("caricoPratiche.fseCreateSource")}
                  </Button>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fse-registry-file">
                    {t("caricoPratiche.fseRegistryFile")}
                  </Label>
                  <Input
                    id="fse-registry-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) =>
                      setRegistryFile(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fse-stock-file">
                    {t("caricoPratiche.fseStockFile", {
                      required: mode === "SALDO_INIZIALE" ? "*" : "",
                    })}
                  </Label>
                  <Input
                    id="fse-stock-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) =>
                      setStockFile(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
              </div>
              {(mode === "SALDO_INIZIALE" || stockFile) && (
                <div className="max-w-xs space-y-2">
                  <Label>{t("caricoPratiche.fseReferenceDate")}</Label>
                  <Input
                    type="date"
                    value={referenceDate}
                    onChange={(event) => setReferenceDate(event.target.value)}
                    aria-label={t("caricoPratiche.fseReferenceDate")}
                  />
                </div>
              )}
              {mode === "SALDO_INIZIALE" && (
                <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                  <Checkbox
                    checked={historicalCoverageConfirmed}
                    onCheckedChange={(checked) =>
                      setHistoricalCoverageConfirmed(checked === true)
                    }
                  />
                  <span>
                    {t("caricoPratiche.fseHistoricalCoverageConfirmation")}
                  </span>
                </label>
              )}
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {t("caricoPratiche.fseNoStockChange")}
              </div>
              {(sessionsQuery.data?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <Label>{t("caricoPratiche.fseResume")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {sessionsQuery.data
                      ?.filter(
                        (session) =>
                          !["REGISTRATA", "ANNULLATA"].includes(
                            session.stato,
                          ) &&
                          (session.caricoPraticaId == null ||
                            session.caricoPraticaId === practice.id),
                      )
                      .slice(0, 5)
                      .map((session) => (
                        <Button
                          key={session.id}
                          variant="outline"
                          onClick={() => {
                            setSessionId(session.id);
                            setStep(1);
                          }}
                        >
                          #{session.id} · {session.stato}
                        </Button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                {[
                  ["fseReady", detail.summary.ready],
                  ["fseNeedsMapping", detail.summary.needsMapping],
                  ["fseNeedsReview", detail.summary.needsReview],
                  ["fseErrors", detail.summary.errors],
                  ["fseKnown", detail.summary.known],
                  ["fseReferenceOnly", detail.summary.referenceOnly],
                ].map(([key, count]) => (
                  <div
                    key={String(key)}
                    className="rounded-md border p-3 text-center"
                  >
                    <strong>{count}</strong>
                    <div className="text-xs text-muted-foreground">
                      {t(`caricoPratiche.${key}`)}
                    </div>
                  </div>
                ))}
              </div>

              {descriptionsToMap.map((description) => (
                <div
                  key={description}
                  className="space-y-3 rounded-md border p-3"
                >
                  <div>
                    <Badge variant="outline">
                      {t("caricoPratiche.fseNeedsMapping")}
                    </Badge>
                    <p className="mt-1 font-medium">{description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select
                      value={mappingProduct[description] ?? ""}
                      onValueChange={(value) =>
                        setMappingProduct((current) => ({
                          ...current,
                          [description]: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        className="min-w-64 flex-1"
                        aria-label={`${t("caricoPratiche.fseSelectProduct")}: ${description}`}
                      >
                        <SelectValue
                          placeholder={t("caricoPratiche.fseSelectProduct")}
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(18rem,var(--radix-select-content-available-height))]">
                        {products
                          .filter((product) => product.attivo)
                          .map((product) => (
                            <SelectItem
                              key={product.id}
                              value={String(product.id)}
                            >
                              {product.codice} — {product.nome}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!mappingProduct[description] || pending}
                      onClick={() => void confirmMapping(description)}
                    >
                      {t("caricoPratiche.fseAssociate")}
                    </Button>
                    {canManageProducts && (
                      <Button
                        variant="outline"
                        onClick={() => setNewProductFor(description)}
                      >
                        <PackagePlus className="mr-2 h-4 w-4" />
                        {t("caricoPratiche.fseCreateProduct")}
                      </Button>
                    )}
                  </div>
                  {newProductFor === description && (
                    <div className="grid gap-2 rounded bg-muted/40 p-3 md:grid-cols-3">
                      <Input
                        value={newProduct.name}
                        onChange={(event) =>
                          setNewProduct((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder={t("caricoPratiche.fseProductName")}
                      />
                      <Select
                        value={newProduct.unit}
                        onValueChange={(value) =>
                          setNewProduct((current) => ({
                            ...current,
                            unit: value as NewProduct["unit"],
                            fractional: value !== "pz",
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pz">pz</SelectItem>
                          <SelectItem value="kg">kg</SelectItem>
                          <SelectItem value="l">l</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Input
                          value={newProduct.barcode}
                          onChange={(event) =>
                            setNewProduct((current) => ({
                              ...current,
                              barcode: event.target.value,
                            }))
                          }
                          placeholder={t("caricoPratiche.fseBarcodeOptional")}
                        />
                        <BarcodeScannerButton
                          onScan={(barcode) =>
                            setNewProduct((current) => ({
                              ...current,
                              barcode,
                            }))
                          }
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={newProduct.physicalLot}
                          onCheckedChange={(checked) =>
                            setNewProduct((current) => ({
                              ...current,
                              physicalLot: checked === true,
                            }))
                          }
                        />
                        {t("caricoPratiche.fsePhysicalLotRequired")}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={newProduct.expiry}
                          onCheckedChange={(checked) =>
                            setNewProduct((current) => ({
                              ...current,
                              expiry: checked === true,
                            }))
                          }
                        />
                        {t("caricoPratiche.fseExpiryManaged")}
                      </label>
                      <Button
                        disabled={!newProduct.name.trim() || pending}
                        onClick={() => void createAndMapProduct()}
                      >
                        {t("caricoPratiche.fseCreateAndAssociate")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              <div className="space-y-2">
                {(detail.modalita === "NUOVI_CARICHI"
                  ? detail.rows
                  : detail.stockRows
                ).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    {detail.modalita === "NUOVI_CARICHI" && (
                      <Checkbox
                        checked={selectedRows.has(row.id)}
                        disabled={row.stato !== "PRONTO"}
                        onCheckedChange={(checked) =>
                          setSelectedRows((current) => {
                            attachIntent.current = null;
                            const next = new Set(current);
                            if (checked) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{row.prodottoEsterno}</strong>
                        <Badge
                          variant={
                            row.stato === "PRONTO" ? "default" : "outline"
                          }
                        >
                          {t(`caricoPratiche.fseState${row.stato}`)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.fondoOrigine ?? "—"} · {row.lottoFisico ?? "—"} ·{" "}
                        {row.quantitaOperativa ?? "—"}
                      </p>
                      {row.errorCodes.length > 0 && (
                        <p className="text-xs text-destructive">
                          {row.errorCodes.join(", ")}
                        </p>
                      )}
                      {"warningCodes" in row && row.warningCodes.length > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {row.warningCodes.join(", ")}
                        </p>
                      )}
                      {detail.modalita === "NUOVI_CARICHI" &&
                        "tipoMovimento" in row &&
                        row.prodottoId != null &&
                        ["ERRORE", "DA_VERIFICARE", "DATO_MODIFICATO"].includes(
                          row.stato,
                        ) && (
                          <Button
                            className="mt-2"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingRowId(row.id);
                              setCorrection(correctionFromRow(row));
                            }}
                          >
                            {t("caricoPratiche.fseCorrect")}
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>

              {editingRowId != null && correction && (
                <div className="grid gap-3 rounded-md border p-4 md:grid-cols-3">
                  <Input
                    value={correction.quantity}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        quantity: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionQuantity")}
                  />
                  <Input
                    value={correction.documentNumber}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        documentNumber: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionDocument")}
                  />
                  <Input
                    type="date"
                    value={correction.documentDate}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        documentDate: event.target.value,
                      })
                    }
                    aria-label={t("caricoPratiche.fseCorrectionDocumentDate")}
                  />
                  <Input
                    type="date"
                    value={correction.operationalDate}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        operationalDate: event.target.value,
                      })
                    }
                    aria-label={t(
                      "caricoPratiche.fseCorrectionOperationalDate",
                    )}
                  />
                  <Input
                    value={correction.physicalLot}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        physicalLot: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionLot")}
                  />
                  <Input
                    type="date"
                    value={correction.expiryDate}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        expiryDate: event.target.value,
                      })
                    }
                    aria-label={t("caricoPratiche.fseCorrectionExpiry")}
                  />
                  <Input
                    value={correction.factor}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        factor: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionFactor")}
                  />
                  <Input
                    value={correction.disambiguator}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        disambiguator: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionDisambiguator")}
                  />
                  <Input
                    value={correction.reason}
                    onChange={(event) =>
                      setCorrection({
                        ...correction,
                        reason: event.target.value,
                      })
                    }
                    placeholder={t("caricoPratiche.fseCorrectionReason")}
                  />
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <Checkbox
                      checked={correction.acceptDateFallback}
                      onCheckedChange={(checked) =>
                        setCorrection({
                          ...correction,
                          acceptDateFallback: checked === true,
                        })
                      }
                    />
                    {t("caricoPratiche.fseAcceptDateFallback")}
                  </label>
                  <div className="flex gap-2">
                    <Button
                      disabled={!correction.reason.trim() || pending}
                      onClick={() => void saveCorrection()}
                    >
                      {t("caricoPratiche.fseSaveCorrection")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingRowId(null);
                        setCorrection(null);
                      }}
                    >
                      {t("barcodeScanner.cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && detail && (
            <div className="space-y-4 text-center">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-primary" />
              <h3 className="text-lg font-semibold">
                {t("caricoPratiche.fseSummaryTitle")}
              </h3>
              <p>
                {detail.modalita === "NUOVI_CARICHI"
                  ? t("caricoPratiche.fseRowsWillBeAdded", {
                      count: selectedRows.size,
                    })
                  : t("caricoPratiche.fseBalanceWillBeAdded", {
                      count: detail.stockRows.length,
                      pieces: detail.summary.stockPieces,
                    })}
              </p>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {t("caricoPratiche.fseNoStockChange")}
              </p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              disabled={pending}
            >
              {t("caricoPratiche.fseBack")}
            </Button>
          )}
          {step === 0 && (
            <Button
              onClick={() => void upload()}
              disabled={
                pending ||
                !sourceId ||
                !registryFile ||
                (mode === "SALDO_INIZIALE" && (!stockFile || !referenceDate))
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("caricoPratiche.fseAnalyze")}
            </Button>
          )}
          {step === 1 && (
            <Button
              onClick={() => setStep(2)}
              disabled={
                pending ||
                !(
                  detail?.stato === "PRONTA" ||
                  (detail?.modalita === "NUOVI_CARICHI" &&
                    ["DA_COMPLETARE", "IN_PRATICA"].includes(detail?.stato))
                ) ||
                (detail.modalita === "NUOVI_CARICHI" &&
                  selectedRows.size === 0) ||
                (detail.modalita === "SALDO_INIZIALE" &&
                  !historicalCoverageConfirmed)
              }
            >
              {t("caricoPratiche.fseReviewSummary")}
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => void attach()} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("caricoPratiche.fseAddToPractice")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
