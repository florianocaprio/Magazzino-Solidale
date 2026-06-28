import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTurni,
  getListTurniQueryKey,
  useUpsertTurno,
  useListCentriAscolto,
  useListVolontari,
  useListMezzi,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import { ChevronLeft, ChevronRight, Plus, Trash2, Truck } from "lucide-react";

const FASCE = [
  { key: "09-13", labelKey: "fasciaMattina", time: "09:00–13:00" },
  { key: "14-18", labelKey: "fasciaPomeriggio", time: "14:00–18:00" },
  { key: "18-20", labelKey: "fasciaSera", time: "18:00–20:00" },
] as const;

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
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isScoped = user?.centroAscoltoId != null;
  const [selectedCentro, setSelectedCentro] = useState<number | null>(
    user?.centroAscoltoId ?? null,
  );
  const effectiveCentro = isScoped ? user!.centroAscoltoId! : selectedCentro;

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const da = toISODate(days[0]);
  const a = toISODate(days[6]);

  const { data: centri } = useListCentriAscolto();
  const { data: volontari } = useListVolontari();
  const volontariCentro = useMemo(
    () =>
      (volontari ?? []).filter(
        (v) =>
          v.centroAscoltoId == null ||
          effectiveCentro == null ||
          v.centroAscoltoId === effectiveCentro,
      ),
    [volontari, effectiveCentro],
  );

  const { data: mezzi } = useListMezzi();
  const mezziCentro = useMemo(
    () =>
      (mezzi ?? []).filter(
        (m) =>
          m.centroAscoltoId == null ||
          effectiveCentro == null ||
          m.centroAscoltoId === effectiveCentro,
      ),
    [mezzi, effectiveCentro],
  );

  const { data: turni } = useListTurni(
    { da, a, ...(effectiveCentro != null ? { centroAscoltoId: effectiveCentro } : {}) },
    { query: { enabled: effectiveCentro != null, queryKey: getListTurniQueryKey({ da, a, centroAscoltoId: effectiveCentro ?? undefined }) } },
  );

  const turnoMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof turni>[number]>();
    for (const turno of turni ?? []) m.set(`${turno.data}|${turno.fascia}`, turno);
    return m;
  }, [turni]);

  const upsert = useUpsertTurno();

  const [dialog, setDialog] = useState<{ data: string; fascia: string } | null>(null);
  const [rows, setRows] = useState<VolRow[]>([]);
  const [mezzoId, setMezzoId] = useState<number | null>(null);

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
    upsert.mutate(
      { data: { centroAscoltoId: effectiveCentro, data: dialog.data, fascia: dialog.fascia, mezzoId, volontari } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTurniQueryKey() });
          toast({ description: t("turni.saved") });
          setDialog(null);
        },
        onError: () => toast({ variant: "destructive", description: t("turni.error") }),
      },
    );
  }

  const fasciaLabel = (key: string) => {
    const f = FASCE.find((x) => x.key === key);
    return f ? `${t(`turni.${f.labelKey}`)} (${f.time})` : key;
  };

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
                      className="bg-background hover:bg-accent min-h-[72px] p-1.5 text-left align-top transition-colors"
                    >
                      {turno && turno.volontari.length ? (
                        <div className="space-y-1">
                          {turno.volontari.map((v) => (
                            <div key={v.volontarioId} className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[11px] leading-tight">
                              <div className="truncate font-medium">{v.volontarioNome ?? `#${v.volontarioId}`}</div>
                              {v.ruolo && <div className="truncate opacity-80">{v.ruolo}</div>}
                            </div>
                          ))}
                          {turno.mezzoCodice && (
                            <div className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] leading-tight text-amber-700 dark:text-amber-400">
                              <Truck className="h-3 w-3 shrink-0" />
                              <span className="truncate font-medium">{turno.mezzoCodice}</span>
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
                      {volontariCentro.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.cognome} {v.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { volontarioId: "", ruolo: "" }])}
            >
              <Plus className="me-1 h-4 w-4" /> {t("turni.addVolontario")}
            </Button>

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
                  {mezziCentro.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.codice}
                      {m.tipo ? ` · ${m.tipo}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t("turni.cancel")}
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {t("turni.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
