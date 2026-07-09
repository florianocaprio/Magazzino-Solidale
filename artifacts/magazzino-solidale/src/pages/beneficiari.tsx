import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useListBeneficiari, useCreateBeneficiario, useDeleteBeneficiario, useUpdateBeneficiario, useBulkBeneficiari, useListCentriAscolto, useListMagazzini, useGetBeneficiario, useCercaBeneficiariSimili, useListCitta, useListZoneUds, getListBeneficiariQueryKey, getGetBeneficiarioQueryKey, getCercaBeneficiariSimiliQueryKey, getListCittaQueryKey } from "@workspace/api-client-react";
import { BulkImportDialog, matchByName, parseBoolCell, type MapRowResult } from "@/components/bulk-import-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Search, User, Trash2, MapPin, AlertCircle, Home, Pencil, CreditCard, FileDown, AlertTriangle, Upload } from "lucide-react";
import { SchedaExportDialog } from "@/components/scheda-export";
import { EditBeneficiarioSheet } from "@/pages/beneficiario-dettaglio";
import { generateTesseraPdf, buildTesseraLabels } from "@/lib/tessera-pdf";
import { loadTesseraBrandingForPdf } from "@/lib/branding-ambiente";
import { EMPORIO_DISABLED_MESSAGE, UNITA_STRADA_DISABLED_MESSAGE, useModuloFlags } from "@/lib/use-moduli";
import { SESSO_OPTIONS } from "@/lib/sesso-options";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const makeFormSchema = (t: (k: string) => string) => z.object({
  cognome: z.string().min(2),
  nome: z.string().min(2),
  soprannome: z.string().optional(),
  codiceFiscale: z.string().optional(),
  dataNascita: z.string().optional(),
  sesso: z.string().min(1, t("beneficiari.sessoRequired")),
  cittadinanza: z.string().optional(),
  areaProvenienza: z.string().min(1, t("common.requiredField")),
  residenza: z.string().optional(),
  domicilio: z.string().optional(),
  comune: z.string().optional(),
  zonaMunicipio: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  numComponenti: z.coerce.number().min(1).default(1),
  priorita: z.string().default("media"),
  centroAscoltoId: z.string().optional(),
  creditoSolidaleAbilitato: z.boolean().default(false),
  creditoSolidaleStato: z.enum(STATI_CREDITO_SOLIDALE).default("non_abilitato"),
  creditoSolidaleNote: z.string().optional(),
  magazzinoEmporioPreferitoId: z.string().optional(),
  consegnaDomicilio: z.boolean().default(false),
  motivoConsegnaDomicilio: z.string().optional(),
  restrizioniAlimentari: z.string().optional(),
  uds: z.boolean().default(false),
  cittaId: z.string().optional(),
  zonaUdsId: z.string().optional(),
});
type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

const CENTRO_ALL = "__all__";
const PRIORITA_ALL = "__all__";
const CITTA_ALL = "__all__";
const NO_ZONE = "__none__";
const NO_EMPORIO = "__none__";
const STATI_CREDITO_SOLIDALE = ["non_abilitato", "attivo", "sospeso", "revocato"] as const;
type CreditoSolidaleStato = (typeof STATI_CREDITO_SOLIDALE)[number];

const creditoSolidaleBadgeClasses: Record<CreditoSolidaleStato, string> = {
  non_abilitato: "bg-muted text-muted-foreground",
  attivo: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  sospeso: "bg-amber-500/10 text-amber-700 border-amber-200",
  revocato: "bg-red-500/10 text-red-700 border-red-200",
};

function creditoSolidaleLabelKey(stato?: string | null): string {
  switch (stato) {
    case "attivo": return "beneficiari.creditoSolidaleStatoAttivo";
    case "sospeso": return "beneficiari.creditoSolidaleStatoSospeso";
    case "revocato": return "beneficiari.creditoSolidaleStatoRevocato";
    default: return "beneficiari.creditoSolidaleStatoNonAbilitato";
  }
}

const apiErrorMessage = (err: unknown, fallback: string): string => {
  const data = (err as { data?: unknown })?.data ?? (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
};

export default function Beneficiari() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState<string>(CENTRO_ALL);
  const [prioritaFilter, setPrioritaFilter] = useState<string>(PRIORITA_ALL);
  const [cittaFilter, setCittaFilter] = useState<string>(CITTA_ALL);
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroFilter(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  const isCittaGlobal = user?.cittaId == null;
  const { data: beneficiari, isLoading } = useListBeneficiari({
    search: search || undefined,
    centroAscoltoId: centroFilter !== CENTRO_ALL ? parseInt(centroFilter) : undefined,
    priorita: prioritaFilter !== PRIORITA_ALL ? prioritaFilter : undefined,
    cittaId: isCittaGlobal && cittaFilter !== CITTA_ALL ? parseInt(cittaFilter) : undefined,
  });
  const { data: centri } = useListCentriAscolto();
  const { data: magazzini } = useListMagazzini();
  const emporiDisponibili = useMemo(
    () => (magazzini ?? []).filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );
  const { data: cittaList } = useListCitta({ query: { queryKey: getListCittaQueryKey(), enabled: isCittaGlobal } });
  const { emporioAbilitato, unitaStradaAbilitata } = useModuloFlags();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [schedaId, setSchedaId] = useState<number | null>(null);

  const createBeneficiario = useCreateBeneficiario();
  const deleteBeneficiario = useDeleteBeneficiario();
  const updateBeneficiario = useUpdateBeneficiario();
  const bulkBeneficiari = useBulkBeneficiari();
  const [isImportOpen, setIsImportOpen] = useState(false);

  const toggleStatus = (b: { id: number; attivo: boolean }) => {
    updateBeneficiario.mutate({ id: b.id, data: { attivo: !b.attivo } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(b.id) });
        toast({ title: b.attivo ? t("beneficiari.toastDisattivato") : t("beneficiari.toastAttivato") });
      },
    });
  };

  const formSchema = useMemo(() => makeFormSchema(t), [t]);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cognome: "", nome: "", soprannome: "", codiceFiscale: "", dataNascita: "", sesso: "",
      cittadinanza: "", areaProvenienza: "", residenza: "", domicilio: "", comune: "", zonaMunicipio: "",
      telefono: "", email: "", numComponenti: 1, priorita: "media", centroAscoltoId: "",
      creditoSolidaleAbilitato: false, creditoSolidaleStato: "non_abilitato", creditoSolidaleNote: "",
      magazzinoEmporioPreferitoId: NO_EMPORIO,
      consegnaDomicilio: false, motivoConsegnaDomicilio: "", restrizioniAlimentari: "",
      uds: false, cittaId: "", zonaUdsId: ""
    }
  });
  const creditoSolidaleAbilitato = form.watch("creditoSolidaleAbilitato");

  const watchUds = form.watch("uds");
  const formCitta = isCittaGlobal
    ? (form.watch("cittaId") ? parseInt(form.watch("cittaId")!) : undefined)
    : (user?.cittaId ?? undefined);
  const { data: udsZone } = useListZoneUds(
    formCitta ? { cittaId: formCitta } : undefined,
    { query: { queryKey: ["zoneUds", "benefForm", formCitta], enabled: watchUds && formCitta != null } },
  );

  // Anti-duplicate fuzzy suggestions (città-scoped) while the create form is open.
  const [dupDismissed, setDupDismissed] = useState(false);
  const [dupParams, setDupParams] = useState<{ nome?: string; cognome?: string }>({});
  const wNome = form.watch("nome");
  const wCognome = form.watch("cognome");
  useEffect(() => {
    if (!isFormOpen) return;
    const handle = setTimeout(() => {
      setDupParams({ nome: (wNome ?? "").trim(), cognome: (wCognome ?? "").trim() });
    }, 300);
    return () => clearTimeout(handle);
  }, [isFormOpen, wNome, wCognome]);
  const dupHasInput = (dupParams.nome ?? "").length + (dupParams.cognome ?? "").length >= 3;
  const { data: dupMatches } = useCercaBeneficiariSimili(dupParams, {
    query: {
      queryKey: getCercaBeneficiariSimiliQueryKey(dupParams),
      enabled: isFormOpen && !dupDismissed && dupHasInput,
    },
  });
  const suggestions = dupMatches ?? [];

  const resetDup = () => { setDupDismissed(false); setDupParams({}); };

  const onSubmit = (data: FormValues) => {
    const {
      centroAscoltoId,
      codiceFiscale,
      cittaId,
      zonaUdsId,
      uds,
      magazzinoEmporioPreferitoId,
      creditoSolidaleNote,
      ...rest
    } = data;
    // A città-global admin must pin a città when flagging a person as UDS,
    // mirroring the server-side hard-boundary guard.
    if (uds && isCittaGlobal && !cittaId) {
      form.setError("cittaId", { type: "manual", message: t("common.requiredField") });
      return;
    }
    const centroId = centroAscoltoId ? parseInt(centroAscoltoId) : (isCentroLocked && lockedCentroId != null ? lockedCentroId : null);
    if (rest.creditoSolidaleAbilitato && centroId == null) {
      form.setError("centroAscoltoId", { type: "manual", message: t("beneficiari.creditoSolidaleCentroAscoltoRichiesto") });
      toast({
        title: t("beneficiari.creditoSolidaleSection"),
        description: t("beneficiari.creditoSolidaleCentroAscoltoRichiesto"),
        variant: "destructive",
      });
      return;
    }
    const payload: Record<string, unknown> = {
      ...rest,
      uds,
      dataNascita: rest.dataNascita || undefined,
      sesso: rest.sesso,
      centroAscoltoId: centroId,
      codiceFiscale: codiceFiscale?.trim() ? codiceFiscale.trim().toUpperCase() : null,
      creditoSolidaleAbilitato: rest.creditoSolidaleAbilitato,
      creditoSolidaleStato: rest.creditoSolidaleAbilitato ? rest.creditoSolidaleStato : "non_abilitato",
      creditoSolidaleNote: creditoSolidaleNote?.trim() ? creditoSolidaleNote.trim() : null,
      magazzinoEmporioPreferitoId:
        magazzinoEmporioPreferitoId && magazzinoEmporioPreferitoId !== NO_EMPORIO
          ? parseInt(magazzinoEmporioPreferitoId)
          : null,
    };
    if (uds) {
      if (isCittaGlobal && cittaId) payload.cittaId = parseInt(cittaId);
      if (zonaUdsId && zonaUdsId !== NO_ZONE) payload.zonaUdsId = parseInt(zonaUdsId);
    }
    createBeneficiario.mutate({ data: payload as never }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        toast({ title: t("beneficiari.toastAdded") });
        setIsFormOpen(false);
        resetDup();
        form.reset();
      },
      onError: (err) => toast({
        title: t("beneficiari.creditoSolidaleSection"),
        description: apiErrorMessage(err, t("beneficiari.creditoSolidaleCentroAscoltoRichiesto")),
        variant: "destructive",
      }),
    });
  };

  const getPriorityBadge = (priorita: string) => {
    switch(priorita) {
      case 'bassa': return <Badge variant="outline" className="bg-gray-100 text-gray-700">{t("beneficiari.prioBassa")}</Badge>;
      case 'media': return <Badge variant="outline" className="bg-blue-100 text-blue-700">{t("beneficiari.prioMedia")}</Badge>;
      case 'alta': return <Badge variant="outline" className="bg-amber-100 text-amber-700">{t("beneficiari.prioAlta")}</Badge>;
      case 'urgente': return <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200 shadow-sm"><AlertCircle className="w-3 h-3 mr-1"/>{t("beneficiari.prioUrgente")}</Badge>;
      default: return <Badge>{priorita}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("beneficiari.title")}</h1>
          <p className="text-muted-foreground">{t("beneficiari.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={beneficiari ?? []}
            columns={[
              { header: t("common.code"), accessor: (b) => b.codice },
              { header: t("common.surname"), accessor: (b) => b.cognome },
              { header: t("common.name"), accessor: (b) => b.nome },
              { header: t("common.email"), accessor: (b) => b.email },
              { header: t("common.phone"), accessor: (b) => b.telefono },
              { header: t("beneficiari.comune"), accessor: (b) => b.comune },
              { header: t("beneficiari.zonaMunicipio"), accessor: (b) => b.zonaMunicipio },
              { header: t("beneficiari.centroAscolto"), accessor: (b) => b.centroAscoltoNome },
              { header: t("beneficiari.creditoSolidaleStato"), accessor: (b) => t(creditoSolidaleLabelKey(b.creditoSolidaleStato)) },
              { header: t("beneficiari.magazzinoEmporioPreferito"), accessor: (b) => b.magazzinoEmporioPreferitoNome },
            ]}
            filename="beneficiari"
            title={t("beneficiari.exportTitle")}
            orientation="landscape"
          />
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> {t("bulkImport.button")}
          </Button>
          <Button onClick={() => { form.setValue("centroAscoltoId", isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : ""); setDupDismissed(false); setDupParams({}); setIsFormOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> {t("beneficiari.newBeneficiario")}</Button>
        </div>
      </div>

      <BulkImportDialog
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        entityLabel={t("beneficiari.title")}
        templateFilename="modello_beneficiari"
        columns={[
          { key: "cognome", header: t("common.surname"), example: "Rossi" },
          { key: "nome", header: t("common.name"), example: "Maria" },
          { key: "codice", header: t("common.code"), example: "" },
          { key: "codiceFiscale", header: "Codice Fiscale", example: "" },
          { key: "dataNascita", header: t("beneficiarioDettaglio.dataNascita"), example: "1985-04-12" },
          { key: "sesso", header: t("beneficiarioDettaglio.sesso"), example: "ALTRO" },
          { key: "cittadinanza", header: t("beneficiarioDettaglio.cittadinanza"), example: "" },
          { key: "telefono", header: t("common.phone"), example: "3331234567" },
          { key: "email", header: t("common.email"), example: "" },
          { key: "comune", header: t("beneficiari.comune"), example: "Milano" },
          { key: "numComponenti", header: t("beneficiari.numComponenti"), example: 1 },
          { key: "priorita", header: t("beneficiari.colPriorita"), example: "media" },
          { key: "areaProvenienza", header: t("beneficiarioDettaglio.areaProvenienza"), example: "UE" },
          { key: "centro", header: t("beneficiari.centroAscolto"), example: "" },
          { key: "creditoSolidaleAbilitato", header: t("beneficiari.creditoSolidaleAbilitato"), example: "No" },
          { key: "creditoSolidaleStato", header: t("beneficiari.creditoSolidaleStato"), example: "non_abilitato" },
          { key: "magazzinoEmporioPreferito", header: t("beneficiari.magazzinoEmporioPreferito"), example: "" },
          { key: "creditoSolidaleNote", header: t("beneficiari.creditoSolidaleNote"), example: "" },
          ...(isCittaGlobal ? [{ key: "citta", header: t("nav.citta"), example: "" }] : []),
        ]}
        mapRow={(r): MapRowResult<Record<string, unknown>> => {
          if (!r.cognome) return { error: t("bulkImport.requiredMissing", { field: t("common.surname") }) };
          if (!r.nome) return { error: t("bulkImport.requiredMissing", { field: t("common.name") }) };
          if (!r.sesso) return { error: t("beneficiari.sessoRequired") };
          let centroAscoltoId: number | null = null;
          if (r.centro) {
            const c = matchByName(centri, r.centro, (x) => x.nome);
            if (!c) return { error: t("bulkImport.unknownRef", { field: t("beneficiari.centroAscolto"), value: r.centro }) };
            centroAscoltoId = c.id;
          }
          let cittaId: number | undefined;
          if (isCittaGlobal && r.citta) {
            const ci = matchByName(cittaList, r.citta, (x) => x.nome);
            if (!ci) return { error: t("bulkImport.unknownRef", { field: t("nav.citta"), value: r.citta }) };
            cittaId = ci.id;
          }
          let magazzinoEmporioPreferitoId: number | null = null;
          if (r.magazzinoEmporioPreferito) {
            const emporio = matchByName(emporiDisponibili, r.magazzinoEmporioPreferito, (x) => x.nome);
            if (!emporio) {
              return { error: t("bulkImport.unknownRef", { field: t("beneficiari.magazzinoEmporioPreferito"), value: r.magazzinoEmporioPreferito }) };
            }
            magazzinoEmporioPreferitoId = emporio.id;
          }
          const creditoSolidaleAbilitato = parseBoolCell(r.creditoSolidaleAbilitato);
          const creditoSolidaleStato = r.creditoSolidaleStato?.trim() || (creditoSolidaleAbilitato ? "attivo" : "non_abilitato");
          if (!STATI_CREDITO_SOLIDALE.includes(creditoSolidaleStato as CreditoSolidaleStato)) {
            return { error: t("bulkImport.unknownRef", { field: t("beneficiari.creditoSolidaleStato"), value: creditoSolidaleStato }) };
          }
          let numComponenti: number | undefined;
          if (r.numComponenti) {
            const n = Number(r.numComponenti);
            if (Number.isNaN(n)) return { error: t("bulkImport.invalidNumber", { field: t("beneficiari.numComponenti") }) };
            numComponenti = n;
          }
          return {
            data: {
              cognome: r.cognome,
              nome: r.nome,
              codice: r.codice || undefined,
              codiceFiscale: r.codiceFiscale ? r.codiceFiscale.trim().toUpperCase() : undefined,
              dataNascita: r.dataNascita || undefined,
              sesso: r.sesso.trim().toUpperCase(),
              cittadinanza: r.cittadinanza || undefined,
              telefono: r.telefono || undefined,
              email: r.email || undefined,
              comune: r.comune || undefined,
              numComponenti,
              priorita: r.priorita || undefined,
              areaProvenienza: r.areaProvenienza || undefined,
              centroAscoltoId,
              cittaId,
              creditoSolidaleAbilitato,
              creditoSolidaleStato: creditoSolidaleAbilitato ? creditoSolidaleStato : "non_abilitato",
              creditoSolidaleNote: r.creditoSolidaleNote || undefined,
              magazzinoEmporioPreferitoId,
            },
          };
        }}
        onImport={async (righe) => bulkBeneficiari.mutateAsync({ data: { righe: righe as never } })}
        onDone={() => queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() })}
      />

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex w-full max-w-sm gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder={t("beneficiari.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <BarcodeScannerButton onScan={(v) => setSearch(v)} />
            </div>
            {isGlobal && (
              <Select value={centroFilter} onValueChange={setCentroFilter}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder={t("beneficiari.allCentri")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CENTRO_ALL}>{t("beneficiari.allCentri")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isCittaGlobal && (
              <Select value={cittaFilter} onValueChange={setCittaFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder={t("beneficiari.allCitta")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CITTA_ALL}>{t("beneficiari.allCitta")}</SelectItem>
                  {cittaList?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={prioritaFilter} onValueChange={setPrioritaFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t("beneficiari.allPriorita")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRIORITA_ALL}>{t("beneficiari.allPriorita")}</SelectItem>
                <SelectItem value="urgente">{t("beneficiari.prioUrgente")}</SelectItem>
                <SelectItem value="alta">{t("beneficiari.prioAlta")}</SelectItem>
                <SelectItem value="media">{t("beneficiari.prioMedia")}</SelectItem>
                <SelectItem value="bassa">{t("beneficiari.prioBassa")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("beneficiari.colNominativo")}</TableHead>
                <TableHead>{t("common.code")}</TableHead>
                <TableHead>{t("beneficiari.colZonaComune")}</TableHead>
                {isGlobal && <TableHead>{t("beneficiari.centroAscolto")}</TableHead>}
                <TableHead className="text-center">{t("beneficiari.colComponenti")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colPriorita")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.creditoSolidaleSection")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colDomicilio")}</TableHead>
                <TableHead className="text-center">{t("beneficiari.colStato")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {isGlobal && <TableCell><Skeleton className="h-5 w-28" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : beneficiari?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 10 : 9} className="h-32 text-center text-muted-foreground">{t("beneficiari.empty")}</TableCell>
                </TableRow>
              ) : beneficiari?.map((b) => (
                <TableRow key={b.id} className={!b.attivo ? "opacity-60" : ""}>
                  <TableCell>
                    <Link href={`/beneficiari/${b.id}`} className="font-medium hover:underline text-primary flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {b.cognome} {b.nome}
                    </Link>
                    {b.uds && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200">{t("beneficiari.udsLabel")}</Badge>
                        {b.cittaNome && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" />{b.cittaNome}</span>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{b.codice}</TableCell>
                  <TableCell className="text-sm">
                    {b.comune && <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground"/> {b.comune} {b.zonaMunicipio ? `(${b.zonaMunicipio})` : ''}</div>}
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">
                      {b.centroAscoltoNome ?? <span className="italic">{t("common.none")}</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-center font-medium">{b.numComponenti}</TableCell>
                  <TableCell className="text-center">{getPriorityBadge(b.priorita)}</TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={creditoSolidaleBadgeClasses[(b.creditoSolidaleStato ?? "non_abilitato") as CreditoSolidaleStato] ?? creditoSolidaleBadgeClasses.non_abilitato}
                    >
                      {t(creditoSolidaleLabelKey(b.creditoSolidaleStato))}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {b.consegnaDomicilio && <Home className="h-4 w-4 text-blue-500 mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={b.attivo}
                        onCheckedChange={() => toggleStatus(b)}
                        aria-label={b.attivo ? t("beneficiari.disattiva") : t("beneficiari.attiva")}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/beneficiari/${b.id}`} className="cursor-pointer w-full flex items-center">
                            {t("beneficiari.profileDetail")}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEditingId(b.id)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" /> {t("beneficiari.editAnagrafica")}</DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={async () => {
                            const { branding, logoDataUrl } = await loadTesseraBrandingForPdf();
                            await generateTesseraPdf({
                              beneficiario: { codice: b.codice, nome: b.nome, cognome: b.cognome, codiceFiscale: b.codiceFiscale },
                              labels: buildTesseraLabels(t),
                              associationLogoDataUrl: logoDataUrl,
                              branding,
                            });
                          }}
                        ><CreditCard className="mr-2 h-4 w-4" /> {t("beneficiari.stampaTessera")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSchedaId(b.id)} className="cursor-pointer"><FileDown className="mr-2 h-4 w-4" /> {t("scheda.esporta")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(b.id)}><Trash2 className="mr-2 h-4 w-4" /> {t("common.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={(open) => { setIsFormOpen(open); if (!open) { resetDup(); form.reset(); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{t("beneficiari.newBeneficiario")}</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.surname")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                {!dupDismissed && suggestions.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      {t("beneficiari.dupTitle")}
                    </div>
                    <p className="text-xs text-amber-700">{t("beneficiari.dupHint")}</p>
                    <div className="space-y-2">
                      {suggestions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {s.cognome} {s.nome}{s.soprannome ? ` (${s.soprannome})` : ""}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[s.dataNascita, s.telefono, s.centroAscoltoNome ?? s.zonaUdsNome].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </div>
                          <Button asChild type="button" size="sm" variant="outline">
                            <Link href={`/beneficiari/${s.id}`}>{t("beneficiari.dupOpen")}</Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="text-amber-800" onClick={() => setDupDismissed(true)}>
                      {t("beneficiari.dupContinueNew")}
                    </Button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codiceFiscale" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiarioDettaglio.codiceFiscale")}</FormLabel><FormControl><Input {...field} className="font-mono uppercase" maxLength={16} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="soprannome" render={({ field }) => (
                    <FormItem><FormLabel>{t("udsAnagrafica.fSoprannome")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataNascita" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiarioDettaglio.dataNascita")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="sesso" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiarioDettaglio.sesso")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {SESSO_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(`beneficiarioDettaglio.${option.beneficiarioLabelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="cittadinanza" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiarioDettaglio.cittadinanza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")} *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="UE">UE</SelectItem>
                          <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="residenza" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.residenza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="domicilio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.domicilio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.phone")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.zonaMunicipio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="numComponenti" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiari.numComponenti")}</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="priorita" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.prioritaAssistenziale")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="bassa">{t("beneficiari.prioBassa")}</SelectItem>
                          <SelectItem value="media">{t("beneficiari.prioMedia")}</SelectItem>
                          <SelectItem value="alta">{t("beneficiari.prioAlta")}</SelectItem>
                          <SelectItem value="urgente">{t("beneficiari.prioUrgente")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.centroRiferimento")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isCentroLocked}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="rounded-md border p-3 space-y-3">
                  <div>
                    <h4 className="text-sm font-medium">{t("beneficiari.creditoSolidaleSection")}</h4>
                    <p className="text-xs text-muted-foreground">{t("beneficiari.creditoSolidaleHelp")}</p>
                    {!emporioAbilitato && (
                      <p className="text-xs text-muted-foreground mt-1">{EMPORIO_DISABLED_MESSAGE}</p>
                    )}
                  </div>
                  <FormField control={form.control} name="creditoSolidaleAbilitato" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <FormLabel className="!mt-0">{t("beneficiari.creditoSolidaleAbilitato")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          disabled={!emporioAbilitato}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            form.setValue("creditoSolidaleStato", checked ? "attivo" : "non_abilitato");
                          }}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="creditoSolidaleStato" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.creditoSolidaleStato")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!emporioAbilitato || !creditoSolidaleAbilitato}
                      >
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="non_abilitato">{t("beneficiari.creditoSolidaleStatoNonAbilitato")}</SelectItem>
                          <SelectItem value="attivo">{t("beneficiari.creditoSolidaleStatoAttivo")}</SelectItem>
                          <SelectItem value="sospeso">{t("beneficiari.creditoSolidaleStatoSospeso")}</SelectItem>
                          <SelectItem value="revocato">{t("beneficiari.creditoSolidaleStatoRevocato")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="magazzinoEmporioPreferitoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.magazzinoEmporioPreferito")}</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || NO_EMPORIO}
                        disabled={!emporioAbilitato || !creditoSolidaleAbilitato}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value={NO_EMPORIO}>{t("common.none")}</SelectItem>
                          {emporiDisponibili.map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">{t("beneficiari.creditoSolidaleDataAbilitazione")}</label>
                    <Input disabled placeholder={t("beneficiari.creditoSolidaleDataAutomatica")} />
                  </div>
                  <FormField control={form.control} name="creditoSolidaleNote" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("beneficiari.creditoSolidaleNote")}</FormLabel>
                      <FormControl><Textarea rows={2} disabled={!emporioAbilitato} {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="consegnaDomicilio" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="mb-0">{t("beneficiarioDettaglio.consegnaDomicilio")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                {form.watch("consegnaDomicilio") && (
                  <FormField control={form.control} name="motivoConsegnaDomicilio" render={({ field }) => (
                    <FormItem><FormLabel>{t("beneficiarioDettaglio.motivoConsegna")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                  )} />
                )}
                <FormField control={form.control} name="restrizioniAlimentari" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.restrizioniAlimentari")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                )} />

                <div className="rounded-md border p-3 space-y-3">
                  {!unitaStradaAbilitata && (
                    <p className="text-xs text-muted-foreground">{UNITA_STRADA_DISABLED_MESSAGE}</p>
                  )}
                  <FormField control={form.control} name="uds" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <FormLabel className="!mt-0">{t("beneficiari.udsToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("beneficiari.udsToggleHint")}</p>
                      </div>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={!unitaStradaAbilitata} /></FormControl>
                    </FormItem>
                  )} />
                  {watchUds && (
                    <>
                      {isCittaGlobal && (
                        <FormField control={form.control} name="cittaId" render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("udsAnagrafica.fCitta")}</FormLabel>
                            <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); form.setValue("zonaUdsId", NO_ZONE); }} disabled={!unitaStradaAbilitata}>
                              <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.fCitta")} /></SelectTrigger></FormControl>
                              <SelectContent>
                                {cittaList?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      )}
                      <FormField control={form.control} name="zonaUdsId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                          <Select value={field.value || NO_ZONE} onValueChange={field.onChange} disabled={!unitaStradaAbilitata}>
                            <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.allZone")} /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value={NO_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                              {udsZone?.map(z => <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </>
                  )}
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setIsFormOpen(false); resetDup(); form.reset(); }}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={createBeneficiario.isPending}>{t("common.save")}</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      {editingId != null && <QuickEditBeneficiario id={editingId} onClose={() => setEditingId(null)} />}
      {schedaId != null && <SchedaExportDialog id={schedaId} onClose={() => setSchedaId(null)} />}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("beneficiari.deleteTitle")}</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deletingId) {
                deleteBeneficiario.mutate({ id: deletingId }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
                    setDeletingId(null);
                  }
                });
              }
            }} className="bg-destructive text-destructive-foreground">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function QuickEditBeneficiario({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: b } = useGetBeneficiario(id, { query: { queryKey: getGetBeneficiarioQueryKey(id) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  if (!b) return null;
  return (
    <EditBeneficiarioSheet
      b={b}
      onClose={onClose}
      onSaved={() => {
        queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(id) });
        toast({ title: t("beneficiari.toastUpdated") });
        onClose();
      }}
    />
  );
}
