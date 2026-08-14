import { useMemo, useRef, useState } from "react";
import {
  useListBeneficiari,
  useListInterventi,
  useCreateIntervento,
  useUpdateIntervento,
  useListCitta,
  useListZoneUds,
  useListTipiIntervento,
  getListInterventiQueryKey,
  getListCittaQueryKey,
  listBisogniPianificati,
  type Beneficiario,
  type BisognoPianificato,
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { BeneficiarioCombobox } from "@/components/beneficiario-combobox";
import {
  UdsPersonaSheet,
  type UdsPersonaSelection,
} from "@/components/uds-persona-sheet";
import {
  BisogniPianificatiEditor,
  type BisognoPianificatoDraft,
} from "@/components/bisogni-pianificati-editor";
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

const ALL_ZONE = "__all__";

function makeSchema(t: (k: string) => string) {
  const bisognoSchema = z
    .object({
      clientKey: z.string(),
      id: z.number().int().positive().optional(),
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

function personLabel(b: {
  nome: string;
  cognome: string;
  soprannome?: string | null;
}): string {
  const base = `${b.cognome} ${b.nome}`;
  return b.soprannome ? `${base} (${b.soprannome})` : base;
}

function bisognoToDraft(bisogno: BisognoPianificato): BisognoPianificatoDraft {
  return {
    clientKey: `bisogno-${bisogno.id}`,
    id: bisogno.id,
    tipo: bisogno.tipo,
    descrizione: bisogno.descrizione,
    stato: bisogno.stato,
    dataPrevista: bisogno.dataPrevista ?? "",
    priorita: bisogno.priorita,
    note: bisogno.note ?? "",
    dataCompletamento: bisogno.dataCompletamento,
  };
}

export default function UdsInterventi() {
  const { t } = useTranslation();
  const { user, hasArea } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const schema = makeSchema(t);
  const canCreatePerson = hasArea("uds");

  const isGlobal = user?.cittaId == null;
  const [selectedPerson, setSelectedPerson] = useState<string>("");
  const [personSearch, setPersonSearch] = useState("");
  const [filterCitta, setFilterCitta] = useState<string>("");
  const [filterZona, setFilterZona] = useState<string>(
    user?.zonaUdsId != null ? String(user.zonaUdsId) : ALL_ZONE,
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isNewPersonOpen, setIsNewPersonOpen] = useState(false);
  const [selectedPersonFallback, setSelectedPersonFallback] = useState<UdsPersonaSelection | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteEditing, setNoteEditing] = useState<Intervento | null>(null);
  const [noteText, setNoteText] = useState("");
  const [bisogniFilter, setBisogniFilter] = useState<
    "tutti" | "aperti" | "scaduti" | "nessuno"
  >("tutti");
  const [isLoadingBisogni, setIsLoadingBisogni] = useState(false);
  const bisogniLoadRequest = useRef(0);

  const { data: cittaList } = useListCitta({ query: { queryKey: getListCittaQueryKey(), enabled: isGlobal } });

  const effectiveCitta = isGlobal
    ? filterCitta
      ? parseInt(filterCitta)
      : undefined
    : (user?.cittaId ?? undefined);

  const { data: zoneList } = useListZoneUds(
    effectiveCitta ? { cittaId: effectiveCitta } : undefined,
    { query: { queryKey: ["zoneUds", "udsInt", effectiveCitta], enabled: effectiveCitta != null } },
  );

  const personeParams = {
    uds: true,
    ...(personSearch.trim() ? { search: personSearch.trim() } : {}),
    ...(isGlobal && effectiveCitta ? { cittaId: effectiveCitta } : {}),
    ...(filterZona !== ALL_ZONE ? { zonaUdsId: parseInt(filterZona) } : {}),
  };
  const { data: persone } = useListBeneficiari(personeParams);
  const personId = selectedPerson ? parseInt(selectedPerson) : undefined;

  const interventiParams = {
    beneficiarioId: personId,
    ...(bisogniFilter !== "tutti" ? { bisogni: bisogniFilter } : {}),
  };
  const { data: interventi, isLoading } = useListInterventi(interventiParams, {
    query: {
      queryKey: getListInterventiQueryKey(interventiParams),
      enabled: personId != null,
    },
  });

  const createIntervento = useCreateIntervento();
  const updateIntervento = useUpdateIntervento();
  const { data: tipiIntervento } = useListTipiIntervento();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dataIntervento: new Date().toISOString().slice(0, 10),
      tipoIntervento: "ascolto",
      descrizione: "",
      note: "",
      bisogniPianificati: [],
    },
  });

  const selectedBenef = persone?.find((p) => p.id === personId);
  const selectedPersonData =
    selectedBenef ?? (selectedPersonFallback?.id === personId ? selectedPersonFallback : undefined);

  // Built-in type keys are translated; admin-added custom names display as typed.
  const tipoLabel = (tipo: string) => t(`tipiIntervento.opt.${tipo}`, { defaultValue: tipo.replace(/_/g, " ") });

  const defaultTipo =
    tipiIntervento?.find((tp) => tp.attivo && tp.nome === "ascolto")?.nome ??
    tipiIntervento?.find((tp) => tp.attivo)?.nome ??
    "ascolto";

  const handlePersonReady = (person: UdsPersonaSelection) => {
    if (isGlobal && person.cittaId != null) setFilterCitta(String(person.cittaId));
    setFilterZona(person.zonaUdsId != null ? String(person.zonaUdsId) : ALL_ZONE);
    setPersonSearch("");
    setSelectedPersonFallback(person);
    setSelectedPerson(String(person.id));
  };

  const handleCreate = () => {
    bisogniLoadRequest.current += 1;
    setIsLoadingBisogni(false);
    setEditingId(null);
    form.reset({
      dataIntervento: new Date().toISOString().slice(0, 10),
      tipoIntervento: defaultTipo,
      descrizione: "",
      note: "",
      bisogniPianificati: [],
    });
    setIsFormOpen(true);
  };

  const handleEdit = (i: Intervento) => {
    const requestId = ++bisogniLoadRequest.current;
    setEditingId(i.id);
    form.reset({
      dataIntervento: i.dataIntervento.slice(0, 10),
      tipoIntervento: i.tipoIntervento,
      descrizione: i.descrizione ?? "",
      note: i.note ?? "",
      bisogniPianificati: [],
    });
    setIsFormOpen(true);
    setIsLoadingBisogni(true);
    void listBisogniPianificati(i.id)
      .then((bisogni) => {
        if (requestId !== bisogniLoadRequest.current) return;
        form.setValue("bisogniPianificati", bisogni.map(bisognoToDraft), {
          shouldDirty: false,
        });
      })
      .catch((err) => {
        if (requestId !== bisogniLoadRequest.current) return;
        toast({
          title: t("udsInterventi.bisogniPianificatiTitle"),
          description: extractError(err, t("udsInterventi.bisogniLoadError")),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (requestId === bisogniLoadRequest.current)
          setIsLoadingBisogni(false);
      });
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
    const payload = {
      beneficiarioId: personId,
      dataIntervento: data.dataIntervento,
      tipoIntervento: data.tipoIntervento,
      descrizione: data.descrizione || undefined,
      note: data.note || undefined,
      bisogniPianificati: data.bisogniPianificati.map((bisogno) => ({
        ...(bisogno.id != null ? { id: bisogno.id } : {}),
        tipo: bisogno.tipo,
        descrizione: bisogno.descrizione.trim(),
        stato: bisogno.stato,
        dataPrevista: bisogno.dataPrevista || null,
        priorita: bisogno.priorita,
        note: bisogno.note.trim() || null,
      })),
    };
    const onError = (err: unknown) => {
      toast({
        title: editingId != null ? t("udsInterventi.editTitle") : t("udsInterventi.newTitle"),
        description: extractError(err, t("common.requiredField")),
        variant: "destructive",
      });
    };
    if (editingId != null) {
      updateIntervento.mutate(
        { id: editingId, data: payload as never },
        {
          onSuccess: () => {
            invalidateList();
            toast({ title: t("udsInterventi.toastUpdated") });
            setIsFormOpen(false);
          },
          onError,
        },
      );
    } else {
      createIntervento.mutate(
        { data: payload as never },
        {
          onSuccess: () => {
            invalidateList();
            toast({ title: t("udsInterventi.toastCreated") });
            setIsFormOpen(false);
          },
          onError,
        },
      );
    }
  };

  const saveNote = () => {
    if (!noteEditing) return;
    updateIntervento.mutate(
      { id: noteEditing.id, data: { noteUds: noteText } as never },
      {
        onSuccess: () => {
          invalidateList();
          toast({ title: t("udsInterventi.toastNoteSaved") });
          setNoteEditing(null);
        },
        onError: (err) => {
          toast({
            title: t("udsInterventi.noteDialogTitle"),
            description: extractError(err, t("common.requiredField")),
            variant: "destructive",
          });
        },
      },
    );
  };

  const rows = interventi ?? [];

  const exportColumns = useMemo(
    () => [
      {
        header: t("udsInterventi.colData"),
        accessor: (i: Intervento) => i.dataIntervento,
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
          <h1 className="text-3xl font-bold tracking-tight">{t("udsInterventi.title")}</h1>
          <p className="text-muted-foreground">{t("udsInterventi.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={rows}
            columns={exportColumns}
            filename={`uds-interventi${selectedPersonData ? "-" + selectedPersonData.cognome : ""}`}
            title={`${t("udsInterventi.exportTitle")}${selectedPersonData ? " — " + personLabel(selectedPersonData) : ""}`}
            disabled={personId == null}
          />
          <Button onClick={handleCreate} className="gap-2" disabled={personId == null}>
            <Plus className="h-4 w-4" /> {t("udsInterventi.newIntervento")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {isGlobal && (
            <div className="space-y-1">
              <span className="text-sm font-medium">{t("udsAnagrafica.filterCitta")}</span>
              <Select
                value={filterCitta || ALL_ZONE}
                onValueChange={(v) => {
                  setFilterCitta(v === ALL_ZONE ? "" : v);
                  setFilterZona(ALL_ZONE);
                  setSelectedPerson("");
                  setSelectedPersonFallback(null);
                  setPersonSearch("");
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("udsAnagrafica.allCitta")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allCitta")}</SelectItem>
                  {cittaList?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium">{t("udsAnagrafica.filterZona")}</span>
            <Select value={filterZona} onValueChange={(v) => { setFilterZona(v); setSelectedPerson(""); setSelectedPersonFallback(null); setPersonSearch(""); }}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("udsAnagrafica.allZone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ZONE}>{t("udsAnagrafica.allZone")}</SelectItem>
                {zoneList?.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-[220px] flex-1">
            <span className="text-sm font-medium">{t("udsInterventi.selectPerson")}</span>
            <BeneficiarioCombobox
              items={persone ?? []}
              value={selectedPerson}
              onChange={(id) => {
                setSelectedPerson(id);
                setSelectedPersonFallback(null);
              }}
              placeholder={t("udsInterventi.selectPersonPlaceholder")}
              selectedLabelFallback={selectedPersonData ? personLabel(selectedPersonData) : null}
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
              <SelectTrigger className="w-[220px]">
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
              <Button type="button" onClick={() => setIsNewPersonOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> {t("udsAnagrafica.newPerson")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <UdsPersonaSheet
        open={isNewPersonOpen}
        onOpenChange={setIsNewPersonOpen}
        initialCittaId={effectiveCitta}
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
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">{t("udsInterventi.colData")}</TableHead>
                  <TableHead>{t("udsInterventi.colTipo")}</TableHead>
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
                        {Array(8)
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
                      colSpan={8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {t("udsInterventi.noIntervento")}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((i) => (
                    <TableRow
                      key={i.id}
                      className={
                        i.bisogniPianificatiScaduti > 0
                          ? "bg-red-50/70"
                          : i.noteUds
                            ? "bg-amber-50/60"
                            : ""
                      }
                    >
                      <TableCell className="text-sm">
                        {i.dataIntervento}
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
                                <Badge variant="destructive" className="gap-1">
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(i)}
                            title={t("udsInterventi.editAction")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
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
                <FormField control={form.control} name="descrizione" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("udsInterventi.fBisogni")}</FormLabel>
                    <FormControl><Textarea rows={3} placeholder={t("udsInterventi.bisogniPlaceholder")} {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("udsInterventi.fMateriale")}</FormLabel>
                    <FormControl><Textarea rows={3} placeholder={t("udsInterventi.materialePlaceholder")} {...field} /></FormControl>
                  </FormItem>
                )} />

                {isLoadingBisogni ? (
                  <div className="space-y-3 border-t pt-5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="bisogniPianificati"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <BisogniPianificatiEditor
                            value={field.value}
                            onChange={field.onChange}
                            disabled={
                              createIntervento.isPending ||
                              updateIntervento.isPending
                            }
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
                    onClick={() => setIsFormOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      isLoadingBisogni ||
                      createIntervento.isPending ||
                      updateIntervento.isPending
                    }
                  >
                    {t("common.save")}
                  </Button>                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={noteEditing != null} onOpenChange={(o) => { if (!o) setNoteEditing(null); }}>
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
            <Button variant="outline" onClick={() => setNoteEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={saveNote} disabled={updateIntervento.isPending}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
