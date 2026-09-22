import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useListBolle,
  useCreateBolla,
  useGetBolla,
  useAddBollaRiga,
  useDeleteBollaRiga,
  useConfermaBolla,
  useConsegnaBolla,
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
  useGetTrasferimento,
  useAvviaTrasferimento,
  useConfermaTrasferimento,
  getDocumentoOperativo,
  exportDocumentiOperativi,
  getListDocumentiOperativiQueryKey,
  getGetDocumentoOperativoQueryKey,
  getGetTrasferimentoQueryKey,
  useListConsegne,
  useGetConsegna,
  useAssociaBolla,
  useSegnalaRitiroNonEffettuato,
  useConvertiBollaInConsegna,
  useListEntiDestinatari,
  useListAreeOperative,
  useCreateEnteDestinatario,
  getListEntiDestinatariQueryKey,
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
import i18n from "@/lib/i18n";
import {
  ModificaTrasferimentoForm,
  NuovoTrasferimentoForm,
} from "@/pages/trasferimenti";

function statoBadge(stato: string) {
  if (stato === "consegnato")
    return (
      <Badge className="bg-green-500 text-white">
        {i18n.t("bolle.statoConsegnato")}
      </Badge>
    );
  if (stato === "confermato")
    return (
      <Badge className="border-blue-300 text-blue-700 bg-blue-50">
        {i18n.t("bolle.statoConfermato")}
      </Badge>
    );
  if (stato === "annullato")
    return (
      <Badge variant="destructive">{i18n.t("bolle.statoAnnullato")}</Badge>
    );
  return <Badge variant="secondary">{i18n.t("bolle.statoBozza")}</Badge>;
}

// ─── Helper download PDF bolla (riusabile da bolle + consegne) ───────────────

type CentroLite = {
  id: number;
  nome: string;
  indirizzo?: string | null;
  comune?: string | null;
  logoUrl?: string | null;
};
type BeneficiarioLite = { id: number; centroAscoltoId?: number | null };
type BollaPdfOptions = {
  beneficiari?: BeneficiarioLite[];
  centri?: CentroLite[];
  footer?: string | null;
  template?: BollaTemplate;
};

async function generateBollaPdfFromData(
  bolla: BollaDettaglioDto,
  opts: BollaPdfOptions,
): Promise<void> {
  const benef = opts.beneficiari?.find((b) => b.id === bolla.beneficiarioId);
  const centro = benef?.centroAscoltoId
    ? opts.centri?.find((c) => c.id === benef.centroAscoltoId)
    : undefined;
  const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
  await generateBollaPdf({
    bolla,
    centro: centro
      ? {
          nome: centro.nome,
          indirizzo: centro.indirizzo,
          comune: centro.comune,
          logoUrl: centro.logoUrl,
        }
      : null,
    footer: opts.footer ?? null,
    template: opts.template ?? "standard",
    associationLogoDataUrl: logoDataUrl,
    branding,
  });
}

export async function downloadBollaPdf(
  bollaId: number,
  opts: BollaPdfOptions,
): Promise<void> {
  const bolla = await getBolla(bollaId);
  if (!bolla) throw new Error("bolla non trovata");
  await generateBollaPdfFromData(bolla, opts);
}

// ─── Form crea bolla ─────────────────────────────────────────────────────────

export function CreaiBollaDialog({
  open,
  onClose,
  consegnaId,
  lockedBeneficiario,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  consegnaId?: number;
  lockedBeneficiario?: { id: number; nome: string } | null;
  onCreated?: (bollaId?: number) => void;
}) {
  const { user, hasPermission } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const [beneficiarioId, setBeneficiarioId] = useState("");
  const [tipoDestinatario, setTipoDestinatario] = useState<
    "beneficiario" | "ente"
  >("beneficiario");
  const [enteId, setEnteId] = useState("");
  const [newEnteNome, setNewEnteNome] = useState("");
  const [newEnteIndirizzo, setNewEnteIndirizzo] = useState("");
  const [magazzinoId, setMagazzinoId] = useState("");
  const [centroId, setCentroId] = useState("all");
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreAltro, setTrasportatoreAltro] = useState("");
  const [mezzo, setMezzo] = useState("");
  const [scanCode, setScanCode] = useState("");
  const commandIntents = useCommandIntentRegistry();
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  useEffect(() => {
    if (open && lockedBeneficiario)
      setBeneficiarioId(String(lockedBeneficiario.id));
  }, [open, lockedBeneficiario]);
  useEffect(() => {
    if (!open) {
      setMagazzinoId("");
      setTrasportatore("");
      setTrasportatoreAltro("");
      setMezzo("");
      setScanCode("");
      if (!lockedBeneficiario) setBeneficiarioId("");
      setTipoDestinatario("beneficiario");
      setEnteId("");
      setNewEnteNome("");
      setNewEnteIndirizzo("");
      commandIntents.discard("ente:create");
      commandIntents.discard("bolla:create");
    }
  }, [open, lockedBeneficiario, commandIntents]);
  const { data: centri } = useListCentriAscolto();
  const { data: beneficiari } = useListBeneficiari({
    attivo: true,
    ...(centroId !== "all" ? { centroAscoltoId: parseInt(centroId) } : {}),
  });
  const { data: allBeneficiari } = useListBeneficiari({ attivo: true });
  const selectedBenef = allBeneficiari?.find(
    (b) => String(b.id) === beneficiarioId,
  );
  const volontariParams =
    selectedBenef?.centroAscoltoId != null
      ? { centroAscoltoId: selectedBenef.centroAscoltoId }
      : undefined;
  const { data: magazzini } = useListMagazzini();
  const { data: enti } = useListEntiDestinatari();
  const createEnte = useCreateEnteDestinatario();
  const { data: volontari } = useListVolontari(volontariParams, {
    query: {
      queryKey: getListVolontariQueryKey(volontariParams),
      enabled: selectedBenef != null,
    },
  });
  const { data: mezzi } = useListMezzi();
  const { data: consegnaSource } = useGetConsegna(consegnaId ?? 0, {
    query: {
      enabled: consegnaId != null,
      queryKey: getGetConsegnaQueryKey(consegnaId ?? 0),
    },
  });
  const createBolla = useCreateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleScan = () => {
    const code = scanCode.trim();
    if (!code) return;
    const b = allBeneficiari?.find(
      (x) => x.codice.toLowerCase() === code.toLowerCase(),
    );
    if (!b) {
      toast({ title: t("bolle.scanNotFound"), variant: "destructive" });
      return;
    }
    setCentroId(
      isCentroLocked && lockedCentroId != null
        ? String(lockedCentroId)
        : b.centroAscoltoId
          ? String(b.centroAscoltoId)
          : "all",
    );
    setBeneficiarioId(String(b.id));
    setScanCode("");
    toast({ title: t("bolle.scanFound", { name: `${b.cognome} ${b.nome}` }) });
  };

  useEffect(() => {
    if (!open || !consegnaSource) return;
    if (consegnaSource.volontarioId != null) {
      setTrasportatore(String(consegnaSource.volontarioId));
      setTrasportatoreAltro("");
    } else if (consegnaSource.volontarioAltro) {
      setTrasportatore("__altro__");
      setTrasportatoreAltro(consegnaSource.volontarioAltro);
    }
    if (consegnaSource.mezzoId != null)
      setMezzo(String(consegnaSource.mezzoId));
    else if (consegnaSource.mezzoAltro) setMezzo("altro");
  }, [open, consegnaSource]);
  // Il trasportatore (un volontario del centro) si indica SOLO per i beneficiari con
  // consegna a domicilio. Negli altri casi vale il ritiro presso il magazzino.
  // Mezzo e conteggio del carico vivono ora sulla pianificazione consegne, non sulla bolla.
  const requiresTrasportatore =
    tipoDestinatario === "beneficiario" &&
    selectedBenef?.consegnaDomicilio === true;
  const trasportatoreMissing =
    requiresTrasportatore &&
    (!trasportatore ||
      (trasportatore === "__altro__" && !trasportatoreAltro.trim()));
  const initialCentroId =
    isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : "all";
  const initialTrasportatore =
    consegnaSource?.volontarioId != null
      ? String(consegnaSource.volontarioId)
      : consegnaSource?.volontarioAltro
        ? "__altro__"
        : "";
  const initialTrasportatoreAltro = consegnaSource?.volontarioAltro ?? "";
  const initialMezzo =
    consegnaSource?.mezzoId != null
      ? String(consegnaSource.mezzoId)
      : consegnaSource?.mezzoAltro
        ? "altro"
        : "";
  const beneficiarioDirty = lockedBeneficiario
    ? !!beneficiarioId && beneficiarioId !== String(lockedBeneficiario.id)
    : !!beneficiarioId;
  const unsavedGuard = useUnsavedChangesGuard(
    open &&
      (beneficiarioDirty ||
        tipoDestinatario !== "beneficiario" ||
        !!enteId ||
        !!newEnteNome ||
        !!newEnteIndirizzo ||
        !!magazzinoId ||
        centroId !== initialCentroId ||
        !!scanCode ||
        trasportatore !== initialTrasportatore ||
        trasportatoreAltro !== initialTrasportatoreAltro ||
        mezzo !== initialMezzo),
  );
  const requestClose = () => {
    if (createBolla.isPending || createEnte.isPending) return;
    unsavedGuard.requestClose(onClose);
  };

  const onCreateEnte = () => {
    const magazzino = magazzini?.find(
      (item) => String(item.id) === magazzinoId,
    );
    if (
      !magazzino?.areaOperativaId ||
      !newEnteNome.trim() ||
      !newEnteIndirizzo.trim()
    )
      return;
    const slot = "ente:create";
    const enteInput = {
      denominazione: newEnteNome.trim(),
      indirizzo: newEnteIndirizzo.trim(),
      areaOperativaId: magazzino.areaOperativaId,
    };
    createEnte.mutate(
      {
        data: commandIntents.prepare(slot, enteInput, enteInput),
      },
      {
        onSuccess: (created) => {
          commandIntents.complete(slot);
          queryClient.invalidateQueries({
            queryKey: getListEntiDestinatariQueryKey(),
          });
          setEnteId(String(created.id));
          setNewEnteNome("");
          setNewEnteIndirizzo("");
        },
        onError: (error) => commandIntents.fail(slot, error),
      },
    );
  };

  const onSubmit = () => {
    if (
      (tipoDestinatario === "beneficiario" ? !beneficiarioId : !enteId) ||
      !magazzinoId ||
      trasportatoreMissing
    )
      return;
    const data: {
      tipoDestinatario: "beneficiario" | "ente";
      beneficiarioId?: number;
      enteDestinatarioId?: number;
      magazzinoId: number;
      consegnaId?: number;
      volontarioConsegnaId?: number;
      mezzoId?: number;
      mezzoAltro?: boolean;
      trasportatoreNome?: string;
    } = { tipoDestinatario, magazzinoId: parseInt(magazzinoId) };
    if (tipoDestinatario === "beneficiario")
      data.beneficiarioId = parseInt(beneficiarioId);
    else data.enteDestinatarioId = parseInt(enteId);
    if (tipoDestinatario === "beneficiario" && consegnaId != null)
      data.consegnaId = consegnaId;
    if (requiresTrasportatore && trasportatore) {
      if (trasportatore === "__altro__")
        data.trasportatoreNome = trasportatoreAltro.trim();
      else data.volontarioConsegnaId = parseInt(trasportatore);
      if (mezzo === "altro") data.mezzoAltro = true;
      else if (mezzo) data.mezzoId = parseInt(mezzo);
    }
    const slot = "bolla:create";
    createBolla.mutate(
      { data: commandIntents.prepare(slot, data, data) },
      {
        onSuccess: (created) => {
          commandIntents.complete(slot);
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: t("bolle.bollaCreata") });
          setBeneficiarioId("");
          setMagazzinoId("");
          setCentroId(
            isCentroLocked && lockedCentroId != null
              ? String(lockedCentroId)
              : "all",
          );
          setTrasportatore("");
          onCreated?.((created as { id?: number } | undefined)?.id);
          onClose();
        },
        onError: (error) => {
          commandIntents.fail(slot, error);
          toast({
            title: t("bolle.error"),
            description: t("bolle.createError"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bolle.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!lockedBeneficiario && (
            <div className="space-y-2">
              <Label>
                {t("bolle.tipoDestinatario", { defaultValue: "Destinatario" })}
              </Label>
              <Select
                value={tipoDestinatario}
                onValueChange={(value) =>
                  setTipoDestinatario(value as "beneficiario" | "ente")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beneficiario">
                    {t("bolle.destinatarioBeneficiario", {
                      defaultValue: "Beneficiario",
                    })}
                  </SelectItem>
                  <SelectItem value="ente">
                    {t("bolle.destinatarioEnte", {
                      defaultValue: "Ente esterno",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {tipoDestinatario === "beneficiario" &&
            (lockedBeneficiario ? (
              <div className="space-y-2">
                <Label>{t("bolle.beneficiarioLabel")}</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                  {lockedBeneficiario.nome}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{t("bolle.scanLabel")}</Label>
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      placeholder={t("bolle.scanPlaceholder")}
                      value={scanCode}
                      onChange={(e) => setScanCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleScan();
                        }
                      }}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleScan}
                      disabled={!scanCode.trim()}
                    >
                      <ScanLine className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("bolle.centroFilterLabel")}</Label>
                  <Select
                    value={centroId}
                    onValueChange={(v) => {
                      setCentroId(v);
                      setBeneficiarioId("");
                    }}
                    disabled={isCentroLocked}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("bolle.allCentriPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("bolle.allBeneficiari")}
                      </SelectItem>
                      {centri?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("bolle.beneficiarioLabel")}</Label>
                  <BeneficiarioCombobox
                    items={(beneficiari ?? []).map((b) => ({
                      id: b.id,
                      nome: b.nome,
                      cognome: b.cognome,
                      codice: b.codice,
                    }))}
                    value={beneficiarioId}
                    onChange={setBeneficiarioId}
                    placeholder={t("bolle.beneficiarioPlaceholder")}
                    emptyText={t("bolle.noBeneficiarioForCentro")}
                  />
                </div>
              </>
            ))}
          {tipoDestinatario === "ente" && (
            <div className="space-y-2">
              <Label>
                {t("bolle.destinatarioEnte", { defaultValue: "Ente esterno" })}
              </Label>
              <Select value={enteId} onValueChange={setEnteId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("bolle.entePlaceholder", {
                      defaultValue: "Seleziona Ente",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {enti?.map((ente) => (
                    <SelectItem key={ente.id} value={String(ente.id)}>
                      {ente.denominazione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>{t("bolle.magazzinoUscitaLabel")}</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger aria-label={t("bolle.magazzinoUscitaLabel")}>
                <SelectValue placeholder={t("bolle.magazzinoPlaceholder")} />
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
          {tipoDestinatario === "ente" &&
            hasPermission("enti-destinatari.manage") && (
              <div className="rounded-md border p-3 space-y-2">
                <Label>
                  {t("bolle.nuovoEnte", { defaultValue: "Nuovo Ente" })}
                </Label>
                <Input
                  value={newEnteNome}
                  onChange={(e) => setNewEnteNome(e.target.value)}
                  placeholder={t("bolle.enteNome", {
                    defaultValue: "Denominazione",
                  })}
                />
                <Input
                  value={newEnteIndirizzo}
                  onChange={(e) => setNewEnteIndirizzo(e.target.value)}
                  placeholder={t("common.address")}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCreateEnte}
                  disabled={
                    !magazzinoId ||
                    !newEnteNome.trim() ||
                    !newEnteIndirizzo.trim() ||
                    createEnte.isPending
                  }
                >
                  {t("bolle.creaEnte", { defaultValue: "Crea Ente" })}
                </Button>
              </div>
            )}
          {consegnaSource && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t("bolle.daPianificazioneInfo", {
                defaultValue:
                  "Volontario e mezzo sono precompilati dalla pianificazione collegata, se presenti.",
              })}
            </div>
          )}
          {requiresTrasportatore ? (
            <div className="space-y-2">
              <Label>{t("bolle.trasportatoreLabel")}</Label>
              <Select
                value={trasportatore}
                onValueChange={(v) => {
                  setTrasportatore(v);
                  setTrasportatoreAltro("");
                  setMezzo("");
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("bolle.trasportatorePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {volontari
                    ?.filter((v) => v.operativo)
                    .map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {volontarioLabel(v)}
                      </SelectItem>
                    ))}
                  <SelectItem value="__altro__">
                    {t("consegne.volontarioAltro", { defaultValue: "Altro" })}
                  </SelectItem>
                </SelectContent>
              </Select>
              {trasportatore === "__altro__" && (
                <Input
                  value={trasportatoreAltro}
                  onChange={(e) => setTrasportatoreAltro(e.target.value)}
                  placeholder={t("consegne.volontarioAltroPlaceholder", {
                    defaultValue: "Es. familiare delegato, vicino di casa...",
                  })}
                />
              )}
              {trasportatoreMissing && (
                <p className="text-sm text-destructive">
                  {t("bolle.trasportatoreObbligatorioDomicilio")}
                </p>
              )}
              {trasportatore && (
                <div className="space-y-2 pt-2">
                  <Label>{t("bolle.mezzoLabel")}</Label>
                  <Select
                    value={mezzo || "0"}
                    onValueChange={(v) => setMezzo(v === "0" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("bolle.mezzoPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{t("common.none")}</SelectItem>
                      {mezzi
                        ?.filter((m) => {
                          if (
                            m.stato !== "disponibile" ||
                            (m.statoApprovazione ?? "approvato") !== "approvato"
                          )
                            return false;
                          if (m.effectiveCentroId == null) return true;
                          const benefCentro =
                            allBeneficiari?.find(
                              (b) => String(b.id) === beneficiarioId,
                            )?.centroAscoltoId ?? null;
                          return (
                            benefCentro != null &&
                            m.effectiveCentroId === benefCentro
                          );
                        })
                        .map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.codice}
                            {m.targa ? ` (${m.targa})` : ""} — {m.tipo}
                          </SelectItem>
                        ))}
                      <SelectItem value="altro">
                        {t("bolle.mezzoAltro")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("bolle.ritiroMagazzinoInfo")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={requestClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="min-h-[44px]"
            onClick={onSubmit}
            disabled={
              (tipoDestinatario === "beneficiario"
                ? !beneficiarioId
                : !enteId) ||
              !magazzinoId ||
              trasportatoreMissing ||
              createBolla.isPending
            }
          >
            {t("bolle.createBolla")}
          </Button>
        </DialogFooter>
        <UnsavedChangesDialog guard={unsavedGuard} />
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog modifica intestazione (beneficiario / magazzino) ────────────────

function ModificaBollaDialog({
  open,
  onClose,
  bollaId,
  versione,
  beneficiarioId,
  magazzinoId,
  hasRighe,
}: {
  open: boolean;
  onClose: () => void;
  bollaId: number;
  versione: number;
  beneficiarioId: number;
  magazzinoId: number;
  hasRighe: boolean;
}) {
  const [bId, setBId] = useState(String(beneficiarioId));
  const [mId, setMId] = useState(String(magazzinoId));
  const [scanCode, setScanCode] = useState("");
  const { data: beneficiari } = useListBeneficiari({ attivo: true });
  const { data: magazzini } = useListMagazzini();
  const updateBolla = useUpdateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const commandIntents = useCommandIntentRegistry();
  const updateHeaderSlot = `bolla:${bollaId}:update-header`;

  const requestClose = () => {
    if (updateBolla.isPending) return;
    commandIntents.discard(updateHeaderSlot);
    onClose();
  };

  const handleScan = () => {
    const code = scanCode.trim();
    if (!code) return;
    if (!beneficiari) {
      toast({ title: t("common.loading") });
      return;
    }
    const b = beneficiari.find(
      (x) => x.codice.toLowerCase() === code.toLowerCase(),
    );
    if (!b) {
      toast({ title: t("bolle.scanNotFound"), variant: "destructive" });
      return;
    }
    setBId(String(b.id));
    setScanCode("");
    toast({ title: t("bolle.scanFound", { name: `${b.cognome} ${b.nome}` }) });
  };

  const magazzinoCambiato = parseInt(mId) !== magazzinoId;
  const magazzinoAreaId =
    magazzini?.find((m) => m.id === parseInt(mId))?.areaOperativaId ?? null;

  const onSubmit = () => {
    if (magazzinoCambiato && hasRighe) {
      const ok = window.confirm(t("bolle.cambioMagazzinoConfirm"));
      if (!ok) return;
    }
    const semanticInput = {
      beneficiarioId: parseInt(bId),
      magazzinoId: parseInt(mId),
    };
    updateBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(updateHeaderSlot, semanticInput, {
          ...semanticInput,
          versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(updateHeaderSlot);
          queryClient.invalidateQueries({
            queryKey: getGetBollaQueryKey(bollaId),
          });
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getListGiacenzeQueryKey(
              magazzinoAreaId == null
                ? undefined
                : {
                    areaOperativaId: magazzinoAreaId,
                    magazzinoId: parseInt(mId),
                  },
            ),
          });
          toast({ title: t("bolle.bollaAggiornata") });
          onClose();
        },
        onError: (err: unknown) => {
          commandIntents.fail(updateHeaderSlot, err);
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? t("bolle.updateError");
          toast({
            title: t("bolle.error"),
            description: msg,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bolle.modificaTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("bolle.scanLabel")}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t("bolle.scanPlaceholder")}
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan();
                  }
                }}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleScan}
                disabled={!scanCode.trim()}
              >
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.beneficiarioLabel")}</Label>
            <Select value={bId} onValueChange={setBId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {beneficiari?.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.cognome} {b.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.magazzinoUscitaLabel")}</Label>
            <Select value={mId} onValueChange={setMId}>
              <SelectTrigger>
                <SelectValue />
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
            {magazzinoCambiato && hasRighe && (
              <p className="text-xs text-amber-600">
                {t("bolle.cambioMagazzinoWarning")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            {t("common.close")}
          </Button>
          <Button onClick={onSubmit} disabled={updateBolla.isPending}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog aggiungi prodotto ────────────────────────────────────────────────

function AggiungiProdottoDialog({
  open,
  onClose,
  bollaId,
  magazzinoId,
}: {
  open: boolean;
  onClose: () => void;
  bollaId: number;
  magazzinoId: number;
}) {
  const [prodottoId, setProdottoId] = useState("");
  const [lottoId, setLottoId] = useState("");
  const [quantita, setQuantita] = useState("");
  const [unitaMisura, setUnitaMisura] = useState("pz");
  const [scanProdotto, setScanProdotto] = useState("");

  const { data: magazzini } = useListMagazzini();
  const areaOperativaId =
    magazzini?.find((m) => m.id === magazzinoId)?.areaOperativaId ?? 0;
  const giacenzeParams = { areaOperativaId, magazzinoId };
  const { data: giacenze } = useListGiacenze(giacenzeParams, {
    query: {
      enabled: open && areaOperativaId > 0,
      queryKey: getListGiacenzeQueryKey(giacenzeParams),
    },
  });
  const { data: prodotti } = useListProdotti();
  const { data: lotti } = useListLotti({
    magazzinoId,
    prodottoId: prodottoId ? parseInt(prodottoId) : undefined,
  });
  const { data: bollaCorrente } = useGetBolla(bollaId, {
    query: { enabled: open, queryKey: getGetBollaQueryKey(bollaId) },
  });

  const addRiga = useAddBollaRiga();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const commandIntents = useCommandIntentRegistry();
  const addRowSlot = `bolla:${bollaId}:add-row`;

  const requestClose = () => {
    if (addRiga.isPending) return;
    commandIntents.discard(addRowSlot);
    onClose();
  };

  const handleScanProdotto = (codeOverride?: string) => {
    const code = (codeOverride ?? scanProdotto).trim();
    if (!code) return;
    if (!prodotti) {
      toast({ title: t("common.loading") });
      return;
    }
    const lc = code.toLowerCase();
    const p = prodotti.find(
      (x) =>
        (x.codiceBarre && x.codiceBarre.toLowerCase() === lc) ||
        x.codice.toLowerCase() === lc,
    );
    if (!p) {
      toast({ title: t("bolle.scanProdottoNotFound"), variant: "destructive" });
      return;
    }
    const g = giacenze?.find((x) => x.prodottoId === p.id);
    if (!g || g.disponibileReale <= 0) {
      toast({
        title: t("bolle.scanProdottoNoStock", { name: p.nome }),
        variant: "destructive",
      });
      return;
    }
    setProdottoId(String(p.id));
    setLottoId("");
    setQuantita("");
    setScanProdotto("");
    toast({ title: t("bolle.scanProdottoFound", { name: p.nome }) });
  };

  const giacenzaSelezionata = giacenze?.find(
    (g) => g.prodottoId === parseInt(prodottoId),
  );
  const lottiDisponibili =
    lotti?.filter(
      (l) => l.magazzinoId === magazzinoId && l.quantitaResidua > 0,
    ) ?? [];

  // quantità già inserita in questa bolla: va sottratta solo in bozza
  // (le bolle confermate hanno prenotazioni bloccate e non sono modificabili)
  const isBozza = bollaCorrente?.stato === "bozza";
  const giaInBollaProdotto =
    isBozza && prodottoId
      ? (bollaCorrente?.righe ?? [])
          .filter((r) => r.prodottoId === parseInt(prodottoId))
          .reduce((acc, r) => acc + r.quantita, 0)
      : 0;
  const giaInBollaLotto = (lid: number) =>
    isBozza
      ? (bollaCorrente?.righe ?? [])
          .filter((r) => r.lottoId === lid)
          .reduce((acc, r) => acc + r.quantita, 0)
      : 0;

  // limite massimo: lotto specifico oppure giacenza totale, al netto di quanto già in bolla
  const lottoSelezionato = lottiDisponibili.find(
    (l) => l.id === parseInt(lottoId),
  );
  const maxBase = lottoSelezionato
    ? lottoSelezionato.quantitaResidua
    : (giacenzaSelezionata?.disponibileReale ?? 0);
  const giaUsato = lottoSelezionato
    ? giaInBollaLotto(lottoSelezionato.id)
    : giaInBollaProdotto;
  const maxDisponibile = Math.max(
    0,
    Math.round((maxBase - giaUsato) * 100) / 100,
  );
  const quantitaNum = parseFloat(quantita || "0");
  const eccedeDisponibilita = quantitaNum > maxDisponibile;

  const onSubmit = () => {
    if (!prodottoId || !quantita || eccedeDisponibilita || !bollaCorrente)
      return;
    const semanticInput = {
      prodottoId: parseInt(prodottoId),
      lottoId: lottoId ? parseInt(lottoId) : undefined,
      quantita,
      unitaMisura,
    };
    addRiga.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(addRowSlot, semanticInput, {
          ...semanticInput,
          versione: bollaCorrente.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(addRowSlot);
          queryClient.invalidateQueries({
            queryKey: getGetBollaQueryKey(bollaId),
          });
          queryClient.invalidateQueries({
            queryKey: getListGiacenzeQueryKey(giacenzeParams),
          });
          toast({ title: t("bolle.prodottoAggiunto") });
          // mantieni il dialog aperto per aggiungere altri prodotti: resetta i campi
          setProdottoId("");
          setLottoId("");
          setQuantita("");
          setUnitaMisura("pz");
        },
        onError: (err: unknown) => {
          commandIntents.fail(addRowSlot, err);
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error ?? t("bolle.addError");
          toast({
            title: t("bolle.error"),
            description: msg,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) requestClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bolle.addProdottoTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("bolle.scanProdottoLabel")}</Label>
            <div className="flex gap-2">
              <Input
                value={scanProdotto}
                onChange={(e) => setScanProdotto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScanProdotto();
                  }
                }}
                placeholder={t("bolle.scanProdottoPlaceholder")}
                autoFocus
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleScanProdotto()}
                disabled={!scanProdotto.trim()}
              >
                {t("bolle.scanProdottoButton")}
              </Button>
              <BarcodeScannerButton
                onScan={(v) => {
                  setScanProdotto(v);
                  handleScanProdotto(v);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("bolle.prodottoDisponibileLabel")}</Label>
            <Select
              value={prodottoId}
              onValueChange={(v) => {
                setProdottoId(v);
                setLottoId("");
                setQuantita("");
              }}
            >
              <SelectTrigger aria-label={t("bolle.prodottoDisponibileLabel")}>
                <SelectValue placeholder={t("bolle.prodottoPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {giacenze && giacenze.length > 0 ? (
                  giacenze.map((g) => (
                    <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                      {g.prodottoNome} — {Math.max(0, g.disponibileReale)}{" "}
                      {g.unitaMisura} {t("bolle.disponibili")}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    {t("bolle.noProdottoInMagazzino")}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {prodottoId && lottiDisponibili.length > 0 && (
            <div className="space-y-2">
              <Label>{t("bolle.lottoLabel")}</Label>
              <Select
                value={lottoId}
                onValueChange={(v) => {
                  setLottoId(v);
                  setQuantita("");
                }}
              >
                <SelectTrigger aria-label={t("bolle.lottoLabel")}>
                  <SelectValue placeholder={t("bolle.lottoPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {lottiDisponibili.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.codiceLotto ?? `${t("bolle.lottoPrefix")}${l.id}`}
                      {l.dataScadenza
                        ? ` — ${t("bolle.scadAbbr")} ${l.dataScadenza}`
                        : ""}
                      {` — ${l.quantitaResidua} ${t("bolle.dispAbbr")}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("bolle.lottoHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("common.quantity")}</Label>
              <Input
                type="number"
                aria-label={t("common.quantity")}
                min="0.01"
                step="0.000001"
                max={maxDisponibile || undefined}
                value={quantita}
                onChange={(e) => setQuantita(e.target.value)}
                placeholder={t("bolle.quantitaPlaceholder")}
                className={
                  eccedeDisponibilita
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {prodottoId && (
                <p
                  className={`text-xs ${eccedeDisponibilita ? "text-destructive font-medium" : "text-muted-foreground"}`}
                >
                  {eccedeDisponibilita
                    ? t("bolle.massimoDisponibile", { max: maxDisponibile })
                    : t("bolle.disponibileQta", {
                        max: maxDisponibile,
                        um: giacenzaSelezionata?.unitaMisura ?? "",
                      })}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("bolle.unitaMisuraLabel")}</Label>
              <Select value={unitaMisura} onValueChange={setUnitaMisura}>
                <SelectTrigger aria-label={t("bolle.unitaMisuraLabel")}>
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
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            {t("common.close")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={
              !prodottoId ||
              !quantita ||
              eccedeDisponibilita ||
              addRiga.isPending
            }
          >
            {t("common.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dettaglio bolla ─────────────────────────────────────────────────────────

export function BollaDettaglio({
  bollaId,
  bollaData,
  onClose,
  onCloseLabel,
  hideConsegnaActions,
}: {
  bollaId: number;
  bollaData?: BollaDettaglioDto;
  onClose?: () => void;
  onCloseLabel?: string;
  hideConsegnaActions?: boolean;
}) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("bolle.manage");
  const canDeliver = hasPermission("bolle.deliver");
  const canCancel = hasPermission("bolle.cancel");
  const canReverseAdmin = hasPermission("bolle.reverse.admin");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [annullaOpen, setAnnullaOpen] = useState(false);
  const [annullaMotivo, setAnnullaMotivo] = useState("");
  const [stornoOpen, setStornoOpen] = useState(false);
  const [stornoRigaIds, setStornoRigaIds] = useState<number[]>([]);
  const [stornoMotivo, setStornoMotivo] = useState("");
  const [stornoConferma, setStornoConferma] = useState("");
  const [assegnaOpen, setAssegnaOpen] = useState(false);
  const [ritiroOpen, setRitiroOpen] = useState(false);
  const [ritiroMotivo, setRitiroMotivo] = useState("");
  const [conversioneOpen, setConversioneOpen] = useState(false);
  const [conversioneIndirizzo, setConversioneIndirizzo] = useState("");
  const [conversioneData, setConversioneData] = useState("");
  const [conversioneFascia, setConversioneFascia] =
    useState<Exclude<ConversioneConsegnaInputFasciaOraria, null>>("Mattina");
  const [conversioneNote, setConversioneNote] = useState("");
  const [printing, setPrinting] = useState(false);
  const { data: fetchedBolla, isLoading: legacyBollaLoading } = useGetBolla(
    bollaId,
    {
      query: {
        enabled: bollaData == null,
        queryKey: getGetBollaQueryKey(bollaId),
      },
    },
  );
  const bolla = bollaData ?? fetchedBolla;
  const isLoading = bollaData == null && legacyBollaLoading;
  const { data: beneficiari } = useListBeneficiari();
  const bollaCentroId =
    beneficiari?.find((b) => b.id === bolla?.beneficiarioId)?.centroAscoltoId ??
    null;
  const volontariDettaglioParams =
    bollaCentroId != null ? { centroAscoltoId: bollaCentroId } : undefined;
  const { data: volontari } = useListVolontari(volontariDettaglioParams, {
    query: {
      queryKey: getListVolontariQueryKey(volontariDettaglioParams),
      enabled: bolla != null && beneficiari != null,
    },
  });
  const { data: centri } = useListCentriAscolto();
  const { data: impostazioni, isLoading: impostazioniLoading } =
    useGetImpostazioniStampa();
  const deleteRiga = useDeleteBollaRiga();
  const confermaBolla = useConfermaBolla();
  const consegnaBolla = useConsegnaBolla();
  const annullaBolla = useAnnullaBolla();
  const stornaAmministrativamente = useStornaAmministrativamenteBolla();
  const updateBolla = useUpdateBolla();
  const associaBolla = useAssociaBolla();
  const segnalaRitiro = useSegnalaRitiroNonEffettuato();
  const convertiConsegna = useConvertiBollaInConsegna();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const commandIntents = useCommandIntentRegistry();
  const cancellationSlot = `bolla:${bollaId}:cancel`;
  const administrativeReversalSlot = `bolla:${bollaId}:reverse-admin`;

  const consegneParams =
    bollaCentroId != null
      ? { centroAscoltoId: bollaCentroId, page: 1, pageSize: 100 }
      : { page: 1, pageSize: 100 };
  const { data: consegnePianificabili } = useListConsegne(consegneParams, {
    query: {
      enabled: assegnaOpen && beneficiari != null,
      queryKey: getListConsegneQueryKey(consegneParams),
    },
  });
  // Beneficiari del centro della bolla (gestisce anche il caso centro nullo,
  // dato che Consegna non espone centroAscoltoId): filtra le consegne lato client.
  const centroBeneficiarioIds = new Set(
    (beneficiari ?? [])
      .filter((b) => (b.centroAscoltoId ?? null) === bollaCentroId)
      .map((b) => b.id),
  );
  const pianificabili = (consegnePianificabili?.items ?? []).filter(
    (c) =>
      c.stato === "pianificata" &&
      c.bollaId == null &&
      centroBeneficiarioIds.has(c.beneficiarioId),
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
    queryClient.invalidateQueries({
      queryKey: getGetDocumentoOperativoQueryKey("bolla", bollaId),
    });
    queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
  };

  const errMsg = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? fallback;

  const onDeleteRiga = (rigaId: number) => {
    if (!bolla) return;
    const slot = `bolla:${bollaId}:delete-row:${rigaId}`;
    deleteRiga.mutate(
      {
        id: bollaId,
        rigaId,
        data: commandIntents.prepare(
          slot,
          { rigaId },
          {
            versione: bolla.versione,
          },
        ),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidateAll();
          toast({ title: t("bolle.prodottoRimosso") });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.rimuoviError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onConferma = () => {
    if (!bolla) return;
    const slot = `bolla:${bollaId}:confirm`;
    confermaBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(slot, {}, { versione: bolla.versione }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidateAll();
          toast({
            title: t("bolle.bollaConfermataTitle"),
            description: t("bolle.bollaConfermataDesc"),
          });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.confermaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onConsegna = () => {
    if (!bolla) return;
    const slot = `bolla:${bollaId}:deliver`;
    const semanticInput = { confermaRicezione: true };
    consegnaBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(slot, semanticInput, {
          ...semanticInput,
          versione: bolla.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidateAll();
          toast({
            title: t("bolle.bollaConsegnataTitle"),
            description: t("bolle.bollaConsegnataDesc"),
          });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.consegnaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onAnnulla = () => {
    if (!bolla) return;
    const semanticInput = { motivo: annullaMotivo.trim() };
    annullaBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(cancellationSlot, semanticInput, {
          ...semanticInput,
          versione: bolla.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(cancellationSlot);
          invalidateAll();
          queryClient.invalidateQueries({
            queryKey: getListConsegneQueryKey(),
          });
          toast({
            title: t("bolle.bollaAnnullataTitle"),
            description: t("bolle.bollaAnnullataDesc"),
          });
          setAnnullaOpen(false);
          setAnnullaMotivo("");
        },
        onError: (err) => {
          commandIntents.fail(cancellationSlot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.annullaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const closeCancellation = () => {
    commandIntents.discard(cancellationSlot);
    setAnnullaOpen(false);
    setAnnullaMotivo("");
  };

  const clearAdministrativeReversal = () => {
    setStornoRigaIds([]);
    setStornoMotivo("");
    setStornoConferma("");
  };

  const closeAdministrativeReversal = () => {
    commandIntents.discard(administrativeReversalSlot);
    clearAdministrativeReversal();
    setStornoOpen(false);
  };

  const onAdministrativeReversal = () => {
    if (!bolla) return;
    if (
      !administrativeReversalReady({
        canReverseAdmin,
        documentStatus: bolla.stato,
        selectedRowIds: stornoRigaIds,
        reason: stornoMotivo,
        confirmation: stornoConferma,
        documentNumber: bolla.numeroBolla,
      })
    )
      return;
    const semanticInput = {
      motivo: stornoMotivo.trim(),
      rigaIds: [...stornoRigaIds].sort((left, right) => left - right),
    };
    stornaAmministrativamente.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(
          administrativeReversalSlot,
          semanticInput,
          { ...semanticInput, versione: bolla.versione },
        ),
      },
      {
        onSuccess: () => {
          commandIntents.complete(administrativeReversalSlot);
          clearAdministrativeReversal();
          setStornoOpen(false);
          invalidateAll();
          toast({
            title: t("bolle.stornoAmministrativoCompletato", {
              defaultValue: "Rettifica amministrativa registrata",
            }),
          });
        },
        onError: (error) => {
          commandIntents.fail(administrativeReversalSlot, error);
          toast({
            title: t("bolle.error"),
            description: errMsg(
              error,
              t("bolle.stornoAmministrativoErrore", {
                defaultValue: "Impossibile registrare la rettifica",
              }),
            ),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onRitiroNonEffettuato = () => {
    segnalaRitiro.mutate(
      { id: bollaId, data: { motivo: ritiroMotivo.trim() || null } },
      {
        onSuccess: () => {
          invalidateAll();
          setRitiroOpen(false);
          setRitiroMotivo("");
          toast({ title: t("maps.missedRecorded") });
        },
        onError: (error) =>
          toast({
            title: t("bolle.error"),
            description: errMsg(error, t("maps.missedError")),
            variant: "destructive",
          }),
      },
    );
  };

  const openConversione = () => {
    setConversioneIndirizzo(bolla?.beneficiarioIndirizzo?.trim() ?? "");
    setConversioneData(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    setConversioneFascia("Mattina");
    setConversioneNote("");
    setConversioneOpen(true);
  };

  const onConvertiConsegna = () => {
    if (!conversioneIndirizzo.trim() || !conversioneData) return;
    convertiConsegna.mutate(
      {
        id: bollaId,
        data: {
          indirizzoConsegna: conversioneIndirizzo.trim(),
          dataPrevista: conversioneData,
          fasciaOraria: conversioneFascia,
          noteOperative: conversioneNote.trim() || null,
        },
      },
      {
        onSuccess: (result) => {
          invalidateAll();
          queryClient.invalidateQueries({
            queryKey: getListConsegneQueryKey(),
          });
          setConversioneOpen(false);
          toast({
            title: result.created
              ? t("maps.deliveryCreated")
              : t("maps.deliveryExisting"),
          });
        },
        onError: (error) =>
          toast({
            title: t("bolle.error"),
            description: errMsg(error, t("maps.conversionError")),
            variant: "destructive",
          }),
      },
    );
  };

  const onAssegna = (consegnaId: number) => {
    if (!bolla) return;
    const slot = `bolla:${bollaId}:associa-consegna:${consegnaId}`;
    const semanticInput = {
      bollaId,
      versione: bolla.versione,
      consegnaId,
    };
    associaBolla.mutate(
      {
        id: consegnaId,
        data: commandIntents.prepare(slot, semanticInput, {
          bollaId,
          versione: bolla.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidateAll();
          queryClient.invalidateQueries({
            queryKey: getListConsegneQueryKey(),
          });
          setAssegnaOpen(false);
          toast({
            title: t("bolle.bollaAssegnataTitle"),
            description: t("bolle.bollaAssegnataDesc"),
          });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.assegnaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onChangeVolontario = (value: string) => {
    if (!bolla) return;
    const data =
      value === "__centro__"
        ? {
            volontarioConsegnaId: null,
            trasportatoreNome: null,
            noteConsegna: "Consegna presso il centro",
          }
        : value === "__altro__"
          ? {
              volontarioConsegnaId: null,
              trasportatoreNome: "Ritiro presso il magazzino",
              noteConsegna: null,
            }
          : {
              volontarioConsegnaId: parseInt(value),
              trasportatoreNome: null,
              noteConsegna: null,
            };
    const slot = `bolla:${bollaId}:update-delivery`;
    updateBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(slot, data, {
          ...data,
          versione: bolla.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          queryClient.invalidateQueries({
            queryKey: getGetBollaQueryKey(bollaId),
          });
          toast({ title: t("bolle.consegnaAggiornata") });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.aggiornaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const onChangeTrasportatoreNome = (value: string) => {
    if (!bolla) return;
    const slot = `bolla:${bollaId}:update-delivery`;
    const semanticInput = {
      trasportatoreNome: value.trim() || "Ritiro presso il magazzino",
    };
    updateBolla.mutate(
      {
        id: bollaId,
        data: commandIntents.prepare(slot, semanticInput, {
          ...semanticInput,
          versione: bolla.versione,
        }),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          queryClient.invalidateQueries({
            queryKey: getGetBollaQueryKey(bollaId),
          });
        },
        onError: (err) => {
          commandIntents.fail(slot, err);
          toast({
            title: t("bolle.error"),
            description: errMsg(err, t("bolle.aggiornaError")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const consegnaValue = bolla?.volontarioConsegnaId
    ? String(bolla.volontarioConsegnaId)
    : bolla?.trasportatoreNome
      ? "__altro__"
      : bolla?.noteConsegna
        ? "__centro__"
        : "";

  const handleDownloadPdf = async () => {
    if (!bolla) return;
    setPrinting(true);
    try {
      const benef = beneficiari?.find((b) => b.id === bolla.beneficiarioId);
      const centro = benef?.centroAscoltoId
        ? centri?.find((c) => c.id === benef.centroAscoltoId)
        : undefined;
      const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
      await generateBollaPdf({
        bolla,
        centro: centro
          ? {
              nome: centro.nome,
              indirizzo: centro.indirizzo,
              comune: centro.comune,
              logoUrl: centro.logoUrl,
            }
          : null,
        footer: impostazioni?.footerBolla ?? null,
        template: (impostazioni?.templateBolla as BollaTemplate) ?? "standard",
        associationLogoDataUrl: logoDataUrl,
        branding,
      });
    } catch {
      toast({
        title: t("bolle.error"),
        description: t("bolle.pdfError"),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!bolla)
    return (
      <p className="text-muted-foreground mt-4">{t("bolle.bollaNonTrovata")}</p>
    );

  const isBozza = bolla.stato === "bozza";
  const isConfermato = bolla.stato === "confermato";
  const isConsegnato = bolla.stato === "consegnato";
  const isAnnullato = bolla.stato === "annullato";
  const stornoAmministrativoReady = administrativeReversalReady({
    canReverseAdmin,
    documentStatus: bolla.stato,
    selectedRowIds: stornoRigaIds,
    reason: stornoMotivo,
    confirmation: stornoConferma,
    documentNumber: bolla.numeroBolla,
  });
  const modificabile = isBozza && canManage; // le prenotazioni si ricalcolano solo confermando una bozza
  const centroBolla =
    bollaCentroId != null
      ? centri?.find((c) => c.id === bollaCentroId)
      : undefined;

  return (
    <div className="mt-4 space-y-5">
      {/* Header info */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          {centroBolla?.logoUrl && (
            <img
              src={centroBolla.logoUrl}
              alt={`Logo ${centroBolla.nome}`}
              className="h-14 w-20 shrink-0 rounded border bg-white object-contain p-1"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-lg">
                {bolla.numeroBolla}
              </span>
              {statoBadge(bolla.stato)}
            </div>
            <p className="text-sm text-muted-foreground">
              {format(new Date(bolla.dataBolla), "dd MMMM yyyy", {
                locale: it,
              })}
            </p>
            {centroBolla && (
              <p className="text-sm font-medium">{centroBolla.nome}</p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 shrink-0"
          onClick={handleDownloadPdf}
          disabled={printing || impostazioniLoading}
        >
          <Download className="h-3.5 w-3.5" /> {t("bolle.scaricaPdf")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
            {bolla.tipoDestinatario === "ente"
              ? t("bolle.destinatarioEnte", { defaultValue: "Ente esterno" })
              : t("bolle.beneficiarioLabel")}
          </p>
          <p className="font-medium">
            {bolla.tipoDestinatario === "ente"
              ? bolla.enteDestinatarioNome
              : (bolla.beneficiarioNome ?? "—")}
          </p>
          {bolla.tipoDestinatario === "ente" &&
            bolla.enteDestinatarioIndirizzo && (
              <p className="text-xs text-muted-foreground">
                {bolla.enteDestinatarioIndirizzo}
              </p>
            )}
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">
            {t("bolle.magazzinoLabel")}
          </p>
          <p className="font-medium">{bolla.magazzinoNome ?? "—"}</p>
        </div>
      </div>

      {isBozza && canManage && bolla.tipoDestinatario === "beneficiario" && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" /> {t("bolle.modificaIntestazione")}
        </Button>
      )}

      <Separator />

      {/* Consegna: volontario o presso centro */}
      {!isAnnullato && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> {t("bolle.chiEffettuaConsegna")}
          </Label>
          {bolla.daPianificazione && (
            <p className="text-xs text-muted-foreground">
              {t("bolle.daPianificazioneDettaglio", {
                defaultValue:
                  "Dati ripresi dalla pianificazione collegata; puoi modificarli se necessario.",
              })}
            </p>
          )}
          {isConsegnato ? (
            <p className="text-sm font-medium">
              {bolla.volontarioNome ??
                bolla.trasportatoreNome ??
                bolla.noteConsegna ??
                "—"}
            </p>
          ) : (
            <>
              <Select
                value={consegnaValue}
                onValueChange={onChangeVolontario}
                disabled={updateBolla.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("bolle.consegnaPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__centro__">
                    {t("bolle.consegnaPressoCentro")}
                  </SelectItem>
                  {volontari
                    ?.filter((v) => v.operativo)
                    .map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {volontarioLabel(v)}
                      </SelectItem>
                    ))}
                  <SelectItem value="__altro__">
                    {t("bolle.altroRitiro")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {consegnaValue === "__altro__" && (
                <Input
                  className="mt-2"
                  defaultValue={bolla.trasportatoreNome ?? ""}
                  placeholder={t("bolle.trasportatoreNomePlaceholder")}
                  onBlur={(e) => onChangeTrasportatoreNome(e.target.value)}
                  disabled={updateBolla.isPending}
                />
              )}
            </>
          )}
        </div>
      )}

      <Separator />

      {/* Righe prodotti */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">
            {t("bolle.prodottiNellaBolla")}
          </h3>
          {modificabile && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8"
              onClick={() => setAddOpen(true)}
            >
              <PackagePlus className="h-4 w-4" />
              {t("bolle.aggiungiProdotto")}
            </Button>
          )}
        </div>

        {bolla.righe.length === 0 ? (
          <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
            <PackagePlus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {t("bolle.nessunProdotto")}
            </p>
            {modificabile && (
              <Button
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-4 w-4" /> {t("bolle.aggiungiPrimoProdotto")}
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">
                    {t("bolle.thProdotto")}
                  </TableHead>
                  <TableHead className="text-xs">
                    {t("bolle.thLotto")}
                  </TableHead>
                  <TableHead className="text-xs text-right">
                    {t("common.quantity")}
                  </TableHead>
                  {modificabile && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolla.righe.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-sm">
                      {r.prodottoNome ??
                        t("bolle.prodottoFallback", { id: r.prodottoId })}
                      {r.fsePlus && (
                        <span
                          className="ml-1 font-bold text-primary"
                          title={t("bolle.fsePlusTitle")}
                        >
                          *
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.codiceLotto ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.quantita} {r.unitaMisura}
                    </TableCell>
                    {modificabile && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => onDeleteRiga(r.id)}
                          disabled={deleteRiga.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {bolla.righe.some((r) => r.fsePlus) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("bolle.fsePlusLegend")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Azioni stato */}
      {!isAnnullato && (
        <>
          <Separator />
          <div className="space-y-2">
            {isBozza && canDeliver && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 mb-3">
                <strong>{t("bolle.confermaInfoTitle")}</strong>
                {t("bolle.confermaInfoText")}
              </div>
            )}
            {isConfermato && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 mb-3">
                <strong>{t("bolle.prontaTitle")}</strong>
                {t("bolle.prontaText")}
              </div>
            )}
            {bolla.tipoDestinatario === "beneficiario" &&
              bolla.ritiroNonEffettuatoAt && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {t("maps.missedPickup")}
                  </div>
                  {bolla.ritiroNonEffettuatoMotivo && (
                    <p className="mt-1">{bolla.ritiroNonEffettuatoMotivo}</p>
                  )}
                </div>
              )}
            {isBozza && (
              <Button
                className="w-full gap-2"
                onClick={onConferma}
                disabled={bolla.righe.length === 0 || confermaBolla.isPending}
              >
                <CheckCircle className="h-4 w-4" />
                {confermaBolla.isPending
                  ? t("bolle.confermaInCorso")
                  : t("bolle.confermaBolla")}
              </Button>
            )}
            {isConfermato && canDeliver && !hideConsegnaActions && (
              <>
                {!bolla.ritiroNonEffettuatoAt && (
                  <Button
                    className="w-full gap-2 bg-green-600 hover:bg-green-700"
                    onClick={onConsegna}
                    disabled={consegnaBolla.isPending}
                  >
                    <Truck className="h-4 w-4" />
                    {consegnaBolla.isPending
                      ? t("bolle.registrazione")
                      : t("bolle.segnaConsegnata")}
                  </Button>
                )}
                {bolla.tipoDestinatario === "beneficiario" &&
                  bolla.consegnaId == null &&
                  !bolla.ritiroNonEffettuatoAt && (
                    <Button
                      variant="outline"
                      className="w-full gap-2 border-amber-300 text-amber-800"
                      onClick={() => setRitiroOpen(true)}
                    >
                      <AlertTriangle className="h-4 w-4" />
                      {t("maps.reportMissedPickup")}
                    </Button>
                  )}
                {bolla.tipoDestinatario === "beneficiario" &&
                  bolla.consegnaId == null &&
                  bolla.ritiroNonEffettuatoAt && (
                    <Button className="w-full gap-2" onClick={openConversione}>
                      <House className="h-4 w-4" />
                      {t("maps.convertDelivery")}
                    </Button>
                  )}
                {bolla.consegnaId != null && (
                  <p className="text-xs text-muted-foreground text-center">
                    {t("bolle.giaAssegnata")}
                  </p>
                )}
                {bolla.consegnaId != null && (
                  <RouteActions
                    consegnaId={bolla.consegnaId}
                    available={Boolean(bolla.indirizzoConsegna)}
                    className="justify-center"
                  />
                )}
                {bolla.tipoDestinatario === "beneficiario" &&
                  !bolla.ritiroNonEffettuatoAt && (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => setAssegnaOpen(true)}
                    >
                      <CalendarClock className="h-4 w-4" />
                      {t("bolle.assegnaPianificazione")}
                    </Button>
                  )}
              </>
            )}
            {/* Annulla */}
            {canCancel && !isConsegnato && (
              <Button
                variant="outline"
                className="w-full gap-2 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={() => setAnnullaOpen(true)}
                disabled={annullaBolla.isPending}
              >
                <XCircle className="h-4 w-4" />
                {t("bolle.annullaBolla")}
              </Button>
            )}
            {isConsegnato && canReverseAdmin && (
              <Button
                variant="outline"
                className="w-full gap-2 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={() => setStornoOpen(true)}
                disabled={stornaAmministrativamente.isPending}
              >
                <AlertTriangle className="h-4 w-4" />
                {t("bolle.stornoAmministrativo", {
                  defaultValue: "Rettifica amministrativa",
                })}
              </Button>
            )}
          </div>
        </>
      )}

      {isConsegnato && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          {t("bolle.consegnaCompletata")}
        </div>
      )}

      {isAnnullato && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {t("bolle.bollaAnnullataInfo")}
        </div>
      )}

      {onClose && (
        <>
          <Separator />
          <Button variant="outline" className="w-full gap-2" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />{" "}
            {onCloseLabel ?? t("bolle.tornaAlleBolle")}
          </Button>
        </>
      )}

      {addOpen && bolla.magazzinoId && (
        <AggiungiProdottoDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          bollaId={bollaId}
          magazzinoId={bolla.magazzinoId}
        />
      )}

      {editOpen &&
        bolla.tipoDestinatario === "beneficiario" &&
        bolla.beneficiarioId != null && (
          <ModificaBollaDialog
            open={editOpen}
            onClose={() => setEditOpen(false)}
            bollaId={bollaId}
            versione={bolla.versione}
            beneficiarioId={bolla.beneficiarioId}
            magazzinoId={bolla.magazzinoId}
            hasRighe={bolla.righe.length > 0}
          />
        )}

      <AlertDialog
        open={annullaOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !annullaBolla.isPending) closeCancellation();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("bolle.annullareTitle", { numero: bolla.numeroBolla })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isConsegnato
                ? t("bolle.annullaDescConsegnato")
                : isConfermato
                  ? t("bolle.annullaDescConfermato")
                  : t("bolle.annullaDescBozza")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="annulla-bolla-motivo">
              {t("bolle.motivoAnnullamento", {
                defaultValue: "Motivo dell'annullamento",
              })}
            </Label>
            <Input
              id="annulla-bolla-motivo"
              value={annullaMotivo}
              maxLength={500}
              onChange={(event) => setAnnullaMotivo(event.target.value)}
              placeholder={t("bolle.motivoAnnullamentoPlaceholder", {
                defaultValue: "Indica il motivo",
              })}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={closeCancellation}
              disabled={annullaBolla.isPending}
            >
              {t("bolle.noMantieni")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={onAnnulla}
              disabled={!annullaMotivo.trim() || annullaBolla.isPending}
            >
              {t("bolle.siAnnulla")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={stornoOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !stornaAmministrativamente.isPending)
            closeAdministrativeReversal();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("bolle.stornoAmministrativoTitle", {
                defaultValue: "Rettifica amministrativa della bolla",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("bolle.stornoAmministrativoDescription", {
                defaultValue:
                  "Seleziona le righe da rettificare. L'operazione è append-only e non equivale al normale annullamento.",
              })}
            </p>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-2">
              {bolla.righe.map((riga) => {
                const residuo = riga.quantitaNetta ?? riga.quantita;
                const selectable = residuo > 0;
                const selected = stornoRigaIds.includes(riga.id);
                return (
                  <label
                    key={riga.id}
                    className="flex min-h-11 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected}
                      disabled={!selectable}
                      onCheckedChange={(checked) =>
                        setStornoRigaIds((current) =>
                          checked === true
                            ? [...new Set([...current, riga.id])]
                            : current.filter((id) => id !== riga.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {riga.prodottoNome ??
                          t("bolle.prodottoFallback", {
                            id: riga.prodottoId,
                          })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {residuo} {riga.unitaMisura}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="space-y-2">
              <Label htmlFor="storno-amministrativo-motivo">
                {t("bolle.stornoAmministrativoMotivo", {
                  defaultValue: "Motivo obbligatorio",
                })}
              </Label>
              <Input
                id="storno-amministrativo-motivo"
                value={stornoMotivo}
                maxLength={500}
                onChange={(event) => setStornoMotivo(event.target.value)}
              />
            </div>
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <Label htmlFor="storno-amministrativo-conferma">
                {t("bolle.stornoAmministrativoConferma", {
                  defaultValue:
                    "Per confermare, digita esattamente il numero bolla {{numero}}",
                  numero: bolla.numeroBolla,
                })}
              </Label>
              <Input
                id="storno-amministrativo-conferma"
                value={stornoConferma}
                onChange={(event) => setStornoConferma(event.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeAdministrativeReversal}
              disabled={stornaAmministrativamente.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={onAdministrativeReversal}
              disabled={
                !stornoAmministrativoReady ||
                stornaAmministrativamente.isPending
              }
            >
              {t("bolle.stornoAmministrativoConfirm", {
                defaultValue: "Registra rettifica",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assegnaOpen} onOpenChange={setAssegnaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bolle.assegnaPianificazioneTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("bolle.assegnaPianificazioneDesc")}
          </p>
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {pianificabili.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("bolle.nessunaPianificata")}
              </p>
            ) : (
              pianificabili.map((c) => {
                const assegnabile = c.beneficiarioId === bolla.beneficiarioId;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {c.beneficiarioNome ?? c.codice}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.codice} ·{" "}
                        {format(new Date(c.dataPrevista), "dd/MM/yyyy", {
                          locale: it,
                        })}
                        {c.fasciaOraria ? ` · ${c.fasciaOraria}` : ""}
                      </p>
                    </div>
                    {assegnabile ? (
                      <Button
                        size="sm"
                        onClick={() => onAssegna(c.id)}
                        disabled={associaBolla.isPending}
                      >
                        {t("bolle.assegna")}
                      </Button>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        {t("bolle.altroBeneficiario")}
                      </Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssegnaOpen(false)}>
              {t("bolle.tornaIndietro")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ritiroOpen} onOpenChange={setRitiroOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("maps.reportMissedPickup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ritiro-motivo">{t("maps.optionalReason")}</Label>
            <Input
              id="ritiro-motivo"
              value={ritiroMotivo}
              maxLength={500}
              onChange={(event) => setRitiroMotivo(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRitiroOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={onRitiroNonEffettuato}
              disabled={segnalaRitiro.isPending}
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conversioneOpen} onOpenChange={setConversioneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("maps.convertDelivery")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="conversione-indirizzo">
                {t("common.address")}
              </Label>
              <Input
                id="conversione-indirizzo"
                value={conversioneIndirizzo}
                maxLength={200}
                onChange={(event) =>
                  setConversioneIndirizzo(event.target.value)
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="conversione-data">{t("common.date")}</Label>
                <Input
                  id="conversione-data"
                  type="date"
                  value={conversioneData}
                  onChange={(event) => setConversioneData(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conversione-fascia">
                  {t("consegne.colFasciaOraria")}
                </Label>
                <Select
                  value={conversioneFascia}
                  onValueChange={(value) =>
                    setConversioneFascia(
                      value as Exclude<
                        ConversioneConsegnaInputFasciaOraria,
                        null
                      >,
                    )
                  }
                >
                  <SelectTrigger id="conversione-fascia">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mattina">
                      {t("consegne.fasciaMattina")}
                    </SelectItem>
                    <SelectItem value="Pomeriggio">
                      {t("consegne.fasciaPomeriggio")}
                    </SelectItem>
                    <SelectItem value="Sera">
                      {t("consegne.fasciaSera")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conversione-note">{t("common.notes")}</Label>
              <Input
                id="conversione-note"
                value={conversioneNote}
                onChange={(event) => setConversioneNote(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConversioneOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={onConvertiConsegna}
              disabled={
                !conversioneIndirizzo.trim() ||
                !conversioneData ||
                convertiConsegna.isPending
              }
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pagina principale ───────────────────────────────────────────────────────

function trasferimentoStatoBadge(stato: string) {
  if (stato === "completato")
    return (
      <Badge className="bg-green-500 text-white">
        {i18n.t("trasferimenti.statusCompletato")}
      </Badge>
    );
  if (stato === "in_transito")
    return (
      <Badge className="bg-amber-500 text-white">
        {i18n.t("trasferimenti.statusInTransito")}
      </Badge>
    );
  if (stato === "annullato")
    return (
      <Badge variant="destructive">{i18n.t("bolle.statoAnnullato")}</Badge>
    );
  if (stato === "preparato")
    return (
      <Badge variant="secondary">
        {i18n.t("trasferimenti.statusPreparato")}
      </Badge>
    );
  return (
    <Badge variant="secondary">{i18n.t("trasferimenti.statusRichiesto")}</Badge>
  );
}

function TrasferimentoDettaglioComune({
  trasferimentoId,
  trasferimentoData,
  onClose,
  onDraftDirtyChange,
}: {
  trasferimentoId: number;
  trasferimentoData?: Trasferimento;
  onClose: () => void;
  onDraftDirtyChange?: (dirty: boolean) => void;
}) {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: fetchedTrasferimento, isLoading: legacyTransferLoading } =
    useGetTrasferimento(trasferimentoId, {
      query: {
        enabled: trasferimentoData == null,
        queryKey: getGetTrasferimentoQueryKey(trasferimentoId),
      },
    });
  const trasferimento = trasferimentoData ?? fetchedTrasferimento;
  const isLoading = trasferimentoData == null && legacyTransferLoading;
  const [editing, setEditing] = useState(false);
  const avvia = useAvviaTrasferimento();
  const ricevi = useConfermaTrasferimento();
  const commandIntents = useCommandIntentRegistry();
  const canEdit = hasPermission("magazzino.transfers.create");
  const canDispatch = hasPermission("magazzino.transfers.dispatch");
  const canReceive = hasPermission("magazzino.transfers.receive");

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetTrasferimentoQueryKey(trasferimentoId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetDocumentoOperativoQueryKey(
        "trasferimento",
        trasferimentoId,
      ),
    });
    queryClient.invalidateQueries({
      queryKey: getListDocumentiOperativiQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
  };

  if (isLoading) return <Skeleton className="mt-5 h-48 w-full" />;
  if (!trasferimento)
    return (
      <p className="mt-5 text-muted-foreground">
        {t("trasferimenti.notFound", {
          defaultValue: "Trasferimento non trovato",
        })}
      </p>
    );

  const avviabile =
    trasferimento.stato === "richiesto" || trasferimento.stato === "preparato";
  const onAvvia = () => {
    const slot = `trasferimento:${trasferimento.id}:start`;
    avvia.mutate(
      {
        id: trasferimento.id,
        data: commandIntents.prepare(
          slot,
          {},
          {
            versione: trasferimento.versione,
          },
        ),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidate();
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
  };
  const onRicevi = () => {
    const slot = `trasferimento:${trasferimento.id}:receive`;
    ricevi.mutate(
      {
        id: trasferimento.id,
        data: commandIntents.prepare(
          slot,
          {},
          {
            versione: trasferimento.versione,
            dataConferma: new Date().toISOString(),
          },
        ),
      },
      {
        onSuccess: () => {
          commandIntents.complete(slot);
          invalidate();
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
  };

  return (
    <div className="mt-5 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-lg font-semibold">
            {trasferimento.codice}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(new Date(trasferimento.dataRichiesta), "dd MMMM yyyy", {
              locale: it,
            })}
          </p>
        </div>
        {trasferimentoStatoBadge(trasferimento.stato)}
      </div>
      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium">
        <span>{trasferimento.magazzinoOrigineNome}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span>{trasferimento.magazzinoDestinoNome}</span>
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("common.details")}
        </p>
        {(trasferimento.righe ?? []).map((riga) => (
          <div
            key={riga.id}
            className="flex justify-between gap-3 border-b py-2 text-sm"
          >
            <span>{riga.prodottoNome}</span>
            <span className="font-medium">
              {riga.quantita} {riga.unitaMisura}
            </span>
          </div>
        ))}
      </div>
      {trasferimento.note && (
        <p className="rounded-md bg-muted p-3 text-sm">{trasferimento.note}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {avviabile && canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1.5 h-4 w-4" />
            {t("common.edit")}
          </Button>
        )}
        {avviabile && canDispatch && (
          <Button
            variant="outline"
            onClick={onAvvia}
            disabled={avvia.isPending}
          >
            <Play className="mr-1.5 h-4 w-4" />
            {t("trasferimenti.avvia")}
          </Button>
        )}
        {trasferimento.stato === "in_transito" && canReceive && (
          <Button onClick={onRicevi} disabled={ricevi.isPending}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {t("trasferimenti.confermaRic")}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      {editing && (
        <ModificaTrasferimentoForm
          key={trasferimento.id}
          trasferimento={trasferimento}
          open
          onDirtyChange={onDraftDirtyChange}
          onClose={() => {
            setEditing(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function DocumentoOperativoDettaglioComune({
  selection,
  onClose,
  onDraftDirtyChange,
}: {
  selection: DocumentoOperativoSelection;
  onClose: () => void;
  onDraftDirtyChange: (dirty: boolean) => void;
}) {
  const { user, hasPermission } = useAuth();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetDocumentoOperativo(
    selection.tipo,
    selection.id,
    {
      query: {
        queryKey: [
          ...getGetDocumentoOperativoQueryKey(selection.tipo, selection.id),
          {
            userId: user?.id ?? null,
            centroAscoltoId: user?.centroAscoltoId ?? null,
            areaOperativaId: user?.areaOperativaId ?? null,
            zonaUdsId: user?.zonaUdsId ?? null,
            canViewBolle: hasPermission("bolle.view"),
            canViewTransfers: hasPermission("magazzino.view"),
          },
        ],
      },
    },
  );

  if (isLoading) return <Skeleton className="mt-5 h-48 w-full" />;
  if (isError || !data || data.tipoAggregato !== selection.tipo)
    return (
      <p className="mt-5 text-muted-foreground">
        {t("bolle.documentoNonTrovato", {
          defaultValue: "Documento non trovato o non accessibile",
        })}
      </p>
    );

  if (data.tipoAggregato === "bolla")
    return (
      <BollaDettaglio
        bollaId={selection.id}
        bollaData={data.dettaglio as BollaDettaglioDto}
        onClose={onClose}
      />
    );

  return (
    <TrasferimentoDettaglioComune
      trasferimentoId={selection.id}
      trasferimentoData={data.dettaglio as Trasferimento}
      onClose={onClose}
      onDraftDirtyChange={onDraftDirtyChange}
    />
  );
}

export default function Bolle() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canViewBolle = hasPermission("bolle.view");
  const canViewTransfers = hasPermission("magazzino.view");
  const canManage = hasPermission("bolle.manage");
  const canDeliver = hasPermission("bolle.deliver");
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
  const { data: beneficiari } = useListBeneficiari(undefined, {
    query: {
      enabled: canViewBolle,
      queryKey: getListBeneficiariQueryKey(),
    },
  });
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
      ? ["bozza", "confermato", "consegnato", "annullato"]
      : filters.tipoAggregato === "trasferimento"
        ? ["richiesto", "preparato", "in_transito", "completato", "annullato"]
        : [
            "bozza",
            "confermato",
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
                {t("bolle.creationDate", { defaultValue: "Data creazione" })}
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
                          {row.bolla.stato === "confermato" && canDeliver && (
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
                          {(row.bolla.stato === "confermato" ||
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
