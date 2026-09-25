import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCaricoPraticaQueryKey,
  getListCaricoPraticheQueryKey,
  getListLottiLogiciQueryKey,
  useAddCaricoPraticaRiga,
  useCancelCaricoPratica,
  useCloseCaricoPratica,
  useCreateCaricoPratica,
  useCreateLottoLogico,
  useDeleteCaricoPraticaRiga,
  useGetCaricoPratica,
  useListAreeOperative,
  useListCaricoPratiche,
  useListLottiLogici,
  useListMagazzini,
  useListProdotti,
  useRegisterCaricoPratica,
  useReopenCaricoPratica,
  useUpdateCaricoPratica,
  useUpdateCaricoPraticaRiga,
  type CaricoPraticaDettaglio,
  type CaricoPraticaRiga,
  type OrigineCaricoManuale,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { FseImportPracticeWizard } from "@/components/fse-import-practice-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/hooks/use-unsaved-changes-guard";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api-error";
import {
  blocksCaricoDraftSave,
  caricoDraftFromRow,
  isCaricoRowDraftDirty,
  newCommandKey,
  normalizeUiQuantity,
  operationalWarehousesForArea,
  productForBarcode,
  reconcileCaricoDrafts,
  shouldAcceptBarcodeScan,
  type CaricoRowDraft,
  type CaricoRowField,
  type CaricoRowIssue,
  validateCaricoRow,
  visibleProducts,
} from "@/lib/carico-merce";
import {
  ArrowLeft,
  FileSpreadsheet,
  History,
  Loader2,
  PackagePlus,
  Plus,
  Save,
} from "lucide-react";

const ORIGINS: OrigineCaricoManuale[] = [
  "DONAZIONE",
  "ACQUISTO",
  "RACCOLTA_ALIMENTARE",
  "ALTRO",
];

type HeaderForm = {
  areaOperativaId: string;
  magazzinoId: string;
  lottoLogicoId: string;
  origineCarico: OrigineCaricoManuale;
  dataCarico: string;
  descrizione: string;
  numeroDocumento: string;
  note: string;
};

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

function emptyHeader(): HeaderForm {
  return {
    areaOperativaId: "",
    magazzinoId: "",
    lottoLogicoId: "",
    origineCarico: "DONAZIONE",
    dataCarico: today(),
    descrizione: "",
    numeroDocumento: "",
    note: "",
  };
}

function headerFromPractice(practice: CaricoPraticaDettaglio): HeaderForm {
  return {
    areaOperativaId: String(practice.areaOperativaId),
    magazzinoId: String(practice.magazzinoId),
    lottoLogicoId: String(practice.lottoLogicoId),
    origineCarico: practice.origineCarico as OrigineCaricoManuale,
    dataCarico: practice.dataCarico,
    descrizione: practice.descrizione,
    numeroDocumento: practice.numeroDocumento ?? "",
    note: practice.note ?? "",
  };
}

function statusLabel(t: (key: string) => string, status: string) {
  return t(`caricoPratiche.status${status[0].toUpperCase()}${status.slice(1)}`);
}

function rowIssueKey(field: CaricoRowField, issue: CaricoRowIssue): string {
  if (field === "quantita")
    return `caricoPratiche.quantity${issue[0].toUpperCase()}${issue.slice(1)}`;
  if (field === "codiceLottoProduttore")
    return "caricoPratiche.physicalLotRequired";
  if (field === "dataScadenza")
    return issue === "format"
      ? "caricoPratiche.expiryFormat"
      : "caricoPratiche.expiryRequired";
  if (field === "fattoreKgLtPezzo")
    return issue === "positive"
      ? "caricoPratiche.factorPositive"
      : "caricoPratiche.factorFormat";
  return "caricoPratiche.fundRequired";
}

export default function CaricoMerce() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canReceive = hasPermission("magazzino.stock.receive");
  const canImportFse = hasPermission("magazzino.agea.import");
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [header, setHeader] = useState<HeaderForm>(emptyHeader);
  const [dirty, setDirty] = useState(false);
  const [filterArea, setFilterArea] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [rowDrafts, setRowDrafts] = useState<Record<number, CaricoRowDraft>>(
    {},
  );
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [confirmRegister, setConfirmRegister] = useState(false);
  const [headerAttempted, setHeaderAttempted] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [rowAttempted, setRowAttempted] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [rowSavedIncomplete, setRowSavedIncomplete] = useState<Set<number>>(
    new Set(),
  );
  const [focusRowField, setFocusRowField] = useState<{
    rowId: number;
    field: CaricoRowField;
  } | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registrationUncertain, setRegistrationUncertain] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityCode, setActivityCode] = useState("");
  const [activityDescription, setActivityDescription] = useState("");
  const [activityAttempted, setActivityAttempted] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [fseImportOpen, setFseImportOpen] = useState(false);
  const [openImportAfterSave, setOpenImportAfterSave] = useState(false);
  const registrationKey = useRef<string | null>(null);
  const registrationAttemptedRows = useRef<number[]>([]);
  const previousPractice = useRef<CaricoPraticaDettaglio | null>(null);
  const savedRowId = useRef<number | undefined>(undefined);
  const lastScan = useRef<{ value: string; at: number } | null>(null);

  const { data: areas = [] } = useListAreeOperative();
  const { data: warehouses = [] } = useListMagazzini();
  const { data: products = [] } = useListProdotti();
  const selectedAreaId = header.areaOperativaId
    ? Number(header.areaOperativaId)
    : null;
  const filterAreaId = filterArea ? Number(filterArea) : null;
  const operationalWarehouses = operationalWarehousesForArea(
    warehouses,
    selectedAreaId,
  );
  const filterWarehouses = (warehouses ?? []).filter(
    (warehouse) => warehouse.areaOperativaId === filterAreaId,
  );
  const logicalLotsQuery = useListLottiLogici(
    { areaOperativaId: selectedAreaId ?? undefined },
    {
      query: {
        enabled: selectedAreaId != null,
        queryKey: getListLottiLogiciQueryKey({
          areaOperativaId: selectedAreaId ?? undefined,
        }),
      },
    },
  );
  const logicalLots = (logicalLotsQuery.data ?? []).filter(
    (lot) => lot.stato === "aperto",
  );

  useEffect(() => {
    if (!filterArea && areas.filter((area) => area.attivo).length === 1)
      setFilterArea(String(areas.find((area) => area.attivo)!.id));
  }, [areas, filterArea]);

  useEffect(() => {
    if (!header.lottoLogicoId) {
      const general = logicalLots.find((lot) => lot.isGenerale);
      if (general)
        setHeader((current) => ({
          ...current,
          lottoLogicoId: String(general.id),
        }));
    }
  }, [header.lottoLogicoId, logicalLots]);

  const listParams = {
    areaOperativaId: filterAreaId ?? 0,
    magazzinoId:
      filterWarehouse === "all" ? undefined : Number(filterWarehouse),
    stato: filterStatus === "all" ? undefined : (filterStatus as never),
    q: filterSearch || undefined,
    da: dateFrom || undefined,
    a: dateTo || undefined,
  };
  const practicesQuery = useListCaricoPratiche(listParams, {
    query: {
      enabled: filterAreaId != null,
      queryKey: getListCaricoPraticheQueryKey(listParams),
    },
  });
  const detailQuery = useGetCaricoPratica(selectedId ?? 0, {
    query: {
      enabled: selectedId != null,
      queryKey: getGetCaricoPraticaQueryKey(selectedId ?? 0),
    },
  });
  const practice = detailQuery.data;
  const pendingRows = practice?.righe.filter((row) => !row.registrata) ?? [];
  const registeredRows = practice?.righe.filter((row) => row.registrata) ?? [];
  const canEdit =
    canReceive && (practice?.stato === "bozza" || practice?.stato === "aperta");
  const isSystemPractice =
    practice?.origineCarico === "AGEA_SIFEAD" ||
    practice?.origineCarico === "SALDO_INIZIALE";
  const canEditManual = canEdit && !isSystemPractice;
  const canRemoveRow = canEdit && practice?.tipoPratica !== "SALDO_INIZIALE";
  const canOpenFseImport =
    canImportFse &&
    canEdit &&
    ((canEditManual &&
      practice?.righe.length === 0 &&
      practice.integrazioni.length === 0) ||
      practice?.origineCarico === "AGEA_SIFEAD");
  const isRowDirty = (row: CaricoPraticaRiga) =>
    isCaricoRowDraftDirty(
      rowDrafts[row.id] ?? caricoDraftFromRow(row),
      caricoDraftFromRow(row),
    );
  const rowsHaveUnsavedChanges = pendingRows.some(isRowDirty);
  const selectedRowsHaveUnsavedChanges = pendingRows.some(
    (row) => selectedRows.has(row.id) && isRowDirty(row),
  );
  const hasUnsavedChanges = dirty || rowsHaveUnsavedChanges;
  const unsavedGuard = useUnsavedChangesGuard(hasUnsavedChanges);

  const headerIssues = {
    areaOperativaId: !header.areaOperativaId,
    magazzinoId: !header.magazzinoId,
    lottoLogicoId: !header.lottoLogicoId,
    dataCarico:
      !header.dataCarico ||
      Number.isNaN(new Date(`${header.dataCarico}T00:00:00Z`).getTime()),
    descrizione: !header.descrizione.trim(),
  };
  const selectedPendingRows = pendingRows.filter((row) =>
    selectedRows.has(row.id),
  );
  const selectedInvalidRows = selectedPendingRows.filter(
    (row) =>
      Object.keys(
        validateCaricoRow(row, rowDrafts[row.id] ?? caricoDraftFromRow(row)),
      ).length > 0,
  );

  useEffect(() => {
    if (!practice) return;
    const previous = previousPractice.current;
    const samePractice = previous?.id === practice.id;
    if (!samePractice) {
      setHeader(headerFromPractice(practice));
      setRowDrafts(
        Object.fromEntries(
          practice.righe.map((row) => [row.id, caricoDraftFromRow(row)]),
        ),
      );
      setSelectedRows(new Set());
      setRowAttempted(new Set());
      setRowErrors({});
      setRowSavedIncomplete(new Set());
      setFocusRowField(null);
      setHeaderAttempted(false);
      setHeaderError(null);
      setSectionError(null);
      setRegisterError(null);
      setRegistrationUncertain(false);
      setDirty(false);
      registrationKey.current = null;
      registrationAttemptedRows.current = [];
    } else {
      if (!dirty) setHeader(headerFromPractice(practice));
      const merged = reconcileCaricoDrafts(
        previous.righe,
        practice.righe,
        rowDrafts,
        savedRowId.current,
      );
      setRowDrafts(merged.drafts);
      if (merged.conflicts.length)
        setRowErrors((errors) => ({
          ...errors,
          ...Object.fromEntries(
            merged.conflicts.map((id) => [id, t("caricoPratiche.rowConflict")]),
          ),
        }));
      setSelectedRows(
        (current) =>
          new Set(
            [...current].filter((id) =>
              practice.righe.some((row) => row.id === id && !row.registrata),
            ),
          ),
      );
    }
    previousPractice.current = practice;
    savedRowId.current = undefined;
  }, [practice]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const guardInternalLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const nextLocation = `${destination.pathname}${destination.search}${destination.hash}`;
      const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextLocation === currentLocation) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      unsavedGuard.requestClose(() => navigate(nextLocation));
    };
    document.addEventListener("click", guardInternalLink, true);
    return () => document.removeEventListener("click", guardInternalLink, true);
  }, [hasUnsavedChanges, navigate, unsavedGuard.requestClose]);

  const createMutation = useCreateCaricoPratica();
  const createLogicalLotMutation = useCreateLottoLogico();
  const updateMutation = useUpdateCaricoPratica();
  const addRowMutation = useAddCaricoPraticaRiga();
  const updateRowMutation = useUpdateCaricoPraticaRiga();
  const deleteRowMutation = useDeleteCaricoPraticaRiga();
  const registerMutation = useRegisterCaricoPratica();
  const closeMutation = useCloseCaricoPratica();
  const reopenMutation = useReopenCaricoPratica();
  const cancelMutation = useCancelCaricoPratica();
  const pending =
    createMutation.isPending ||
    createLogicalLotMutation.isPending ||
    updateMutation.isPending ||
    addRowMutation.isPending ||
    updateRowMutation.isPending ||
    deleteRowMutation.isPending ||
    registerMutation.isPending ||
    closeMutation.isPending ||
    reopenMutation.isPending ||
    cancelMutation.isPending;
  const registrationBlockReason = pending
    ? t("caricoPratiche.operationPending")
    : registrationUncertain
      ? t("caricoPratiche.registrationRetryWarning")
      : !canEdit
        ? t("caricoPratiche.cannotEdit")
        : selectedRows.size === 0
          ? t("caricoPratiche.selectRows")
          : dirty
            ? t("caricoPratiche.saveHeaderBeforeRegister")
            : selectedRowsHaveUnsavedChanges
              ? t("caricoPratiche.saveSelectedRowsBeforeRegister")
              : selectedInvalidRows.length > 0
                ? t("caricoPratiche.selectedIncomplete", {
                    count: selectedInvalidRows.length,
                  })
                : null;

  useEffect(() => {
    if (pending || !focusRowField) return;
    const handle = requestAnimationFrame(() => {
      const suffix = {
        quantita: "quantity",
        fondoOrigine: "fund",
        codiceLottoProduttore: "lot",
        dataScadenza: "expiry",
        fattoreKgLtPezzo: "factor",
      }[focusRowField.field];
      const element = document.getElementById(
        `carico-${suffix}-${focusRowField.rowId}`,
      );
      if (!element || element.hasAttribute("disabled")) return;
      element.focus();
      setFocusRowField(null);
    });
    return () => cancelAnimationFrame(handle);
  }, [focusRowField, pending, practice]);

  const updateDetailCache = (value: CaricoPraticaDettaglio) => {
    queryClient.setQueryData(getGetCaricoPraticaQueryKey(value.id), value);
    void queryClient.invalidateQueries({ queryKey: ["/api/carico-pratiche"] });
  };

  const showError = (error: unknown) => {
    const message = errorMessage(error, t("caricoPratiche.error"));
    toast({
      title: message.includes("altro operatore")
        ? t("caricoPratiche.conflict")
        : t("caricoPratiche.error"),
      description: message,
      variant: "destructive",
    });
  };

  const headerPayload = () => ({
    areaOperativaId: Number(header.areaOperativaId),
    magazzinoId: Number(header.magazzinoId),
    lottoLogicoId: Number(header.lottoLogicoId),
    origineCarico: header.origineCarico,
    dataCarico: header.dataCarico,
    descrizione: header.descrizione.trim(),
    numeroDocumento: header.numeroDocumento.trim() || null,
    note: header.note.trim() || null,
  });

  const validHeader =
    !Object.values(headerIssues).some(Boolean) &&
    ORIGINS.includes(header.origineCarico);

  const saveHeader = async () => {
    setHeaderAttempted(true);
    if (!validHeader) {
      setHeaderError(t("caricoPratiche.requiredHeader"));
      const first = (
        [
          "areaOperativaId",
          "magazzinoId",
          "lottoLogicoId",
          "dataCarico",
          "descrizione",
        ] as const
      ).find((field) => headerIssues[field]);
      const id = {
        areaOperativaId: "carico-area",
        magazzinoId: "carico-warehouse",
        lottoLogicoId: "carico-activity",
        dataCarico: "carico-date",
        descrizione: "carico-description",
      }[first ?? "areaOperativaId"];
      requestAnimationFrame(() => document.getElementById(id)?.focus());
      return;
    }
    setHeaderError(null);
    try {
      if (creating) {
        const created = await createMutation.mutateAsync({
          data: { ...headerPayload(), righe: [] },
        });
        setCreating(false);
        setSelectedId(created.id);
        updateDetailCache(created);
        if (openImportAfterSave) {
          setOpenImportAfterSave(false);
          setFseImportOpen(true);
        }
      } else if (practice) {
        const updated = await updateMutation.mutateAsync({
          id: practice.id,
          data: { versione: practice.versione, ...headerPayload() },
        });
        updateDetailCache(updated);
      }
      setDirty(false);
      toast({ title: t("caricoPratiche.saved") });
    } catch (error) {
      setHeaderError(errorMessage(error, t("caricoPratiche.error")));
      showError(error);
    }
  };

  const addProduct = async (productId: number) => {
    if (!practice || pending) return;
    try {
      const updated = await addRowMutation.mutateAsync({
        id: practice.id,
        data: {
          versione: practice.versione,
          prodottoId: productId,
          fondoOrigine: "NESSUN_FONDO",
          quantita: null,
          clientId: crypto.randomUUID(),
        },
      });
      updateDetailCache(updated);
      setProductSearch("");
      setSectionError(null);
    } catch (error) {
      setSectionError(errorMessage(error, t("caricoPratiche.error")));
      showError(error);
    }
  };

  const createLogicalLot = async () => {
    if (selectedAreaId == null || !canReceive) return;
    setActivityAttempted(true);
    if (!activityCode.trim() || !activityDescription.trim()) return;
    try {
      const created = await createLogicalLotMutation.mutateAsync({
        data: {
          areaOperativaId: selectedAreaId,
          codice: activityCode.trim(),
          descrizione: activityDescription.trim(),
        },
      });
      await logicalLotsQuery.refetch();
      setHeader((current) => ({
        ...current,
        lottoLogicoId: String(created.id),
      }));
      setDirty(true);
      setActivityOpen(false);
      setActivityCode("");
      setActivityDescription("");
      setActivityAttempted(false);
      setActivityError(null);
    } catch (error) {
      setActivityError(errorMessage(error, t("caricoPratiche.error")));
      showError(error);
    }
  };

  const scanProduct = (barcode: string) => {
    const now = Date.now();
    if (!shouldAcceptBarcodeScan(lastScan.current, barcode, now)) return;
    lastScan.current = { value: barcode, at: now };
    const product = productForBarcode(products, barcode);
    if (!product) {
      toast({
        title: t("caricoPratiche.unknownBarcode"),
        variant: "destructive",
      });
      return;
    }
    void addProduct(product.id);
  };

  const saveRow = async (row: CaricoPraticaRiga) => {
    if (!practice) return;
    if (rowErrors[row.id] === t("caricoPratiche.rowConflict")) return;
    const draft = rowDrafts[row.id] ?? caricoDraftFromRow(row);
    const issues = validateCaricoRow(row, draft);
    setRowAttempted((current) => new Set(current).add(row.id));
    const firstIssue = (Object.keys(issues) as CaricoRowField[])[0];
    if (blocksCaricoDraftSave(issues)) {
      if (firstIssue) setFocusRowField({ rowId: row.id, field: firstIssue });
      return;
    }
    try {
      const updated = await updateRowMutation.mutateAsync({
        id: practice.id,
        rigaId: row.id,
        data: {
          versione: practice.versione,
          prodottoId: row.prodottoId,
          fondoOrigine: draft.fondoOrigine,
          quantita: draft.quantita ? normalizeUiQuantity(draft.quantita) : null,
          codiceLottoProduttore: draft.codiceLottoProduttore.trim() || null,
          dataScadenza: draft.dataScadenza || null,
          fattoreKgLtPezzo: draft.fattoreKgLtPezzo
            ? normalizeUiQuantity(draft.fattoreKgLtPezzo)
            : null,
          note: draft.note.trim() || null,
        },
      });
      savedRowId.current = row.id;
      updateDetailCache(updated);
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setRowSavedIncomplete((current) => {
        const next = new Set(current);
        if (Object.keys(issues).length) next.add(row.id);
        else next.delete(row.id);
        return next;
      });
      if (firstIssue) setFocusRowField({ rowId: row.id, field: firstIssue });
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [row.id]: errorMessage(error, t("caricoPratiche.error")),
      }));
      showError(error);
    }
  };

  const removeRow = async (row: CaricoPraticaRiga) => {
    if (!practice) return;
    try {
      const updated = await deleteRowMutation.mutateAsync({
        id: practice.id,
        rigaId: row.id,
        data: { versione: practice.versione },
      });
      updateDetailCache(updated);
      setSectionError(null);
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch (error) {
      setSectionError(errorMessage(error, t("caricoPratiche.error")));
      showError(error);
    }
  };

  const registerRows = async () => {
    if (!practice || registrationBlockReason) {
      setRowAttempted((current) => new Set([...current, ...selectedRows]));
      return;
    }
    setRegisterError(null);
    registrationKey.current ??= newCommandKey();
    const attemptedIds = [...selectedRows];
    registrationAttemptedRows.current = attemptedIds;
    try {
      await registerMutation.mutateAsync({
        id: practice.id,
        data: {
          versione: practice.versione,
          rigaIds: attemptedIds,
          idempotencyKey: registrationKey.current,
        },
      });
      registrationKey.current = null;
      registrationAttemptedRows.current = [];
      setRegistrationUncertain(false);
      setConfirmRegister(false);
      void detailQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["/api/carico-pratiche"],
      });
      toast({ title: t("caricoPratiche.registered") });
    } catch (error) {
      setConfirmRegister(false);
      setRegistrationUncertain(true);
      const result = await detailQuery.refetch();
      const after = result.data;
      if (
        after &&
        attemptedIds.every((id) =>
          after.righe.some((row) => row.id === id && row.registrata),
        )
      ) {
        registrationKey.current = null;
        registrationAttemptedRows.current = [];
        setRegistrationUncertain(false);
        toast({ title: t("caricoPratiche.registered") });
        return;
      }
      if (result.isSuccess && !result.isRefetchError)
        setRegistrationUncertain(false);
      setRegisterError(
        `${errorMessage(error, t("caricoPratiche.error"))} ${t("caricoPratiche.registrationRetryWarning")}`,
      );
      showError(error);
    }
  };

  const verifyRegistration = async () => {
    const result = await detailQuery.refetch();
    if (!result.isSuccess || result.isRefetchError || !result.data) return;
    setRegistrationUncertain(false);
    if (
      registrationAttemptedRows.current.length > 0 &&
      registrationAttemptedRows.current.every((id) =>
        result.data.righe.some((row) => row.id === id && row.registrata),
      )
    ) {
      registrationKey.current = null;
      registrationAttemptedRows.current = [];
      setRegisterError(null);
      toast({ title: t("caricoPratiche.registered") });
    }
  };

  const lifecycle = async (action: "close" | "reopen" | "cancel") => {
    if (!practice) return;
    const reason =
      action === "close" ? null : window.prompt(t("caricoPratiche.reason"));
    if (action !== "close" && !reason?.trim()) return;
    try {
      const updated =
        action === "close"
          ? await closeMutation.mutateAsync({
              id: practice.id,
              data: { versione: practice.versione },
            })
          : action === "reopen"
            ? await reopenMutation.mutateAsync({
                id: practice.id,
                data: { versione: practice.versione, motivo: reason!.trim() },
              })
            : await cancelMutation.mutateAsync({
                id: practice.id,
                data: { versione: practice.versione, motivo: reason!.trim() },
              });
      updateDetailCache(updated);
      setSectionError(null);
    } catch (error) {
      setSectionError(errorMessage(error, t("caricoPratiche.error")));
      showError(error);
    }
  };

  const productChoices = useMemo(
    () => visibleProducts(products, productSearch),
    [productSearch, products],
  );
  const leaveDetail = () => {
    unsavedGuard.requestClose(() => {
      setSelectedId(null);
      setCreating(false);
      setDirty(false);
      setHeaderAttempted(false);
      setHeaderError(null);
      setSectionError(null);
    });
  };

  if (!selectedId && !creating) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t("caricoPratiche.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("caricoPratiche.subtitle")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/lotti?tab=carichi">
                <History className="mr-2 h-4 w-4" />
                {t("caricoPratiche.legacy")}
              </Link>
            </Button>
            {canReceive && (
              <Button
                onClick={() => {
                  setHeader(emptyHeader());
                  setHeaderAttempted(false);
                  setHeaderError(null);
                  setSectionError(null);
                  setActivityOpen(false);
                  setOpenImportAfterSave(false);
                  setCreating(true);
                }}
              >
                <PackagePlus className="mr-2 h-4 w-4" />
                {t("caricoPratiche.newPractice")}
              </Button>
            )}
            {canReceive && canImportFse && (
              <Button
                variant="outline"
                onClick={() => {
                  setHeader({
                    ...emptyHeader(),
                    areaOperativaId: filterArea,
                    magazzinoId:
                      filterWarehouse === "all" ? "" : filterWarehouse,
                    descrizione: t("caricoPratiche.fseDraftDescription"),
                  });
                  setHeaderAttempted(false);
                  setHeaderError(null);
                  setSectionError(null);
                  setOpenImportAfterSave(true);
                  setCreating(true);
                }}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {t("caricoPratiche.fseImport")}
              </Button>
            )}
          </div>
        </div>
        <Card>
          <CardContent className="grid gap-3 pt-6 md:grid-cols-3 lg:grid-cols-6">
            <Select
              value={filterArea}
              onValueChange={(value) => {
                setFilterArea(value);
                setFilterWarehouse("all");
              }}
            >
              <SelectTrigger aria-label={t("caricoPratiche.area")}>
                <SelectValue placeholder={t("caricoPratiche.selectArea")} />
              </SelectTrigger>
              <SelectContent>
                {areas
                  .filter((area) => area.attivo)
                  .map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
              <SelectTrigger aria-label={t("caricoPratiche.warehouse")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("caricoPratiche.allWarehouses")}
                </SelectItem>
                {filterWarehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.nome}
                    {warehouse.stato !== "attivo"
                      ? ` — ${t("caricoPratiche.inactive")}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              placeholder={t("caricoPratiche.search")}
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger aria-label={t("caricoPratiche.status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("caricoPratiche.allStatuses")}
                </SelectItem>
                {["bozza", "aperta", "chiusa", "annullata"].map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel(t, status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label={t("caricoPratiche.dateFrom")}
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label={t("caricoPratiche.dateTo")}
            />
          </CardContent>
        </Card>
        <div className="grid gap-3">
          {practicesQuery.isLoading && (
            <Loader2 className="h-6 w-6 animate-spin" />
          )}
          {practicesQuery.data?.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <strong>{item.codice}</strong>
                    <Badge variant="outline">
                      {statusLabel(t, item.stato)}
                    </Badge>
                  </div>
                  <p>{item.descrizione}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.magazzinoNome} · {item.dataCarico} ·{" "}
                    {item.numeroRigheRegistrate ?? 0}/{item.numeroRighe ?? 0}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setSelectedId(item.id)}
                >
                  {t("caricoPratiche.open")}
                </Button>
              </CardContent>
            </Card>
          ))}
          {filterAreaId != null &&
            !practicesQuery.isLoading &&
            practicesQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("caricoPratiche.noPractices")}
              </p>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={leaveDetail}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("caricoPratiche.backToList")}
        </Button>
        {practice && (
          <div className="flex flex-wrap items-center gap-2">
            <strong>{practice.codice}</strong>
            <Badge>{statusLabel(t, practice.stato)}</Badge>
            {canOpenFseImport && (
              <Button
                variant="outline"
                onClick={() =>
                  unsavedGuard.requestClose(() => setFseImportOpen(true))
                }
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {t("caricoPratiche.fseImport")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("caricoPratiche.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {headerError &&
            (headerError !== t("caricoPratiche.requiredHeader") ||
              !validHeader) && (
              <Alert
                variant="destructive"
                className="md:col-span-2 lg:col-span-3"
              >
                <AlertDescription>{headerError}</AlertDescription>
              </Alert>
            )}
          <div className="space-y-2">
            <Label htmlFor="carico-area">{t("caricoPratiche.area")} *</Label>
            <Select
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              value={header.areaOperativaId}
              onValueChange={(value) => {
                setHeader((current) => ({
                  ...current,
                  areaOperativaId: value,
                  magazzinoId: "",
                  lottoLogicoId: "",
                }));
                setDirty(true);
              }}
            >
              <SelectTrigger
                id="carico-area"
                aria-label={t("caricoPratiche.area")}
                aria-invalid={headerAttempted && headerIssues.areaOperativaId}
                aria-describedby={
                  headerAttempted && headerIssues.areaOperativaId
                    ? "carico-area-error"
                    : undefined
                }
                className={
                  headerAttempted && headerIssues.areaOperativaId
                    ? "border-destructive ring-1 ring-destructive"
                    : undefined
                }
              >
                <SelectValue placeholder={t("caricoPratiche.selectArea")} />
              </SelectTrigger>
              <SelectContent>
                {areas
                  .filter((area) => area.attivo)
                  .map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {headerAttempted && headerIssues.areaOperativaId && (
              <p id="carico-area-error" className="text-sm text-destructive">
                {t("caricoPratiche.areaRequired")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="carico-warehouse">
              {t("caricoPratiche.warehouse")} *
            </Label>
            <Select
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              value={header.magazzinoId}
              onValueChange={(value) => {
                setHeader((current) => ({ ...current, magazzinoId: value }));
                setDirty(true);
              }}
            >
              <SelectTrigger
                id="carico-warehouse"
                aria-label={t("caricoPratiche.warehouse")}
                aria-invalid={headerAttempted && headerIssues.magazzinoId}
                aria-describedby={
                  headerAttempted && headerIssues.magazzinoId
                    ? "carico-warehouse-error"
                    : undefined
                }
                className={
                  headerAttempted && headerIssues.magazzinoId
                    ? "border-destructive ring-1 ring-destructive"
                    : undefined
                }
              >
                <SelectValue
                  placeholder={t("caricoPratiche.selectWarehouse")}
                />
              </SelectTrigger>
              <SelectContent>
                {operationalWarehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                    {warehouse.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {headerAttempted && headerIssues.magazzinoId && (
              <p
                id="carico-warehouse-error"
                className="text-sm text-destructive"
              >
                {t("caricoPratiche.warehouseRequired")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="carico-activity">
              {t("caricoPratiche.activity")} *
            </Label>
            <Select
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              value={header.lottoLogicoId}
              onValueChange={(value) => {
                setHeader((current) => ({ ...current, lottoLogicoId: value }));
                setDirty(true);
              }}
            >
              <SelectTrigger
                id="carico-activity"
                aria-label={t("caricoPratiche.activity")}
                aria-invalid={headerAttempted && headerIssues.lottoLogicoId}
                aria-describedby={
                  headerAttempted && headerIssues.lottoLogicoId
                    ? "carico-activity-error"
                    : undefined
                }
                className={
                  headerAttempted && headerIssues.lottoLogicoId
                    ? "border-destructive ring-1 ring-destructive"
                    : undefined
                }
              >
                <SelectValue placeholder={t("caricoPratiche.selectActivity")} />
              </SelectTrigger>
              <SelectContent>
                {logicalLots.map((lot) => (
                  <SelectItem key={lot.id} value={String(lot.id)}>
                    {lot.isGenerale
                      ? t("caricoPratiche.generalActivity")
                      : lot.descrizione}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {headerAttempted && headerIssues.lottoLogicoId && (
              <p
                id="carico-activity-error"
                className="text-sm text-destructive"
              >
                {t("caricoPratiche.activityRequired")}
              </p>
            )}
            {canReceive &&
              (!practice || canEditManual) &&
              !practice?.integrazioni.length && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full whitespace-normal text-start sm:w-auto"
                  disabled={pending || selectedAreaId == null}
                  onClick={() => setActivityOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  {t("caricoPratiche.newActivity")}
                </Button>
              )}
            {canReceive && selectedAreaId == null && (
              <p className="text-sm text-muted-foreground">
                {t("caricoPratiche.selectAreaFirst")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.origin")}</Label>
            <Select
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              value={header.origineCarico}
              onValueChange={(value) => {
                setHeader((current) => ({
                  ...current,
                  origineCarico: value as OrigineCaricoManuale,
                }));
                setDirty(true);
              }}
            >
              <SelectTrigger aria-label={t("caricoPratiche.origin")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORIGINS.map((origin) => (
                  <SelectItem key={origin} value={origin}>
                    {t(`caricoPratiche.origin${origin}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="carico-date">{t("caricoPratiche.date")} *</Label>
            <Input
              id="carico-date"
              aria-label={t("caricoPratiche.date")}
              aria-invalid={headerAttempted && headerIssues.dataCarico}
              aria-describedby={
                headerAttempted && headerIssues.dataCarico
                  ? "carico-date-error"
                  : undefined
              }
              className={
                headerAttempted && headerIssues.dataCarico
                  ? "border-destructive ring-1 ring-destructive"
                  : undefined
              }
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              type="date"
              value={header.dataCarico}
              onChange={(event) => {
                setHeader((current) => ({
                  ...current,
                  dataCarico: event.target.value,
                }));
                setDirty(true);
              }}
            />
            {headerAttempted && headerIssues.dataCarico && (
              <p id="carico-date-error" className="text-sm text-destructive">
                {t("caricoPratiche.dateRequired")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="carico-description">
              {t("caricoPratiche.description")} *
            </Label>
            <Input
              id="carico-description"
              aria-label={t("caricoPratiche.description")}
              aria-invalid={headerAttempted && headerIssues.descrizione}
              aria-describedby={
                headerAttempted && headerIssues.descrizione
                  ? "carico-description-error"
                  : undefined
              }
              className={
                headerAttempted && headerIssues.descrizione
                  ? "border-destructive ring-1 ring-destructive"
                  : undefined
              }
              disabled={pending || Boolean(practice && !canEditManual)}
              value={header.descrizione}
              onChange={(event) => {
                setHeader((current) => ({
                  ...current,
                  descrizione: event.target.value,
                }));
                setDirty(true);
              }}
            />
            {headerAttempted && headerIssues.descrizione && (
              <p
                id="carico-description-error"
                className="text-sm text-destructive"
              >
                {t("caricoPratiche.descriptionRequired")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.document")}</Label>
            <Input
              aria-label={t("caricoPratiche.document")}
              disabled={
                Boolean(practice?.integrazioni.length) ||
                pending ||
                Boolean(practice && !canEditManual)
              }
              value={header.numeroDocumento}
              onChange={(event) => {
                setHeader((current) => ({
                  ...current,
                  numeroDocumento: event.target.value,
                }));
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>{t("caricoPratiche.notes")}</Label>
            <Textarea
              aria-label={t("caricoPratiche.notes")}
              disabled={pending || Boolean(practice && !canEditManual)}
              value={header.note}
              onChange={(event) => {
                setHeader((current) => ({
                  ...current,
                  note: event.target.value,
                }));
                setDirty(true);
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={pending || Boolean(practice && !canEditManual)}
              onClick={() => void saveHeader()}
            >
              <Save className="mr-2 h-4 w-4" />
              {t("caricoPratiche.saveDraft")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {practice && canEditManual && (
        <Card>
          <CardHeader>
            <CardTitle>{t("caricoPratiche.addProduct")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sectionError && (
              <Alert variant="destructive">
                <AlertDescription>{sectionError}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Input
                aria-label={t("caricoPratiche.productSearch")}
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder={t("caricoPratiche.productSearch")}
              />
              <BarcodeScannerButton
                onScan={scanProduct}
                disabled={pending}
                withLabel
                label={t("caricoPratiche.scan")}
              />
            </div>
            <ScrollArea className="h-48 rounded-md border p-2">
              <div className="grid gap-1">
                {productChoices.map((product) => (
                  <Button
                    key={product.id}
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start py-2 text-left"
                    disabled={pending}
                    onClick={() => void addProduct(product.id)}
                  >
                    <span>
                      <strong>{product.codice}</strong> — {product.nome}
                      <br />
                      <small className="text-muted-foreground">
                        {product.unitaMisura}
                        {product.codiceBarre ? ` · ${product.codiceBarre}` : ""}
                      </small>
                    </span>
                  </Button>
                ))}
              </div>
              {productChoices.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {t("caricoPratiche.noProducts")}
                </p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {practice && (
        <Card>
          <CardHeader>
            <CardTitle>{t("caricoPratiche.pendingRows")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sectionError && (
              <Alert variant="destructive">
                <AlertDescription>{sectionError}</AlertDescription>
              </Alert>
            )}
            {pendingRows.map((row) => {
              const draft = rowDrafts[row.id] ?? caricoDraftFromRow(row);
              const issues = rowAttempted.has(row.id)
                ? validateCaricoRow(row, draft)
                : {};
              const fieldError = (field: CaricoRowField) =>
                issues[field] ? t(rowIssueKey(field, issues[field])) : null;
              return (
                <div
                  key={row.id}
                  data-testid={`carico-row-${row.id}`}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-2 lg:grid-cols-4"
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      aria-label={row.prodottoNome}
                      checked={selectedRows.has(row.id)}
                      disabled={pending || !canEdit}
                      onCheckedChange={(checked) => {
                        if (
                          checked &&
                          Object.keys(validateCaricoRow(row, draft)).length > 0
                        )
                          setRowAttempted((current) =>
                            new Set(current).add(row.id),
                          );
                        if (!registrationUncertain) setRegisterError(null);
                        setSelectedRows((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        });
                        if (!registrationUncertain) {
                          registrationKey.current = null;
                          registrationAttemptedRows.current = [];
                        }
                      }}
                    />
                    <div>
                      <strong>{row.prodottoNome}</strong>
                      <p className="text-xs text-muted-foreground">
                        {row.prodottoCodice}
                      </p>
                      {row.numeroDocumentoEsterno && (
                        <p className="text-xs text-muted-foreground">
                          {t("caricoPratiche.fseExternalDocument", {
                            number: row.numeroDocumentoEsterno,
                            date: row.dataDocumentoEsterna
                              ? ` · ${row.dataDocumentoEsterna}`
                              : "",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`carico-quantity-${row.id}`}>
                      {t("caricoPratiche.quantity", { unit: row.unitaMisura })}
                      {" *"}
                    </Label>
                    <Input
                      id={`carico-quantity-${row.id}`}
                      aria-label={t("caricoPratiche.quantity", {
                        unit: row.unitaMisura,
                      })}
                      inputMode="decimal"
                      step={row.quantitaFrazionabile ? "0.000001" : "1"}
                      aria-invalid={Boolean(fieldError("quantita"))}
                      aria-describedby={
                        fieldError("quantita")
                          ? `carico-quantity-error-${row.id}`
                          : undefined
                      }
                      className={
                        fieldError("quantita")
                          ? "border-destructive ring-1 ring-destructive"
                          : undefined
                      }
                      value={draft.quantita}
                      disabled={pending || !canEditManual}
                      onChange={(event) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: { ...draft, quantita: event.target.value },
                        }));
                      }}
                    />
                    {fieldError("quantita") && (
                      <p
                        id={`carico-quantity-error-${row.id}`}
                        className="text-sm text-destructive"
                      >
                        {fieldError("quantita")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`carico-fund-${row.id}`}>
                      {t("caricoPratiche.fund")} *
                    </Label>
                    <Select
                      disabled={pending || !canEditManual}
                      value={draft.fondoOrigine}
                      onValueChange={(value) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...draft,
                            fondoOrigine:
                              value as CaricoRowDraft["fondoOrigine"],
                          },
                        }));
                      }}
                    >
                      <SelectTrigger
                        id={`carico-fund-${row.id}`}
                        aria-invalid={Boolean(fieldError("fondoOrigine"))}
                        aria-describedby={
                          fieldError("fondoOrigine")
                            ? `carico-fund-error-${row.id}`
                            : undefined
                        }
                        className={
                          fieldError("fondoOrigine")
                            ? "border-destructive ring-1 ring-destructive"
                            : undefined
                        }
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NESSUN_FONDO">
                          {t("caricoPratiche.noFund")}
                        </SelectItem>
                        <SelectItem value="FSE_PLUS">FSE+</SelectItem>
                        <SelectItem value="FONDO_NAZIONALE">
                          {t("caricoPratiche.nationalFund")}
                        </SelectItem>
                        <SelectItem value="FONDO_NAZIONALE_COFINANZIATO">
                          {t("caricoPratiche.cofinancedNationalFund")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldError("fondoOrigine") && (
                      <p
                        id={`carico-fund-error-${row.id}`}
                        className="text-sm text-destructive"
                      >
                        {fieldError("fondoOrigine")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`carico-lot-${row.id}`}>
                      {t("caricoPratiche.physicalLot")}
                      {row.lottoFisicoObbligatorio ? " *" : ""}
                    </Label>
                    <Input
                      id={`carico-lot-${row.id}`}
                      aria-label={t("caricoPratiche.physicalLot")}
                      aria-invalid={Boolean(
                        fieldError("codiceLottoProduttore"),
                      )}
                      aria-describedby={
                        fieldError("codiceLottoProduttore")
                          ? `carico-lot-error-${row.id}`
                          : undefined
                      }
                      className={
                        fieldError("codiceLottoProduttore")
                          ? "border-destructive ring-1 ring-destructive"
                          : undefined
                      }
                      value={draft.codiceLottoProduttore}
                      disabled={pending || !canEditManual}
                      onChange={(event) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...draft,
                            codiceLottoProduttore: event.target.value,
                          },
                        }));
                      }}
                    />
                    {fieldError("codiceLottoProduttore") && (
                      <p
                        id={`carico-lot-error-${row.id}`}
                        className="text-sm text-destructive"
                      >
                        {fieldError("codiceLottoProduttore")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`carico-expiry-${row.id}`}>
                      {t("caricoPratiche.expiry")}
                      {row.gestioneScadenza ? " *" : ""}
                    </Label>
                    <Input
                      id={`carico-expiry-${row.id}`}
                      aria-label={t("caricoPratiche.expiry")}
                      aria-invalid={Boolean(fieldError("dataScadenza"))}
                      aria-describedby={
                        fieldError("dataScadenza")
                          ? `carico-expiry-error-${row.id}`
                          : undefined
                      }
                      className={
                        fieldError("dataScadenza")
                          ? "border-destructive ring-1 ring-destructive"
                          : undefined
                      }
                      type="date"
                      value={draft.dataScadenza}
                      disabled={pending || !canEditManual}
                      onChange={(event) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...draft,
                            dataScadenza: event.target.value,
                          },
                        }));
                      }}
                    />
                    {fieldError("dataScadenza") && (
                      <p
                        id={`carico-expiry-error-${row.id}`}
                        className="text-sm text-destructive"
                      >
                        {fieldError("dataScadenza")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>{t("caricoPratiche.notes")}</Label>
                    <Input
                      value={draft.note}
                      disabled={pending || !canEditManual}
                      onChange={(event) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: { ...draft, note: event.target.value },
                        }));
                      }}
                    />
                  </div>
                  {["pz", "kg", "l", "lt"].includes(
                    row.unitaMisura.toLowerCase(),
                  ) && (
                    <div className="space-y-1">
                      <Label htmlFor={`carico-factor-${row.id}`}>
                        {t("caricoPratiche.factor")}
                      </Label>
                      <Input
                        id={`carico-factor-${row.id}`}
                        aria-invalid={Boolean(fieldError("fattoreKgLtPezzo"))}
                        aria-describedby={
                          fieldError("fattoreKgLtPezzo")
                            ? `carico-factor-error-${row.id}`
                            : undefined
                        }
                        className={
                          fieldError("fattoreKgLtPezzo")
                            ? "border-destructive ring-1 ring-destructive"
                            : undefined
                        }
                        inputMode="decimal"
                        value={draft.fattoreKgLtPezzo}
                        disabled={pending || !canEditManual}
                        onChange={(event) => {
                          setRowDrafts((current) => ({
                            ...current,
                            [row.id]: {
                              ...draft,
                              fattoreKgLtPezzo: event.target.value,
                            },
                          }));
                        }}
                      />
                      {fieldError("fattoreKgLtPezzo") && (
                        <p
                          id={`carico-factor-error-${row.id}`}
                          className="text-sm text-destructive"
                        >
                          {fieldError("fattoreKgLtPezzo")}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        pending ||
                        !canEditManual ||
                        rowErrors[row.id] === t("caricoPratiche.rowConflict")
                      }
                      onClick={() => void saveRow(row)}
                    >
                      {t("caricoPratiche.saveDraft")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending || !canRemoveRow}
                      onClick={() => void removeRow(row)}
                    >
                      {t("caricoPratiche.removeRow")}
                    </Button>
                  </div>
                  {!draft.quantita && (
                    <Badge variant="outline">
                      {t("caricoPratiche.incomplete")}
                    </Badge>
                  )}
                  {rowErrors[row.id] && (
                    <Alert
                      variant="destructive"
                      className="md:col-span-2 lg:col-span-4"
                    >
                      <AlertDescription>{rowErrors[row.id]}</AlertDescription>
                    </Alert>
                  )}
                  {rowSavedIncomplete.has(row.id) &&
                    Object.keys(validateCaricoRow(row, draft)).length > 0 &&
                    !isRowDirty(row) && (
                      <Alert className="md:col-span-2 lg:col-span-4">
                        <AlertDescription>
                          {t("caricoPratiche.savedIncomplete")}
                        </AlertDescription>
                      </Alert>
                    )}
                </div>
              );
            })}
            {pendingRows.length === 0 && (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            <p className="text-sm text-muted-foreground">
              {t("caricoPratiche.registerHelp")}
            </p>
            {registrationBlockReason && (
              <p
                id="carico-register-reason"
                role="status"
                className="text-sm text-amber-700 dark:text-amber-300"
              >
                {registrationBlockReason}
              </p>
            )}
            {registerError && (
              <Alert variant="destructive">
                <AlertDescription>{registerError}</AlertDescription>
                {registrationUncertain && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    onClick={() => void verifyRegistration()}
                  >
                    {t("caricoPratiche.verifyRegistration")}
                  </Button>
                )}
              </Alert>
            )}
            <Button
              aria-describedby={
                registrationBlockReason ? "carico-register-reason" : undefined
              }
              disabled={Boolean(registrationBlockReason)}
              onClick={() => setConfirmRegister(true)}
            >
              {registerMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("caricoPratiche.register")}
            </Button>
          </CardContent>
        </Card>
      )}

      {practice && (
        <Card>
          <CardHeader>
            <CardTitle>{t("caricoPratiche.registeredRows")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {registeredRows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap justify-between gap-2 rounded-md border p-3"
              >
                <span>
                  <strong>{row.prodottoNome}</strong> · {row.fondoOrigine}
                </span>
                <Badge>
                  {row.quantita} {row.unitaMisura}
                </Badge>
              </div>
            ))}
            {registeredRows.length === 0 && (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      )}

      {practice && practice.integrazioni.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("caricoPratiche.integrations")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {practice.integrazioni.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                #{item.id} · {new Date(item.dataRegistrazione).toLocaleString()}{" "}
                ·{" "}
                {t("caricoPratiche.accountingLoad", {
                  id: item.caricoMagazzinoId,
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {practice && (
        <div className="flex flex-wrap gap-2">
          {practice.stato === "aperta" && (
            <Button
              variant="outline"
              disabled={pending || pendingRows.length > 0}
              onClick={() => void lifecycle("close")}
            >
              {t("caricoPratiche.close")}
            </Button>
          )}
          {practice.stato === "chiusa" && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void lifecycle("reopen")}
            >
              {t("caricoPratiche.reopen")}
            </Button>
          )}
          {practice.stato === "bozza" && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void lifecycle("cancel")}
            >
              {t("caricoPratiche.cancel")}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/lotti?tab=partite">{t("caricoPratiche.legacy")}</Link>
          </Button>
        </div>
      )}

      <Dialog
        open={activityOpen}
        onOpenChange={(open) => {
          setActivityOpen(open);
          if (!open) {
            setActivityError(null);
            setActivityAttempted(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("caricoPratiche.newActivityTitle")}</DialogTitle>
            <DialogDescription>
              {t("caricoPratiche.activityArea", {
                area:
                  areas.find((item) => item.id === selectedAreaId)?.nome ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {activityError && (
            <Alert variant="destructive">
              <AlertDescription>{activityError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="carico-activity-code">
              {t("caricoPratiche.activityCodePrompt")} *
            </Label>
            <Input
              id="carico-activity-code"
              value={activityCode}
              maxLength={80}
              aria-invalid={activityAttempted && !activityCode.trim()}
              aria-describedby={
                activityAttempted && !activityCode.trim()
                  ? "carico-activity-code-error"
                  : undefined
              }
              className={
                activityAttempted && !activityCode.trim()
                  ? "border-destructive ring-1 ring-destructive"
                  : undefined
              }
              onChange={(event) => setActivityCode(event.target.value)}
            />
            {activityAttempted && !activityCode.trim() && (
              <p
                id="carico-activity-code-error"
                className="text-sm text-destructive"
              >
                {t("caricoPratiche.activityCodeRequired")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="carico-activity-description">
              {t("caricoPratiche.activityDescriptionPrompt")} *
            </Label>
            <Input
              id="carico-activity-description"
              value={activityDescription}
              maxLength={200}
              aria-invalid={activityAttempted && !activityDescription.trim()}
              aria-describedby={
                activityAttempted && !activityDescription.trim()
                  ? "carico-activity-description-error"
                  : undefined
              }
              className={
                activityAttempted && !activityDescription.trim()
                  ? "border-destructive ring-1 ring-destructive"
                  : undefined
              }
              onChange={(event) => setActivityDescription(event.target.value)}
            />
            {activityAttempted && !activityDescription.trim() && (
              <p
                id="carico-activity-description-error"
                className="text-sm text-destructive"
              >
                {t("caricoPratiche.activityDescriptionRequired")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={createLogicalLotMutation.isPending}
              onClick={() => setActivityOpen(false)}
            >
              {t("barcodeScanner.cancel")}
            </Button>
            <Button
              disabled={createLogicalLotMutation.isPending}
              onClick={() => void createLogicalLot()}
            >
              {t("caricoPratiche.createActivity")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmRegister} onOpenChange={setConfirmRegister}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("caricoPratiche.confirmRegister")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("caricoPratiche.confirmBody", {
                count: selectedRows.size,
                warehouse: practice?.magazzinoNome ?? "",
              })}
            </AlertDialogDescription>
            <ul className="max-h-56 list-disc space-y-1 overflow-auto ps-5 text-sm">
              {selectedPendingRows.map((row) => (
                <li key={row.id}>
                  {row.prodottoNome}:{" "}
                  {rowDrafts[row.id]?.quantita ?? row.quantita}{" "}
                  {row.unitaMisura}
                </li>
              ))}
            </ul>
            {registerError && (
              <Alert variant="destructive">
                <AlertDescription>{registerError}</AlertDescription>
              </Alert>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={registerMutation.isPending}>
              {t("barcodeScanner.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                registerMutation.isPending || selectedRowsHaveUnsavedChanges
              }
              onClick={(event) => {
                event.preventDefault();
                void registerRows();
              }}
            >
              {registerMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("caricoPratiche.confirmLoad")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog guard={unsavedGuard} />

      {practice && (
        <FseImportPracticeWizard
          open={fseImportOpen}
          onOpenChange={setFseImportOpen}
          practice={practice}
          products={products}
          onPracticeReady={(practiceId) => {
            setSelectedId(practiceId);
            void queryClient.invalidateQueries({
              queryKey: ["/api/carico-pratiche"],
            });
            if (practiceId === practice.id) void detailQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
