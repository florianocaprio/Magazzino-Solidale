import { useMemo, useState } from "react";
import {
  useListUdsDirectory,
  useListInterventi,
  useCreateUdsIntervento,
  useUpdateUdsInterventoNota,
  useRectifyUdsIntervento,
  useListAreeOperative,
  useListZoneUds,
  useListTipiIntervento,
  getListInterventiQueryKey,
  getListAreeOperativeQueryKey,
  type Intervento,
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { BeneficiarioCombobox } from "@/components/beneficiario-combobox";
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from "@/hooks/use-unsaved-changes-guard";
import {
  UdsPersonaSheet,
  type UdsPersonaSelection,
} from "@/components/uds-persona-sheet";
import {
  BisogniPianificatiEditor,
  type BisognoPianificatoDraft,
} from "@/components/bisogni-pianificati-editor";
import { UdsBisogniDialog } from "@/components/uds-bisogni-dialog";
import {
  InterventoStatoBadge,
  interventoDataLabel,
} from "@/components/intervento-workflow";
import {
  AlertTriangle,
  CalendarClock,
  Plus,
  HeartHandshake,
  StickyNote,
  Pencil,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { todayEuropeRome } from "@/lib/europe-rome";

const ALL_ZONE = "__all__";

function makeSchema(t: (k: string) => string) {
  const bisognoSchema = z
    .object({
      clientKey: z.string(),
      id: z.number().int().positive().optional(),
      versione: z.number().int().positive().optional(),
      tipo: z.enum(["richiesta", "azione"]),
      descrizione: z
        .string()
        .trim()
        .min(1, t("udsInterventi.bisognoDescrizioneRequired"))
        .max(500),
      stato: z.enum([
        "da_pianificare",
        "pianificato",
        "completato",
        "annullato",
      ]),
      dataPrevista: z.string(),
      priorita: z.enum(["bassa", "normale", "alta", "urgente"]),
      note: z.string().max(2000),
      dataCompletamento: z.string().nullable().optional(),
    })
    .superRefine((value, context) => {
      if (value.stato === "pianificato" && !value.dataPrevista) {
        context.addIssue({
          code: "custom",
          path: ["dataPrevista"],
          message: t("udsInterventi.bisognoDataRequired"),
        });
      }
    });
  return z.object({
    dataIntervento: z.string().min(1, t("common.requiredField")),
    tipoIntervento: z.string().min(1, t("common.requiredField")),
    descrizione: z.string().optional(),
    note: z.string().optional(),
    motivoRettifica: z.string().max(2000).optional(),
    bisogniPianificati: z.array(bisognoSchema),
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err != null &&
    "status" in err &&
    (err as { status?: unknown }).status === 409
  );
}

function personLabel(b: {
  nome: string;
  cognome: string;
  soprannome?: string | null;
}): string {
  const base = `${b.cognome} ${b.nome}`;
  return b.soprannome ? `${base} (${b.soprannome})` : base;
}

export default function UdsInterventi() {
  const { t } = useTranslation();
  const { user, hasArea, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const schema = makeSchema(t);
  const canCreatePerson = hasArea("uds") && hasPermission("beneficiari.manage");

  const isGlobal = user?.areaOperativaId == null;
  const [selectedPerson, setSelectedPerson] = useState<string>("");
  const [personSearch, setPersonSearch] = useState("");
  const [filterAreaOperativa, setFilterAreaOperativa] = useState<string>("");
  const [filterZona, setFilterZona] = useState<string>(ALL_ZONE);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isNewPersonOpen, setIsNewPersonOpen] = useState(false);
  const [selectedPersonFallback, setSelectedPersonFallback] =
    useState<UdsPersonaSelection | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteEditing, setNoteEditing] = useState<Intervento | null>(null);
  const [bisogniEditingId, setBisogniEditingId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [bisogniFilter, setBisogniFilter] = useState<
    "tutti" | "aperti" | "scaduti" | "nessuno"
  >("tutti");

  const { data: areaOperativaList } = useListAreeOperative({
    query: { queryKey: getListAreeOperativeQueryKey(), enabled: isGlobal },
  });

  const effectiveAreaOperativa = isGlobal
    ? filterAreaOperativa
      ? parseInt(filterAreaOperativa)
      : undefined
    : (user?.areaOperativaId ?? undefined);

  const { data: zoneList } = useListZoneUds(
    effectiveAreaOperativa
      ? { areaOperativaId: effectiveAreaOperativa }
      : undefined,
    {
      query: {
        queryKey: ["zoneUds", "udsInt", effectiveAreaOperativa],
        enabled: effectiveAreaOperativa != null,
      },
    },
  );

  const personeParams = {
    ...(personSearch.trim() ? { search: personSearch.trim() } : {}),
    ...(isGlobal && effectiveAreaOperativa
      ? { areaOperativaId: effectiveAreaOperativa }
      : {}),
    ...(filterZona !== ALL_ZONE ? { zonaUdsId: parseInt(filterZona) } : {}),
  };
  const { data: persone } = useListUdsDirectory({
    ...personeParams,
    page: 1,
    limit: 100,
  });
  const personId = selectedPerson ? parseInt(selectedPerson) : undefined;

  const interventiParams = {
    beneficiarioId: personId,
    ambito: "uds" as const,
    includiStorici: true,
    ...(isGlobal && effectiveAreaOperativa
      ? { areaOperativaId: effectiveAreaOperativa }
      : {}),
    ...(bisogniFilter !== "tutti" ? { bisogni: bisogniFilter } : {}),
  };
  const { data: interventi, isLoading } = useListInterventi(interventiParams, {
    query: {
      queryKey: getListInterventiQueryKey(interventiParams),
      enabled: personId != null,
    },
  });

  const createIntervento = useCreateUdsIntervento();
  const updateNote = useUpdateUdsInterventoNota();
  const rectifyIntervento = useRectifyUdsIntervento();
  const { data: tipiIntervento } = useListTipiIntervento();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dataIntervento: todayEuropeRome(),
      tipoIntervento: "ascolto",
      descrizione: "",
      note: "",
      motivoRettifica: "",
      bisogniPianificati: [],
    },
  });
  const unsavedGuard = useUnsavedChangesGuard(
    isFormOpen && form.formState.isDirty,
  );
  const closeInterventoForm = () =>
    unsavedGuard.requestClose(() => setIsFormOpen(false));

  const selectedBenef = persone?.find((p) => p.id === personId);
  const selectedPersonData =
    selectedBenef ??
    (selectedPersonFallback?.id === personId
      ? selectedPersonFallback
      : undefined);

  // Built-in type keys are translated; admin-added custom names display as typed.
  const tipoLabel = (tipo: string) =>
    t(`tipiIntervento.opt.${tipo}`, { defaultValue: tipo.replace(/_/g, " ") });

  const defaultTipo =
    tipiIntervento?.find((tp) => tp.attivo && tp.nome === "ascolto")?.nome ??
    tipiIntervento?.find((tp) => tp.attivo)?.nome ??
    "ascolto";

  const handlePersonReady = (person: UdsPersonaSelection) => {
    if (isGlobal && person.areaOperativaId != null)
      setFilterAreaOperativa(String(person.areaOperativaId));
    setFilterZona(
      person.zonaUdsId != null ? String(person.zonaUdsId) : ALL_ZONE,
    );
    setPersonSearch("");
    setSelectedPersonFallback(person);
    setSelectedPerson(String(person.id));
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      dataIntervento: todayEuropeRome(),
      tipoIntervento: defaultTipo,
      descrizione: "",
      note: "",
      motivoRettifica: "",
      bisogniPianificati: [],
    });
    setIsFormOpen(true);
  };

  const handleEdit = (i: Intervento) => {
    setEditingId(i.id);
    form.reset({
      dataIntervento: i.dataIntervento?.slice(0, 10) ?? "",
      tipoIntervento: i.tipoIntervento,
      descrizione: i.descrizione ?? "",
      note: i.note ?? "",
      motivoRettifica: "",
      bisogniPianificati: [],
    });
    setIsFormOpen(true);
  };

  const invalidateList = () => {
    if (personId != null) {
      queryClient.invalidateQueries({
        queryKey: getListInterventiQueryKey(interventiParams),
      });
    }
  };

  const onSubmit = (data: FormValues) => {
    if (personId == null) return;
    const onError = (err: unknown) => {
      if (isConflict(err)) invalidateList();
      toast({
        title:
          editingId != null
            ? t("udsInterventi.editTitle")
            : t("udsInterventi.newTitle"),
        description: isConflict(err)
          ? t("udsInterventi.concurrencyConflict")
          : extractError(err, t("common.requiredField")),
        variant: "destructive",
      });
    };
    if (editingId != null) {
      const current = interventi?.find((item) => item.id === editingId);
      const motivo = data.motivoRettifica?.trim();
      if (!current?.dataAggiornamento || !motivo) {
        toast({
          title: t("udsInterventi.editTitle"),
          description: t("common.requiredField"),
          variant: "destructive",
        });
        return;
      }
      rectifyIntervento.mutate(
        {
          id: editingId,
          data: {
            versione: current.dataAggiornamento,
            motivo,
            dataIntervento: data.dataIntervento,
            tipoIntervento: data.tipoIntervento,
            descrizione: data.descrizione || null,
            note: data.note || null,
          },
        },
        {
          onSuccess: () => {
            invalidateList();
            toast({ title: t("udsInterventi.toastUpdated") });
            form.reset();
            setIsFormOpen(false);
          },
          onError,
        },
      );
    } else {
      createIntervento.mutate(
        {
          data: {
            beneficiarioId: personId,
            tipoIntervento: data.tipoIntervento,
            descrizione: data.descrizione || null,
            note: data.note || null,
            bisogniPianificati: data.bisogniPianificati.map((bisogno) => ({
              tipo: bisogno.tipo,
              descrizione: bisogno.descrizione.trim(),
              stato: bisogno.stato,
              dataPrevista: bisogno.dataPrevista || null,
              priorita: bisogno.priorita,
              note: bisogno.note.trim() || null,
            })),
          },
        },
        {
          onSuccess: () => {
            invalidateList();
            toast({ title: t("udsInterventi.toastCreated") });
            form.reset();
            setIsFormOpen(false);
          },
          onError,
        },
      );
    }
  };

  const saveNote = () => {
    if (!noteEditing) return;
    if (!noteEditing.dataAggiornamento) {
      toast({
        title: t("udsInterventi.noteDialogTitle"),
        description: t("common.requiredField"),
        variant: "destructive",
      });
      return;
    }
    updateNote.mutate(
      {
        id: noteEditing.id,
        data: {
          versione: noteEditing.dataAggiornamento,
          noteUds: noteText || null,
        },
      },
      {
        onSuccess: () => {
          invalidateList();
          toast({ title: t("udsInterventi.toastNoteSaved") });
          setNoteEditing(null);
        },
        onError: (err) => {
          if (isConflict(err)) invalidateList();
          toast({
            title: t("udsInterventi.noteDialogTitle"),
            description: isConflict(err)
              ? t("udsInterventi.concurrencyConflict")
              : extractError(err, t("common.requiredField")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const rows = interventi ?? [];
  const bisogniEditingIntervento =
    rows.find((item) => item.id === bisogniEditingId) ?? null;

  const exportColumns = useMemo(
    () => [
      {
        header: t("udsInterventi.colData"),
        accessor: (i: Intervento) => interventoDataLabel(i),
      },
      {
        header: t("udsInterventi.colTipo"),
        accessor: (i: Intervento) => tipoLabel(i.tipoIntervento),
      },
      {
        header: t("udsInterventi.colBisogni"),
        accessor: (i: Intervento) => i.descrizione ?? "",
      },
      {
        header: t("udsInterventi.colBisogniPianificati"),
        accessor: (i: Intervento) =>
          `${i.bisogniPianificatiTotale} / ${i.bisogniPianificatiAperti}`,
      },
      {
        header: t("udsInterventi.colMateriale"),
        accessor: (i: Intervento) => i.note ?? "",
      },
      {
        header: t("udsInterventi.colNote"),
        accessor: (i: Intervento) => i.noteUds ?? "",
      },
      {
        header: t("udsInterventi.colOperatore"),
        accessor: (i: Intervento) => i.operatoreCodice ?? "",
      },
    ],
    [t],
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("udsInterventi.title")}
          </h1>
          <p className="text-muted-foreground">{t("udsInterventi.subtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <ExportButtons
            rows={rows}
            columns={exportColumns}
            filename={`uds-interventi${selectedPersonData ? "-" + selectedPersonData.cognome : ""}`}
            title={`${t("udsInterventi.exportTitle")}${selectedPersonData ? " — " + personLabel(selectedPersonData) : ""}`}
            disabled={personId == null}
          />
          {hasPermission("uds.interventi.create") && (
            <Button
              onClick={handleCreate}
              className="min-h-11 w-full gap-2 sm:w-auto"
              disabled={personId == null}
            >
              <Plus className="h-4 w-4" /> {t("udsInterventi.newIntervento")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {isGlobal && (
            <div className="space-y-1">
              <span className="text-sm font-medium">
                {t("udsAnagrafica.filterAreaOperativa")}
              </span>
              <Select
                value={filterAreaOperativa || ALL_ZONE}
                onValueChange={(v) => {
                  setFilterAreaOperativa(v === ALL_ZONE ? "" : v);
                  setFilterZona(ALL_ZONE);
                  setSelectedPerson("");
                  setSelectedPersonFallback(null);
                  setPersonSearch("");
                }}
              >
                <SelectTrigger
                  className="w-[220px]"
                  aria-label={t("udsAnagrafica.filterAreaOperativa")}
                >
                  <SelectValue
                    placeholder={t("udsAnagrafica.allAreaOperativa")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>
                    {t("udsAnagrafica.allAreaOperativa")}
                  </SelectItem>
                  {areaOperativaList?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("udsAnagrafica.filterZona")}
            </span>
            <Select
              value={filterZona}
              onValueChange={(v) => {
                setFilterZona(v);
                setSelectedPerson("");
                setSelectedPersonFallback(null);
                setPersonSearch("");
              }}
            >
              <SelectTrigger
                className="w-[220px]"
                aria-label={t("udsAnagrafica.filterZona")}
              >
                <SelectValue placeholder={t("udsAnagrafica.allZone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ZONE}>
                  {t("udsAnagrafica.allZone")}
                </SelectItem>
                {zoneList?.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>
                    {z.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-[220px] flex-1">
            <span className="text-sm font-medium">
              {t("udsInterventi.selectPerson")}
            </span>
            <BeneficiarioCombobox
              items={persone ?? []}
              value={selectedPerson}
              onChange={(id) => {
                setSelectedPerson(id);
                setSelectedPersonFallback(null);
              }}
              placeholder={t("udsInterventi.selectPersonPlaceholder")}
              selectedLabelFallback={
                selectedPersonData ? personLabel(selectedPersonData) : null
              }
              searchValue={personSearch}
              onSearchChange={setPersonSearch}
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">
              {t("udsInterventi.bisogniFilterLabel")}
            </span>
            <Select
              value={bisogniFilter}
              onValueChange={(value: typeof bisogniFilter) =>
                setBisogniFilter(value)
              }
            >
              <SelectTrigger
                className="w-[220px]"
                aria-label={t("udsInterventi.bisogniFilterLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">
                  {t("udsInterventi.bisogniFilter.tutti")}
                </SelectItem>
                <SelectItem value="aperti">
                  {t("udsInterventi.bisogniFilter.aperti")}
                </SelectItem>
                <SelectItem value="scaduti">
                  {t("udsInterventi.bisogniFilter.scaduti")}
                </SelectItem>
                <SelectItem value="nessuno">
                  {t("udsInterventi.bisogniFilter.nessuno")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {canCreatePerson && (
            <div className="space-y-1">
              <span className="text-sm font-medium">&nbsp;</span>
              <Button
                type="button"
                onClick={() => setIsNewPersonOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> {t("udsAnagrafica.newPerson")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <UdsPersonaSheet
        open={isNewPersonOpen}
        onOpenChange={setIsNewPersonOpen}
        initialAreaOperativaId={effectiveAreaOperativa}
        initialZonaUdsId={
          filterZona !== ALL_ZONE
            ? parseInt(filterZona)
            : user?.zonaUdsId != null
              ? user.zonaUdsId
              : null
        }
        onPersonReady={handlePersonReady}
      />

      {personId == null ? (
        <Card>
          <CardContent className="h-40 flex items-center justify-center text-muted-foreground">
            {t("udsInterventi.noPersonSelected")}
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            data-testid="uds-interventi-mobile"
            className="space-y-3 lg:hidden"
          >
            {isLoading ? (
              Array(3)
                .fill(0)
                .map((_, index) => (
                  <Card key={index}>
                    <CardContent className="space-y-3 p-4">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-12 w-full" />
                    </CardContent>
                  </Card>
                ))
            ) : rows.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {t("udsInterventi.noIntervento")}
                </CardContent>
              </Card>
            ) : (
              rows.map((intervento) => (
                <Card
                  key={intervento.id}
                  data-testid="uds-intervento-mobile-card"
                  data-intervento-id={intervento.id}
                  className={
                    intervento.bisogniPianificatiScaduti > 0
                      ? "border-red-300 bg-red-50/60"
                      : intervento.noteUds
                        ? "border-amber-300 bg-amber-50/60"
                        : ""
                  }
                >
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {interventoDataLabel(intervento)}
                        </div>
                        <Badge
                          variant="outline"
                          className="mt-1 gap-1 border-none bg-amber-500/10 text-amber-700"
                        >
                          <HeartHandshake className="h-3.5 w-3.5" />
                          {tipoLabel(intervento.tipoIntervento)}
                        </Badge>
                      </div>
                      <InterventoStatoBadge stato={intervento.stato} />
                    </div>

                    <p className="line-clamp-3 whitespace-pre-wrap text-sm">
                      {intervento.descrizione ||
                        t("udsInterventi.noMeetingSummary")}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {intervento.bisogniPianificatiAperti > 0 && (
                        <Badge variant="secondary">
                          {t("udsInterventi.mobileOpenNeeds", {
                            count: intervento.bisogniPianificatiAperti,
                          })}
                        </Badge>
                      )}
                      {intervento.bisogniPianificatiScaduti > 0 && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {t("udsInterventi.mobileOverdueNeeds", {
                            count: intervento.bisogniPianificatiScaduti,
                          })}
                        </Badge>
                      )}
                      {intervento.noteUds && (
                        <Badge variant="outline" className="gap-1">
                          <StickyNote className="h-3.5 w-3.5" />
                          {t("udsInterventi.notePresent")}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {hasPermission("uds.bisogni.manage") && (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 gap-2"
                          onClick={() => setBisogniEditingId(intervento.id)}
                        >
                          <CalendarClock className="h-4 w-4" />
                          {t("udsInterventi.manageBisogniAction")}
                        </Button>
                      )}
                      {hasPermission("uds.interventi.note") && (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 gap-2"
                          onClick={() => {
                            setNoteEditing(intervento);
                            setNoteText(intervento.noteUds ?? "");
                          }}
                        >
                          <StickyNote className="h-4 w-4" />
                          {t("udsInterventi.mobileNoteAction")}
                        </Button>
                      )}
                      {hasPermission("uds.interventi.update") && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="col-span-2 min-h-11 gap-2"
                          onClick={() => handleEdit(intervento)}
                        >
                          <Pencil className="h-4 w-4" />
                          {t("udsInterventi.editAction")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Card
            data-testid="uds-interventi-desktop"
            className="hidden lg:block"
          >
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">
                      {t("udsInterventi.colData")}
                    </TableHead>
                    <TableHead>{t("udsInterventi.colTipo")}</TableHead>
                    <TableHead>{t("interventi.workflowState")}</TableHead>
                    <TableHead>{t("udsInterventi.colBisogni")}</TableHead>
                    <TableHead>
                      {t("udsInterventi.colBisogniPianificati")}
                    </TableHead>
                    <TableHead>{t("udsInterventi.colMateriale")}</TableHead>
                    <TableHead>{t("udsInterventi.colNote")}</TableHead>
                    <TableHead>{t("udsInterventi.colOperatore")}</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array(3)
                      .fill(0)
                      .map((_, i) => (
                        <TableRow key={i}>
                          {Array(9)
                            .fill(0)
                            .map((_, j) => (
                              <TableCell key={j}>
                                <Skeleton className="h-5 w-24" />
                              </TableCell>
                            ))}
                        </TableRow>
                      ))
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-32 text-center text-muted-foreground"
                      >
                        {t("udsInterventi.noIntervento")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((i) => (
                      <TableRow
                        key={i.id}
                        data-intervento-id={i.id}
                        className={
                          i.bisogniPianificatiScaduti > 0
                            ? "bg-red-50/70"
                            : i.noteUds
                              ? "bg-amber-50/60"
                              : ""
                        }
                      >
                        <TableCell className="text-sm">
                          {interventoDataLabel(i)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="gap-1 border-none bg-amber-500/10 text-amber-700"
                          >
                            <HeartHandshake className="h-3 w-3" />{" "}
                            {tipoLabel(i.tipoIntervento)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <InterventoStatoBadge stato={i.stato} />
                        </TableCell>
                        <TableCell className="text-sm max-w-xs whitespace-pre-wrap">
                          {i.descrizione || "-"}
                        </TableCell>
                        <TableCell className="text-sm min-w-[190px]">
                          {i.bisogniPianificatiTotale === 0 ? (
                            <span className="text-muted-foreground">
                              {t("udsInterventi.noBisogniPianificati")}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline">
                                  {t("udsInterventi.bisogniTotale", {
                                    count: i.bisogniPianificatiTotale,
                                  })}
                                </Badge>
                                <Badge
                                  variant={
                                    i.bisogniPianificatiAperti > 0
                                      ? "secondary"
                                      : "outline"
                                  }
                                >
                                  {t("udsInterventi.bisogniAperti", {
                                    count: i.bisogniPianificatiAperti,
                                  })}
                                </Badge>
                                {i.bisogniPianificatiScaduti > 0 && (
                                  <Badge
                                    variant="destructive"
                                    className="gap-1"
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                    {t("udsInterventi.bisogniScaduti", {
                                      count: i.bisogniPianificatiScaduti,
                                    })}
                                  </Badge>
                                )}
                              </div>
                              {i.bisogniPianificatiProssimaScadenza && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <CalendarClock className="h-3.5 w-3.5" />
                                  {t("udsInterventi.bisogniProssimaScadenza", {
                                    date: new Date(
                                      `${i.bisogniPianificatiProssimaScadenza}T12:00:00`,
                                    ).toLocaleDateString("it-IT"),
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-xs whitespace-pre-wrap">
                          {i.note || "-"}
                        </TableCell>
                        <TableCell className="text-sm max-w-xs">
                          {i.noteUds ? (
                            <div className="flex items-start gap-1 rounded-md bg-amber-100 px-2 py-1 text-amber-900 whitespace-pre-wrap">
                              <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>{i.noteUds}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {i.operatoreCodice || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {hasPermission("uds.bisogni.manage") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={() => setBisogniEditingId(i.id)}
                              >
                                <CalendarClock className="h-3.5 w-3.5" />
                                {t("udsInterventi.manageBisogniAction")}
                              </Button>
                            )}
                            {hasPermission("uds.interventi.note") && (
                              <Button
                                variant={i.noteUds ? "secondary" : "ghost"}
                                size="sm"
                                className={`gap-1 ${i.noteUds ? "bg-amber-100 text-amber-900 hover:bg-amber-200" : ""}`}
                                onClick={() => {
                                  setNoteEditing(i);
                                  setNoteText(i.noteUds ?? "");
                                }}
                              >
                                <StickyNote className="h-3.5 w-3.5" />
                                {i.noteUds
                                  ? t("udsInterventi.editNote")
                                  : t("udsInterventi.addNote")}
                              </Button>
                            )}
                            {hasPermission("uds.interventi.update") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={() => handleEdit(i)}
                                title={t("udsInterventi.editAction")}
                              >
                                <Pencil className="h-4 w-4" />
                                {t("udsInterventi.editAction")}
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
        </>
      )}

      <UdsBisogniDialog
        interventoId={bisogniEditingId}
        interventoVersione={bisogniEditingIntervento?.dataAggiornamento ?? null}
        open={bisogniEditingId != null}
        onOpenChange={(open) => {
          if (!open) setBisogniEditingId(null);
        }}
        onChanged={invalidateList}
      />

      <Sheet
        open={isFormOpen}
        onOpenChange={(open) => {
          if (open) setIsFormOpen(true);
          else closeInterventoForm();
        }}
      >
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editingId != null
                ? t("udsInterventi.editTitle")
                : t("udsInterventi.newTitle")}
            </SheetTitle>
            <SheetDescription>{t("udsInterventi.subtitle")}</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {editingId == null ? (
                    <div
                      data-testid="uds-new-intervento-today"
                      className="rounded-md border bg-muted/30 p-3"
                    >
                      <div className="text-sm font-medium">
                        {t("udsInterventi.fData")}
                      </div>
                      <div className="mt-1">
                        {t("udsInterventi.todayLabel", {
                          date: new Date(
                            `${todayEuropeRome()}T12:00:00`,
                          ).toLocaleDateString("it-IT"),
                        })}
                      </div>
                    </div>
                  ) : (
                    <FormField
                      control={form.control}
                      name="dataIntervento"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsInterventi.fData")}</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={form.control}
                    name="tipoIntervento"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsInterventi.fTipo")}</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {tipiIntervento
                              ?.filter(
                                (tp) =>
                                  tp.attivo ||
                                  (editingId != null &&
                                    tp.nome === field.value),
                              )
                              .map((tp) => (
                                <SelectItem key={tp.id} value={tp.nome}>
                                  {tipoLabel(tp.nome)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="descrizione"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsInterventi.fBisogni")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("udsInterventi.bisogniPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("udsInterventi.fMateriale")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("udsInterventi.materialePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {editingId != null && (
                  <FormField
                    control={form.control}
                    name="motivoRettifica"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Motivo della rettifica</FormLabel>
                        <FormControl>
                          <Textarea rows={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {editingId == null && hasPermission("uds.bisogni.manage") && (
                  <FormField
                    control={form.control}
                    name="bisogniPianificati"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <BisogniPianificatiEditor
                            value={field.value}
                            onChange={field.onChange}
                            disabled={createIntervento.isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="pt-6 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeInterventoForm}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    className="min-h-11 min-w-28"
                    disabled={
                      createIntervento.isPending || rectifyIntervento.isPending
                    }
                  >
                    {createIntervento.isPending || rectifyIntervento.isPending
                      ? t("udsInterventi.savingIntervention")
                      : t("common.save")}
                  </Button>{" "}
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog guard={unsavedGuard} />

      <Dialog
        open={noteEditing != null}
        onOpenChange={(o) => {
          if (!o) setNoteEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("udsInterventi.noteDialogTitle")}</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t("udsInterventi.notePlaceholder")}
            className="bg-amber-50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveNote} disabled={updateNote.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
