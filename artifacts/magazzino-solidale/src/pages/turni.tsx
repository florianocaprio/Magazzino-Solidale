import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTurni,
  getListTurniQueryKey,
  useUpsertTurno,
  useCreateTurnoVolontarioPending,
  useCreateTurnoMezzoPending,
  useListCentriAscolto,
  useListVolontari,
  getListVolontariQueryKey,
  useListMezzi,
  getListMezziQueryKey,
  useListRuoliVolontari,
  useGetVolontariCarico,
  getGetVolontariCaricoQueryKey,
  type Volontario,
  type Mezzo,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { volontarioLabel } from "@/lib/volontari-label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExportButtons } from "@/components/export-buttons";
import { ChevronLeft, ChevronRight, Plus, Trash2, Truck, Users } from "lucide-react";

const FASCE = [
  { key: "09-13", labelKey: "fasciaMattina", time: "09:00–13:00" },
  { key: "14-18", labelKey: "fasciaPomeriggio", time: "14:00–18:00" },
  { key: "18-20", labelKey: "fasciaSera", time: "18:00–20:00" },
] as const;

function mezzoScadutoAllaData(
  mezzo: Pick<Mezzo, "scadenzaAssicurazione" | "scadenzaRevisione">,
  data: string,
): boolean {
  return Boolean(
    (mezzo.scadenzaAssicurazione != null && mezzo.scadenzaAssicurazione.slice(0, 10) < data) ||
    (mezzo.scadenzaRevisione != null && mezzo.scadenzaRevisione.slice(0, 10) < data),
  );
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = (r.getDay() + 6) % 7; // 0 = Monday
  r.setDate(r.getDate() - dow);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

type VolRow = { volontarioId: number | ""; ruolo: string };

export default function Turni() {
  const { t, i18n } = useTranslation();
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isScoped = user?.centroAscoltoId != null;
  const canManage = hasPermission("logistica.turni.manage");
  const canManageVolontari = hasPermission("logistica.volontari.manage");
  const canManageMezzi = hasPermission("logistica.mezzi.manage");
  const [selectedCentro, setSelectedCentro] = useState<number | null>(
    user?.centroAscoltoId ?? null,
  );
  const [pendingVolontari, setPendingVolontari] = useState<Volontario[]>([]);
  const [pendingMezzi, setPendingMezzi] = useState<Mezzo[]>([]);
  const [volontarioDialogOpen, setVolontarioDialogOpen] = useState(false);
  const [mezzoDialogOpen, setMezzoDialogOpen] = useState(false);
  const [nuovoVolontario, setNuovoVolontario] = useState({
    nome: "",
    cognome: "",
    ruoloVolontarioId: null as number | null,
    telefono: "",
    patente: false,
    note: "",
  });
  const [volontarioError, setVolontarioError] = useState<string | null>(null);
  const [nuovoMezzo, setNuovoMezzo] = useState({
    tipo: "",
    targa: "",
    proprieta: "associazione",
    descrizione: "",
    note: "",
  });
  const effectiveCentro = isScoped ? user!.centroAscoltoId! : selectedCentro;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const da = toISODate(days[0]);
  const a = toISODate(days[6]);

  const { data: centri } = useListCentriAscolto();
  const { data: ruoliVolontari } = useListRuoliVolontari();
  const { data: volontari } = useListVolontari();
  const volontariCentro = useMemo(
    () =>
      (volontari ?? []).filter((v, idx, all) => {
        if (all.findIndex((x) => x.id === v.id) !== idx) return false;
        const centroOk =
          v.centroAscoltoId == null ||
          effectiveCentro == null ||
          v.centroAscoltoId === effectiveCentro;
        const approved = (v.statoApprovazione ?? "approvato") === "approvato";
        return centroOk && approved;
      }),
    [volontari, effectiveCentro],
  );

  const { data: mezzi } = useListMezzi();
  const mezziCentro = useMemo(
    () =>
      (mezzi ?? []).filter((m, idx, all) => {
        if (all.findIndex((x) => x.id === m.id) !== idx) return false;
        const centroOk =
          m.effectiveCentroId == null ||
          effectiveCentro == null ||
          m.effectiveCentroId === effectiveCentro;
        const approved =
          (m.statoApprovazione ?? "approvato") === "approvato" &&
          m.stato === "disponibile";
        return centroOk && approved;
      }),
    [mezzi, effectiveCentro],
  );

  const { data: turni } = useListTurni(
    { da, a, ...(effectiveCentro != null ? { centroAscoltoId: effectiveCentro } : {}) },
    { query: { enabled: effectiveCentro != null, queryKey: getListTurniQueryKey({ da, a, centroAscoltoId: effectiveCentro ?? undefined }) } },
  );

  // All turni visible to the caller for this week (no centro filter) — used for the
  // allocation views and the cross-centro mezzo conflict detection. For a centro-scoped
  // caller the server still limits this to their own centro.
  const { data: allTurni } = useListTurni(
    { da, a },
    { query: { queryKey: getListTurniQueryKey({ da, a }) } },
  );

  const turnoMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof turni>[number]>();
    for (const turno of turni ?? []) m.set(`${turno.data}|${turno.fascia}`, turno);
    return m;
  }, [turni]);

  // key `data|fascia` → set of mezzoId already booked by ANOTHER centro in that slot.
  const bookedElsewhere = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const turno of allTurni ?? []) {
      if (turno.stato === "annullato") continue;
      if (turno.mezzoId == null) continue;
      if (turno.centroAscoltoId === effectiveCentro) continue;
      const k = `${turno.data}|${turno.fascia}`;
      const s = m.get(k) ?? new Set<number>();
      s.add(turno.mezzoId);
      m.set(k, s);
    }
    return m;
  }, [allTurni, effectiveCentro]);

  const upsert = useUpsertTurno();
  const createPendingVolontario = useCreateTurnoVolontarioPending();
  const createPendingMezzo = useCreateTurnoMezzoPending();

  const apiErrorMessage = (e: unknown) =>
    (e as { data?: { error?: string } })?.data?.error ??
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    t("turni.error");

  const [dialog, setDialog] = useState<{ data: string; fascia: string } | null>(null);
  const [rows, setRows] = useState<VolRow[]>([]);
  const [mezzoId, setMezzoId] = useState<number | null>(null);
  const caricoParams = {
    data: dialog?.data ?? "",
    fascia: (dialog?.fascia ?? "09-13") as "09-13" | "14-18" | "18-20",
  };
  const { data: caricoTurno } = useGetVolontariCarico(caricoParams, {
    query: {
      enabled: dialog != null,
      queryKey: getGetVolontariCaricoQueryKey(caricoParams),
    },
  });
  const volontariOperativiParams = {
    dataRiferimento: dialog?.data ?? da,
    stato: "attivi" as const,
  };
  const { data: volontariOperativiDialog } = useListVolontari(
    volontariOperativiParams,
    {
      query: {
        enabled: dialog != null,
        queryKey: getListVolontariQueryKey(volontariOperativiParams),
      },
    },
  );
  const volontariOperativiIds = useMemo(
    () =>
      new Set(
        (volontariOperativiDialog ?? [])
          .filter((volontario) => volontario.operativo)
          .map((volontario) => volontario.id),
      ),
    [volontariOperativiDialog],
  );
  const caricoMap = useMemo(
    () => new Map((caricoTurno ?? []).map((item) => [item.volontarioId, item.count])),
    [caricoTurno],
  );

  const bookedVolontari = useMemo(() => {
    if (!dialog) return new Set<number>();
    const result = new Set<number>();
    for (const turno of allTurni ?? []) {
      if (turno.stato === "annullato") continue;
      if (turno.data !== dialog.data || turno.fascia !== dialog.fascia) continue;
      if (turno.centroAscoltoId === effectiveCentro) continue;
      for (const volontario of turno.volontari) result.add(volontario.volontarioId);
    }
    return result;
  }, [allTurni, dialog, effectiveCentro]);

  // Mezzi selectable for the open cell: hide those already booked by another centro
  // in this exact data+fascia, but always keep the currently selected mezzo visible.
  const mezziDisponibili = useMemo(() => {
    if (!dialog) return mezziCentro;
    const booked = bookedElsewhere.get(`${dialog.data}|${dialog.fascia}`);
    const operationalDate = dialog.data;
    return mezziCentro.filter((m) => {
      const bookedElsewhere = booked?.has(m.id) && m.id !== mezzoId;
      const expired = mezzoScadutoAllaData(m, operationalDate);
      return !bookedElsewhere && (!expired || m.id === mezzoId);
    });
  }, [mezziCentro, bookedElsewhere, dialog, mezzoId]);

  const volontariDisponibili = useMemo(
    () => volontariCentro.filter((v) => {
      const atLimit = v.maxConsegneTurno > 0 && (caricoMap.get(v.id) ?? 0) >= v.maxConsegneTurno;
      return volontariOperativiIds.has(v.id) && !bookedVolontari.has(v.id) && !atLimit;
    }),
    [bookedVolontari, caricoMap, volontariCentro, volontariOperativiIds],
  );

  function openCell(dataISO: string, fascia: string) {
    if (effectiveCentro == null) return;
    const existing = turnoMap.get(`${dataISO}|${fascia}`);
    setRows(
      existing && existing.volontari.length
        ? existing.volontari.map((v) => ({ volontarioId: v.volontarioId, ruolo: v.ruolo ?? "" }))
        : [{ volontarioId: "", ruolo: "" }],
    );
    setMezzoId(existing?.mezzoId ?? null);
    setDialog({ data: dataISO, fascia });
  }

  function save() {
    if (!dialog || effectiveCentro == null) return;
    const volontari = rows
      .filter((r) => r.volontarioId !== "")
      .map((r) => ({ volontarioId: Number(r.volontarioId), ruolo: r.ruolo.trim() || undefined }));
    const existing = turnoMap.get(`${dialog.data}|${dialog.fascia}`);
    upsert.mutate(
      { data: { centroAscoltoId: effectiveCentro, data: dialog.data, fascia: dialog.fascia as "09-13" | "14-18" | "18-20", mezzoId, volontari, ...(existing ? { versione: existing.versione } : {}) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTurniQueryKey() });
          toast({ description: t("turni.saved") });
          setDialog(null);
        },
        onError: (err: unknown) => {
          const error = err as { status?: number; response?: { status?: number } };
          const status = error.status ?? error.response?.status;
          if (status === 409) queryClient.invalidateQueries({ queryKey: getListTurniQueryKey() });
          toast({
            variant: "destructive",
            description: status === 409
              ? t("turni.stale", { defaultValue: "La pianificazione è stata aggiornata da un altro operatore. Ricarica i dati prima di salvare." })
              : apiErrorMessage(err),
          });
        },
      },
    );
  }

  function creaVolontarioPending() {
    if (effectiveCentro == null || nuovoVolontario.ruoloVolontarioId == null || !nuovoVolontario.nome.trim() || !nuovoVolontario.cognome.trim()) {
      return;
    }
    setVolontarioError(null);
    createPendingVolontario.mutate(
      {
        data: {
          centroAscoltoId: effectiveCentro,
          nome: nuovoVolontario.nome.trim(),
          cognome: nuovoVolontario.cognome.trim(),
          ruoloVolontarioId: nuovoVolontario.ruoloVolontarioId,
          telefono: nuovoVolontario.telefono.trim() || undefined,
          patente: nuovoVolontario.patente,
          note: nuovoVolontario.note.trim() || undefined,
        },
      },
      {
        onSuccess: (created) => {
          setPendingVolontari((prev) => [created, ...prev.filter((v) => v.id !== created.id)]);
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ description: t("turni.pendingVolCreated", { defaultValue: "Volontario inserito in attesa di approvazione" }) });
          setNuovoVolontario({ nome: "", cognome: "", ruoloVolontarioId: null, telefono: "", patente: false, note: "" });
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
  }

  function creaMezzoPending() {
    if (effectiveCentro == null || !nuovoMezzo.tipo.trim()) return;
    createPendingMezzo.mutate(
      {
        data: {
          centroAscoltoId: effectiveCentro,
          tipo: nuovoMezzo.tipo.trim(),
          targa: nuovoMezzo.targa.trim() || undefined,
          proprieta: nuovoMezzo.proprieta || "associazione",
          descrizione: nuovoMezzo.descrizione.trim() || undefined,
          note: nuovoMezzo.note.trim() || undefined,
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
  }

  const fasciaLabel = (key: string) => {
    const f = FASCE.find((x) => x.key === key);
    return f ? `${t(`turni.${f.labelKey}`)} (${f.time})` : key;
  };

  const fasciaShort = (key: string) => {
    const f = FASCE.find((x) => x.key === key);
    return f ? t(`turni.${f.labelKey}`) : key;
  };

  const isNonApprovato = (stato?: string | null) => stato != null && stato !== "approvato";
  const statoApprovazioneLabel = (stato?: string | null) => {
    if (stato === "in_attesa") return t("turni.pendingLabel", { defaultValue: "in attesa approvazione" });
    if (stato === "respinto") return t("turni.rejectedLabel", { defaultValue: "respinto" });
    return null;
  };

  // Allocazione mezzi: per mezzo, le fasce/centri usati in ciascun giorno della settimana.
  const mezziAlloc = useMemo(() => {
    const map = new Map<
      number,
      { codice: string; tipo: string | null; byDay: Map<string, { fascia: string; centroNome: string | null }[]> }
    >();
    for (const turno of allTurni ?? []) {
      if (turno.stato === "annullato") continue;
      if (turno.mezzoId == null) continue;
      let m = map.get(turno.mezzoId);
      if (!m) {
        m = { codice: turno.mezzoCodice ?? `#${turno.mezzoId}`, tipo: turno.mezzoTipo ?? null, byDay: new Map() };
        map.set(turno.mezzoId, m);
      }
      const arr = m.byDay.get(turno.data) ?? [];
      arr.push({ fascia: turno.fascia, centroNome: turno.centroAscoltoNome ?? null });
      m.byDay.set(turno.data, arr);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((x, y) => x.codice.localeCompare(y.codice));
  }, [allTurni]);

  // Allocazione volontari per centro: turni, assegnazioni totali e volontari distinti.
  const volPerCentro = useMemo(() => {
    const map = new Map<
      number,
      { centroNome: string; turni: number; assegnazioni: number; distinti: Set<number> }
    >();
    for (const turno of allTurni ?? []) {
      if (turno.stato === "annullato") continue;
      let c = map.get(turno.centroAscoltoId);
      if (!c) {
        c = { centroNome: turno.centroAscoltoNome ?? `#${turno.centroAscoltoId}`, turni: 0, assegnazioni: 0, distinti: new Set() };
        map.set(turno.centroAscoltoId, c);
      }
      c.turni += 1;
      for (const v of turno.volontari) {
        c.assegnazioni += 1;
        c.distinti.add(v.volontarioId);
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ centroId: id, centroNome: v.centroNome, turni: v.turni, assegnazioni: v.assegnazioni, distinti: v.distinti.size }))
      .sort((x, y) => x.centroNome.localeCompare(y.centroNome));
  }, [allTurni]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("turni.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("turni.subtitle")}</p>
        </div>
        {!isScoped && (
          <div className="w-64">
            <Label className="text-xs">{t("turni.centro")}</Label>
            <Select
              value={selectedCentro != null ? String(selectedCentro) : ""}
              onValueChange={(v) => setSelectedCentro(v ? Number(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("turni.centroPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(centri ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label={t("turni.prevWeek")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => setWeekStart(startOfWeekMonday(new Date()))}>
          {t("turni.today")}
        </Button>
        <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label={t("turni.nextWeek")}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground ms-2 text-sm">
          {days[0].toLocaleDateString(i18n.language, { day: "numeric", month: "short" })} –{" "}
          {days[6].toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <Tabs defaultValue="pianificazione">
        <TabsList>
          <TabsTrigger value="pianificazione">{t("turni.tabPianificazione")}</TabsTrigger>
          <TabsTrigger value="allocazione">{t("turni.tabAllocazione")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pianificazione" className="mt-4">
          {effectiveCentro == null ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-sm">
                {t("turni.selectCentroFirst")}
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[900px] grid-cols-[140px_repeat(7,1fr)] gap-px rounded-lg border bg-border">
                <div className="bg-muted p-2" />
                {days.map((d) => {
                  const isToday = toISODate(d) === toISODate(new Date());
                  return (
                    <div key={d.toISOString()} className={`bg-muted p-2 text-center text-xs font-medium ${isToday ? "text-primary" : ""}`}>
                      {d.toLocaleDateString(i18n.language, { weekday: "short" })}
                      <div className="text-sm">{d.getDate()}</div>
                    </div>
                  );
                })}

                {FASCE.map((f) => (
                  <div key={f.key} className="contents">
                    <div className="bg-background p-2 text-xs">
                      <div className="font-medium">{t(`turni.${f.labelKey}`)}</div>
                      <div className="text-muted-foreground">{f.time}</div>
                    </div>
                    {days.map((d) => {
                      const iso = toISODate(d);
                      const turno = turnoMap.get(`${iso}|${f.key}`);
                      return (
                        <button
                          key={`${iso}|${f.key}`}
                          onClick={() => openCell(iso, f.key)}
                          disabled={!canManage || turno?.stato === "completato"}
                          className="bg-background hover:bg-accent min-h-[72px] p-1.5 text-left align-top transition-colors disabled:cursor-default disabled:hover:bg-background"
                        >
                          {turno && <div className="mb-1 text-[9px] uppercase tracking-wide text-muted-foreground">{turno.stato}</div>}
                          {turno && (turno.volontari.length || turno.mezzoCodice) ? (
                            <div className="space-y-1">
                              {turno.volontari.map((v) => (
                                <div
                                  key={v.volontarioId}
                                  className={
                                    isNonApprovato(v.volontarioStatoApprovazione)
                                      ? "rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground"
                                      : "bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[11px] leading-tight"
                                  }
                                >
                                  <div className="truncate font-medium">{v.volontarioNome ?? `#${v.volontarioId}`}</div>
                                  {v.ruolo && <div className="truncate opacity-80">{v.ruolo}</div>}
                                  {statoApprovazioneLabel(v.volontarioStatoApprovazione) && (
                                    <div className="truncate text-[10px] uppercase tracking-wide">
                                      {statoApprovazioneLabel(v.volontarioStatoApprovazione)}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {turno.mezzoCodice && (
                                <div
                                  className={
                                    isNonApprovato(turno.mezzoStatoApprovazione)
                                      ? "flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground"
                                      : "flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] leading-tight text-amber-700 dark:text-amber-400"
                                  }
                                >
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span className="truncate font-medium">
                                    {turno.mezzoCodice}
                                    {statoApprovazioneLabel(turno.mezzoStatoApprovazione)
                                      ? ` · ${statoApprovazioneLabel(turno.mezzoStatoApprovazione)}`
                                      : ""}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                              <Plus className="h-3 w-3" /> {t("turni.emptySlot")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="allocazione" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" /> {t("turni.allocMezziTitle")}
              </CardTitle>
              <CardDescription>{t("turni.allocMezziDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {mezziAlloc.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">{t("turni.nessunMezzoAllocato")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid min-w-[900px] grid-cols-[160px_repeat(7,1fr)] gap-px rounded-lg border bg-border">
                    <div className="bg-muted p-2 text-xs font-medium">{t("turni.colMezzo")}</div>
                    {days.map((d) => {
                      const isToday = toISODate(d) === toISODate(new Date());
                      return (
                        <div key={d.toISOString()} className={`bg-muted p-2 text-center text-xs font-medium ${isToday ? "text-primary" : ""}`}>
                          {d.toLocaleDateString(i18n.language, { weekday: "short" })}
                          <div className="text-sm">{d.getDate()}</div>
                        </div>
                      );
                    })}
                    {mezziAlloc.map((m) => (
                      <div key={m.id} className="contents">
                        <div className="bg-background p-2 text-xs">
                          <div className="font-medium">{m.codice}</div>
                          {m.tipo && <div className="text-muted-foreground">{m.tipo}</div>}
                        </div>
                        {days.map((d) => {
                          const iso = toISODate(d);
                          const entries = (m.byDay.get(iso) ?? []).slice().sort((x, y) => x.fascia.localeCompare(y.fascia));
                          return (
                            <div key={`${m.id}|${iso}`} className="bg-background min-h-[56px] p-1.5">
                              <div className="space-y-1">
                                {entries.map((e, i) => (
                                  <div key={i} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] leading-tight text-amber-700 dark:text-amber-400">
                                    <div className="font-medium">{fasciaShort(e.fascia)}</div>
                                    {e.centroNome && <div className="truncate opacity-80">{e.centroNome}</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" /> {t("turni.allocVolontariTitle")}
                </CardTitle>
                <CardDescription>{t("turni.allocVolontariDesc")}</CardDescription>
              </div>
              <ExportButtons
                rows={volPerCentro}
                columns={[
                  { header: t("turni.colCentro"), accessor: (r) => r.centroNome },
                  { header: t("turni.colTurni"), accessor: (r) => r.turni },
                  { header: t("turni.colAssegnazioni"), accessor: (r) => r.assegnazioni },
                  { header: t("turni.colVolontariDistinti"), accessor: (r) => r.distinti },
                ]}
                filename={`volontari_per_centro_${da}_${a}`}
                title={t("turni.allocVolontariTitle")}
                subtitle={`${da} – ${a}`}
              />
            </CardHeader>
            <CardContent>
              {volPerCentro.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">{t("turni.nessunaAllocazione")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("turni.colCentro")}</TableHead>
                      <TableHead className="text-right">{t("turni.colTurni")}</TableHead>
                      <TableHead className="text-right">{t("turni.colAssegnazioni")}</TableHead>
                      <TableHead className="text-right">{t("turni.colVolontariDistinti")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {volPerCentro.map((r) => (
                      <TableRow key={r.centroId}>
                        <TableCell className="font-medium">{r.centroNome}</TableCell>
                        <TableCell className="text-right">{r.turni}</TableCell>
                        <TableCell className="text-right">{r.assegnazioni}</TableCell>
                        <TableCell className="text-right">{r.distinti}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialog != null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("turni.addTitle", { fascia: dialog ? fasciaLabel(dialog.fascia) : "" })}</DialogTitle>
            <DialogDescription>
              {dialog
                ? new Date(`${dialog.data}T00:00:00`).toLocaleDateString(i18n.language, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {rows.length === 0 && (
              <p className="text-muted-foreground text-sm">{t("turni.noVolontari")}</p>
            )}
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">{t("turni.volontario")}</Label>
                  <Select
                    value={row.volontarioId !== "" ? String(row.volontarioId) : ""}
                    onValueChange={(v) =>
                      setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, volontarioId: v ? Number(v) : "" } : r)))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("turni.volontarioPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {volontariCentro.filter((v) => volontariDisponibili.some((available) => available.id === v.id) || v.id === row.volontarioId).map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {volontarioLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.volontarioId !== "" && !volontariOperativiIds.has(Number(row.volontarioId)) && (
                    <p className="mt-1 text-xs text-destructive">
                      Assegnazione esistente non più operativa per questa data; scegli un volontario idoneo prima di salvare.
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  <Label className="text-xs">{t("turni.ruolo")}</Label>
                  <Input
                    value={row.ruolo}
                    placeholder={t("turni.ruoloPlaceholder")}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ruolo: e.target.value } : r)))
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                  aria-label={t("turni.remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs, { volontarioId: "", ruolo: "" }])}
              >
                <Plus className="me-1 h-4 w-4" /> {t("turni.addVolontario")}
              </Button>
              {canManageVolontari && <Button
                variant="outline"
                size="sm"
                onClick={() => setVolontarioDialogOpen(true)}
                disabled={effectiveCentro == null}
              >
                <Plus className="me-1 h-4 w-4" /> {t("turni.addVolontarioNonCensito", { defaultValue: "Nuovo Volontario" })}
              </Button>}
            </div>
            {pendingVolontari.length > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                {pendingVolontari.map(volontarioLabel).join(", ")} · {t("turni.pendingNotSelectable", { defaultValue: "In attesa di approvazione, non selezionabile" })}
              </p>
            )}

            <div className="border-t pt-3">
              <Label className="text-xs">{t("turni.mezzo")}</Label>
              <Select
                value={mezzoId != null ? String(mezzoId) : "none"}
                onValueChange={(v) => setMezzoId(v === "none" ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("turni.mezzoPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("turni.nessunMezzo")}</SelectItem>
                  {mezziDisponibili.map((m) => {
                    const scaduto = dialog != null && mezzoScadutoAllaData(m, dialog.data);
                    return <SelectItem key={m.id} value={String(m.id)} disabled={scaduto}>
                      {m.codice}
                      {m.tipo ? ` · ${m.tipo}` : ""}
                      {scaduto ? " · Scaduto" : ""}
                    </SelectItem>;
                  })}
                </SelectContent>
              </Select>
              {canManageMezzi && <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setMezzoDialogOpen(true)}
                disabled={effectiveCentro == null}
              >
                <Plus className="me-1 h-4 w-4" /> {t("turni.addMezzoNonCensito", { defaultValue: "Nuovo Mezzo" })}
              </Button>}
              {pendingMezzi.length > 0 && (
                <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
                  {pendingMezzi.map((m) => m.codice).join(", ")} · {t("turni.pendingNotSelectable", { defaultValue: "In attesa di approvazione, non selezionabile" })}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("turni.cancel")}
            </Button>
            <Button onClick={save} disabled={upsert.isPending || !canManage}>
              {t("turni.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("common.name")}</Label>
              <Input
                value={nuovoVolontario.nome}
                onChange={(e) => setNuovoVolontario((v) => ({ ...v, nome: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.surname")}</Label>
              <Input
                value={nuovoVolontario.cognome}
                onChange={(e) => setNuovoVolontario((v) => ({ ...v, cognome: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.phone")}</Label>
              <Input
                value={nuovoVolontario.telefono}
                onChange={(e) => setNuovoVolontario((v) => ({ ...v, telefono: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
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
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
              <Label htmlFor="turni-patente-b">{t("volontari.patenteB", { defaultValue: "Patente B" })}</Label>
              <Switch
                id="turni-patente-b"
                checked={nuovoVolontario.patente}
                onCheckedChange={(checked) => setNuovoVolontario((v) => ({ ...v, patente: checked }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("common.notes")}</Label>
              <Input
                value={nuovoVolontario.note}
                onChange={(e) => setNuovoVolontario((v) => ({ ...v, note: e.target.value }))}
              />
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
                !nuovoVolontario.nome.trim() ||
                !nuovoVolontario.cognome.trim() ||
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("common.type")}</Label>
              <Input
                value={nuovoMezzo.tipo}
                onChange={(e) => setNuovoMezzo((m) => ({ ...m, tipo: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("mezzi.targa", { defaultValue: "Targa" })}</Label>
              <Input
                value={nuovoMezzo.targa}
                onChange={(e) => setNuovoMezzo((m) => ({ ...m, targa: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("mezzi.proprieta", { defaultValue: "Proprietà" })}</Label>
              <Select
                value={nuovoMezzo.proprieta}
                onValueChange={(v) => setNuovoMezzo((m) => ({ ...m, proprieta: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="associazione">{t("mezzi.proprietaOpts.associazione", { defaultValue: "Associazione" })}</SelectItem>
                  <SelectItem value="noleggio">{t("mezzi.proprietaOpts.noleggio", { defaultValue: "Noleggio / Leasing" })}</SelectItem>
                  <SelectItem value="volontario">{t("mezzi.proprietaOpts.volontario", { defaultValue: "Volontario" })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.description")}</Label>
              <Input
                value={nuovoMezzo.descrizione}
                onChange={(e) => setNuovoMezzo((m) => ({ ...m, descrizione: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("common.notes")}</Label>
              <Input
                value={nuovoMezzo.note}
                onChange={(e) => setNuovoMezzo((m) => ({ ...m, note: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMezzoDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={creaMezzoPending}
              disabled={createPendingMezzo.isPending || !nuovoMezzo.tipo.trim()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
