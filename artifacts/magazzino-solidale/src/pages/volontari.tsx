import { useState } from "react";
import {
  confirmBulkVolontariInsurance,
  customFetch,
  getVolontario,
  getListVolontariQueryKey,
  previewBulkVolontariInsurance,
  useCreateVolontario,
  useListCentriAscolto,
  useListRuoliVolontari,
  useListVolontari,
  useUpdateVolontario,
  type ListVolontariParams,
  type Volontario,
  type VolontarioBulkInsurancePreviewRow,
  type VolontarioInput,
  type VolontarioUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  Download,
  Eye,
  Filter,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { VolontarioDossierSheet } from "@/components/volontari/volontario-dossier-sheet";
import { VolontariImportDialog } from "@/components/volontari/volontari-import-dialog";
import {
  VolontarioOperationDialog,
  type VolontarioOperation,
} from "@/components/volontari/volontario-operation-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  buildVolunteerCreatePayload,
  buildVolunteerUpdatePayload,
  validateVolunteerDraft,
  volunteerApiErrorData,
  type VolunteerDraft as Draft,
  type VolunteerFormErrors,
  type VolunteerFormField,
} from "@/lib/volontari-form";
import {
  canReactivateVolunteer,
  canSuspendVolunteer,
} from "@/lib/volontari-actions";

const emptyDraft = (centerId: number | null): Draft => ({
  nome: "",
  cognome: "",
  tipoVolontario: "PERMANENTE",
  centroAscoltoId: centerId,
  ruoloVolontarioId: 0,
  telefono: "",
  telefonoSecondario: "",
  email: "",
  luogoNascita: "",
  dataNascita: "",
  indirizzoResidenza: "",
  indirizzoDomicilio: "",
  domicilioCoincideResidenza: true,
  codiceFiscale: "",
  codiceFiscaleNonDisponibile: false,
  codiceFiscaleNota: "",
  patente: false,
  mezzoPersonale: false,
  maxConsegneTurno: 5,
  note: "",
  dataServizio: "",
});

function errorMessage(error: unknown): string {
  return (
    (error as { data?: { error?: string } })?.data?.error ??
    (error instanceof Error ? error.message : "Operazione non riuscita")
  );
}

function reasonLabel(reason?: string | null): string {
  const labels: Record<string, string> = {
    IN_ATTESA_APPROVAZIONE: "In attesa di approvazione",
    APPROVAZIONE_RESPINTA: "Approvazione respinta",
    SOSPENSIONE_MANUALE: "Sospeso manualmente",
    ASSICURAZIONE_SCADUTA: "Assicurazione scaduta",
    ASSICURAZIONE_MANCANTE: "Assicurazione mancante",
    ASSICURAZIONE_NON_ANCORA_VALIDA: "Copertura non ancora valida",
    GIORNATA_TEMPORANEA_MANCANTE: "Fuori dalla giornata di servizio",
  };
  return reason
    ? (labels[reason] ?? reason.replaceAll("_", " ").toLowerCase())
    : "Operativo";
}

function insuranceLabel(value: string): string {
  return (
    (
      {
        VALIDA: "Valida",
        IN_SCADENZA: "In scadenza",
        SCADUTA: "Scaduta",
        MANCANTE: "Mancante",
        NON_ANCORA_VALIDA: "Non ancora valida",
        TEMPORANEA: "Temporanea (giornata di servizio)",
      } as Record<string, string>
    )[value] ?? value
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function OperationalBadge({ volunteer }: { volunteer: Volontario }) {
  return (
    <div className="space-y-1">
      <Badge
        className={
          volunteer.operativo
            ? "bg-emerald-600 hover:bg-emerald-600"
            : "bg-destructive hover:bg-destructive"
        }
      >
        {volunteer.operativo ? "Attivo" : "Non attivo"}
      </Badge>
      {!volunteer.operativo && (
        <div className="max-w-52 text-xs text-muted-foreground">
          {reasonLabel(volunteer.motivoNonOperativo)}
        </div>
      )}
    </div>
  );
}

function InsuranceBadge({ volunteer }: { volunteer: Volontario }) {
  const style =
    volunteer.statoAssicurazione === "TEMPORANEA"
      ? "bg-blue-500/10 text-blue-800"
      : volunteer.statoAssicurazione === "VALIDA"
        ? "bg-emerald-500/10 text-emerald-700"
        : volunteer.statoAssicurazione === "IN_SCADENZA"
          ? "bg-amber-500/10 text-amber-800"
          : "bg-destructive/10 text-destructive";
  return (
    <div className="space-y-1">
      <Badge variant="secondary" className={style}>
        {insuranceLabel(volunteer.statoAssicurazione)}
      </Badge>
      <div className="text-xs text-muted-foreground">
        {volunteer.tipoVolontario === "TEMPORANEO"
          ? "Copertura legata alle giornate registrate"
          : (volunteer.scadenzaAssicurazione ?? "Nessuna scadenza")}
      </div>
    </div>
  );
}

const touchCheckboxClass =
  "relative h-11 w-11 border-0 bg-transparent shadow-none before:absolute before:h-4 before:w-4 before:rounded-sm before:border before:border-primary data-[state=checked]:bg-transparent data-[state=checked]:before:bg-primary [&_svg]:relative [&_svg]:z-10";

export default function Volontari() {
  const { user, hasPermission } = useAuth();
  const lockedCenterId = user?.centroAscoltoId ?? null;
  const canManage = hasPermission("logistica.volontari.manage");
  const canExport = hasPermission("logistica.volontari.export");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"tutti" | "attivi" | "non_attivi">(
    "tutti",
  );
  const [type, setType] = useState<"all" | "PERMANENTE" | "TEMPORANEO">("all");
  const [insurance, setInsurance] = useState<
    | "all"
    | "VALIDA"
    | "IN_SCADENZA"
    | "SCADUTA"
    | "MANCANTE"
    | "NON_ANCORA_VALIDA"
    | "TEMPORANEA"
  >("all");
  const [role, setRole] = useState("all");
  const [center, setCenter] = useState(
    lockedCenterId ? String(lockedCenterId) : "all",
  );
  const [referenceDate, setReferenceDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(
      new Date(),
    ),
  );
  const [expiryFrom, setExpiryFrom] = useState("");
  const [expiryTo, setExpiryTo] = useState("");
  const [serviceFrom, setServiceFrom] = useState("");
  const [serviceTo, setServiceTo] = useState("");
  const [expiredMonths, setExpiredMonths] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Volontario | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(lockedCenterId));
  const [initialDraft, setInitialDraft] = useState<Draft | null>(null);
  const [formErrors, setFormErrors] = useState<VolunteerFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formCorrelationId, setFormCorrelationId] = useState<string | null>(
    null,
  );
  const [resumeConversionAfterSave, setResumeConversionAfterSave] =
    useState(false);
  const [autoOpenServiceDay, setAutoOpenServiceDay] = useState(false);
  const [dossierVolunteer, setDossierVolunteer] = useState<Volontario | null>(
    null,
  );
  const [operationVolunteer, setOperationVolunteer] =
    useState<Volontario | null>(null);
  const [operation, setOperation] = useState<VolontarioOperation | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<
    "CONTINUA_SCADENZA" | "NUOVA_DA_DATA"
  >("NUOVA_DA_DATA");
  const [bulkStart, setBulkStart] = useState(referenceDate);
  const [bulkMonths, setBulkMonths] = useState("12");
  const [bulkPolicy, setBulkPolicy] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkPreview, setBulkPreview] = useState<
    VolontarioBulkInsurancePreviewRow[]
  >([]);
  const [bulkPending, setBulkPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createVolunteer = useCreateVolontario();
  const updateVolunteer = useUpdateVolontario();

  const params: ListVolontariParams = {
    stato: status,
    dataRiferimento: referenceDate,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(type !== "all" ? { tipoVolontario: type } : {}),
    ...(insurance !== "all" ? { statoAssicurazione: insurance } : {}),
    ...(role !== "all" ? { ruoloVolontarioId: Number(role) } : {}),
    ...(center !== "all" ? { centroAscoltoId: Number(center) } : {}),
    ...(expiryFrom ? { scadenzaDa: expiryFrom } : {}),
    ...(expiryTo ? { scadenzaA: expiryTo } : {}),
    ...(expiredMonths ? { scadutiDaMenoDiMesi: Number(expiredMonths) } : {}),
  };
  const { data: volunteers = [], isLoading } = useListVolontari(params, {
    query: { queryKey: getListVolontariQueryKey(params) },
  });
  const { data: centers = [] } = useListCentriAscolto();
  const { data: roles = [] } = useListRuoliVolontari();
  const currentDossierVolunteer = dossierVolunteer
    ? (volunteers.find((item) => item.id === dossierVolunteer.id) ??
      dossierVolunteer)
    : null;

  const focusFirstError = (errors: VolunteerFormErrors) => {
    const firstField = Object.keys(errors)[0] as VolunteerFormField | undefined;
    if (!firstField) return;
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-volunteer-field="${firstField}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
  };

  const resetFormFeedback = () => {
    setFormErrors({});
    setFormError(null);
    setFormCorrelationId(null);
  };

  const openCreate = () => {
    setEditing(null);
    const nextDraft = emptyDraft(lockedCenterId);
    setDraft(nextDraft);
    setInitialDraft(null);
    resetFormFeedback();
    setFormOpen(true);
  };
  const openEdit = async (
    volunteer: Volontario,
    requestedErrors: VolunteerFormErrors = {},
  ) => {
    try {
      const detail = await getVolontario(volunteer.id);
      setEditing(detail);
      const loadedDraft: Draft = {
        nome: detail.nome,
        cognome: detail.cognome,
        tipoVolontario: detail.tipoVolontario,
        centroAscoltoId: detail.centroAscoltoId ?? null,
        ruoloVolontarioId: detail.ruoloVolontarioId ?? 0,
        telefono: detail.telefono ?? "",
        telefonoSecondario: detail.telefonoSecondario ?? "",
        email: detail.email ?? "",
        luogoNascita: detail.luogoNascita ?? "",
        dataNascita: detail.dataNascita ?? "",
        indirizzoResidenza: detail.indirizzoResidenza ?? "",
        indirizzoDomicilio:
          (detail as Volontario & { indirizzoDomicilio?: string | null })
            .indirizzoDomicilio ?? "",
        domicilioCoincideResidenza:
          (detail as Volontario & { indirizzoDomicilio?: string | null })
            .indirizzoDomicilio == null,
        codiceFiscale: detail.codiceFiscale ?? "",
        codiceFiscaleNonDisponibile:
          (detail as Volontario & { codiceFiscaleNonDisponibile?: boolean })
            .codiceFiscaleNonDisponibile ?? false,
        codiceFiscaleNota:
          (detail as Volontario & { codiceFiscaleNota?: string | null })
            .codiceFiscaleNota ?? "",
        patente: detail.patente,
        mezzoPersonale: detail.mezzoPersonale,
        maxConsegneTurno: detail.maxConsegneTurno,
        note: detail.note ?? "",
        dataServizio: "",
      };
      setDraft(loadedDraft);
      setInitialDraft(loadedDraft);
      resetFormFeedback();
      setFormErrors(requestedErrors);
      setFormOpen(true);
      focusFirstError(requestedErrors);
    } catch (error) {
      toast({
        title: "Impossibile caricare la scheda completa",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as VolunteerFormField];
      return next;
    });
    setFormError(null);
    setFormCorrelationId(null);
  };

  const saveVolunteer = async () => {
    const clientErrors = validateVolunteerDraft(draft, {
      editing: editing != null,
    });
    if (Object.keys(clientErrors).length > 0) {
      setFormErrors(clientErrors);
      setFormError("Correggi tutti i campi evidenziati prima di salvare.");
      focusFirstError(clientErrors);
      return;
    }
    resetFormFeedback();
    try {
      if (editing) {
        const updated = await updateVolunteer.mutateAsync({
          id: editing.id,
          data: buildVolunteerUpdatePayload(
            draft,
            initialDraft ?? draft,
            lockedCenterId,
            editing.versione,
          ) as unknown as VolontarioUpdate,
        });
        if (resumeConversionAfterSave) setDossierVolunteer(updated);
        toast({ title: "Anagrafica aggiornata" });
      } else {
        await createVolunteer.mutateAsync({
          data: buildVolunteerCreatePayload(
            draft,
            lockedCenterId,
          ) as VolontarioInput,
        });
        toast({
          title: "Volontario creato",
          description: "L'anagrafica è in attesa di approvazione.",
        });
      }
      await queryClient.invalidateQueries({
        queryKey: getListVolontariQueryKey(),
      });
      setFormOpen(false);
      if (!editing) setResumeConversionAfterSave(false);
    } catch (error) {
      const data = volunteerApiErrorData(error);
      const serverErrors = data.fieldErrors ?? {};
      setFormErrors(serverErrors);
      setFormError(
        data.message ??
          data.error ??
          "Non è stato possibile salvare l'anagrafica.",
      );
      setFormCorrelationId(data.correlationId ?? null);
      focusFirstError(serverErrors);
      toast({
        title: "Salvataggio non riuscito",
        description: data.message ?? data.error ?? errorMessage(error),
        variant: "destructive",
      });
    }
  };

  const openOperation = (
    volunteer: Volontario,
    nextOperation: VolontarioOperation,
  ) => {
    setOperationVolunteer(
      volunteers.find((item) => item.id === volunteer.id) ?? volunteer,
    );
    setOperation(nextOperation);
  };
  const openDossierAction = (
    volunteer: Volontario,
    action: "conversion" | "giornata",
  ) => {
    setResumeConversionAfterSave(action === "conversion");
    setAutoOpenServiceDay(action === "giornata");
    setDossierVolunteer(volunteer);
  };
  const allSelected =
    volunteers.length > 0 &&
    volunteers.every((volunteer) => selectedIds.has(volunteer.id));
  const toggleAll = (checked: boolean) =>
    setSelectedIds(
      checked ? new Set(volunteers.map((item) => item.id)) : new Set(),
    );
  const toggleSelected = (id: number, checked: boolean) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const runBulkPreview = async () => {
    const months = Number(bulkMonths);
    if (!Number.isSafeInteger(months) || months < 1 || months > 120) return;
    setBulkPending(true);
    try {
      const result = await previewBulkVolontariInsurance({
        volontarioIds: [...selectedIds],
        modalita: bulkMode,
        ...(bulkMode === "NUOVA_DA_DATA" ? { dataDecorrenza: bulkStart } : {}),
        durataMesi: months,
        riferimentoPolizza: bulkPolicy || undefined,
        note: bulkNotes || undefined,
      });
      setBulkPreview(result.items);
    } catch (error) {
      toast({
        title: "Anteprima non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBulkPending(false);
    }
  };

  const confirmBulk = async () => {
    setBulkPending(true);
    try {
      await confirmBulkVolontariInsurance({
        modalita: bulkMode,
        ...(bulkMode === "NUOVA_DA_DATA" ? { dataDecorrenza: bulkStart } : {}),
        durataMesi: Number(bulkMonths),
        riferimentoPolizza: bulkPolicy || undefined,
        note: bulkNotes || undefined,
        righe: bulkPreview.map((row) => ({
          volontarioId: row.volontarioId,
          versione: row.versione,
          incluso: row.incluso,
        })),
      });
      await queryClient.invalidateQueries({
        queryKey: getListVolontariQueryKey(),
      });
      setBulkOpen(false);
      setBulkPreview([]);
      setSelectedIds(new Set());
      toast({ title: "Rinnovo massivo completato" });
    } catch (error) {
      toast({
        title: "Rinnovo non riuscito",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setBulkPending(false);
    }
  };

  const exportQuery = () => {
    const query = new URLSearchParams();
    if (center !== "all") query.set("centroAscoltoId", center);
    if (type !== "all") query.set("tipo", type);
    query.set("stato", status);
    query.set("dataRiferimento", referenceDate);
    if (role !== "all") query.set("ruoloVolontarioId", role);
    if (insurance !== "all") query.set("assicurazione", insurance);
    if (serviceFrom) query.set("servizioDa", serviceFrom);
    if (serviceTo) query.set("servizioA", serviceTo);
    return query.toString();
  };
  const exportFile = async (
    kind: "storico" | "esteso" | "registro-pdf" | "registro-xlsx",
  ) => {
    setExportPending(true);
    try {
      const extension = kind.includes("pdf") ? "pdf" : "xlsx";
      const blob =
        kind === "storico" || kind === "esteso"
          ? await customFetch<Blob>(
              `/api/volontari/export/${kind}.xlsx?${exportQuery()}`,
              { responseType: "blob" },
            )
          : await customFetch<Blob>("/api/volontari/registro/genera", {
              method: "POST",
              responseType: "blob",
              body: JSON.stringify({
                tipo: kind === "registro-pdf" ? "PDF" : "XLSX",
                filtri: {
                  dataRiferimento: referenceDate,
                  stato: status,
                  tipo: type === "all" ? "TUTTI" : type,
                  ...(center !== "all"
                    ? { centroAscoltoId: Number(center) }
                    : {}),
                  ...(role !== "all"
                    ? { ruoloVolontarioId: Number(role) }
                    : {}),
                  ...(insurance !== "all" ? { assicurazione: insurance } : {}),
                  ...(serviceFrom ? { servizioDa: serviceFrom } : {}),
                  ...(serviceTo ? { servizioA: serviceTo } : {}),
                },
              }),
            });
      downloadBlob(blob, `${kind}-${referenceDate}.${extension}`);
      toast({ title: "File generato" });
    } catch (error) {
      toast({
        title: "Esportazione non riuscita",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setExportPending(false);
    }
  };

  const fieldInputProps = (field: VolunteerFormField) => ({
    id: `volontario-${field}`,
    "data-volunteer-field": field,
    "aria-invalid": formErrors[field] ? (true as const) : undefined,
    "aria-describedby": formErrors[field]
      ? `volontario-${field}-error`
      : undefined,
  });
  const fieldError = (field: VolunteerFormField) =>
    formErrors[field] ? (
      <p
        id={`volontario-${field}-error`}
        className="text-sm text-destructive"
        role="alert"
      >
        {formErrors[field]}
      </p>
    ) : null;
  const invalidBorder = (field: VolunteerFormField) =>
    `min-h-11 ${
      formErrors[field]
        ? "border-destructive focus-visible:ring-destructive"
        : ""
    }`;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Users className="h-7 w-7" /> Volontari
          </h1>
          <p className="mt-1 text-muted-foreground">
            Anagrafiche, operatività, coperture, formazione e registro storico.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={exportPending}
                >
                  <Download className="h-4 w-4" /> Esporta / Registro{" "}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportFile("storico")}>
                  Export tracciato storico XLSX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportFile("esteso")}>
                  Export operativo esteso XLSX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportFile("registro-pdf")}>
                  Emetti registro ufficiale PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportFile("registro-xlsx")}>
                  Emetti registro ufficiale XLSX
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canManage && (
            <Button
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" /> Importa
            </Button>
          )}
          {canManage && (
            <Button className="min-h-11 gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Nuovo volontario
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Risultati</div>
            <div className="mt-1 text-2xl font-semibold">
              {volunteers.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Operativi</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">
              {volunteers.filter((item) => item.operativo).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">
              Copertura critica
            </div>
            <div className="mt-1 text-2xl font-semibold text-destructive">
              {
                volunteers.filter((item) =>
                  ["SCADUTA", "MANCANTE"].includes(item.statoAssicurazione),
                ).length
              }
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4 border-b p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="min-h-11 pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cerca nome, cognome o matricola"
              />
            </div>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
            >
              <SelectTrigger className="min-h-11 md:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti gli stati</SelectItem>
                <SelectItem value="attivi">Attivi</SelectItem>
                <SelectItem value="non_attivi">Non attivi</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Filter className="h-4 w-4" /> Filtri avanzati
            </Button>
          </div>
          {filtersOpen && (
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as typeof type)}
                >
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    <SelectItem value="PERMANENTE">Permanenti</SelectItem>
                    <SelectItem value="TEMPORANEO">Temporanei</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Assicurazione</Label>
                <Select
                  value={insurance}
                  onValueChange={(value) =>
                    setInsurance(value as typeof insurance)
                  }
                >
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutte</SelectItem>
                    <SelectItem value="VALIDA">Valida</SelectItem>
                    <SelectItem value="IN_SCADENZA">In scadenza</SelectItem>
                    <SelectItem value="SCADUTA">Scaduta</SelectItem>
                    <SelectItem value="MANCANTE">Mancante</SelectItem>
                    <SelectItem value="NON_ANCORA_VALIDA">
                      Non ancora valida
                    </SelectItem>
                    <SelectItem value="TEMPORANEA">
                      Temporanea (giornata di servizio)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Ruolo</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tutti</SelectItem>
                    {roles
                      .filter((item) => item.attivo)
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {!lockedCenterId && (
                <div className="space-y-1">
                  <Label>Centro</Label>
                  <Select value={center} onValueChange={setCenter}>
                    <SelectTrigger className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tutti</SelectItem>
                      {centers.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label>Data riferimento</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={referenceDate}
                  onChange={(event) => setReferenceDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Scaduti da meno di mesi</Label>
                <Input
                  className="min-h-11"
                  type="number"
                  min="1"
                  max="120"
                  value={expiredMonths}
                  onChange={(event) => setExpiredMonths(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Scadenza da</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={expiryFrom}
                  onChange={(event) => setExpiryFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Scadenza a</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={expiryTo}
                  onChange={(event) => setExpiryTo(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Servizio temporanei da</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={serviceFrom}
                  onChange={(event) => setServiceFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Servizio temporanei a</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={serviceTo}
                  onChange={(event) => setServiceTo(event.target.value)}
                />
              </div>
            </div>
          )}
          {canManage && selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary/5 p-3">
              <span className="text-sm font-medium">
                {selectedIds.size} volontari selezionati
              </span>
              <Button
                className="min-h-11"
                onClick={() => {
                  setBulkPreview([]);
                  setBulkOpen(true);
                }}
              >
                <ShieldCheck className="mr-2 h-4 w-4" /> Registra / Rinnova
                assicurazione
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden lg:block" data-testid="volontari-desktop-list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      className={touchCheckboxClass}
                      checked={allSelected}
                      onCheckedChange={(checked) => toggleAll(checked === true)}
                      aria-label="Seleziona tutti"
                    />
                  </TableHead>
                  <TableHead>Volontario</TableHead>
                  <TableHead>Tipo / Ruolo</TableHead>
                  <TableHead>Centro</TableHead>
                  <TableHead>Assicurazione</TableHead>
                  <TableHead>Stato operativo</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-11 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : volunteers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 text-center text-muted-foreground"
                    >
                      Nessun volontario per i filtri selezionati.
                    </TableCell>
                  </TableRow>
                ) : (
                  volunteers.map((volunteer) => (
                    <TableRow key={volunteer.id} data-testid="volontario-row">
                      <TableCell>
                        <Checkbox
                          className={touchCheckboxClass}
                          checked={selectedIds.has(volunteer.id)}
                          onCheckedChange={(checked) =>
                            toggleSelected(volunteer.id, checked === true)
                          }
                          aria-label={`Seleziona ${volunteer.cognome} ${volunteer.nome}`}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          className="min-h-11 text-left font-medium hover:underline"
                          onClick={() => setDossierVolunteer(volunteer)}
                        >
                          {volunteer.cognome} {volunteer.nome}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {volunteer.matricola ?? "Senza matricola"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {volunteer.tipoVolontario === "TEMPORANEO"
                            ? "Temporaneo"
                            : "Permanente"}
                        </Badge>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {volunteer.ruoloCatalogoNome ?? volunteer.ruolo}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {volunteer.centroAscoltoNome ?? "Trasversale"}
                      </TableCell>
                      <TableCell>
                        <InsuranceBadge volunteer={volunteer} />
                      </TableCell>
                      <TableCell>
                        <OperationalBadge volunteer={volunteer} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11"
                            onClick={() => setDossierVolunteer(volunteer)}
                            aria-label="Apri scheda"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="min-h-11">
                                  Azioni{" "}
                                  <ChevronDown className="ml-2 h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  className="min-h-11"
                                  onClick={() => openEdit(volunteer)}
                                >
                                  <Pencil className="mr-2 h-4 w-4" /> Modifica
                                  anagrafica
                                </DropdownMenuItem>
                                {canReactivateVolunteer(volunteer) && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={() =>
                                      openOperation(volunteer, "riattiva")
                                    }
                                  >
                                    Riattiva
                                  </DropdownMenuItem>
                                )}
                                {canSuspendVolunteer(volunteer) && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={() =>
                                      openOperation(volunteer, "sospendi")
                                    }
                                  >
                                    Sospendi
                                  </DropdownMenuItem>
                                )}
                                {volunteer.tipoVolontario === "TEMPORANEO" ? (
                                  <>
                                    <DropdownMenuItem
                                      className="min-h-11"
                                      onClick={() =>
                                        openDossierAction(volunteer, "giornata")
                                      }
                                    >
                                      <CalendarPlus className="mr-2 h-4 w-4" />
                                      Registra giornata di servizio
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="min-h-11"
                                      onClick={() =>
                                        openDossierAction(
                                          volunteer,
                                          "conversion",
                                        )
                                      }
                                    >
                                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                                      Converti in permanente
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={() =>
                                      openOperation(volunteer, "assicurazione")
                                    }
                                  >
                                    <ShieldCheck className="mr-2 h-4 w-4" />
                                    Registra / Rinnova assicurazione
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div
            className="grid gap-3 p-3 lg:hidden"
            data-testid="volontari-mobile-list"
          >
            {isLoading ? (
              Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-52 w-full rounded-xl" />
              ))
            ) : volunteers.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                Nessun volontario per i filtri selezionati.
              </div>
            ) : (
              volunteers.map((volunteer) => (
                <article
                  key={volunteer.id}
                  className="rounded-xl border p-4"
                  data-testid="volontario-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className={`-mt-2 ${touchCheckboxClass}`}
                        checked={selectedIds.has(volunteer.id)}
                        onCheckedChange={(checked) =>
                          toggleSelected(volunteer.id, checked === true)
                        }
                        aria-label={`Seleziona ${volunteer.cognome} ${volunteer.nome}`}
                      />
                      <div>
                        <button
                          className="min-h-11 text-left text-base font-semibold hover:underline"
                          onClick={() => setDossierVolunteer(volunteer)}
                        >
                          {volunteer.cognome} {volunteer.nome}
                        </button>
                        <div className="text-sm text-muted-foreground">
                          {volunteer.matricola ?? "Senza matricola"} ·{" "}
                          {volunteer.tipoVolontario === "TEMPORANEO"
                            ? "Temporaneo"
                            : "Permanente"}
                        </div>
                      </div>
                    </div>
                    <OperationalBadge volunteer={volunteer} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Ruolo</div>
                      {volunteer.ruoloCatalogoNome ?? volunteer.ruolo}
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Centro
                      </div>
                      {volunteer.centroAscoltoNome ?? "Trasversale"}
                    </div>
                    <div className="col-span-2">
                      <InsuranceBadge volunteer={volunteer} />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1"
                      onClick={() => setDossierVolunteer(volunteer)}
                    >
                      <Eye className="mr-2 h-4 w-4" /> Scheda
                    </Button>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="min-h-11 flex-1">
                            Azioni <ChevronDown className="ml-2 h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="min-h-11"
                            onClick={() => openEdit(volunteer)}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Modifica
                            anagrafica
                          </DropdownMenuItem>
                          {canReactivateVolunteer(volunteer) && (
                            <DropdownMenuItem
                              className="min-h-11"
                              onClick={() =>
                                openOperation(volunteer, "riattiva")
                              }
                            >
                              Riattiva
                            </DropdownMenuItem>
                          )}
                          {canSuspendVolunteer(volunteer) && (
                            <DropdownMenuItem
                              className="min-h-11"
                              onClick={() =>
                                openOperation(volunteer, "sospendi")
                              }
                            >
                              Sospendi
                            </DropdownMenuItem>
                          )}
                          {volunteer.tipoVolontario === "TEMPORANEO" ? (
                            <>
                              <DropdownMenuItem
                                className="min-h-11"
                                onClick={() =>
                                  openDossierAction(volunteer, "giornata")
                                }
                              >
                                <CalendarPlus className="mr-2 h-4 w-4" />
                                Registra giornata di servizio
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="min-h-11"
                                onClick={() =>
                                  openDossierAction(volunteer, "conversion")
                                }
                              >
                                <ArrowRightLeft className="mr-2 h-4 w-4" />
                                Converti in permanente
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem
                              className="min-h-11"
                              onClick={() =>
                                openOperation(volunteer, "assicurazione")
                              }
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Registra / Rinnova assicurazione
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Sheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (
            !open &&
            !createVolunteer.isPending &&
            !updateVolunteer.isPending
          ) {
            setResumeConversionAfterSave(false);
          }
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-hidden sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Modifica volontario" : "Nuovo volontario"}
            </SheetTitle>
            <SheetDescription>
              Lo stato operativo è calcolato separatamente da approvazione,
              sospensione e assicurazione.
            </SheetDescription>
          </SheetHeader>
          {formError && (
            <div
              className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              <div className="font-medium">{formError}</div>
              {formCorrelationId && (
                <div className="mt-1 text-xs">
                  ID correlazione: {formCorrelationId}
                </div>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto py-6 pr-1">
            <section className="space-y-4">
              <h3 className="font-semibold">1. Identità e contatti</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="volontario-nome">Nome *</Label>
                  <Input
                    {...fieldInputProps("nome")}
                    className={invalidBorder("nome")}
                    value={draft.nome}
                    onChange={(event) => setField("nome", event.target.value)}
                  />
                  {fieldError("nome")}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-cognome">Cognome *</Label>
                  <Input
                    {...fieldInputProps("cognome")}
                    className={invalidBorder("cognome")}
                    value={draft.cognome}
                    onChange={(event) =>
                      setField("cognome", event.target.value)
                    }
                  />
                  {fieldError("cognome")}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-codiceFiscale">
                    Codice fiscale *
                  </Label>
                  <Input
                    {...fieldInputProps("codiceFiscale")}
                    className={invalidBorder("codiceFiscale")}
                    disabled={draft.codiceFiscaleNonDisponibile}
                    value={draft.codiceFiscale}
                    onChange={(event) =>
                      setField("codiceFiscale", event.target.value)
                    }
                  />
                  {fieldError("codiceFiscale")}
                </div>
                <label
                  className={`flex min-h-12 items-center gap-3 rounded-lg border p-3 sm:col-span-2 ${invalidBorder("codiceFiscaleNonDisponibile")}`}
                >
                  <Checkbox
                    {...fieldInputProps("codiceFiscaleNonDisponibile")}
                    className={touchCheckboxClass}
                    checked={draft.codiceFiscaleNonDisponibile}
                    onCheckedChange={(checked) => {
                      setField("codiceFiscaleNonDisponibile", checked === true);
                      if (checked === true) setField("codiceFiscale", "");
                    }}
                  />
                  <span>
                    Codice fiscale non disponibile
                    {fieldError("codiceFiscaleNonDisponibile")}
                  </span>
                </label>
                {draft.codiceFiscaleNonDisponibile && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="volontario-codiceFiscaleNota">
                      Motivo indisponibilità (facoltativo)
                    </Label>
                    <Input
                      {...fieldInputProps("codiceFiscaleNota")}
                      className={invalidBorder("codiceFiscaleNota")}
                      value={draft.codiceFiscaleNota}
                      onChange={(event) =>
                        setField("codiceFiscaleNota", event.target.value)
                      }
                    />
                    {fieldError("codiceFiscaleNota")}
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="volontario-dataNascita">
                    Data di nascita *
                  </Label>
                  <Input
                    {...fieldInputProps("dataNascita")}
                    className={invalidBorder("dataNascita")}
                    type="date"
                    value={draft.dataNascita}
                    onChange={(event) =>
                      setField("dataNascita", event.target.value)
                    }
                  />
                  {fieldError("dataNascita")}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-luogoNascita">
                    Luogo di nascita *
                  </Label>
                  <Input
                    {...fieldInputProps("luogoNascita")}
                    className={invalidBorder("luogoNascita")}
                    value={draft.luogoNascita}
                    onChange={(event) =>
                      setField("luogoNascita", event.target.value)
                    }
                  />
                  {fieldError("luogoNascita")}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="volontario-indirizzoResidenza">
                    Indirizzo di residenza *
                  </Label>
                  <Input
                    {...fieldInputProps("indirizzoResidenza")}
                    className={invalidBorder("indirizzoResidenza")}
                    value={draft.indirizzoResidenza}
                    onChange={(event) =>
                      setField("indirizzoResidenza", event.target.value)
                    }
                  />
                  {fieldError("indirizzoResidenza")}
                </div>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3 sm:col-span-2">
                  <Checkbox
                    className={touchCheckboxClass}
                    checked={draft.domicilioCoincideResidenza}
                    onCheckedChange={(checked) => {
                      const coincide = checked === true;
                      setField("domicilioCoincideResidenza", coincide);
                      if (coincide) setField("indirizzoDomicilio", "");
                    }}
                  />
                  Il domicilio coincide con la residenza
                </label>
                {!draft.domicilioCoincideResidenza && (
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="volontario-indirizzoDomicilio">
                      Indirizzo di domicilio *
                    </Label>
                    <Input
                      {...fieldInputProps("indirizzoDomicilio")}
                      className={invalidBorder("indirizzoDomicilio")}
                      value={draft.indirizzoDomicilio}
                      onChange={(event) =>
                        setField("indirizzoDomicilio", event.target.value)
                      }
                    />
                    {fieldError("indirizzoDomicilio")}
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="volontario-telefono">Cellulare</Label>
                  <Input
                    {...fieldInputProps("telefono")}
                    className={invalidBorder("telefono")}
                    inputMode="tel"
                    value={draft.telefono}
                    onChange={(event) =>
                      setField("telefono", event.target.value)
                    }
                  />
                  {fieldError("telefono")}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-telefonoSecondario">
                    Telefono
                  </Label>
                  <Input
                    {...fieldInputProps("telefonoSecondario")}
                    className={invalidBorder("telefonoSecondario")}
                    inputMode="tel"
                    value={draft.telefonoSecondario}
                    onChange={(event) =>
                      setField("telefonoSecondario", event.target.value)
                    }
                  />
                  {fieldError("telefonoSecondario")}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="volontario-email">Email</Label>
                  <Input
                    {...fieldInputProps("email")}
                    className={invalidBorder("email")}
                    type="email"
                    value={draft.email}
                    onChange={(event) => setField("email", event.target.value)}
                  />
                  {fieldError("email")}
                </div>
              </div>
            </section>
            <section className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">2. Tipo, ruolo e perimetro</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="volontario-tipoVolontario">
                    Tipo volontario *
                  </Label>
                  <Select
                    disabled={editing != null}
                    value={draft.tipoVolontario}
                    onValueChange={(value) =>
                      setField(
                        "tipoVolontario",
                        value as Draft["tipoVolontario"],
                      )
                    }
                  >
                    <SelectTrigger
                      {...fieldInputProps("tipoVolontario")}
                      className={`min-h-11 ${invalidBorder("tipoVolontario")}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERMANENTE">Permanente</SelectItem>
                      <SelectItem value="TEMPORANEO">Temporaneo</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldError("tipoVolontario")}
                  {!editing && (
                    <p className="text-xs text-muted-foreground">
                      La matricola verrà generata automaticamente al
                      salvataggio.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-ruoloVolontarioId">Ruolo *</Label>
                  <Select
                    value={
                      draft.ruoloVolontarioId
                        ? String(draft.ruoloVolontarioId)
                        : ""
                    }
                    onValueChange={(value) =>
                      setField("ruoloVolontarioId", Number(value))
                    }
                  >
                    <SelectTrigger
                      {...fieldInputProps("ruoloVolontarioId")}
                      className={`min-h-11 ${invalidBorder("ruoloVolontarioId")}`}
                    >
                      <SelectValue placeholder="Seleziona ruolo" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles
                        .filter((item) => item.attivo)
                        .map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {fieldError("ruoloVolontarioId")}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volontario-centroAscoltoId">Centro</Label>
                  <Select
                    disabled={lockedCenterId != null}
                    value={
                      draft.centroAscoltoId
                        ? String(draft.centroAscoltoId)
                        : "none"
                    }
                    onValueChange={(value) =>
                      setField(
                        "centroAscoltoId",
                        value === "none" ? null : Number(value),
                      )
                    }
                  >
                    <SelectTrigger
                      {...fieldInputProps("centroAscoltoId")}
                      className={`min-h-11 ${invalidBorder("centroAscoltoId")}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Trasversale / nessun centro
                      </SelectItem>
                      {centers.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError("centroAscoltoId")}
                </div>
                {draft.tipoVolontario === "TEMPORANEO" && !editing && (
                  <div className="space-y-1">
                    <Label htmlFor="volontario-dataServizio">
                      Prima giornata di servizio *
                    </Label>
                    <Input
                      {...fieldInputProps("dataServizio")}
                      className={invalidBorder("dataServizio")}
                      type="date"
                      value={draft.dataServizio}
                      onChange={(event) =>
                        setField("dataServizio", event.target.value)
                      }
                    />
                    {fieldError("dataServizio")}
                  </div>
                )}
              </div>
            </section>
            <section className="space-y-4 border-t pt-6">
              <h3 className="font-semibold">3. Logistica</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    className={touchCheckboxClass}
                    checked={draft.patente}
                    onCheckedChange={(checked) =>
                      setField("patente", checked === true)
                    }
                  />{" "}
                  Patente B
                </label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    className={touchCheckboxClass}
                    checked={draft.mezzoPersonale}
                    onCheckedChange={(checked) =>
                      setField("mezzoPersonale", checked === true)
                    }
                  />{" "}
                  Mezzo personale
                </label>
                <div className="space-y-1">
                  <Label htmlFor="volontario-maxConsegneTurno">
                    Massimo consegne per turno
                  </Label>
                  <Input
                    {...fieldInputProps("maxConsegneTurno")}
                    className={invalidBorder("maxConsegneTurno")}
                    type="number"
                    min="0"
                    value={draft.maxConsegneTurno}
                    onChange={(event) =>
                      setField("maxConsegneTurno", Number(event.target.value))
                    }
                  />
                  {fieldError("maxConsegneTurno")}
                </div>
              </div>
            </section>
            <section className="space-y-2 border-t pt-6">
              <h3 className="font-semibold">4. Note</h3>
              <Textarea
                value={draft.note}
                onChange={(event) => setField("note", event.target.value)}
                rows={4}
              />
            </section>
          </div>
          <div className="z-10 flex shrink-0 flex-wrap justify-end gap-2 border-t bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setFormOpen(false);
                setResumeConversionAfterSave(false);
              }}
            >
              Annulla
            </Button>
            <Button
              className="min-h-11"
              onClick={saveVolunteer}
              disabled={createVolunteer.isPending || updateVolunteer.isPending}
            >
              {editing ? "Salva modifiche" : "Crea volontario"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <VolontarioDossierSheet
        volontario={currentDossierVolunteer}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) {
            setDossierVolunteer(null);
            setAutoOpenServiceDay(false);
          }
        }}
        autoOpenConversion={resumeConversionAfterSave}
        onAutoOpenConversionHandled={() => setResumeConversionAfterSave(false)}
        autoOpenServiceDay={autoOpenServiceDay}
        onAutoOpenServiceDayHandled={() => setAutoOpenServiceDay(false)}
        onEdit={(volunteer, errors = {}) => {
          setResumeConversionAfterSave(Object.keys(errors).length > 0);
          setDossierVolunteer(null);
          openEdit(volunteer, errors);
        }}
        onOperation={openOperation}
      />
      <VolontarioOperationDialog
        volontario={operationVolunteer}
        operation={operation}
        onOpenChange={(open) => {
          if (!open) {
            setOperationVolunteer(null);
            setOperation(null);
          }
        }}
      />
      <VolontariImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        centroAscoltoId={
          lockedCenterId ?? (center !== "all" ? Number(center) : undefined)
        }
        ruoli={roles}
        centri={centers}
      />

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) setBulkPreview([]);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5" /> Rinnovo assicurativo massivo
            </DialogTitle>
            <DialogDescription>
              {selectedIds.size} volontari selezionati. La preview mostra esiti
              ed esclusioni prima del commit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>Modalità</Label>
              <Select
                value={bulkMode}
                onValueChange={(value) => {
                  setBulkMode(value as typeof bulkMode);
                  setBulkPreview([]);
                }}
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTINUA_SCADENZA">
                    Continua da scadenza
                  </SelectItem>
                  <SelectItem value="NUOVA_DA_DATA">Nuova da data</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {bulkMode === "NUOVA_DA_DATA" && (
              <div className="space-y-1">
                <Label>Decorrenza</Label>
                <Input
                  className="min-h-11"
                  type="date"
                  value={bulkStart}
                  onChange={(event) => {
                    setBulkStart(event.target.value);
                    setBulkPreview([]);
                  }}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>Durata mesi</Label>
              <Input
                className="min-h-11"
                type="number"
                min="1"
                max="120"
                value={bulkMonths}
                onChange={(event) => {
                  setBulkMonths(event.target.value);
                  setBulkPreview([]);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Riferimento polizza</Label>
              <Input
                className="min-h-11"
                value={bulkPolicy}
                onChange={(event) => setBulkPolicy(event.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <Label>Note</Label>
              <Textarea
                value={bulkNotes}
                onChange={(event) => setBulkNotes(event.target.value)}
              />
            </div>
          </div>
          {bulkPreview.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Anteprima</div>
              {bulkPreview.map((row, index) => (
                <label
                  key={row.volontarioId}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${row.incluso ? "" : "opacity-60"}`}
                >
                  <Checkbox
                    className="mt-1"
                    checked={row.incluso}
                    disabled={Boolean(row.esclusioneMotivo)}
                    onCheckedChange={(checked) =>
                      setBulkPreview((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, incluso: checked === true }
                            : item,
                        ),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{row.volontario}</div>
                    <div className="mt-1 grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                      <span>Vecchia: {row.vecchiaScadenza ?? "mancante"}</span>
                      <span>
                        Nuova: {row.nuovaDecorrenza ?? "—"} →{" "}
                        {row.nuovaScadenza ?? "—"}
                      </span>
                      <span>
                        {row.esclusioneMotivo ??
                          reasonLabel(row.motivoNonOperativo)}
                      </span>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {row.esitoPrevisto.replaceAll("_", " ")}
                  </Badge>
                </label>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setBulkOpen(false)}
            >
              Annulla
            </Button>
            {bulkPreview.length === 0 ? (
              <Button
                className="min-h-11"
                onClick={runBulkPreview}
                disabled={bulkPending}
              >
                {bulkPending ? "Calcolo…" : "Mostra anteprima"}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={runBulkPreview}
                  disabled={bulkPending}
                >
                  Ricalcola
                </Button>
                <Button
                  className="min-h-11"
                  onClick={confirmBulk}
                  disabled={
                    bulkPending || !bulkPreview.some((row) => row.incluso)
                  }
                >
                  {bulkPending ? "Conferma…" : "Conferma rinnovo"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
