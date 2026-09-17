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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  isCaricoRowDraftDirty,
  newCommandKey,
  normalizeUiQuantity,
  operationalWarehousesForArea,
  productForBarcode,
  shouldAcceptBarcodeScan,
  type CaricoRowDraft,
  visibleProducts,
} from "@/lib/carico-merce";
import { ArrowLeft, History, Loader2, PackagePlus, Save } from "lucide-react";

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
    origineCarico: practice.origineCarico,
    dataCarico: practice.dataCarico,
    descrizione: practice.descrizione,
    numeroDocumento: practice.numeroDocumento ?? "",
    note: practice.note ?? "",
  };
}

function rowDraft(row: CaricoPraticaRiga): CaricoRowDraft {
  return {
    quantita: row.quantita?.toString() ?? "",
    fondoOrigine: row.fondoOrigine === "FSE_PLUS" ? "FSE_PLUS" : "NESSUN_FONDO",
    codiceLottoProduttore: row.codiceLottoProduttore ?? "",
    dataScadenza: row.dataScadenza ?? "",
    fattoreKgLtPezzo: row.fattoreKgLtPezzo?.toString() ?? "",
    note: row.note ?? "",
  };
}

function statusLabel(t: (key: string) => string, status: string) {
  return t(`caricoPratiche.status${status[0].toUpperCase()}${status.slice(1)}`);
}

export default function CaricoMerce() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canReceive = hasPermission("magazzino.stock.receive");
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
  const registrationKey = useRef<string | null>(null);
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
  const isRowDirty = (row: CaricoPraticaRiga) =>
    isCaricoRowDraftDirty(rowDrafts[row.id] ?? rowDraft(row), rowDraft(row));
  const rowsHaveUnsavedChanges = pendingRows.some(isRowDirty);
  const selectedRowsHaveUnsavedChanges = pendingRows.some(
    (row) => selectedRows.has(row.id) && isRowDirty(row),
  );
  const hasUnsavedChanges = dirty || rowsHaveUnsavedChanges;
  const unsavedGuard = useUnsavedChangesGuard(hasUnsavedChanges);

  useEffect(() => {
    if (!practice) return;
    setHeader(headerFromPractice(practice));
    setRowDrafts(
      Object.fromEntries(practice.righe.map((row) => [row.id, rowDraft(row)])),
    );
    setSelectedRows(
      new Set(
        practice.righe
          .filter((row) => !row.registrata && row.quantita != null)
          .map((row) => row.id),
      ),
    );
    setDirty(false);
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
    selectedAreaId != null &&
    Boolean(header.magazzinoId) &&
    Boolean(header.lottoLogicoId) &&
    Boolean(header.dataCarico) &&
    Boolean(header.descrizione.trim());

  const saveHeader = async () => {
    if (!validHeader) {
      toast({
        title: t("caricoPratiche.requiredHeader"),
        variant: "destructive",
      });
      return;
    }
    try {
      if (creating) {
        const created = await createMutation.mutateAsync({
          data: { ...headerPayload(), righe: [] },
        });
        setCreating(false);
        setSelectedId(created.id);
        updateDetailCache(created);
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
    } catch (error) {
      showError(error);
    }
  };

  const createLogicalLot = async () => {
    if (selectedAreaId == null || !canReceive) return;
    const code = window.prompt(t("caricoPratiche.activityCodePrompt"));
    if (!code?.trim()) return;
    const description = window.prompt(
      t("caricoPratiche.activityDescriptionPrompt"),
    );
    if (!description?.trim()) return;
    try {
      const created = await createLogicalLotMutation.mutateAsync({
        data: {
          areaOperativaId: selectedAreaId,
          codice: code.trim(),
          descrizione: description.trim(),
        },
      });
      await logicalLotsQuery.refetch();
      setHeader((current) => ({
        ...current,
        lottoLogicoId: String(created.id),
      }));
      setDirty(true);
    } catch (error) {
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
    const draft = rowDrafts[row.id];
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
      updateDetailCache(updated);
    } catch (error) {
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
    } catch (error) {
      showError(error);
    }
  };

  const registerRows = async () => {
    if (!practice || selectedRows.size === 0 || selectedRowsHaveUnsavedChanges)
      return;
    registrationKey.current ??= newCommandKey();
    try {
      await registerMutation.mutateAsync({
        id: practice.id,
        data: {
          versione: practice.versione,
          rigaIds: [...selectedRows],
          idempotencyKey: registrationKey.current,
        },
      });
      registrationKey.current = null;
      setConfirmRegister(false);
      await detailQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["/api/carico-pratiche"],
      });
      toast({ title: t("caricoPratiche.registered") });
    } catch (error) {
      setConfirmRegister(false);
      showError(error);
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
    } catch (error) {
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
                  setCreating(true);
                }}
              >
                <PackagePlus className="mr-2 h-4 w-4" />
                {t("caricoPratiche.newPractice")}
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
          <div className="flex items-center gap-2">
            <strong>{practice.codice}</strong>
            <Badge>{statusLabel(t, practice.stato)}</Badge>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("caricoPratiche.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("caricoPratiche.area")}</Label>
            <Select
              disabled={Boolean(practice?.integrazioni.length) || pending}
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
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.warehouse")}</Label>
            <Select
              disabled={Boolean(practice?.integrazioni.length) || pending}
              value={header.magazzinoId}
              onValueChange={(value) => {
                setHeader((current) => ({ ...current, magazzinoId: value }));
                setDirty(true);
              }}
            >
              <SelectTrigger aria-label={t("caricoPratiche.warehouse")}>
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
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.activity")}</Label>
            <Select
              disabled={Boolean(practice?.integrazioni.length) || pending}
              value={header.lottoLogicoId}
              onValueChange={(value) => {
                setHeader((current) => ({ ...current, lottoLogicoId: value }));
                setDirty(true);
              }}
            >
              <SelectTrigger aria-label={t("caricoPratiche.activity")}>
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
            {canReceive &&
              selectedAreaId != null &&
              !practice?.integrazioni.length && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0"
                  disabled={pending}
                  onClick={() => void createLogicalLot()}
                >
                  {t("caricoPratiche.newActivity")}
                </Button>
              )}
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.origin")}</Label>
            <Select
              disabled={Boolean(practice?.integrazioni.length) || pending}
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
            <Label>{t("caricoPratiche.date")}</Label>
            <Input
              aria-label={t("caricoPratiche.date")}
              disabled={Boolean(practice?.integrazioni.length) || pending}
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
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.description")}</Label>
            <Input
              aria-label={t("caricoPratiche.description")}
              disabled={pending}
              value={header.descrizione}
              onChange={(event) => {
                setHeader((current) => ({
                  ...current,
                  descrizione: event.target.value,
                }));
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("caricoPratiche.document")}</Label>
            <Input
              aria-label={t("caricoPratiche.document")}
              disabled={Boolean(practice?.integrazioni.length) || pending}
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
              disabled={pending}
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
              disabled={
                pending || !validHeader || Boolean(practice && !canEdit)
              }
              onClick={() => void saveHeader()}
            >
              <Save className="mr-2 h-4 w-4" />
              {t("caricoPratiche.saveDraft")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {practice && canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t("caricoPratiche.addProduct")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
            {pendingRows.map((row) => {
              const draft = rowDrafts[row.id] ?? rowDraft(row);
              return (
                <div
                  key={row.id}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-2 lg:grid-cols-4"
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedRows.has(row.id)}
                      disabled={row.quantita == null || pending}
                      onCheckedChange={(checked) =>
                        setSelectedRows((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                    <div>
                      <strong>{row.prodottoNome}</strong>
                      <p className="text-xs text-muted-foreground">
                        {row.prodottoCodice}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>
                      {t("caricoPratiche.quantity", { unit: row.unitaMisura })}
                    </Label>
                    <Input
                      aria-label={t("caricoPratiche.quantity", {
                        unit: row.unitaMisura,
                      })}
                      inputMode="decimal"
                      step={row.quantitaFrazionabile ? "0.000001" : "1"}
                      value={draft.quantita}
                      onChange={(event) => {
                        setRowDrafts((current) => ({
                          ...current,
                          [row.id]: { ...draft, quantita: event.target.value },
                        }));
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t("caricoPratiche.fund")}</Label>
                    <Select
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
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NESSUN_FONDO">
                          {t("caricoPratiche.noFund")}
                        </SelectItem>
                        <SelectItem value="FSE_PLUS">FSE+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>
                      {t("caricoPratiche.physicalLot")}
                      {row.lottoFisicoObbligatorio ? " *" : ""}
                    </Label>
                    <Input
                      aria-label={t("caricoPratiche.physicalLot")}
                      value={draft.codiceLottoProduttore}
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
                  </div>
                  <div className="space-y-1">
                    <Label>
                      {t("caricoPratiche.expiry")}
                      {row.gestioneScadenza ? " *" : ""}
                    </Label>
                    <Input
                      aria-label={t("caricoPratiche.expiry")}
                      type="date"
                      value={draft.dataScadenza}
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
                  </div>
                  <div className="space-y-1">
                    <Label>{t("caricoPratiche.notes")}</Label>
                    <Input
                      value={draft.note}
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
                      <Label>{t("caricoPratiche.factor")}</Label>
                      <Input
                        inputMode="decimal"
                        value={draft.fattoreKgLtPezzo}
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
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      disabled={pending || !canEdit}
                      onClick={() => void saveRow(row)}
                    >
                      {t("caricoPratiche.saveDraft")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending || !canEdit}
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
                </div>
              );
            })}
            {pendingRows.length === 0 && (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            <Button
              aria-describedby={
                selectedRowsHaveUnsavedChanges
                  ? "carico-register-unsaved"
                  : undefined
              }
              disabled={
                pending ||
                selectedRows.size === 0 ||
                !canEdit ||
                selectedRowsHaveUnsavedChanges
              }
              onClick={() => setConfirmRegister(true)}
            >
              {registerMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("caricoPratiche.register")}
            </Button>
            {selectedRowsHaveUnsavedChanges && (
              <p
                id="carico-register-unsaved"
                role="status"
                className="text-sm text-amber-700 dark:text-amber-300"
              >
                {t("caricoPratiche.saveSelectedRowsBeforeRegister")}
              </p>
            )}
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

      <AlertDialog open={confirmRegister} onOpenChange={setConfirmRegister}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("caricoPratiche.confirmRegister")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("caricoPratiche.confirmBody", { count: selectedRows.size })}
            </AlertDialogDescription>
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
              {t("caricoPratiche.register")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog guard={unsavedGuard} />
    </div>
  );
}
