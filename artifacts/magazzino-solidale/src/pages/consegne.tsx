import { useState, useEffect, useMemo, useRef } from "react";
import { useListConsegne, exportConsegne, useCreateConsegna, useCompletaConsegna, useDeleteConsegna, useAssociaBolla, useInviaEmailConsegnaBeneficiario, useInviaEmailConsegnaVolontario, useListBolle, useListBeneficiari, useGetBeneficiario, getGetBeneficiarioQueryKey, useListMagazzini, useListVolontari, useListMezzi, useGetVolontariCarico, getGetVolontariCaricoQueryKey, useListCentriAscolto, useListAreeOperative, getListAreeOperativeQueryKey, getListConsegneQueryKey, useCreateTurnoVolontarioPending, useCreateTurnoMezzoPending, useListRuoliVolontari, getListVolontariQueryKey, getListMezziQueryKey, type Consegna, type Volontario, type Mezzo } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { BeneficiarioCombobox } from "@/components/beneficiario-combobox";
import { RouteActions } from "@/components/maps/route-actions";
import { BollaDettaglio, CreaiBollaDialog } from "@/pages/bolle";
import { Plus, MapPin, Truck, CheckCircle2, Filter, FileText, FileClock, Link2, Download, CalendarClock, Building2, Package, Mail, ChevronDown, Trash2, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, subMonths } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { volontarioLabel } from "@/lib/volontari-label";
import { todayEuropeRome } from "@/lib/europe-rome";
import { UnsavedChangesDialog, useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  tipoConsegna: z.string().min(1),
  dataPrevista: z.string().min(1),
  fasciaOraria: z.string().optional(),
  indirizzoConsegna: z.string().optional(),
  zona: z.string().optional(),
  magazzinoId: z.coerce.number().min(1),
  volontarioId: z.coerce.number().optional(),
  volontarioAltro: z.string().optional(),
  mezzoId: z.coerce.number().optional(),
  mezzoAltro: z.boolean().optional(),
  noteOperative: z.string().optional()
}).superRefine((value, context) => {
  if (value.tipoConsegna !== "domicilio") return;
  const address = value.indirizzoConsegna?.trim() ?? "";
  if (!address || address.length > 200) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["indirizzoConsegna"],
      message: "Indirizzo obbligatorio (massimo 200 caratteri)",
    });
  }
});

export default function Consegne() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const isAreaOperativaGlobal = user?.areaOperativaId == null;
  const canCreateVolontario = hasPermission("logistica.volontari.manage");
  const canCreateMezzo = hasPermission("logistica.mezzi.manage");
  const canManage = hasPermission("consegne.manage");
  const canComplete = hasPermission("consegne.complete");
  const canCancel = hasPermission("consegne.cancel");
  const canExport = hasPermission("consegne.export");
  const initialSearch = useMemo(() => new URLSearchParams(window.location.search), []);
  const [areaOperativaFilter, setAreaOperativaFilter] = useState(initialSearch.get("area") ?? "all");
  const [centroFilter, setCentroFilter] = useState(initialSearch.get("centro") ?? "all");
  const [statoFilter, setStatoFilter] = useState(initialSearch.get("stato") ?? "all");
  const [search, setSearch] = useState(initialSearch.get("q") ?? "");
  const [page, setPage] = useState(() => Math.max(1, Number(initialSearch.get("page")) || 1));
  const pageSize = 25;
  const [createCentroId, setCreateCentroId] = useState("all");
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
      setCreateCentroId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const lastMonthRange = useMemo(() => {
    const oggiCivile = todayEuropeRome();
    const oggi = new Date(`${oggiCivile}T12:00:00`);
    return {
      inizio: format(subMonths(oggi, 1), "yyyy-MM-dd"),
      fine: oggiCivile,
    };
  }, []);
  const [dataInizio, setDataInizio] = useState(initialSearch.get("dal") ?? lastMonthRange.inizio);
  const [dataFine, setDataFine] = useState(initialSearch.get("al") ?? lastMonthRange.fine);
  const consegneParams: { page: number; pageSize: number; q?: string; centroAscoltoId?: number; stato?: string; dataInizio?: string; dataFine?: string } = { page, pageSize };
  if (search.trim()) consegneParams.q = search.trim();
  if (centroFilter !== "all") consegneParams.centroAscoltoId = parseInt(centroFilter);
  if (statoFilter !== "all") consegneParams.stato = statoFilter;
  if (dataInizio) consegneParams.dataInizio = dataInizio;
  if (dataFine) consegneParams.dataFine = dataFine;
  const { data: consegnePage, isLoading } = useListConsegne(consegneParams);
  const consegne = consegnePage?.items ?? [];
  useEffect(() => {
    const params = new URLSearchParams();
    if (areaOperativaFilter !== "all") params.set("area", areaOperativaFilter);
    if (centroFilter !== "all") params.set("centro", centroFilter);
    if (statoFilter !== "all") params.set("stato", statoFilter);
    if (search.trim()) params.set("q", search.trim());
    if (dataInizio) params.set("dal", dataInizio);
    if (dataFine) params.set("al", dataFine);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [areaOperativaFilter, centroFilter, dataFine, dataInizio, page, search, statoFilter]);
  const { data: beneficiari } = useListBeneficiari({
    attivo: true,
    ...(createCentroId !== "all" ? { centroAscoltoId: parseInt(createCentroId) } : {}),
  });
  const { data: allBeneficiari } = useListBeneficiari({ attivo: true });
  const { data: magazzini } = useListMagazzini();
  const { data: mezzi } = useListMezzi();
  const { data: ruoliVolontari } = useListRuoliVolontari();
  const { data: centri } = useListCentriAscolto();
  const { data: areaOperativaList } = useListAreeOperative({
    query: { queryKey: getListAreeOperativeQueryKey(), enabled: isAreaOperativaGlobal },
  });

  // Global (multi-area operativa) users MUST pick a area operativa first; the centro pickers then
  // only show centri belonging to that area operativa (empty until a area operativa is chosen).
  // Area Operativa-scoped users already receive only their own area operativa's centri from the
  // API, so no extra filtering is needed.
  const areaOperativaNotChosen = isAreaOperativaGlobal && areaOperativaFilter === "all";
  const centriFiltrati = (centri ?? []).filter((c) => {
    if (!isAreaOperativaGlobal) return true;
    if (areaOperativaFilter === "all") return false;
    return c.areaOperativaId != null && String(c.areaOperativaId) === areaOperativaFilter;
  });

  const handleAreaOperativaFilterChange = (v: string) => {
    setAreaOperativaFilter(v);
    setCentroFilter("all");
    setCreateCentroId("all");
    setPage(1);
  };
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const apiErrorMessage = (e: unknown) =>
    (e as { data?: { error?: string } })?.data?.error ??
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    t("consegne.toastErrore");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [associatingId, setAssociatingId] = useState<number | null>(null);
  const [selectedBollaId, setSelectedBollaId] = useState<string>("");
  const [viewingBollaId, setViewingBollaId] = useState<number | null>(null);
  const [creatingBollaFor, setCreatingBollaFor] = useState<Consegna | null>(null);
  const [ripianificando, setRipianificando] = useState<Consegna | null>(null);
  const [riDate, setRiDate] = useState("");
  const [riFascia, setRiFascia] = useState("Mattina");
  const [scanCode, setScanCode] = useState("");
  const [annullandoId, setAnnullandoId] = useState<number | null>(null);
  const [pendingVolontari, setPendingVolontari] = useState<Volontario[]>([]);
  const [pendingMezzi, setPendingMezzi] = useState<Mezzo[]>([]);
  const [volontarioDialogOpen, setVolontarioDialogOpen] = useState(false);
  const [mezzoDialogOpen, setMezzoDialogOpen] = useState(false);
  const [nuovoVolontario, setNuovoVolontario] = useState({ nome: "", cognome: "", matricola: "", ruoloVolontarioId: null as number | null, telefono: "", patente: false, note: "" });
  const [volontarioError, setVolontarioError] = useState<string | null>(null);
  const [nuovoMezzo, setNuovoMezzo] = useState({ tipo: "", targa: "", proprieta: "associazione", descrizione: "", note: "" });

  const { data: bolle } = useListBolle();

  const createConsegna = useCreateConsegna();
  const completaConsegna = useCompletaConsegna();
  const deleteConsegna = useDeleteConsegna();
  const associaBolla = useAssociaBolla();
  const inviaEmailBeneficiario = useInviaEmailConsegnaBeneficiario();
  const inviaEmailVolontario = useInviaEmailConsegnaVolontario();
  const createPendingVolontario = useCreateTurnoVolontarioPending();
  const createPendingMezzo = useCreateTurnoMezzoPending();

  const associatingConsegna = consegne?.find(c => c.id === associatingId) ?? null;
  // bolle selezionabili: stesso beneficiario, non annullate, non già consegnate, non già legate ad altra consegna
  const bolleDisponibili = (bolle ?? []).filter(b =>
    associatingConsegna != null &&
    b.beneficiarioId === associatingConsegna.beneficiarioId &&
    b.stato !== "annullato" &&
    b.stato !== "consegnato" &&
    (b.consegnaId == null || b.consegnaId === associatingConsegna.id)
  );

  const handleAssocia = (bollaId: number | null) => {
    if (!associatingId) return;
    associaBolla.mutate({ id: associatingId, data: { bollaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: bollaId ? t("consegne.toastBollaAssociata") : t("consegne.toastBollaScollegata") });
        setAssociatingId(null);
        setSelectedBollaId("");
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastOpFallita"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
      },
    });
  };

  const handleAnnulla = () => {
    if (annullandoId == null) return;
    deleteConsegna.mutate({ id: annullandoId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastAnnullata") });
        setAnnullandoId(null);
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastOpFallita"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
      },
    });
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      beneficiarioId: 0, tipoConsegna: "in_sede", dataPrevista: todayEuropeRome(),
      fasciaOraria: "Mattina", magazzinoId: 0, noteOperative: ""
    }
  });
  const unsavedGuard = useUnsavedChangesGuard(isFormOpen && form.formState.isDirty);
  const closePlanningForm = () => unsavedGuard.requestClose(() => {
    setIsFormOpen(false);
    form.reset();
  });

  const dataPrevistaWatch = form.watch("dataPrevista");
  const fasciaOrariaWatch = form.watch("fasciaOraria");
  const volontariOperativiParams = {
    dataRiferimento: dataPrevistaWatch,
    stato: "attivi" as const,
  };
  const { data: volontari } = useListVolontari(volontariOperativiParams, {
    query: {
      queryKey: getListVolontariQueryKey(volontariOperativiParams),
      enabled: /^\d{4}-\d{2}-\d{2}$/.test(dataPrevistaWatch ?? ""),
    },
  });
  const fasciaCanonica = fasciaOrariaWatch === "Mattina" ? "09-13" : fasciaOrariaWatch === "Pomeriggio" ? "14-18" : fasciaOrariaWatch === "Sera" ? "18-20" : null;
  const validData = /^\d{4}-\d{2}-\d{2}$/.test(dataPrevistaWatch ?? "");
  const caricoParams = { data: dataPrevistaWatch, fascia: (fasciaCanonica ?? "09-13") as "09-13" | "14-18" | "18-20" };
  const { data: caricoTurno } = useGetVolontariCarico(
    caricoParams,
    { query: { queryKey: getGetVolontariCaricoQueryKey(caricoParams), enabled: validData && fasciaCanonica != null } },
  );
  const caricoMap = new Map((caricoTurno ?? []).map((c) => [c.volontarioId, c.count]));
  const selectedBeneficiarioId = form.watch("beneficiarioId");
  const previousBeneficiarioId = useRef(selectedBeneficiarioId);
  const { data: beneficiarioDettaglio } = useGetBeneficiario(selectedBeneficiarioId, {
    query: {
      queryKey: getGetBeneficiarioQueryKey(selectedBeneficiarioId),
      enabled: selectedBeneficiarioId > 0,
    },
  });
  const beneficiarioSelezionato = useMemo(
    () => [...(beneficiari ?? []), ...(allBeneficiari ?? [])].find((b) => b.id === selectedBeneficiarioId),
    [allBeneficiari, beneficiari, selectedBeneficiarioId],
  );
  useEffect(() => {
    if (previousBeneficiarioId.current === selectedBeneficiarioId) return;
    previousBeneficiarioId.current = selectedBeneficiarioId;
    if (form.getValues("tipoConsegna") === "domicilio") {
      form.setValue("indirizzoConsegna", "", { shouldValidate: true });
    }
  }, [form, selectedBeneficiarioId]);
  useEffect(() => {
    if (
      form.getValues("tipoConsegna") === "domicilio"
      && beneficiarioDettaglio?.id === selectedBeneficiarioId
      && !(form.getValues("indirizzoConsegna") ?? "").trim()
    ) {
      form.setValue("indirizzoConsegna", beneficiarioDettaglio.domicilio?.trim() ?? "", {
        shouldValidate: true,
      });
    }
  }, [beneficiarioDettaglio, form, selectedBeneficiarioId]);
  const effectiveConsegnaCentroId = beneficiarioSelezionato?.centroAscoltoId
    ?? (createCentroId !== "all" ? parseInt(createCentroId) : lockedCentroId);
  const volontariConsegna = useMemo(
    () => (volontari ?? []).filter((v, idx, all) => {
      if (all.findIndex((item) => item.id === v.id) !== idx) return false;
      if (!v.operativo) return false;
      if (v.centroAscoltoId == null) return true;
      return effectiveConsegnaCentroId != null && v.centroAscoltoId === effectiveConsegnaCentroId;
    }),
    [effectiveConsegnaCentroId, volontari],
  );
  const mezziConsegna = useMemo(
    () => (mezzi ?? []).filter((m, idx, all) => {
      if (all.findIndex((item) => item.id === m.id) !== idx) return false;
      if (m.stato !== "disponibile" || (m.statoApprovazione ?? "approvato") !== "approvato") return false;
      if ((m.scadenzaAssicurazione != null && m.scadenzaAssicurazione.slice(0, 10) < dataPrevistaWatch) || (m.scadenzaRevisione != null && m.scadenzaRevisione.slice(0, 10) < dataPrevistaWatch)) return false;
      if (m.effectiveCentroId == null) return true;
      return effectiveConsegnaCentroId != null && m.effectiveCentroId === effectiveConsegnaCentroId;
    }),
    [dataPrevistaWatch, effectiveConsegnaCentroId, mezzi],
  );

  const onSubmit = (raw: z.infer<typeof formSchema>) => {
    const data = { ...raw };
    const altroSelected = data.volontarioAltro !== undefined;
    if (altroSelected && !data.volontarioAltro?.trim()) {
      form.setError("volontarioAltro", { type: "manual", message: t("common.requiredField") });
      return;
    }
    if (data.volontarioAltro?.trim()) {
      data.volontarioAltro = data.volontarioAltro.trim();
      delete data.volontarioId;
    } else {
      delete data.volontarioAltro;
    }
    if (!data.volontarioId) delete data.volontarioId;
    if (!data.mezzoId) delete data.mezzoId;
    data.mezzoAltro = !!data.mezzoAltro && !data.mezzoId;
    createConsegna.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastConsegnaProgrammata") });
        form.reset();
        setIsFormOpen(false);
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastOpFallita"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
      },
    });
  };

  const creaVolontarioPending = () => {
    if (effectiveConsegnaCentroId == null || nuovoVolontario.ruoloVolontarioId == null || !nuovoVolontario.nome.trim() || !nuovoVolontario.cognome.trim() || !nuovoVolontario.matricola.trim()) {
      return;
    }
    setVolontarioError(null);
    createPendingVolontario.mutate(
      {
        data: {
          centroAscoltoId: effectiveConsegnaCentroId,
          nome: nuovoVolontario.nome.trim(),
          cognome: nuovoVolontario.cognome.trim(),
          matricola: nuovoVolontario.matricola.trim(),
          ruoloVolontarioId: nuovoVolontario.ruoloVolontarioId,
          telefono: nuovoVolontario.telefono.trim() || undefined,
          patente: nuovoVolontario.patente,
          note: nuovoVolontario.note.trim() || "Inserito da pianificazione consegne",
        },
      },
      {
        onSuccess: (created) => {
          setPendingVolontari((prev) => [created, ...prev.filter((v) => v.id !== created.id)]);
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ description: t("turni.pendingVolCreated", { defaultValue: "Volontario inserito in attesa di approvazione" }) });
          setNuovoVolontario({ nome: "", cognome: "", matricola: "", ruoloVolontarioId: null, telefono: "", patente: false, note: "" });
          setVolontarioError(null);
          setVolontarioDialogOpen(false);
        },
        onError: (e: unknown) => {
          const message = apiErrorMessage(e);
          setVolontarioError(message);
          toast({ variant: "destructive", description: message });
        },
      },
    );
  };

  const creaMezzoPending = () => {
    if (effectiveConsegnaCentroId == null || !nuovoMezzo.tipo.trim()) return;
    createPendingMezzo.mutate(
      {
        data: {
          centroAscoltoId: effectiveConsegnaCentroId,
          tipo: nuovoMezzo.tipo.trim(),
          targa: nuovoMezzo.targa.trim() || undefined,
          proprieta: nuovoMezzo.proprieta || "associazione",
          descrizione: nuovoMezzo.descrizione.trim() || undefined,
          note: nuovoMezzo.note.trim() || "Inserito da pianificazione consegne",
        },
      },
      {
        onSuccess: (created) => {
          setPendingMezzi((prev) => [created, ...prev.filter((m) => m.id !== created.id)]);
          queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
          toast({ description: t("turni.pendingMezzoCreated", { defaultValue: "Mezzo inserito in attesa di approvazione" }) });
          setNuovoMezzo({ tipo: "", targa: "", proprieta: "associazione", descrizione: "", note: "" });
          setMezzoDialogOpen(false);
        },
        onError: (e: unknown) => toast({ variant: "destructive", description: apiErrorMessage(e) }),
      },
    );
  };

  const handleScan = (codeOverride?: string) => {
    const code = (codeOverride ?? scanCode).trim();
    if (!code) return;
    const b = allBeneficiari?.find((x) => x.codice.toLowerCase() === code.toLowerCase());
    if (!b) {
      toast({ title: t("consegne.scanNotFound"), variant: "destructive" });
      return;
    }
    setCreateCentroId(isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : (b.centroAscoltoId ? String(b.centroAscoltoId) : "all"));
    form.setValue("beneficiarioId", b.id);
    setScanCode("");
    toast({ title: t("consegne.scanFound", { name: `${b.cognome} ${b.nome}` }) });
  };

  const openRipianifica = (c: Consegna) => {
    setRipianificando(c);
    setRiDate(todayEuropeRome());
    setRiFascia(c.fasciaOraria || "Mattina");
  };

  const handleRipianifica = () => {
    if (!ripianificando || !riDate) return;
    const c = ripianificando;
    const data = {
      beneficiarioId: c.beneficiarioId,
      tipoConsegna: c.tipoConsegna,
      dataPrevista: riDate,
      fasciaOraria: riFascia || undefined,
      indirizzoConsegna: c.indirizzoConsegna ?? undefined,
      zona: c.zona ?? undefined,
      magazzinoId: c.magazzinoId,
      volontarioId: c.volontarioId ?? undefined,
      volontarioAltro: c.volontarioAltro ?? undefined,
      mezzoId: c.mezzoId ?? undefined,
      mezzoAltro: c.mezzoAltro ?? false,
      noteOperative: c.noteOperative ?? undefined,
    };
    createConsegna.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastRipianificata") });
        setRipianificando(null);
      },
    });
  };

  const handleCompleta = () => {
    if (!completingId) return;
    completaConsegna.mutate({ id: completingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: t("consegne.toastConsegnaRegistrata"), description: t("consegne.toastConsegnaRegistrataDesc") });
        setCompletingId(null);
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: t("consegne.toastImpossibileCompletare"), description: msg ?? t("consegne.toastErrore"), variant: "destructive" });
        setCompletingId(null);
      },
    });
  };

  const handleInviaEmail = (id: number, destinatario: "beneficiario" | "volontario") => {
    const mutation = destinatario === "beneficiario" ? inviaEmailBeneficiario : inviaEmailVolontario;
    mutation.mutate({ id }, {
      onSuccess: (res) => {
        if (res.sent) {
          toast({ title: t("consegne.toastEmailInviata") });
        } else {
          toast({ title: t("consegne.toastEmailErrore"), description: res.error ?? undefined, variant: "destructive" });
        }
      },
      onError: () => toast({ title: t("consegne.toastEmailErrore"), variant: "destructive" }),
    });
  };

  const closeViewingBolla = () => {
    setViewingBollaId(null);
    queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
  };

  const exportParams = {
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(centroFilter !== "all" ? { centroAscoltoId: Number(centroFilter) } : {}),
    ...(statoFilter !== "all" ? { stato: statoFilter } : {}),
    ...(dataInizio ? { dataInizio } : {}),
    ...(dataFine ? { dataFine } : {}),
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("consegne.title")}</h1>
          <p className="text-muted-foreground">{t("consegne.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && <ExportButtons
            rows={consegne}
            loadRows={async () => (await exportConsegne(exportParams)).items}
            columns={[
              { header: t("common.code"), accessor: (c) => c.codice },
              { header: t("consegne.colDataPrevista"), accessor: (c) => c.dataPrevista ? new Date(c.dataPrevista).toLocaleDateString("it-IT") : "" },
              { header: t("consegne.colFasciaOraria"), accessor: (c) => c.fasciaOraria },
              { header: t("consegne.beneficiario"), accessor: (c) => c.beneficiarioNome },
              { header: t("common.centro"), accessor: (c) => c.centroAscoltoNome ?? "" },
              { header: t("common.type"), accessor: (c) => c.tipoConsegna?.replace('_', ' ') },
              { header: t("common.address"), accessor: (c) => c.indirizzoConsegna },
              { header: t("consegne.zona"), accessor: (c) => c.zona },
              { header: t("consegne.magazzino"), accessor: (c) => c.magazzinoNome },
              { header: t("consegne.volontario"), accessor: (c) => c.volontarioNome ?? c.volontarioAltro ?? "" },
              { header: t("common.status"), accessor: (c) => c.stato },
            ]}
            filename="consegne"
            title={t("consegne.exportTitle")}
            orientation="landscape"
          />}
          {canManage && <Button
            onClick={() => {
              form.reset({
                beneficiarioId: 0,
                tipoConsegna: "in_sede",
                dataPrevista: todayEuropeRome(),
                fasciaOraria: "Mattina",
                magazzinoId: 0,
                noteOperative: "",
              });
              setIsFormOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> {t("consegne.planDelivery")}
          </Button>}
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-2 lg:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            <Filter className="h-4 w-4" /> Filtri e ricerca
          </Button>
          <div className="hidden flex-wrap items-center gap-2 lg:flex">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Cerca codice, beneficiario o indirizzo"
              aria-label="Cerca consegne"
              className="w-full min-h-11 sm:w-[240px]"
            />
            {isGlobal && isAreaOperativaGlobal && (
              <Select value={areaOperativaFilter} onValueChange={handleAreaOperativaFilterChange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("consegne.filterAreaOperativa")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consegne.filterAllAreaOperativa")}</SelectItem>
                  {areaOperativaList?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {isGlobal && (
              <Select value={centroFilter} onValueChange={(value) => { setCentroFilter(value); setPage(1); }} disabled={areaOperativaNotChosen}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={areaOperativaNotChosen ? t("consegne.selectAreaOperativaFirst") : t("consegne.filterAllCenters")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consegne.filterAllCenters")}</SelectItem>
                  {centriFiltrati.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={statoFilter} onValueChange={(value) => { setStatoFilter(value); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("consegne.filterAllStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("consegne.filterAllStatuses")}</SelectItem>
                <SelectItem value="pianificata">{t("consegne.statoPianificata")}</SelectItem>
                <SelectItem value="effettuata">{t("consegne.statoEffettuata")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dataInizio}
              onChange={(e) => { setDataInizio(e.target.value); setPage(1); }}
              className="w-[160px] min-h-11"
              aria-label={t("consegne.filterDateFrom")}
              title={t("consegne.filterDateFrom")}
            />
            <Input
              type="date"
              value={dataFine}
              onChange={(e) => { setDataFine(e.target.value); setPage(1); }}
              className="w-[160px] min-h-11"
              aria-label={t("consegne.filterDateTo")}
              title={t("consegne.filterDateTo")}
            />
            {(dataInizio || dataFine) && (
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => { setDataInizio(""); setDataFine(""); setPage(1); }}>
                {t("consegne.clearDate")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div data-testid="consegne-mobile-list" className="grid gap-3 p-3 lg:hidden">
            {isLoading ? (
              Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-52 w-full rounded-lg" />
              ))
            ) : consegne.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t("consegne.emptyState")}
              </p>
            ) : (
              consegne.map((c) => {
                const bollaPronta =
                  c.bollaStato === "confermato" || c.bollaStato === "consegnato";
                return (
                  <article key={c.id} data-consegna-id={c.id} className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs text-muted-foreground">{c.codice}</p>
                        <h2 className="font-semibold">{c.beneficiarioNome}</h2>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(`${c.dataPrevista.slice(0, 10)}T12:00:00`), "dd MMM yyyy", { locale: it })}
                          {c.fasciaOraria ? ` · ${c.fasciaOraria}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant={c.stato === "effettuata" ? "default" : "outline"}
                        className={c.stato === "effettuata" ? "bg-green-600" : "border-blue-200 bg-blue-50 text-blue-700"}
                      >
                        {c.stato === "effettuata" ? t("consegne.badgeConsegnata") : t("consegne.badgePianificata")}
                      </Badge>
                    </div>
                    <div className="space-y-1 text-sm">
                      {isGlobal && c.centroAscoltoNome && <p>{c.centroAscoltoNome}</p>}
                      {c.tipoConsegna === "domicilio" ? (
                        <p className="flex items-start gap-2 text-blue-700">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{c.indirizzoConsegna || t("consegne.domicilioFallback")}</span>
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-purple-700">
                          <Building2 className="h-4 w-4" /> {t("consegne.ritiroCentro")}
                        </p>
                      )}
                      {c.magazzinoNome && (
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <Package className="h-4 w-4" /> {c.magazzinoNome}
                        </p>
                      )}
                      {c.volontarioId != null && c.volontarioOperativo === false && (
                        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>Il volontario assegnato non è più operativo per questa data. Verifica l’assegnazione.</span>
                        </p>
                      )}
                    </div>
                    <RouteActions
                      consegnaId={c.id}
                      available={c.stato === "pianificata" && c.tipoConsegna === "domicilio" && Boolean(c.indirizzoConsegna)}
                      className="justify-start"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      {c.bollaId != null && (
                        <Button className="min-h-11 gap-2" variant="outline" onClick={() => setViewingBollaId(c.bollaId!)}>
                          <FileText className="h-4 w-4" /> {c.stato === "effettuata" ? t("consegne.btnBolla") : t("consegne.btnCompilaBolla")}
                        </Button>
                      )}
                      {c.stato === "pianificata" && c.bollaId == null && canManage && (
                        <Button className="min-h-11 gap-2" variant="outline" onClick={() => setCreatingBollaFor(c)}>
                          <Plus className="h-4 w-4" /> {t("consegne.btnCreaBolla")}
                        </Button>
                      )}
                      {c.stato === "pianificata" && bollaPronta && canComplete && (
                        <Button className="min-h-11 gap-2 bg-green-600 hover:bg-green-700" onClick={() => setCompletingId(c.id)}>
                          <CheckCircle2 className="h-4 w-4" /> {t("bolle.segnaConsegnata")}
                        </Button>
                      )}
                      {c.stato === "effettuata" && canManage && (
                        <Button className="min-h-11 gap-2" variant="outline" onClick={() => openRipianifica(c)}>
                          <CalendarClock className="h-4 w-4" /> {t("consegne.btnRipianifica")}
                        </Button>
                      )}
                      {c.stato === "pianificata" && canCancel && (
                        <Button className="min-h-11 gap-2 text-destructive hover:text-destructive" variant="ghost" onClick={() => setAnnullandoId(c.id)}>
                          <Trash2 className="h-4 w-4" /> {t("consegne.btnAnnulla")}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <Table data-testid="consegne-desktop-list" className="hidden lg:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>{t("consegne.thDataFascia")}</TableHead>
                <TableHead>{t("consegne.beneficiario")}</TableHead>
                {isGlobal && <TableHead>{t("common.centro")}</TableHead>}
                <TableHead>{t("consegne.thDettagli")}</TableHead>
                <TableHead>{t("consegne.thBolla")}</TableHead>
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("consegne.thAzione")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : consegne?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 8 : 7} className="h-32 text-center text-muted-foreground">{t("consegne.emptyState")}</TableCell>
                </TableRow>
              ) : consegne?.map((c) => (
                <TableRow key={c.id} data-consegna-id={c.id}>
                  <TableCell className="font-mono text-xs">{c.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{format(new Date(c.dataPrevista), "dd MMM yyyy", { locale: it })}</div>
                    <div className="text-xs text-muted-foreground">{c.fasciaOraria}</div>
                  </TableCell>
                  <TableCell className="font-medium">{c.beneficiarioNome}</TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm">
                      {c.centroAscoltoNome ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm">
                      {c.tipoConsegna === 'diretta' ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Truck className="h-3 w-3" /> {t("consegne.consegnaDiretta")}
                        </div>
                      ) : (
                        <>
                          {c.tipoConsegna === 'domicilio' ? (
                            <div className="space-y-1 text-blue-600">
                              <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.indirizzoConsegna || t("consegne.domicilioFallback")} {c.zona ? `(${c.zona})` : ''}</div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-purple-600">
                              <Building2 className="h-3 w-3" /> {t("consegne.ritiroCentro")}
                            </div>
                          )}
                          {c.magazzinoNome && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Package className="h-3 w-3" /> {t("consegne.preparazionePresso", { magazzino: c.magazzinoNome })}
                            </div>
                          )}
                        </>
                      )}
                      {(c.volontarioNome || c.volontarioAltro) && (
                        <div className="text-xs text-muted-foreground">
                          {t("consegne.volontarioPrefix", { name: c.volontarioNome ?? c.volontarioAltro })}
                        </div>
                      )}
                      {c.volontarioId != null && c.volontarioOperativo === false && (
                        <div className="flex items-start gap-1 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>Assegnazione da verificare: volontario non operativo per la data.</span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const consegnata = c.stato === 'effettuata';
                      const pronta = c.bollaStato === 'confermato' || c.bollaStato === 'consegnato';
                      const badge = c.bollaStato == null ? (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> {t("consegne.inPreparazione")}
                        </Badge>
                      ) : pronta ? (
                        <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700">
                          <FileText className="h-3 w-3" /> {c.bollaNumero} · {t("consegne.pronta")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> {c.bollaNumero} · {t("consegne.inPreparazione")}
                        </Badge>
                      );
                      return (
                        <button
                          type="button"
                          disabled={(consegnata && c.bollaId == null) || (!consegnata && !canManage)}
                          onClick={() => {
                            if (consegnata) {
                              if (c.bollaId != null) setViewingBollaId(c.bollaId);
                            } else {
                              setAssociatingId(c.id);
                              setSelectedBollaId(c.bollaId ? String(c.bollaId) : "");
                            }
                          }}
                          className="min-h-11 text-left disabled:cursor-default disabled:opacity-100 enabled:hover:opacity-80"
                          title={consegnata ? (c.bollaId != null ? t("consegne.titleViewBolla") : undefined) : t("consegne.titleManageBolla")}
                        >
                          {badge}
                        </button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.stato === 'effettuata' ? 'default' : 'outline'}
                           className={c.stato === 'effettuata' ? 'bg-green-500' : 'border-blue-200 text-blue-700 bg-blue-50'}>
                      {c.stato === 'effettuata' ? t("consegne.badgeConsegnata") : t("consegne.badgePianificata")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <RouteActions
                      consegnaId={c.id}
                      available={c.stato === "pianificata" && c.tipoConsegna === "domicilio" && Boolean(c.indirizzoConsegna)}
                      className="mb-2 justify-end sm:mb-0 sm:me-2"
                      compact
                    />
                    {c.stato === 'effettuata' ? (
                      <div className="flex items-center justify-end gap-2">
                        {c.bollaId != null && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setViewingBollaId(c.bollaId!)}>
                            <Download className="h-3.5 w-3.5" /> {t("consegne.btnBolla")}
                          </Button>
                        )}
                        {canManage && <Button size="sm" variant="outline" className="gap-1 min-h-11" onClick={() => openRipianifica(c)}>
                          <CalendarClock className="h-3.5 w-3.5" /> {t("consegne.btnRipianifica")}
                        </Button>}
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {(c.bollaStato === 'confermato' || c.bollaStato === 'consegnato') && canComplete ? (
                          <Button size="sm" className="gap-1 min-h-11 bg-green-600 hover:bg-green-700" onClick={() => setCompletingId(c.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("bolle.segnaConsegnata")}
                          </Button>
                        ) : canManage ? (
                          <>
                            {c.bollaId == null ? (
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => setCreatingBollaFor(c)}>
                                <Plus className="h-3.5 w-3.5" /> {t("consegne.btnCreaBolla")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => setViewingBollaId(c.bollaId!)}>
                                <FileText className="h-3.5 w-3.5" /> {t("consegne.btnCompilaBolla")}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => { setAssociatingId(c.id); setSelectedBollaId(c.bollaId ? String(c.bollaId) : ""); }}>
                              <Link2 className="h-3.5 w-3.5" /> {t("consegne.btnAssociaBolla")}
                            </Button>
                          </>
                        ) : null}
                        {canManage && <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="gap-1" disabled={inviaEmailBeneficiario.isPending || inviaEmailVolontario.isPending}>
                              <Mail className="h-3.5 w-3.5" /> {t("consegne.btnReminder")} <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleInviaEmail(c.id, "beneficiario")}>
                              <Mail className="h-3.5 w-3.5 mr-2" /> {t("consegne.reminderBeneficiario")}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={c.volontarioId == null} onClick={() => handleInviaEmail(c.id, "volontario")}>
                              <Truck className="h-3.5 w-3.5 mr-2" /> {t("consegne.reminderVolontario")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>}
                        {canCancel && <Button size="sm" variant="ghost" className="gap-1 min-h-11 text-destructive hover:text-destructive" onClick={() => setAnnullandoId(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" /> {t("consegne.btnAnnulla")}
                        </Button>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isLoading && consegnePage && consegnePage.totalPages > 1 && (
            <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {consegnePage.total} consegne · pagina {consegnePage.page} di {consegnePage.totalPages}
              </p>
              <div className="flex gap-2">
                <Button className="min-h-11" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  Precedente
                </Button>
                <Button className="min-h-11" variant="outline" disabled={page >= consegnePage.totalPages} onClick={() => setPage((value) => value + 1)}>
                  Successiva
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-sm">
          <SheetHeader><SheetTitle>Filtri consegne</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="consegne-mobile-search">Ricerca</Label>
              <Input id="consegne-mobile-search" className="min-h-11" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Codice, beneficiario o indirizzo" />
            </div>
            {isGlobal && isAreaOperativaGlobal && (
              <div className="space-y-2">
                <Label>{t("consegne.filterAreaOperativa")}</Label>
                <Select value={areaOperativaFilter} onValueChange={handleAreaOperativaFilterChange}>
                  <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("consegne.filterAllAreaOperativa")}</SelectItem>
                    {areaOperativaList?.map((area) => <SelectItem key={area.id} value={String(area.id)}>{area.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isGlobal && (
              <div className="space-y-2">
                <Label>{t("common.centro")}</Label>
                <Select value={centroFilter} onValueChange={(value) => { setCentroFilter(value); setPage(1); }} disabled={areaOperativaNotChosen}>
                  <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("consegne.filterAllCenters")}</SelectItem>
                    {centriFiltrati.map((centro) => <SelectItem key={centro.id} value={String(centro.id)}>{centro.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("common.status")}</Label>
              <Select value={statoFilter} onValueChange={(value) => { setStatoFilter(value); setPage(1); }}>
                <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("consegne.filterAllStatuses")}</SelectItem>
                  <SelectItem value="pianificata">{t("consegne.statoPianificata")}</SelectItem>
                  <SelectItem value="effettuata">{t("consegne.statoEffettuata")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label htmlFor="consegne-mobile-from">{t("consegne.filterDateFrom")}</Label><Input id="consegne-mobile-from" type="date" className="min-h-11" value={dataInizio} onChange={(event) => { setDataInizio(event.target.value); setPage(1); }} /></div>
              <div className="space-y-2"><Label htmlFor="consegne-mobile-to">{t("consegne.filterDateTo")}</Label><Input id="consegne-mobile-to" type="date" className="min-h-11" value={dataFine} onChange={(event) => { setDataFine(event.target.value); setPage(1); }} /></div>
            </div>
            <Button className="min-h-11 w-full" onClick={() => setFiltersOpen(false)}>Mostra risultati</Button>
          </div>
        </SheetContent>
      </Sheet>

      <CreaiBollaDialog
        open={creatingBollaFor !== null}
        onClose={() => setCreatingBollaFor(null)}
        consegnaId={creatingBollaFor?.id}
        lockedBeneficiario={creatingBollaFor ? { id: creatingBollaFor.beneficiarioId, nome: creatingBollaFor.beneficiarioNome ?? "" } : null}
        onCreated={(bollaId) => {
          queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
          if (bollaId != null) setViewingBollaId(bollaId);
        }}
      />

      <Sheet open={viewingBollaId !== null} onOpenChange={(open) => { if (!open) closeViewingBolla(); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>{t("consegne.bollaConsegnaTitle")}</SheetTitle></SheetHeader>
          {viewingBollaId !== null && (
            <BollaDettaglio
              bollaId={viewingBollaId}
              hideConsegnaActions
              onClose={closeViewingBolla}
              onCloseLabel={t("consegne.btnTornaPianificazione")}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={isFormOpen} onOpenChange={(open) => { if (open) setIsFormOpen(true); else closePlanningForm(); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{t("consegne.planDelivery")}</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {isGlobal && isAreaOperativaGlobal && (
                  <div className="space-y-2">
                    <Label>{t("consegne.filterAreaOperativa")}</Label>
                    <Select value={areaOperativaFilter} onValueChange={handleAreaOperativaFilterChange}>
                      <SelectTrigger aria-label={t("consegne.filterAreaOperativa")}><SelectValue placeholder={t("consegne.filterAreaOperativa")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("consegne.filterAllAreaOperativa")}</SelectItem>
                        {areaOperativaList?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{t("consegne.centroFilterLabel")}</Label>
                  <Select value={createCentroId} onValueChange={(v) => { setCreateCentroId(v); form.setValue("beneficiarioId", 0); }} disabled={isCentroLocked || areaOperativaNotChosen}>
                    <SelectTrigger aria-label={t("consegne.centroFilterLabel")}><SelectValue placeholder={areaOperativaNotChosen ? t("consegne.selectAreaOperativaFirst") : undefined} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("consegne.allBeneficiari")}</SelectItem>
                      {centriFiltrati.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("consegne.scanLabel")}</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("consegne.scanPlaceholder")}
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
                    <BarcodeScannerButton onScan={(value) => handleScan(value)} />
                  </div>
                </div>

                <FormField control={form.control} name="beneficiarioId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consegne.beneficiario")}</FormLabel>
                    <BeneficiarioCombobox
                      items={(beneficiari ?? []).map(b => ({ id: b.id, nome: b.nome, cognome: b.cognome, codice: b.codice }))}
                      value={field.value ? String(field.value) : ""}
                      onChange={(id) => {
                        field.onChange(Number(id));
                        if (form.getValues("tipoConsegna") === "domicilio") {
                          form.setValue("indirizzoConsegna", "", { shouldValidate: true });
                        }
                      }}
                      placeholder={t("consegne.selectPlaceholder")}
                      ariaLabel={t("consegne.beneficiario")}
                      emptyText={t("consegne.noBeneficiarioForCentro")}
                      selectedLabelFallback={(() => {
                        const sel = allBeneficiari?.find(b => b.id === field.value);
                        return sel ? `${sel.cognome} ${sel.nome}` : null;
                      })()}
                    />
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataPrevista" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.date")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="fasciaOraria" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("consegne.formFascia")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger aria-label={t("consegne.formFascia")}><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Mattina">{t("consegne.fasciaMattina")}</SelectItem>
                          <SelectItem value="Pomeriggio">{t("consegne.fasciaPomeriggio")}</SelectItem>
                          <SelectItem value="Sera">{t("consegne.fasciaSera")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="tipoConsegna" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consegne.formModalita")}</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        if (v === "domicilio") {
                          form.setValue(
                            "indirizzoConsegna",
                            beneficiarioDettaglio?.id === selectedBeneficiarioId
                              ? beneficiarioDettaglio.domicilio?.trim() ?? ""
                              : "",
                            { shouldValidate: true },
                          );
                        }
                        if (v !== "domicilio") {
                          form.setValue("volontarioId", 0);
                          form.setValue("volontarioAltro", undefined);
                          form.setValue("mezzoId", 0);
                          form.setValue("mezzoAltro", false);
                        }
                      }}
                      defaultValue={field.value}
                    >
                      <FormControl><SelectTrigger aria-label={t("consegne.formModalita")}><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="in_sede">{t("consegne.modInSede")}</SelectItem>
                        <SelectItem value="domicilio">{t("consegne.modDomicilio")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                {form.watch("tipoConsegna") === "domicilio" && (
                  <div className="space-y-4 pt-2 border-t">
                    <FormField control={form.control} name="indirizzoConsegna" render={({ field }) => (
                      <FormItem><FormLabel>{t("consegne.formIndirizzo")}</FormLabel><FormControl><Input maxLength={200} {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="zona" render={({ field }) => (
                      <FormItem><FormLabel>{t("consegne.formZona")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="volontarioId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("consegne.formVolontario")}</FormLabel>
                        <Select
                          value={form.watch("volontarioAltro") !== undefined ? "altro" : (field.value ? String(field.value) : "0")}
                          onValueChange={(v) => {
                            form.setValue("mezzoId", 0);
                            form.setValue("mezzoAltro", false);
                            if (v === "altro") {
                              field.onChange(0);
                              form.setValue("volontarioAltro", "");
                              return;
                            }
                            form.setValue("volontarioAltro", undefined);
                            form.clearErrors("volontarioAltro");
                            field.onChange(Number(v));
                          }}
                        >
                          <FormControl><SelectTrigger aria-label={t("consegne.formVolontario")}><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="0">{t("common.none")}</SelectItem>
                            <SelectItem value="altro">{t("consegne.volontarioAltro", { defaultValue: "Altro" })}</SelectItem>
                            {volontariConsegna.map(v => {
                              const overLimit = v.maxConsegneTurno > 0 && (caricoMap.get(v.id) ?? 0) >= v.maxConsegneTurno;
                              return (
                                <SelectItem key={v.id} value={String(v.id)} disabled={overLimit}>
                                  {volontarioLabel(v)}
                                  {overLimit ? ` — ${t("consegne.limiteRaggiunto")}` : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <div className="flex flex-wrap gap-2">
                      {canCreateVolontario && <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setVolontarioDialogOpen(true)}
                        disabled={effectiveConsegnaCentroId == null}
                      >
                        <Plus className="me-1 h-4 w-4" /> {t("turni.addVolontarioNonCensito", { defaultValue: "Nuovo Volontario" })}
                      </Button>}
                      {canCreateMezzo && <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMezzoDialogOpen(true)}
                        disabled={effectiveConsegnaCentroId == null}
                      >
                        <Plus className="me-1 h-4 w-4" /> {t("turni.addMezzoNonCensito", { defaultValue: "Nuovo Mezzo" })}
                      </Button>}
                    </div>
                    {pendingVolontari.length > 0 && (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                        {pendingVolontari.map(volontarioLabel).join(", ")} · {t("turni.pendingNotSelectable", { defaultValue: "In attesa di approvazione, non selezionabile" })}
                      </p>
                    )}
                    {pendingMezzi.length > 0 && (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                        {pendingMezzi.map((mezzo) => mezzo.codice).join(", ")} · {t("turni.pendingNotSelectable", { defaultValue: "In attesa di approvazione, non selezionabile" })}
                      </p>
                    )}
                    {form.watch("volontarioAltro") !== undefined && (
                      <FormField control={form.control} name="volontarioAltro" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("consegne.volontarioAltroNote", { defaultValue: "Nominativo e nota" })}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ""}
                              placeholder={t("consegne.volontarioAltroPlaceholder", { defaultValue: "Es. familiare delegato, vicino di casa..." })}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    {(() => {
                      if (form.watch("volontarioAltro") !== undefined) return null;
                      const mezzoVal = form.watch("mezzoAltro") ? "altro" : (form.watch("mezzoId") ? String(form.watch("mezzoId")) : "0");
                      const selVol = volontariConsegna.find(v => v.id === Number(form.watch("volontarioId")));
                      const hasMezzoSelected = mezzoVal !== "0";
                      if (!selVol?.patente && !hasMezzoSelected) return null;
                      return (
                        <div className="space-y-2">
                          <Label>{t("consegne.formMezzo")}</Label>
                          <Select value={mezzoVal} onValueChange={(v) => {
                            if (v === "altro") { form.setValue("mezzoId", 0); form.setValue("mezzoAltro", true); }
                            else { form.setValue("mezzoId", Number(v)); form.setValue("mezzoAltro", false); }
                          }}>
                            <SelectTrigger><SelectValue placeholder={t("consegne.mezzoPlaceholder")} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">{t("common.none")}</SelectItem>
                              {mezziConsegna.map(m => (
                                <SelectItem key={m.id} value={String(m.id)}>
                                  {m.codice}{m.targa ? ` (${m.targa})` : ""} — {m.tipo}
                                </SelectItem>
                              ))}
                              <SelectItem value="altro">{t("consegne.mezzoAltro")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="pt-2 border-t">
                  <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("consegne.formMagazzino")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger aria-label={t("consegne.formMagazzino")}><SelectValue placeholder={t("consegne.selectPlaceholder")} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closePlanningForm}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createConsegna.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog guard={unsavedGuard} />

      <Dialog open={volontarioDialogOpen} onOpenChange={(open) => {
        setVolontarioDialogOpen(open);
        setVolontarioError(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("turni.pendingVolTitle", { defaultValue: "Nuovo Volontario" })}</DialogTitle>
            <DialogDescription>
              {t("turni.pendingVolDesc", { defaultValue: "Il volontario sarà inserito in attesa di approvazione Logistica." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("common.name")}</Label>
                <Input value={nuovoVolontario.nome} onChange={(e) => setNuovoVolontario((v) => ({ ...v, nome: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t("common.surname", { defaultValue: "Cognome" })}</Label>
                <Input value={nuovoVolontario.cognome} onChange={(e) => setNuovoVolontario((v) => ({ ...v, cognome: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("volontari.matricola", { defaultValue: "Matricola" })}</Label>
                <Input
                  value={nuovoVolontario.matricola}
                  onChange={(e) => {
                    setVolontarioError(null);
                    setNuovoVolontario((v) => ({ ...v, matricola: e.target.value }));
                  }}
                />
                {volontarioError ? <p className="text-sm text-destructive">{volontarioError}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>{t("common.phone", { defaultValue: "Telefono" })}</Label>
                <Input value={nuovoVolontario.telefono} onChange={(e) => setNuovoVolontario((v) => ({ ...v, telefono: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label htmlFor="consegne-patente-b">{t("volontari.patenteB", { defaultValue: "Patente B" })}</Label>
              <Switch
                id="consegne-patente-b"
                checked={nuovoVolontario.patente}
                onCheckedChange={(checked) => setNuovoVolontario((v) => ({ ...v, patente: checked }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("volontari.ruoloPrincipale", { defaultValue: "Ruolo principale" })}</Label>
              <Select
                value={nuovoVolontario.ruoloVolontarioId != null ? String(nuovoVolontario.ruoloVolontarioId) : ""}
                onValueChange={(value) => setNuovoVolontario((v) => ({ ...v, ruoloVolontarioId: Number(value) }))}
              >
                <SelectTrigger><SelectValue placeholder={t("volontari.valRuolo")} /></SelectTrigger>
                <SelectContent>
                  {(ruoliVolontari ?? []).filter((ruolo) => ruolo.attivo).map((ruolo) => (
                    <SelectItem key={ruolo.id} value={String(ruolo.id)}>{ruolo.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("common.notes")}</Label>
              <Input value={nuovoVolontario.note} onChange={(e) => setNuovoVolontario((v) => ({ ...v, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVolontarioDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={creaVolontarioPending}
              disabled={
                createPendingVolontario.isPending ||
                effectiveConsegnaCentroId == null ||
                !nuovoVolontario.nome.trim() ||
                !nuovoVolontario.cognome.trim() ||
                !nuovoVolontario.matricola.trim() ||
                nuovoVolontario.ruoloVolontarioId == null
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mezzoDialogOpen} onOpenChange={setMezzoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("turni.pendingMezzoTitle", { defaultValue: "Nuovo Mezzo" })}</DialogTitle>
            <DialogDescription>
              {t("turni.pendingMezzoDesc", { defaultValue: "Il mezzo sarà inserito in attesa di approvazione Logistica." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("mezzi.tipo", { defaultValue: "Tipo" })}</Label>
                <Input value={nuovoMezzo.tipo} onChange={(e) => setNuovoMezzo((m) => ({ ...m, tipo: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t("mezzi.targa", { defaultValue: "Targa" })}</Label>
                <Input value={nuovoMezzo.targa} onChange={(e) => setNuovoMezzo((m) => ({ ...m, targa: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("mezzi.proprieta", { defaultValue: "Proprietà" })}</Label>
              <Select value={nuovoMezzo.proprieta} onValueChange={(v) => setNuovoMezzo((m) => ({ ...m, proprieta: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="associazione">{t("mezzi.proprietaOpts.associazione", { defaultValue: "Associazione" })}</SelectItem>
                  <SelectItem value="centro">{t("mezzi.proprietaOpts.centro", { defaultValue: "Centro" })}</SelectItem>
                  <SelectItem value="volontario">{t("mezzi.proprietaOpts.volontario", { defaultValue: "Volontario" })}</SelectItem>
                  <SelectItem value="noleggio">{t("mezzi.proprietaOpts.noleggio", { defaultValue: "Noleggio" })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("mezzi.descrizione", { defaultValue: "Descrizione" })}</Label>
              <Input value={nuovoMezzo.descrizione} onChange={(e) => setNuovoMezzo((m) => ({ ...m, descrizione: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t("common.notes")}</Label>
              <Input value={nuovoMezzo.note} onChange={(e) => setNuovoMezzo((m) => ({ ...m, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMezzoDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={creaMezzoPending}
              disabled={createPendingMezzo.isPending || effectiveConsegnaCentroId == null || !nuovoMezzo.tipo.trim()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!completingId} onOpenChange={(open) => !open && setCompletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("consegne.dialogCompletaTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("consegne.dialogCompletaDesc")}
          </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCompleta} className="bg-green-600 hover:bg-green-700">{t("consegne.dialogCompletaConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={annullandoId != null} onOpenChange={(open) => !open && setAnnullandoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consegne.annullaTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("consegne.annullaDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleAnnulla} disabled={deleteConsegna.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("consegne.annullaConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={ripianificando != null} onOpenChange={(open) => !open && setRipianificando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consegne.ripianificaTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("consegne.ripianificaDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          {ripianificando && (
            <div className="py-2 space-y-4">
              <p className="text-sm font-medium">{ripianificando.beneficiarioNome}</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("common.date")}</Label>
                  <Input type="date" value={riDate} onChange={(e) => setRiDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("consegne.formFascia")}</Label>
                  <Select value={riFascia} onValueChange={setRiFascia}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Mattina">{t("consegne.fasciaMattina")}</SelectItem>
                      <SelectItem value="Pomeriggio">{t("consegne.fasciaPomeriggio")}</SelectItem>
                      <SelectItem value="Sera">{t("consegne.fasciaSera")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button disabled={!riDate || createConsegna.isPending} onClick={handleRipianifica}>
              {t("consegne.btnRipianifica")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!associatingId} onOpenChange={(open) => { if (!open) { setAssociatingId(null); setSelectedBollaId(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consegne.dialogAssociaTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consegne.dialogAssociaDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-3">
            {bolleDisponibili.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("consegne.noBollaAvailable")} <span className="font-medium">{t("consegne.bolleSection")}</span>.
              </p>
            ) : (
              <Select value={selectedBollaId} onValueChange={setSelectedBollaId}>
                <SelectTrigger><SelectValue placeholder={t("consegne.selectBollaPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {bolleDisponibili.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.numeroBolla} · {b.stato === 'confermato' ? t("consegne.optPronta") : b.stato === 'consegnato' ? t("consegne.optConsegnata") : t("consegne.optInPreparazione")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            {associatingConsegna?.bollaId != null && (
              <Button variant="outline" className="mr-auto text-destructive" disabled={associaBolla.isPending} onClick={() => handleAssocia(null)}>
                {t("consegne.btnScollega")}
              </Button>
            )}
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              disabled={!selectedBollaId || associaBolla.isPending}
              onClick={() => handleAssocia(selectedBollaId ? parseInt(selectedBollaId) : null)}
            >
              {t("consegne.btnAssocia")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
