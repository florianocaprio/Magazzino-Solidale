import { useState, useEffect } from "react";
import { authUserCanOperateBolle, useAuth } from "@/lib/auth";
import { Link } from "wouter";
import {
  useListBolle,
  useCreateBolla,
  useGetBolla,
  useAddBollaRiga,
  useDeleteBollaRiga,
  useConfermaBolla,
  useConsegnaBolla,
  useAffidaBolla,
  useSegnalaMancataConsegnaBolla,
  useSegnalaMancatoArrivoTrasferimento,
  useAnnullaBolla,
  useStornaAmministrativamenteBolla,
  useUpdateBolla,
  useListBeneficiari,
  useListCentriAscolto,
  useListMagazzini,
  useListGiacenze,
  useListLotti,
  useListProdotti,
  useListVolontari,
  useListMezzi,
  useGetImpostazioniStampa,
  useListDocumentiOperativi,
  useGetDocumentoOperativo,
  useGetDocumentoOperativoRichiesta,
  useGetRichiestaMagazzino,
  getGetRichiestaMagazzinoQueryKey,
  useListBollaVolontariCandidati,
  getListBollaVolontariCandidatiQueryKey,
  useGetTrasferimento,
  useAvviaTrasferimento,
  usePreparaTrasferimento,
  useAnnullaTrasferimento,
  useConfermaTrasferimento,
  getDocumentoOperativo,
  getDocumentoOperativoRichiesta,
  listBeneficiari,
  exportDocumentiOperativi,
  getListDocumentiOperativiQueryKey,
  getGetDocumentoOperativoQueryKey,
  getGetDocumentoOperativoRichiestaQueryKey,
  getListRichiesteMagazzinoQueryKey,
  getGetTrasferimentoQueryKey,
  useListConsegne,
  useGetConsegna,
  useAssociaBolla,
  useSegnalaRitiroNonEffettuato,
  useConvertiBollaInConsegna,
  useListEntiDestinatari,
  getListEntiDestinatariQueryKey,
  useListAreeOperative,
  getBolla,
  getListBolleQueryKey,
  getListBeneficiariQueryKey,
  getListCentriAscoltoQueryKey,
  getGetBollaQueryKey,
  getListGiacenzeQueryKey,
  getListConsegneQueryKey,
  getGetConsegnaQueryKey,
  getListVolontariQueryKey,
  type ConversioneConsegnaInputFasciaOraria,
  type BollaDettaglio as BollaDettaglioDto,
  type Trasferimento,
  type ListDocumentiOperativiParams,
  type ExportDocumentiOperativiParams,
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
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { BeneficiarioCombobox } from "@/components/beneficiario-combobox";
import { EnteDestinatarioCombobox } from "@/components/ente-destinatario-combobox";
import {
  bollaErrorMessage,
  invalidateBollaViews,
} from "@/lib/bolla-query-invalidation";
import {
  AUTO_FEFO_LOT,
  bollaAddProductInput,
  selectedPhysicalLot,
} from "@/lib/bolla-add-product";
import { RouteActions } from "@/components/maps/route-actions";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { volontarioLabel } from "@/lib/volontari-label";
import {
  Plus,
  FileText,
  Trash2,
  PackagePlus,
  CheckCircle,
  Truck,
  ChevronRight,
  XCircle,
  Pencil,
  User,
  Download,
  ArrowRight,
  ArrowLeft,
  ArrowRightLeft,
  ScanLine,
  CalendarClock,
  AlertTriangle,
  House,
  Play,
  CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateBollaPdf, type BollaTemplate } from "@/lib/bolla-pdf";
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/hooks/use-unsaved-changes-guard";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import { useCommandIntentRegistry } from "@/lib/command-intent";
import { administrativeReversalReady } from "@/lib/bolla-admin-reversal";
import {
  DEFAULT_DOCUMENTO_FILTERS,
  documentListScopeChanged,
  documentiOperativiQuery,
  normalizeDocumentFiltersForAccess,
  readDocumentiOperativiUrl,
  writeDocumentiOperativiUrl,
  type DocumentoOperativoFilters,
  type DocumentoOperativoSelection,
} from "@/lib/documenti-operativi-url";
import { useTranslation } from "react-i18next";
import { TransportReturnPanel } from "@/components/transport-return-panel";
import i18n from "@/lib/i18n";
import { shouldFetchBollaBeneficiari } from "@/lib/bolle-beneficiari-query";
import {
  ModificaTrasferimentoForm,
  NuovoTrasferimentoForm,
} from "@/pages/trasferimenti";

import {
  CreaiBollaDialog,
  DocumentoOperativoDettaglioComune,
  statoBadge,
  trasferimentoStatoBadge,
  generateBollaPdfFromData,
  type BeneficiarioLite,
} from "@/components/documento-operativo";
import { filtersAfterDocumentCreation } from "@/lib/documenti-operativi-url";
export {
  CreaiBollaDialog,
  BollaDettaglio,
  downloadBollaPdf,
} from "@/components/documento-operativo";

export default function Bolle() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canViewBolle = hasPermission("bolle.view");
  const canViewTransfers = hasPermission("magazzino.view");
  const canManage = authUserCanOperateBolle(user, "bolle.manage");
  const canDeliver = authUserCanOperateBolle(user, "bolle.deliver");
  const canCreateTransfer = hasPermission("magazzino.transfers.create");
  const canCreateBolla = canViewBolle && canManage;
  const canCreateVisibleTransfer = canViewTransfers && canCreateTransfer;
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const access = { canViewBolle, canViewTransfers };
  const normalizeFilters = (candidate: DocumentoOperativoFilters) => {
    const normalized = normalizeDocumentFiltersForAccess(candidate, access);
    return isCentroLocked
      ? { ...normalized, centroAscoltoId: "all" }
      : normalized;
  };
  const initialUrl = readDocumentiOperativiUrl(window.location.search);
  const [filters, setFilters] = useState<DocumentoOperativoFilters>(() =>
    normalizeFilters(initialUrl.filters),
  );
  const [page, setPage] = useState(initialUrl.page);
  const [selectedDocumento, setSelectedDocumento] =
    useState<DocumentoOperativoSelection | null>(() => {
      const selection = initialUrl.selection;
      if (selection?.tipo === "bolla" && !canViewBolle) return null;
      if (selection?.tipo === "trasferimento" && !canViewTransfers) return null;
      return selection;
    });
  const [detailDraftDirty, setDetailDraftDirty] = useState(false);
  const detailUnsavedGuard = useUnsavedChangesGuard(detailDraftDirty);
  const pageSize = 50;

  useEffect(() => {
    const onPopState = () => {
      const parsed = readDocumentiOperativiUrl(window.location.search);
      const nextFilters = normalizeFilters(parsed.filters);
      const scopeChanged = documentListScopeChanged(filters, nextFilters);
      const requestedSelection = parsed.selection;
      let nextSelection =
        requestedSelection?.tipo === "bolla" && !canViewBolle
          ? null
          : requestedSelection?.tipo === "trasferimento" && !canViewTransfers
            ? null
            : requestedSelection;
      const selectionChanged =
        selectedDocumento?.tipo !== nextSelection?.tipo ||
        selectedDocumento?.id !== nextSelection?.id;

      if (
        detailDraftDirty &&
        (scopeChanged || selectionChanged) &&
        !window.confirm(i18n.t("common.unsavedChangesDesc"))
      ) {
        const restoredSearch = writeDocumentiOperativiUrl(
          window.location.search,
          filters,
          selectedDocumento,
          page,
        );
        window.history.pushState(
          { ...window.history.state, documentoOperativo: true },
          "",
          `${window.location.pathname}${restoredSearch}${window.location.hash}`,
        );
        return;
      }

      if (scopeChanged) nextSelection = null;
      if (scopeChanged || selectionChanged) {
        if (selectedDocumento) {
          void queryClient.cancelQueries({
            queryKey: getGetDocumentoOperativoQueryKey(
              selectedDocumento.tipo,
              selectedDocumento.id,
            ),
          });
        }
        setDetailDraftDirty(false);
      }
      setFilters(nextFilters);
      setPage(parsed.page);
      setSelectedDocumento(nextSelection);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    canViewBolle,
    canViewTransfers,
    detailDraftDirty,
    filters,
    isCentroLocked,
    page,
    queryClient,
    selectedDocumento,
  ]);

  useEffect(() => {
    const search = writeDocumentiOperativiUrl(
      window.location.search,
      filters,
      selectedDocumento,
      page,
    );
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl)
      window.history.replaceState(window.history.state, "", nextUrl);
  }, [filters, page, selectedDocumento]);

  const openDocumento = (selection: DocumentoOperativoSelection) => {
    setDetailDraftDirty(false);
    setSelectedDocumento(selection);
    const search = writeDocumentiOperativiUrl(
      window.location.search,
      filters,
      selection,
      page,
    );
    window.history.pushState(
      { ...window.history.state, documentoOperativo: true },
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  };
  const closeDocumento = () => {
    if (selectedDocumento) {
      void queryClient.cancelQueries({
        queryKey: getGetDocumentoOperativoQueryKey(
          selectedDocumento.tipo,
          selectedDocumento.id,
        ),
      });
    }
    setDetailDraftDirty(false);
    setSelectedDocumento(null);
    const search = writeDocumentiOperativiUrl(
      window.location.search,
      filters,
      null,
      page,
    );
    window.history.replaceState(
      { ...window.history.state, documentoOperativo: false },
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  };
  const requestCloseDocumento = () => {
    detailUnsavedGuard.requestClose(closeDocumento);
  };
  const updateFilters = (patch: Partial<DocumentoOperativoFilters>) => {
    const nextFilters = normalizeFilters({ ...filters, ...patch });
    const scopeChanged = documentListScopeChanged(filters, nextFilters);
    const apply = () => {
      if (scopeChanged && selectedDocumento) closeDocumento();
      setFilters(nextFilters);
      setPage(1);
    };
    if (scopeChanged && selectedDocumento && detailDraftDirty) {
      detailUnsavedGuard.requestClose(apply);
      return;
    }
    apply();
  };

  const documentParams = documentiOperativiQuery(filters, {
    page,
    limit: pageSize,
    lockedCentroId,
  }) as ListDocumentiOperativiParams;
  const documentAccessScope = {
    userId: user?.id ?? null,
    centroAscoltoId: user?.centroAscoltoId ?? null,
    areaOperativaId: user?.areaOperativaId ?? null,
    zonaUdsId: user?.zonaUdsId ?? null,
    canViewBolle,
    canViewTransfers,
  };
  const { data: documenti, isLoading } = useListDocumentiOperativi(
    documentParams,
    {
      query: {
        enabled: canViewBolle || canViewTransfers,
        queryKey: [
          ...getListDocumentiOperativiQueryKey(documentParams),
          documentAccessScope,
        ],
      },
    },
  );
  const { data: centri } = useListCentriAscolto({
    query: {
      enabled: canViewBolle,
      queryKey: getListCentriAscoltoQueryKey(),
    },
  });
  const { data: magazzini } = useListMagazzini();
  const { data: areeOperative } = useListAreeOperative();
  const { data: impostazioni } = useGetImpostazioniStampa();
  const consegnaBolla = useConsegnaBolla();
  const { toast } = useToast();
  const { t } = useTranslation();
  const commandIntents = useCommandIntentRegistry();
  const [createOpen, setCreateOpen] = useState(false);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [createTransferOpen, setCreateTransferOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingTrasfId, setDownloadingTrasfId] = useState<number | null>(
    null,
  );
  const [downloadingBollaId, setDownloadingBollaId] = useState<number | null>(
    null,
  );
  const [consegnandoBollaId, setConsegnandoBollaId] = useState<number | null>(
    null,
  );

  const downloadBolla = async (e: React.MouseEvent, bollaId: number) => {
    e.stopPropagation();
    setDownloadingBollaId(bollaId);
    try {
      const documento = await getDocumentoOperativo("bolla", bollaId);
      if (documento.tipoAggregato !== "bolla")
        throw new Error("tipo documento non coerente");
      // Il PDF legacy può usare il Centro della directory; un documento M5B
      // collegato usa soltanto il DTO autorizzato e non carica la directory.
      let beneficiari: BeneficiarioLite[] | undefined;
      if (hasPermission("richieste_magazzino.view")) {
        const origine = await getDocumentoOperativoRichiesta("bolla", bollaId);
        if (!origine.richiesta && hasPermission("beneficiari.view"))
          beneficiari = await listBeneficiari();
      }
      await generateBollaPdfFromData(documento.dettaglio as BollaDettaglioDto, {
        beneficiari,
        centri,
        footer: impostazioni?.footerBolla ?? null,
        template: (impostazioni?.templateBolla as BollaTemplate) ?? "standard",
      });
    } catch {
      toast({
        title: t("bolle.error"),
        description: t("bolle.genBollaError"),
        variant: "destructive",
      });
    } finally {
      setDownloadingBollaId(null);
    }
  };

  const markConsegnato = (
    e: React.MouseEvent,
    bollaId: number,
    versione: number,
  ) => {
    e.stopPropagation();
    setConsegnandoBollaId(bollaId);
    const slot = `bolla:${bollaId}:deliver`;
    consegnaBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(slot, {}, { versione }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListDocumentiOperativiQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getListGiacenzeQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: getListConsegneQueryKey(),
          });
          toast({ title: t("bolle.consegnaCompletata") });
        },
        onError: (error) => {
          commandIntents.fail(slot, error);
          toast({
            title: t("bolle.error"),
            description: t("bolle.consegnaError"),
            variant: "destructive",
          });
        },
        onSettled: () => setConsegnandoBollaId(null),
      },
    );
  };

  const downloadTrasf = async (
    e: React.MouseEvent,
    trasferimentoId: number,
  ) => {
    e.stopPropagation();
    setDownloadingTrasfId(trasferimentoId);
    try {
      const documento = await getDocumentoOperativo(
        "trasferimento",
        trasferimentoId,
      );
      if (documento.tipoAggregato !== "trasferimento")
        throw new Error("tipo documento non coerente");
      const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
      await generateTrasferimentoPdf({
        trasferimento: documento.dettaglio as Trasferimento,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl: logoDataUrl,
        branding,
      });
    } catch {
      toast({
        title: t("bolle.error"),
        description: t("bolle.genBollaError"),
        variant: "destructive",
      });
    } finally {
      setDownloadingTrasfId(null);
    }
  };

  const exportFilteredDocuments = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = documentiOperativiQuery(filters, {
        lockedCentroId,
      }) as ExportDocumentiOperativiParams;
      const blob = await exportDocumentiOperativi(params);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "documenti-operativi.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: t("bolle.error"),
        description: t("bolle.exportError", {
          defaultValue: "Impossibile esportare i documenti filtrati",
        }),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  type Row =
    | {
        kind: "bolla";
        bolla: {
          id: number;
          numeroBolla: string;
          dataBolla: string;
          beneficiarioNome: string | null;
          magazzinoNome: string | null;
          centroAscoltoNome: null;
          stato: string;
          tipoDestinatario: string;
          versione: number;
          centroHandoff: boolean;
        };
      }
    | {
        kind: "trasf";
        trasf: {
          id: number;
          codice: string;
          dataRichiesta: string;
          magazzinoOrigineNome: string | null;
          magazzinoDestinoNome: string | null;
          stato: string;
        };
      };

  const rows: Row[] = (documenti?.items ?? []).map(
    (documento): Row =>
      documento.tipoAggregato === "bolla"
        ? {
            kind: "bolla",
            bolla: {
              id: documento.id,
              numeroBolla: documento.numero,
              dataBolla: documento.dataDocumento,
              beneficiarioNome: documento.destinatarioNome ?? null,
              magazzinoNome: documento.origineNome ?? null,
              centroAscoltoNome: null,
              stato: documento.stato,
              tipoDestinatario: documento.tipoDestinatario,
              versione: documento.versione,
              centroHandoff: documento.centroHandoff,
            },
          }
        : {
            kind: "trasf",
            trasf: {
              id: documento.id,
              codice: documento.numero,
              dataRichiesta: documento.dataDocumento,
              magazzinoOrigineNome: documento.origineNome ?? null,
              magazzinoDestinoNome: documento.destinazioneMagazzinoNome ?? null,
              stato: documento.stato,
            },
          },
  );

  const baselineFilters = normalizeFilters(DEFAULT_DOCUMENTO_FILTERS);
  const filtersActive = Object.entries(filters).some(
    ([key, value]) =>
      value !== baselineFilters[key as keyof DocumentoOperativoFilters],
  );
  const magazziniFiltrati = (magazzini ?? []).filter(
    (magazzino) =>
      filters.areaOperativaId === "all" ||
      String(magazzino.areaOperativaId) === filters.areaOperativaId,
  );
  const statusOptions =
    filters.tipoAggregato === "bolla"
      ? [
          "bozza",
          "confermato",
          "in_trasporto",
          "rientro_atteso",
          "rientrato",
          "consegnato",
          "annullato",
        ]
      : filters.tipoAggregato === "trasferimento"
        ? [
            "richiesto",
            "preparato",
            "in_transito",
            "rientro_atteso",
            "rientrato",
            "completato",
            "annullato",
          ]
        : [
            "bozza",
            "confermato",
            "in_trasporto",
            "rientro_atteso",
            "rientrato",
            "consegnato",
            "richiesto",
            "preparato",
            "in_transito",
            "completato",
            "annullato",
          ];
  const statusLabel = (stato: string) => {
    const labels: Record<string, string> = {
      bozza: t("bolle.statoBozza"),
      confermato: t("bolle.statoConfermato"),
      in_trasporto: t("transportReturn.inDelivery"),
      rientro_atteso: t("transportReturn.awaitingReturn"),
      rientrato: t("transportReturn.returned"),
      consegnato: t("bolle.statoConsegnato"),
      annullato: t("bolle.statoAnnullato"),
      richiesto: t("trasferimenti.statusRichiesto"),
      preparato: t("trasferimenti.statusPreparato"),
      in_transito: t("trasferimenti.statusInTransito"),
      completato: t("trasferimenti.statusCompletato"),
    };
    return labels[stato] ?? stato.replaceAll("_", " ");
  };

  const loading = isLoading;
  const hasNextPage = page * pageSize < (documenti?.total ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("bolle.title")}
          </h1>
          <p className="text-muted-foreground">{t("bolle.subtitle")}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void exportFilteredDocuments()}
            disabled={exporting || loading}
          >
            <Download className="h-4 w-4" />
            {exporting
              ? t("common.loading")
              : t("bolle.exportFiltered", {
                  defaultValue: "Esporta XLSX",
                })}
          </Button>
          {(canCreateBolla || canCreateVisibleTransfer) && (
            <Button onClick={() => setCreateChoiceOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> {t("common.new")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("common.status")}
          </Label>
          <Select
            value={filters.stato}
            onValueChange={(value) => updateFilters({ stato: value })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("bolle.allStati")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("bolle.allStati")}</SelectItem>
              {statusOptions.map((stato) => (
                <SelectItem key={stato} value={stato}>
                  {statusLabel(stato)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("bolle.tipoDocumento", { defaultValue: "Tipo documento" })}
          </Label>
          <Select
            value={filters.tipoAggregato}
            onValueChange={(value) =>
              updateFilters({
                tipoAggregato:
                  value as DocumentoOperativoFilters["tipoAggregato"],
              })
            }
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canViewBolle && canViewTransfers && (
                <SelectItem value="all">
                  {t("bolle.allDocuments", {
                    defaultValue: "Tutti i documenti",
                  })}
                </SelectItem>
              )}
              {canViewBolle && (
                <SelectItem value="bolla">{t("bolle.title")}</SelectItem>
              )}
              {canViewTransfers && (
                <SelectItem value="trasferimento">
                  {t("trasferimenti.title")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("bolle.destinatarioLabel", { defaultValue: "Destinatario" })}
          </Label>
          <Select
            value={filters.destinatario}
            onValueChange={(value) =>
              updateFilters({
                destinatario:
                  value as DocumentoOperativoFilters["destinatario"],
              })
            }
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("bolle.allRecipients", {
                  defaultValue: "Tutti i destinatari",
                })}
              </SelectItem>
              {canViewBolle && filters.tipoAggregato !== "trasferimento" && (
                <>
                  <SelectItem value="beneficiario">
                    {t("bolle.beneficiario", { defaultValue: "Beneficiario" })}
                  </SelectItem>
                  <SelectItem value="ente">
                    {t("bolle.enteDestinatario", {
                      defaultValue: "Ente destinatario",
                    })}
                  </SelectItem>
                </>
              )}
              {canViewTransfers && filters.tipoAggregato !== "bolla" && (
                <SelectItem value="magazzino">
                  {t("bolle.magazzinoLabel")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("common.areaOperativa", { defaultValue: "Area Operativa" })}
          </Label>
          <Select
            value={filters.areaOperativaId}
            onValueChange={(value) =>
              updateFilters({ areaOperativaId: value, magazzinoId: "all" })
            }
          >
            <SelectTrigger className="w-[210px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("bolle.allAreas", { defaultValue: "Tutte le Aree" })}
              </SelectItem>
              {(areeOperative ?? []).map((area) => (
                <SelectItem key={area.id} value={String(area.id)}>
                  {area.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("bolle.magazzinoLabel")}
          </Label>
          <Select
            value={filters.magazzinoId}
            onValueChange={(value) => updateFilters({ magazzinoId: value })}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder={t("bolle.allMagazzini")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("bolle.allMagazzini")}</SelectItem>
              {magazziniFiltrati.map((magazzino) => (
                <SelectItem key={magazzino.id} value={String(magazzino.id)}>
                  {magazzino.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isGlobal &&
          canViewBolle &&
          filters.tipoAggregato !== "trasferimento" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("bolle.centroLabel")}
              </Label>
              <Select
                value={filters.centroAscoltoId}
                onValueChange={(value) =>
                  updateFilters({ centroAscoltoId: value })
                }
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("bolle.allCentriPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("bolle.allCentriPlaceholder")}
                  </SelectItem>
                  {(centri ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

        <div className="space-y-1.5">
          <Label
            htmlFor="documenti-data-da"
            className="text-xs text-muted-foreground"
          >
            {t("bolle.dataDa", { defaultValue: "Dal" })}
          </Label>
          <Input
            id="documenti-data-da"
            type="date"
            value={filters.dataDa}
            max={filters.dataA || undefined}
            className="w-[155px]"
            onChange={(event) => updateFilters({ dataDa: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="documenti-data-a"
            className="text-xs text-muted-foreground"
          >
            {t("bolle.dataA", { defaultValue: "Al" })}
          </Label>
          <Input
            id="documenti-data-a"
            type="date"
            value={filters.dataA}
            min={filters.dataDa || undefined}
            className="w-[155px]"
            onChange={(event) => updateFilters({ dataA: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="documenti-ricerca"
            className="text-xs text-muted-foreground"
          >
            {t("common.search")}
          </Label>
          <Input
            id="documenti-ricerca"
            value={filters.ricerca}
            maxLength={120}
            className="w-[220px]"
            placeholder={t("bolle.searchDocuments", {
              defaultValue: "Numero o magazzino",
            })}
            onChange={(event) => updateFilters({ ricerca: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("bolle.sortBy", { defaultValue: "Ordina per" })}
          </Label>
          <Select
            value={filters.sortBy}
            onValueChange={(value) =>
              updateFilters({
                sortBy: value as DocumentoOperativoFilters["sortBy"],
              })
            }
          >
            <SelectTrigger className="w-[165px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dataDocumento">
                {t("bolle.documentDate", { defaultValue: "Data documento" })}
              </SelectItem>
              <SelectItem value="dataCreazione">
                {t("bolle.latestInserted")}
              </SelectItem>
              <SelectItem value="numero">{t("bolle.numero")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("bolle.sortDirection", { defaultValue: "Direzione" })}
          </Label>
          <Select
            value={filters.sortDirection}
            onValueChange={(value) =>
              updateFilters({
                sortDirection:
                  value as DocumentoOperativoFilters["sortDirection"],
              })
            }
          >
            <SelectTrigger className="w-[145px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">
                {t("bolle.newestFirst", { defaultValue: "Decrescente" })}
              </SelectItem>
              <SelectItem value="asc">
                {t("bolle.oldestFirst", { defaultValue: "Crescente" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filtersActive && (
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => updateFilters(DEFAULT_DOCUMENTO_FILTERS)}
          >
            <XCircle className="h-4 w-4" /> {t("bolle.azzeraFiltri")}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bolle.numero")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>
                  {t("bolle.destinatarioLabel", {
                    defaultValue: "Destinatario",
                  })}
                </TableHead>
                <TableHead>{t("bolle.magazzinoLabel")}</TableHead>
                {isGlobal && <TableHead>{t("common.centro")}</TableHead>}
                <TableHead className="text-center">
                  {t("common.status")}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      {Array(isGlobal ? 7 : 6)
                        .fill(0)
                        .map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        ))}
                    </TableRow>
                  ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isGlobal ? 7 : 6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    {filtersActive
                      ? t("bolle.noDocFiltri")
                      : t("bolle.noBolle")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) =>
                  row.kind === "bolla" ? (
                    <TableRow
                      key={`b-${row.bolla.id}`}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        openDocumento({ tipo: "bolla", id: row.bolla.id })
                      }
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {row.bolla.numeroBolla}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(row.bolla.dataBolla), "dd MMM yyyy", {
                          locale: it,
                        })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.bolla.beneficiarioNome ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.bolla.magazzinoNome ?? "—"}
                      </TableCell>
                      {isGlobal && (
                        <TableCell className="text-sm text-muted-foreground">
                          {row.bolla.centroAscoltoNome ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        {statoBadge(row.bolla.stato)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.bolla.stato === "confermato" &&
                            !row.bolla.centroHandoff &&
                            canDeliver && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 text-green-700 border-green-300 hover:bg-green-50 hover:text-green-700"
                                onClick={(e) =>
                                  markConsegnato(
                                    e,
                                    row.bolla.id,
                                    row.bolla.versione,
                                  )
                                }
                                disabled={consegnandoBollaId === row.bolla.id}
                              >
                                <Truck className="h-3.5 w-3.5" />
                                {t("bolle.segnaConsegnata")}
                              </Button>
                            )}
                          {([
                            "confermato",
                            "in_trasporto",
                            "rientro_atteso",
                            "rientrato",
                          ].includes(row.bolla.stato) ||
                            row.bolla.stato === "consegnato" ||
                            row.bolla.stato === "annullato") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              title={t("common.exportPdf")}
                              onClick={(e) => downloadBolla(e, row.bolla.id)}
                              disabled={downloadingBollaId === row.bolla.id}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow
                      key={`t-${row.trasf.id}`}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        openDocumento({
                          tipo: "trasferimento",
                          id: row.trasf.id,
                        })
                      }
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-4 w-4 text-emerald-600" />
                          {row.trasf.codice}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(
                          new Date(row.trasf.dataRichiesta),
                          "dd MMM yyyy",
                          { locale: it },
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 text-emerald-700 border-emerald-200"
                        >
                          {t("bolle.trasferimentoInterno")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{row.trasf.magazzinoOrigineNome ?? "—"}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                          <span>{row.trasf.magazzinoDestinoNome ?? "—"}</span>
                        </div>
                      </TableCell>
                      {isGlobal && (
                        <TableCell className="text-sm text-muted-foreground">
                          —
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        {trasferimentoStatoBadge(row.trasf.stato)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={(e) => downloadTrasf(e, row.trasf.id)}
                          disabled={downloadingTrasfId === row.trasf.id}
                        >
                          <Download className="h-3.5 w-3.5" />{" "}
                          {t("bolle.bollaBtn")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ),
                )
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page === 1 || loading}
        >
          {t("common.previous", { defaultValue: "Precedente" })}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("common.page", { defaultValue: "Pagina" })} {page}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((value) => value + 1)}
          disabled={!hasNextPage || loading}
        >
          {t("common.next", { defaultValue: "Successiva" })}
        </Button>
      </div>

      {canCreateBolla && (
        <CreaiBollaDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          initialMagazzinoId={filters.magazzinoId}
          initialAreaId={filters.areaOperativaId}
          initialCentroId={filters.centroAscoltoId}
          onCreated={(id, context) => {
            if (!id || !context) return;
            const next = normalizeFilters(
              filtersAfterDocumentCreation(filters, context),
            );
            setFilters(next);
            setPage(1);
            setSelectedDocumento({ tipo: "bolla", id });
            setDetailDraftDirty(false);
            const search = writeDocumentiOperativiUrl(
              window.location.search,
              next,
              { tipo: "bolla", id },
              1,
            );
            window.history.pushState(
              {},
              "",
              `${window.location.pathname}${search}`,
            );
            toast({
              title: t("bolle.latestInserted"),
              description: t("bolle.creationFiltersAligned"),
            });
          }}
        />
      )}
      {canCreateVisibleTransfer && (
        <NuovoTrasferimentoForm
          open={createTransferOpen}
          onClose={() => setCreateTransferOpen(false)}
          onCreated={(created) => {
            setCreateTransferOpen(false);
            openDocumento({ tipo: "trasferimento", id: created.id });
            queryClient.invalidateQueries({
              queryKey: getListDocumentiOperativiQueryKey(),
            });
          }}
        />
      )}

      <Dialog open={createChoiceOpen} onOpenChange={setCreateChoiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("bolle.nuovoDocumento", {
                defaultValue: "Nuovo documento operativo",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {canCreateBolla && (
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 p-4"
                onClick={() => {
                  setCreateChoiceOpen(false);
                  setCreateOpen(true);
                }}
              >
                <FileText className="h-5 w-5" />
                <span className="text-left">
                  <span className="block font-medium">
                    {t("bolle.newBolla")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("bolle.nuovaConsegnaDescrizione", {
                      defaultValue: "Consegna a beneficiario o ente esterno",
                    })}
                  </span>
                </span>
              </Button>
            )}
            {canCreateVisibleTransfer && (
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 p-4"
                onClick={() => {
                  setCreateChoiceOpen(false);
                  setCreateTransferOpen(true);
                }}
              >
                <ArrowRightLeft className="h-5 w-5" />
                <span className="text-left">
                  <span className="block font-medium">
                    {t("trasferimenti.title")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("bolle.nuovoTrasferimentoDescrizione", {
                      defaultValue: "Movimento tra due magazzini",
                    })}
                  </span>
                </span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet
        open={selectedDocumento !== null}
        onOpenChange={(open) => {
          if (!open) requestCloseDocumento();
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {selectedDocumento?.tipo === "trasferimento"
                ? t("trasferimenti.dettaglioTitle", {
                    defaultValue: "Dettaglio trasferimento",
                  })
                : t("bolle.dettaglioBolla")}
            </SheetTitle>
          </SheetHeader>
          {selectedDocumento !== null && (
            <DocumentoOperativoDettaglioComune
              selection={selectedDocumento}
              onClose={requestCloseDocumento}
              onDraftDirtyChange={setDetailDraftDirty}
            />
          )}
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog guard={detailUnsavedGuard} />
    </div>
  );
}
