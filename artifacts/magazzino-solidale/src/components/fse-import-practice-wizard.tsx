import { registerBlocco07 } from "@/lib/i18n/namespaces/blocco07";
import i18n from "@/lib/i18n";
registerBlocco07(i18n);
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  analyzeFsePracticeImport,
  getFseImportSession,
  useReviseFseReferenceDate,
  getGetFseImportSessionQueryKey,
  getListFseImportSourcesQueryKey,
  getListFseImportSessionsQueryKey,
  getListProdottiQueryKey,
  useAddFseImportToPractice,
  resolveAutomaticFseImportSource,
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
import { suggestFseProducts } from "@/lib/fse-product-suggestions";
import { suggestFseUnit, type FseUnit } from "@/lib/fse-unit-suggestion";
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
  initialSessionId?: number | null;
  onResumePractice?: (practiceId: number, sessionId: number) => void;
};

type NewProduct = {
  name: string;
  unit: FseUnit | "";
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
    quantity:
      row.quantitaOperativa ??
      (row.prodotto?.unitaMisura === "pz"
        ? row.quantitaPezzi
        : row.quantitaKgLt) ??
      "",
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
  unit: "",
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
  initialSessionId,
  onResumePractice,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (open)
      void queryClient.invalidateQueries({
        queryKey: getListProdottiQueryKey(),
      });
  }, [open, queryClient]);
  const canManageProducts = hasPermission("magazzino.products.manage");
  const canManageMappings = hasPermission("magazzino.agea.mapping.manage");
  const canBootstrap = hasPermission("magazzino.agea.bootstrap");
  const [step, setStep] = useState(0);
  const [otherPractice, setOtherPractice] = useState<{
    practiceId: number;
    sessionId: number;
  } | null>(null);
  const [remapping, setRemapping] = useState<string | null>(null);
  const [dateReason, setDateReason] = useState("");
  const mappingPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (remapping) mappingPanel.current?.scrollIntoView?.({ block: "nearest" });
  }, [remapping]);
  useEffect(() => {
    if (open && initialSessionId) {
      setSessionId(initialSessionId);
      setStep(1);
    }
  }, [open, initialSessionId]);
  const [inlineError, setInlineError] = useState("");
  const [addedPracticeId, setAddedPracticeId] = useState<number | null>(null);
  const acquiredRegistry = useRef<{
    file: File;
    context: string;
    sessionId: number;
  } | null>(null);
  const registryInput = useRef<HTMLInputElement>(null),
    stockInput = useRef<HTMLInputElement>(null);
  const createdProducts = useRef<Record<string, number>>({});
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
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      queryKey: getGetFseImportSessionQueryKey(sessionId ?? 0),
    },
  });
  const areaSources = useMemo(
    () =>
      (sourcesQuery.data ?? []).filter(
        (source) => source.areaOperativaId === practice.areaOperativaId,
      ),
    [sourcesQuery.data, practice.areaOperativaId],
  );
  const mapProduct = useMapFseImportProduct();
  const addToPractice = useAddFseImportToPractice();
  const createProduct = useCreateProdotto();
  const reviseRow = useReviseFseImportRow();
  const reviseDate = useReviseFseReferenceDate();
  const detail = detailQuery.data;
  const registryAcquired = detail?.files?.find(
    (file) => file.profilo === "REGISTRO",
  );
  const stockAcquired = detail?.files?.find(
    (file) => file.profilo === "GIACENZE",
  );
  const pending =
    busy ||
    mapProduct.isPending ||
    addToPractice.isPending ||
    createProduct.isPending ||
    reviseRow.isPending ||
    reviseDate.isPending;
  const editingRow = detail?.rows.find((row) => row.id === editingRowId);
  const fileWeightUnit = (description: string) => {
    if (!detail) return "kg/l";
    const proposal = suggestFseUnit(description, detail.stockRows, detail.rows);
    return proposal.source === "file" ? proposal.unit : "kg/l";
  };
  const editingUnit = editingRow?.prodotto?.unitaMisura;
  const editingFileQuantity =
    editingUnit === "pz"
      ? editingRow?.quantitaPezzi
      : ["kg", "l", "lt"].includes(editingUnit ?? "")
        ? editingRow?.quantitaKgLt
        : null;
  const unitProposal =
    detail && newProductFor
      ? suggestFseUnit(newProductFor, detail.stockRows, detail.rows)
      : null;
  const editingUnitProposal =
    detail && editingRow
      ? suggestFseUnit(
          editingRow.prodottoEsterno,
          detail.stockRows,
          detail.rows,
        )
      : null;
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
    if (initialize) {
      if (!busy)
        setReferenceDate(
          detail.dataRiferimentoSaldo ??
            detail.files?.find((file) => file.profilo === "GIACENZE")
              ?.dataRiferimento ??
            detail.files?.find((file) => file.profilo === "REGISTRO")
              ?.dataRiferimento ??
            "",
        );
      if (
        detail.modalita === "SALDO_INIZIALE" &&
        !detail.files?.some((file) => file.profilo === "GIACENZE")
      )
        setStep(0);
    }
    selectedSession.current = detail.id;
  }, [detail, busy]);

  useEffect(() => {
    if (!sourceId && areaSources.length === 1)
      setSourceId(String(areaSources[0].id));
  }, [sourceId, areaSources]);

  const descriptionsToMap = useMemo(
    () => [
      ...new Set([
        ...(remapping ? [remapping] : []),
        ...(detail?.rows ?? [])
          .filter((row) => row.stato === "DA_ASSOCIARE")
          .map((row) => row.prodottoEsterno),
        ...(detail?.stockRows ?? [])
          .filter((row) => row.stato === "DA_ASSOCIARE")
          .map((row) => row.prodottoEsterno),
      ]),
    ],
    [detail, remapping],
  );

  const showError = (error: unknown) => {
    setInlineError(errorMessage(error, t("caricoPratiche.error")));
    toast({
      title: t("caricoPratiche.fseError"),
      description: errorMessage(error, t("caricoPratiche.error")),
      variant: "destructive",
    });
  };

  const disabledReason = otherPractice
    ? t("blocco07.resumeOtherHelp")
    : sourcesQuery.isLoading || sourcesQuery.isError
      ? t("blocco07.sourceLoading")
      : !sourceId && areaSources.length > 1
        ? t("blocco07.missingSource")
        : !registryFile && !registryAcquired
          ? t("blocco07.missingRegistry")
          : mode === "SALDO_INIZIALE" && !stockFile && !stockAcquired
            ? t("blocco07.missingStock")
            : mode === "SALDO_INIZIALE" && !historicalCoverageConfirmed
              ? t("blocco07.missingCoverage")
              : "";
  const chooseFile = (file: File | null, registry: boolean) => {
    if (
      file &&
      (file.size > 10 * 1024 * 1024 || !/\.(xlsx|xls|csv)$/i.test(file.name))
    ) {
      setInlineError(t("blocco07.formats"));
      return;
    }
    setInlineError("");
    setOtherPractice(null);
    if (registry) {
      setRegistryFile(file);
      acquiredRegistry.current = null;
      setSessionId(null);
    } else setStockFile(file);
  };

  const upload = async () => {
    if ((!registryFile && !registryAcquired) || disabledReason || pending)
      return;
    setInlineError("");
    if (mode === "SALDO_INIZIALE" && !stockFile && !stockAcquired) return;
    setBusy(true);
    try {
      const resolvedSourceId =
        sourceId ||
        String(
          (
            await resolveAutomaticFseImportSource({
              magazzinoId: practice.magazzinoId,
            })
          ).id,
        );
      setSourceId(resolvedSourceId);
      const base = {
        sourceRegistryId: Number(resolvedSourceId),
        areaOperativaId: practice.areaOperativaId,
        magazzinoId: practice.magazzinoId,
        lottoLogicoId: practice.lottoLogicoId,
        caricoPraticaId: practice.id,
        modalita: mode,
      } as const;
      const context = JSON.stringify(base);
      let acquiredSessionId =
        acquiredRegistry.current?.file === registryFile &&
        acquiredRegistry.current.context === context
          ? acquiredRegistry.current.sessionId
          : registryAcquired &&
              detail?.sourceRegistryId === Number(resolvedSourceId) &&
              detail.modalita === mode
            ? detail.id
            : null;
      if (acquiredSessionId == null && registryFile) {
        const registry = await analyzeFsePracticeImport(registryFile, {
          ...base,
          profilo: "REGISTRO",
          nomeFile: registryFile.name,
        });
        acquiredSessionId = registry.sessionId;
        acquiredRegistry.current = {
          file: registryFile,
          context,
          sessionId: acquiredSessionId,
        };
        setSessionId(acquiredSessionId);
        await queryClient.invalidateQueries({
          queryKey: ["/api/fse-importazioni/sessioni"],
        });
      }
      if (acquiredSessionId == null) return;
      const acquired = await getFseImportSession(acquiredSessionId);
      if (
        acquired.caricoPraticaId != null &&
        acquired.caricoPraticaId !== practice.id
      ) {
        setOtherPractice({
          practiceId: acquired.caricoPraticaId,
          sessionId: acquired.id,
        });
        setInlineError(t("blocco07.resumeOtherHelp"));
        return;
      }
      const effectiveDate =
        referenceDate ||
        acquired.files.find((file) => file.profilo === "REGISTRO")
          ?.dataRiferimento ||
        "";
      setReferenceDate(effectiveDate);
      if (stockFile) {
        const stock = await analyzeFsePracticeImport(stockFile, {
          ...base,
          caricoPraticaId: practice.id,
          sessionId: acquiredSessionId,
          profilo: "GIACENZE",
          nomeFile: stockFile.name,
          dataRiferimento: effectiveDate || undefined,
        });
        acquiredSessionId = stock.sessionId;
      }
      setSessionId(acquiredSessionId);
      // Registry can already be cached while Stock is still being acquired.
      await queryClient.invalidateQueries({
        queryKey: getGetFseImportSessionQueryKey(acquiredSessionId),
      });
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
      setRemapping(null);
      setInlineError("");
      attachIntent.current = null;
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };

  const createAndMapProduct = async () => {
    if (!newProductFor || !newProduct.name.trim() || !newProduct.unit) return;
    try {
      const created = createdProducts.current[`${detail?.id}:${newProductFor}`]
        ? { id: createdProducts.current[`${detail?.id}:${newProductFor}`] }
        : await createProduct.mutateAsync({
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
      createdProducts.current[`${detail?.id}:${newProductFor}`] = created.id;
      setMappingProduct((current) => ({
        ...current,
        [newProductFor]: String(created.id),
      }));
      await queryClient.invalidateQueries({ queryKey: ["/api/prodotti"] });
      if (await confirmMapping(newProductFor, created.id)) {
        setNewProductFor(null);
        setNewProduct(emptyProduct);
      }
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
      setInlineError("");
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
      setAddedPracticeId(result.practiceId);
      setInlineError("");
      setStep(3);
    } catch (error) {
      if (!retainFseAttachIntentAfterError(error)) attachIntent.current = null;
      showError(error);
    }
  };

  const documentDateRows =
    detail?.modalita === "NUOVI_CARICHI"
      ? detail.rows.filter(
          (row) =>
            row.stato === "DA_VERIFICARE" &&
            row.errorCodes.length === 0 &&
            row.warningCodes.length === 1 &&
            row.warningCodes[0] === "DATA_DOCUMENTO_FALLBACK" &&
            row.dataDocumento != null &&
            row.dataOperativaProposta === row.dataDocumento,
        )
      : [];
  const confirmDocumentDates = async () => {
    if (!detail || pending || !documentDateRows.length) return;
    setBusy(true);
    let version = detail.versione;
    try {
      for (const row of documentDateRows) {
        const updated = await reviseRow.mutateAsync({
          id: detail.id,
          rigaId: row.id,
          data: {
            versione: version,
            accettaFallbackData: true,
            motivo: t("blocco07.documentDatesReason"),
          },
        });
        version = updated.versione;
      }
      setInlineError("");
    } catch (error) {
      showError(error);
    } finally {
      await detailQuery.refetch();
      attachIntent.current = null;
      setBusy(false);
    }
  };
  const saveReferenceDate = async () => {
    if (!detail || !referenceDate || !dateReason.trim()) return;
    try {
      await reviseDate.mutateAsync({
        id: detail.id,
        data: {
          versione: detail.versione,
          dataRiferimento: referenceDate,
          motivo: dateReason.trim(),
        },
      });
      await detailQuery.refetch();
      setInlineError("");
      setDateReason("");
      attachIntent.current = null;
    } catch (error) {
      showError(error);
    }
  };
  const dateMismatch =
    detail?.modalita === "SALDO_INIZIALE" &&
    (!stockAcquired?.dataRiferimento ||
      (registryAcquired?.dataRiferimento != null &&
        registryAcquired.dataRiferimento !== stockAcquired.dataRiferimento));
  const reset = () => {
    setOtherPractice(null);
    setRemapping(null);
    setDateReason("");
    setSourceId("");
    setStep(0);
    setInlineError("");
    setAddedPracticeId(null);
    acquiredRegistry.current = null;
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
        if (pending) return;
        if (!next && addedPracticeId != null) onPracticeReady(addedPracticeId);
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

        <nav
          aria-label={t("caricoPratiche.fseImport")}
          className="flex flex-wrap gap-2 text-sm"
        >
          {["stepFiles", "stepMap", "stepSummary", "stepAdded"].map(
            (key, index) => (
              <span
                key={key}
                aria-current={step === index ? "step" : undefined}
                className={
                  step === index
                    ? "font-semibold text-primary"
                    : "text-muted-foreground"
                }
              >
                {index + 1}. {t(`blocco07.${key}`)}
              </span>
            ),
          )}
        </nav>
        {inlineError && (
          <p
            role="alert"
            className="rounded-md border border-destructive p-3 text-sm text-destructive"
          >
            {inlineError}
          </p>
        )}
        {otherPractice && onResumePractice && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              const target = otherPractice;
              reset();
              onResumePractice(target.practiceId, target.sessionId);
            }}
          >
            {t("blocco07.resumePractice", { id: otherPractice.practiceId })}
          </Button>
        )}
        {sessionId && detail && (
          <p className="text-sm text-muted-foreground">
            {t("blocco07.savedSession", {
              id: detail.id,
              practice: detail.caricoPraticaId ?? practice.id,
            })}
          </p>
        )}
        <ScrollArea className="max-h-[60vh] pr-4">
          {step === 0 && (
            <div className="space-y-5">
              <h3 className="font-semibold">{t("blocco07.sourceTitle")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("blocco07.modeHelp")}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("caricoPratiche.fseMode")}</Label>
                  <Select
                    value={mode}
                    onValueChange={(value) => {
                      setMode(value as FseImportMode);
                      acquiredRegistry.current = null;
                      setSessionId(null);
                    }}
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
                {areaSources.length > 0 && (
                  <div className="space-y-2">
                    <Label>{t("blocco07.registerPicker")}</Label>
                    <Select
                      value={sourceId}
                      onValueChange={(value) => {
                        setSourceId(value);
                        acquiredRegistry.current = null;
                        setSessionId(null);
                      }}
                    >
                      <SelectTrigger aria-label={t("blocco07.registerPicker")}>
                        <SelectValue
                          placeholder={t("blocco07.registerPicker")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {areaSources.map((source) => (
                          <SelectItem key={source.id} value={String(source.id)}>
                            {source.descrizione}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <p className="rounded-md bg-muted p-3 text-sm">
                {t("blocco07.automaticSource")}
              </p>
              {sourcesQuery.isError && (
                <Button
                  variant="outline"
                  onClick={() => void sourcesQuery.refetch()}
                >
                  {t("blocco07.reloadSources")}
                </Button>
              )}

              <div className="border-t pt-4">
                <h3 className="font-semibold">{t("blocco07.files")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("blocco07.formats")}
                </p>
              </div>
              {(acquiredRegistry.current || registryAcquired) && (
                <p role="status" className="text-sm text-teal-700">
                  {t("blocco07.registryAcquired")} · #
                  {acquiredRegistry.current?.sessionId ?? sessionId}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fse-registry-file">
                    {t("caricoPratiche.fseRegistryFile")}
                  </Label>
                  <Input
                    ref={registryInput}
                    className="sr-only"
                    id="fse-registry-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) =>
                      chooseFile(event.target.files?.[0] ?? null, true)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto whitespace-normal text-left"
                    disabled={pending}
                    onClick={() => registryInput.current?.click()}
                  >
                    {t("blocco07.registryPicker")}
                  </Button>
                  <p className="text-sm break-all">
                    {registryFile?.name ?? registryAcquired?.nomeFile}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("blocco07.registryHelp")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fse-stock-file">
                    {t("caricoPratiche.fseStockFile", {
                      required: mode === "SALDO_INIZIALE" ? "*" : "",
                    })}
                  </Label>
                  <Input
                    ref={stockInput}
                    className="sr-only"
                    id="fse-stock-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) =>
                      chooseFile(event.target.files?.[0] ?? null, false)
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto whitespace-normal text-left"
                    disabled={pending}
                    onClick={() => stockInput.current?.click()}
                  >
                    {t("blocco07.stockPicker")}
                  </Button>
                  <p className="text-sm break-all">
                    {stockFile?.name ?? stockAcquired?.nomeFile}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("blocco07.stockHelp")}
                  </p>
                </div>
              </div>
              {(mode === "SALDO_INIZIALE" || stockFile) && (
                <div className="max-w-xs space-y-2">
                  <Label>{t("caricoPratiche.fseReferenceDate")}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t("blocco07.referenceDateHelp")}
                  </p>
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
              <p className="rounded-md border bg-muted p-3 text-sm font-medium">
                {t(
                  detail.modalita === "SALDO_INIZIALE"
                    ? "blocco07.initialModeReview"
                    : "blocco07.loadsModeReview",
                )}
              </p>
              {detail.modalita === "SALDO_INIZIALE" && (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm">{t("blocco07.referenceDateHelp")}</p>
                  <p>
                    {t("blocco07.detectedDate", {
                      date: registryAcquired?.dataRiferimento ?? "—",
                    })}
                  </p>
                  {dateMismatch && (
                    <p role="alert" className="text-destructive">
                      {t("blocco07.dateMismatch")}
                    </p>
                  )}
                  <div className="grid gap-2 md:grid-cols-3">
                    <label>
                      {t("caricoPratiche.fseReferenceDate")}
                      <Input
                        type="date"
                        value={referenceDate}
                        onChange={(e) => setReferenceDate(e.target.value)}
                      />
                    </label>
                    <label>
                      {t("caricoPratiche.fseCorrectionReason")}
                      <Input
                        value={dateReason}
                        onChange={(e) => setDateReason(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={pending || !referenceDate || !dateReason.trim()}
                      onClick={() => void saveReferenceDate()}
                    >
                      {t("blocco07.saveDate")}
                    </Button>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={historicalCoverageConfirmed}
                      onCheckedChange={(checked) =>
                        setHistoricalCoverageConfirmed(checked === true)
                      }
                    />
                    {t("caricoPratiche.fseHistoricalCoverageConfirmation")}
                  </label>
                </div>
              )}
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

              {documentDateRows.length > 0 && (
                <div className="space-y-2 rounded-md border border-amber-300 p-3">
                  <p className="text-sm">{t("blocco07.documentDatesHelp")}</p>
                  <Button
                    variant="outline"
                    className="h-auto whitespace-normal"
                    disabled={pending}
                    onClick={() => void confirmDocumentDates()}
                  >
                    {t("blocco07.confirmDocumentDates", {
                      count: documentDateRows.length,
                    })}
                  </Button>
                </div>
              )}
              {descriptionsToMap.map((description) => (
                <div
                  key={description}
                  ref={remapping === description ? mappingPanel : undefined}
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
                        disabled={
                          pending ||
                          Boolean(
                            createdProducts.current[
                              `${detail?.id}:${description}`
                            ],
                          )
                        }
                        onClick={() => {
                          if (newProductFor !== description) {
                            const proposal = suggestFseUnit(
                              description,
                              detail.stockRows,
                              detail.rows,
                            );
                            setNewProduct({
                              ...emptyProduct,
                              name: description,
                              unit: proposal.unit ?? "",
                              fractional:
                                proposal.unit === "kg" || proposal.unit === "l",
                            });
                          }
                          setNewProductFor(description);
                        }}
                      >
                        <PackagePlus className="mr-2 h-4 w-4" />
                        {t("caricoPratiche.fseCreateProduct")}
                      </Button>
                    )}
                  </div>
                  {canManageMappings && (
                    <div
                      className={
                        suggestFseProducts(description, products).length
                          ? "space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 md:col-span-3 dark:border-emerald-900 dark:bg-emerald-950"
                          : "space-y-2 rounded-md bg-muted/40 p-3 md:col-span-3"
                      }
                    >
                      <p className="text-sm text-muted-foreground">
                        {t(
                          suggestFseProducts(description, products).length
                            ? "blocco07.productSuggestions"
                            : "blocco07.noProductSuggestions",
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {suggestFseProducts(description, products).map(
                          (product) => (
                            <Button
                              key={product.id}
                              variant="outline"
                              disabled={pending}
                              className="h-auto max-w-full whitespace-normal border-emerald-300 bg-emerald-100 text-left text-emerald-900 hover:bg-emerald-200 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100 dark:hover:bg-emerald-800"
                              onClick={() =>
                                void confirmMapping(description, product.id)
                              }
                            >
                              {t("blocco07.associateSuggested", {
                                name: product.nome,
                              })}{" "}
                              · {product.codice} · {product.unitaMisura}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                  {createdProducts.current[`${detail?.id}:${description}`] && (
                    <p role="status" className="md:col-span-3">
                      {t("caricoPratiche.fseSelectProduct")}: #
                      {createdProducts.current[`${detail?.id}:${description}`]}{" "}
                      · {newProduct.name}
                    </p>
                  )}
                  {newProductFor === description && (
                    <div className="grid gap-2 rounded bg-muted/40 p-3 md:grid-cols-3">
                      <p className="text-sm text-muted-foreground md:col-span-3">
                        {t(
                          `blocco07.unitSuggestion.${unitProposal?.source ?? "unknown"}`,
                          { unit: unitProposal?.unit },
                        )}
                      </p>
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
                        <SelectTrigger aria-label={t("blocco07.productUnit")}>
                          <SelectValue
                            placeholder={t("blocco07.productUnit")}
                          />
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
                        disabled={
                          !newProduct.name.trim() || !newProduct.unit || pending
                        }
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
                        {t("blocco07.rowNumber", { number: row.numeroRiga })} ·{" "}
                        {row.fondoOrigine ?? "—"} · {row.lottoFisico ?? "—"} ·{" "}
                        {row.quantitaOperativa ?? "—"}{" "}
                        {row.prodotto?.unitaMisura}
                      </p>
                      <p className="text-sm">
                        {t("blocco07.fileQuantities", {
                          unit: fileWeightUnit(row.prodottoEsterno),
                          pieces:
                            "tipoMovimento" in row
                              ? (row.quantitaPezzi ?? "—")
                              : (row.giacenzaPezzi ?? "—"),
                          weight:
                            "tipoMovimento" in row
                              ? (row.quantitaKgLt ?? "—")
                              : (row.giacenzaPesoVolume ?? "—"),
                        })}
                      </p>
                      {"tipoMovimento" in row && (
                        <p className="text-sm text-muted-foreground">
                          {t("blocco07.rowDates", {
                            document: row.dataDocumento ?? "—",
                            operational: row.dataOperativaProposta ?? "—",
                          })}
                        </p>
                      )}
                      {row.errorCodes.length > 0 && (
                        <p className="text-xs text-destructive">
                          {row.errorCodes
                            .map((code) =>
                              t(`blocco07.importIssues.${code}`, {
                                defaultValue: code,
                              }),
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {"warningCodes" in row && row.warningCodes.length > 0 && (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {row.warningCodes
                            .map((code) =>
                              t(`blocco07.importIssues.${code}`, {
                                defaultValue: code,
                              }),
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {canManageMappings &&
                        row.prodottoId != null &&
                        ["PRONTO", "ERRORE", "DA_VERIFICARE"].includes(
                          row.stato,
                        ) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => setRemapping(row.prodottoEsterno)}
                          >
                            {t("blocco07.changeMapping")}
                          </Button>
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
                <Dialog
                  open
                  onOpenChange={(next) => {
                    if (!next && !pending) {
                      setEditingRowId(null);
                      setCorrection(null);
                    }
                  }}
                >
                  <DialogContent className="max-h-[85vh] overflow-y-auto max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>
                        {t("caricoPratiche.fseCorrect")}
                      </DialogTitle>
                      <DialogDescription>
                        {
                          detail.rows.find((row) => row.id === editingRowId)
                            ?.prodottoEsterno
                        }{" "}
                        ·{" "}
                        {t("blocco07.rowNumber", {
                          number: detail.rows.find(
                            (row) => row.id === editingRowId,
                          )?.numeroRiga,
                        })}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
                      <p>
                        {t("blocco07.correctionUnit", {
                          unit: editingUnit ?? "—",
                        })}
                      </p>
                      {editingUnitProposal?.source === "file" && (
                        <p>
                          {t("blocco07.unitSuggestion.file", {
                            unit: editingUnitProposal.unit,
                          })}
                        </p>
                      )}
                      {editingFileQuantity != null && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            setCorrection({
                              ...correction,
                              quantity: editingFileQuantity,
                            })
                          }
                        >
                          {t("blocco07.useRowQuantity", {
                            quantity: editingFileQuantity,
                            unit: editingUnit,
                          })}
                        </Button>
                      )}
                      {canManageMappings && editingRow && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          disabled={pending}
                          onClick={() => {
                            setRemapping(editingRow.prodottoEsterno);
                            setEditingRowId(null);
                            setCorrection(null);
                          }}
                        >
                          {t("blocco07.changeMapping")}
                        </Button>
                      )}
                    </div>
                    {inlineError && (
                      <p role="alert" className="text-destructive">
                        {inlineError}
                      </p>
                    )}
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionQuantity")} (
                        {editingUnit ?? "—"})
                        <Input
                          value={correction.quantity}
                          onChange={(event) =>
                            setCorrection({
                              ...correction,
                              quantity: event.target.value,
                            })
                          }
                          placeholder={t(
                            "caricoPratiche.fseCorrectionQuantity",
                          )}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionDocument")}
                        <Input
                          value={correction.documentNumber}
                          onChange={(event) =>
                            setCorrection({
                              ...correction,
                              documentNumber: event.target.value,
                            })
                          }
                          placeholder={t(
                            "caricoPratiche.fseCorrectionDocument",
                          )}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionDocumentDate")}
                        <Input
                          type="date"
                          value={correction.documentDate}
                          onChange={(event) =>
                            setCorrection({
                              ...correction,
                              documentDate: event.target.value,
                            })
                          }
                          aria-label={t(
                            "caricoPratiche.fseCorrectionDocumentDate",
                          )}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionOperationalDate")}
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
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionLot")}
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
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionExpiry")}
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
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionFactor")}
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
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionDisambiguator")}
                        <Input
                          value={correction.disambiguator}
                          onChange={(event) =>
                            setCorrection({
                              ...correction,
                              disambiguator: event.target.value,
                            })
                          }
                          placeholder={t(
                            "caricoPratiche.fseCorrectionDisambiguator",
                          )}
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        {t("caricoPratiche.fseCorrectionReason")}
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
                      </label>
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
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )}

          {step === 3 && (
            <div
              role="status"
              className="rounded-md border border-teal-300 bg-teal-50 p-5 text-teal-950 dark:bg-teal-950/30 dark:text-teal-100"
            >
              {t("blocco07.added")}
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
              <p className="text-sm">
                {t(
                  detail.modalita === "SALDO_INIZIALE"
                    ? "blocco07.initialModeReview"
                    : "blocco07.loadsModeReview",
                )}
              </p>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {t("caricoPratiche.fseNoStockChange")}
              </p>
            </div>
          )}
        </ScrollArea>

        {step === 0 && disabledReason && (
          <p id="fse-disabled-reason" className="text-sm text-muted-foreground">
            {disabledReason}
          </p>
        )}
        <DialogFooter>
          {step < 3 && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              {t("blocco07.suspendImport")}
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={() => {
                if (addedPracticeId != null) onPracticeReady(addedPracticeId);
                onOpenChange(false);
                reset();
              }}
            >
              {t("blocco07.backToPractice")}
            </Button>
          )}
          {step > 0 && step < 3 && (
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
              aria-describedby="fse-disabled-reason"
              disabled={pending || Boolean(disabledReason)}
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
                  (!historicalCoverageConfirmed ||
                    Boolean(dateMismatch) ||
                    referenceDate !== detail.dataRiferimentoSaldo))
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
