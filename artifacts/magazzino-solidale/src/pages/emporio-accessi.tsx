import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getListAccessiEmporioQueryKey,
  useCreateAccessoEmporio,
  useListAccessiEmporio,
  useListCentriAscolto,
  useListCitta,
  useListMagazzini,
  useSearchBeneficiariAccessiEmporio,
  useUpdateAccessoEmporio,
  useUpdateAccessoEmporioStato,
  type AccessoEmporio,
  type AccessoEmporioStato,
  type BeneficiarioAccessoEmporioSearchResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Edit, Play, Search, UserCheck, UserX, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { EMPORIO_DISABLED_MESSAGE, useModuloFlags } from "@/lib/use-moduli";

const ALL = "__all__";
const STATI_ACCESSO: AccessoEmporioStato[] = ["pianificato", "confermato", "effettuato", "annullato", "non_presentato"];
type FormState = {
  beneficiarioId: string;
  magazzinoEmporioId: string;
  data: string;
  oraInizio: string;
  oraFine: string;
  statoAccessoEmporio: AccessoEmporioStato;
  noteAccessoEmporio: string;
};

type EditingState = { mode: "create"; accesso?: undefined } | { mode: "edit"; accesso: AccessoEmporio };

const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);

function formatCredito(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function combineDateTime(date: string, time: string): string {
  return `${date}T${time || "00:00"}:00`;
}

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data ?? (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function isEligible(b: BeneficiarioAccessoEmporioSearchResult | null): string | null {
  if (!b) return null;
  if (!b.attivo) return "accessiEmporio.beneficiarioNonAttivo";
  if (b.centroAscoltoId == null) return "accessiEmporio.centroAscoltoRichiesto";
  if (!b.creditoSolidaleAbilitato) return "accessiEmporio.creditoSolidaleRichiesto";
  if (b.creditoSolidaleStato !== "attivo") return "accessiEmporio.creditoSolidaleNonAttivo";
  return null;
}

function statusClass(stato: AccessoEmporioStato | null): string {
  if (stato === "confermato") return "bg-sky-500/10 text-sky-700 border-sky-200";
  if (stato === "effettuato") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (stato === "annullato") return "bg-red-500/10 text-red-700 border-red-200";
  if (stato === "non_presentato") return "bg-amber-500/10 text-amber-700 border-amber-200";
  return "bg-muted text-muted-foreground";
}

export default function EmporioAccessi() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { emporioAbilitato } = useModuloFlags();
  const initialBeneficiarioId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("beneficiarioId");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? String(id) : "";
  }, []);

  const [dataDa, setDataDa] = useState(today());
  const [dataA, setDataA] = useState(today());
  const [centroFilter, setCentroFilter] = useState(ALL);
  const [cittaFilter, setCittaFilter] = useState(ALL);
  const [emporioFilter, setEmporioFilter] = useState(ALL);
  const [statoFilter, setStatoFilter] = useState(ALL);
  const [beneficiarioSearch, setBeneficiarioSearch] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [annullando, setAnnullando] = useState<AccessoEmporio | null>(null);
  const [motivoAnnullamento, setMotivoAnnullamento] = useState("");
  const [form, setForm] = useState<FormState>({
    beneficiarioId: initialBeneficiarioId,
    magazzinoEmporioId: "",
    data: today(),
    oraInizio: nowTime(),
    oraFine: "",
    statoAccessoEmporio: "pianificato",
    noteAccessoEmporio: "",
  });

  const params = {
    dataDa: dataDa || undefined,
    dataA: dataA || undefined,
    centroAscoltoId: centroFilter === ALL ? undefined : Number(centroFilter),
    cittaId: cittaFilter === ALL ? undefined : Number(cittaFilter),
    magazzinoEmporioId: emporioFilter === ALL ? undefined : Number(emporioFilter),
    statoAccessoEmporio: statoFilter === ALL ? undefined : (statoFilter as AccessoEmporioStato),
    beneficiarioSearch: beneficiarioSearch.trim() || undefined,
    beneficiarioId: initialBeneficiarioId ? Number(initialBeneficiarioId) : undefined,
  };
  const { data: accessi, isLoading } = useListAccessiEmporio(params);
  const { data: centri } = useListCentriAscolto();
  const { data: citta } = useListCitta();
  const { data: magazzini } = useListMagazzini();
  const beneficiarioSearchParams = beneficiarioSearch.trim()
    ? { search: beneficiarioSearch.trim() }
    : form.beneficiarioId
      ? { beneficiarioId: Number(form.beneficiarioId) }
      : undefined;
  const { data: beneficiari } = useSearchBeneficiariAccessiEmporio(beneficiarioSearchParams);
  const empori = useMemo(
    () => (magazzini ?? []).filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );
  const beneficiarioSelezionato = useMemo(
    () => (beneficiari ?? []).find((b) => String(b.beneficiarioId) === form.beneficiarioId) ?? null,
    [beneficiari, form.beneficiarioId],
  );
  const eligibilityError = isEligible(beneficiarioSelezionato);

  const createAccesso = useCreateAccessoEmporio();
  const updateAccesso = useUpdateAccessoEmporio();
  const updateStato = useUpdateAccessoEmporioStato();
  const pending = createAccesso.isPending || updateAccesso.isPending || updateStato.isPending;

  const riepilogo = useMemo(() => {
    const rows = accessi ?? [];
    return {
      totale: rows.filter((a) => a.statoAccessoEmporio !== "annullato").length,
      confermati: rows.filter((a) => a.statoAccessoEmporio === "confermato").length,
      effettuati: rows.filter((a) => a.statoAccessoEmporio === "effettuato").length,
      nonPresentati: rows.filter((a) => a.statoAccessoEmporio === "non_presentato").length,
      annullati: rows.filter((a) => a.statoAccessoEmporio === "annullato").length,
    };
  }, [accessi]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListAccessiEmporioQueryKey() });
  };

  const openCreate = () => {
    setEditing({ mode: "create" });
    setBeneficiarioSearch("");
    setForm({
      beneficiarioId: initialBeneficiarioId,
      magazzinoEmporioId: "",
      data: today(),
      oraInizio: nowTime(),
      oraFine: "",
      statoAccessoEmporio: "pianificato",
      noteAccessoEmporio: "",
    });
  };

  const openEdit = (accesso: AccessoEmporio) => {
    const start = accesso.dataOraInizio ? new Date(accesso.dataOraInizio) : new Date();
    const end = accesso.dataOraFine ? new Date(accesso.dataOraFine) : null;
    setEditing({ mode: "edit", accesso });
    setBeneficiarioSearch(accesso.beneficiarioCodice ?? accesso.beneficiarioNome ?? "");
    setForm({
      beneficiarioId: String(accesso.beneficiarioId),
      magazzinoEmporioId: accesso.magazzinoEmporioId != null ? String(accesso.magazzinoEmporioId) : "",
      data: start.toISOString().slice(0, 10),
      oraInizio: start.toTimeString().slice(0, 5),
      oraFine: end ? end.toTimeString().slice(0, 5) : "",
      statoAccessoEmporio: accesso.statoAccessoEmporio ?? "pianificato",
      noteAccessoEmporio: accesso.noteAccessoEmporio ?? "",
    });
  };

  const submit = () => {
    if (!emporioAbilitato) {
      toast({ title: t("accessiEmporio.titolo"), description: t("accessiEmporio.emporioDisabilitato"), variant: "destructive" });
      return;
    }
    if (!form.beneficiarioId || !form.magazzinoEmporioId || !form.data || !form.oraInizio) {
      toast({ title: t("accessiEmporio.titolo"), description: t("common.requiredField"), variant: "destructive" });
      return;
    }
    if (eligibilityError) {
      toast({ title: t("accessiEmporio.beneficiario"), description: t(eligibilityError), variant: "destructive" });
      return;
    }
    const data = {
      beneficiarioId: Number(form.beneficiarioId),
      magazzinoEmporioId: Number(form.magazzinoEmporioId),
      dataOraInizio: combineDateTime(form.data, form.oraInizio),
      dataOraFine: form.oraFine ? combineDateTime(form.data, form.oraFine) : null,
      statoAccessoEmporio: form.statoAccessoEmporio,
      noteAccessoEmporio: form.noteAccessoEmporio.trim() || null,
    };
    const onSuccess = () => {
      invalidate();
      setEditing(null);
      toast({ title: t(editing?.mode === "edit" ? "accessiEmporio.modificaAccesso" : "accessiEmporio.nuovoAccesso") });
    };
    const onError = (err: unknown) => {
      toast({ title: t("accessiEmporio.titolo"), description: extractError(err, t("consegne.toastErrore")), variant: "destructive" });
    };
    if (editing?.mode === "edit") {
      updateAccesso.mutate({ id: editing.accesso.id, data }, { onSuccess, onError });
    } else {
      createAccesso.mutate({ data }, { onSuccess, onError });
    }
  };

  const changeStatus = (accesso: AccessoEmporio, statoAccessoEmporio: AccessoEmporioStato, motivo?: string) => {
    updateStato.mutate(
      { id: accesso.id, data: { statoAccessoEmporio, motivoAnnullamento: motivo ?? null } },
      {
        onSuccess: () => {
          invalidate();
          setAnnullando(null);
          setMotivoAnnullamento("");
          toast({ title: t("accessiEmporio.stato") });
        },
        onError: (err) => toast({ title: t("accessiEmporio.stato"), description: extractError(err, t("consegne.toastErrore")), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">{t("accessiEmporio.titolo")}</h1>
          <p className="text-sm text-muted-foreground">{t("accessiEmporio.sottotitolo")}</p>
        </div>
        <Button onClick={openCreate} disabled={!emporioAbilitato}>{t("accessiEmporio.nuovoAccesso")}</Button>
      </div>

      {!emporioAbilitato && (
        <Alert variant="destructive">
          <AlertDescription>{EMPORIO_DISABLED_MESSAGE}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">{t("accessiEmporio.totalePianificati")}</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{riepilogo.totale}</CardContent></Card>
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">{t("accessiEmporio.totaleConfermati")}</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{riepilogo.confermati}</CardContent></Card>
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">{t("accessiEmporio.totaleEffettuati")}</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{riepilogo.effettuati}</CardContent></Card>
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">{t("accessiEmporio.totaleNonPresentati")}</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{riepilogo.nonPresentati}</CardContent></Card>
        <Card><CardHeader className="py-3"><CardTitle className="text-sm">{t("accessiEmporio.totaleAnnullati")}</CardTitle></CardHeader><CardContent className="pt-0 text-2xl font-semibold">{riepilogo.annullati}</CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4" />{t("accessiEmporio.filtri")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
          <Input type="date" value={dataDa} onChange={(event) => setDataDa(event.target.value)} />
          <Input type="date" value={dataA} onChange={(event) => setDataA(event.target.value)} />
          <Select value={centroFilter} onValueChange={setCentroFilter}>
            <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tuttiCentri")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiCentri")}</SelectItem>
              {centri?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cittaFilter} onValueChange={setCittaFilter}>
            <SelectTrigger><SelectValue placeholder={t("accessiEmporio.tutteLeAree")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("accessiEmporio.tutteLeAree")}</SelectItem>
              {citta?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emporioFilter} onValueChange={setEmporioFilter}>
            <SelectTrigger><SelectValue placeholder={t("accessiEmporio.tuttiGliEmpori")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("accessiEmporio.tuttiGliEmpori")}</SelectItem>
              {empori.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statoFilter} onValueChange={setStatoFilter}>
            <SelectTrigger><SelectValue placeholder={t("accessiEmporio.tuttiGliStati")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("accessiEmporio.tuttiGliStati")}</SelectItem>
              {STATI_ACCESSO.map((stato) => <SelectItem key={stato} value={stato}>{t(`accessiEmporio.${stato}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder={t("accessiEmporio.cercaBeneficiarioPlaceholder")} value={beneficiarioSearch} onChange={(event) => setBeneficiarioSearch(event.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accessiEmporio.dataOraInizio")}</TableHead>
                <TableHead>{t("accessiEmporio.beneficiario")}</TableHead>
                <TableHead>{t("beneficiari.centroRiferimento")}</TableHead>
                <TableHead>{t("accessiEmporio.emporio")}</TableHead>
                <TableHead>{t("accessiEmporio.stato")}</TableHead>
                <TableHead>{t("creditoSolidale.saldoCreditoSolidale")}</TableHead>
                <TableHead>{t("creditoSolidale.quotaMensileAssegnata")}</TableHead>
                <TableHead>{t("accessiEmporio.note")}</TableHead>
                <TableHead className="text-right">{t("creditoSolidale.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
              ) : (accessi ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{t("accessiEmporio.nessunAccesso")}</TableCell></TableRow>
              ) : (accessi ?? []).map((accesso) => (
                <TableRow key={accesso.id}>
                  <TableCell>
                    <div className="font-medium">{formatDateTime(accesso.dataOraInizio)}</div>
                    <div className="text-xs text-muted-foreground">{accesso.dataOraFine ? formatDateTime(accesso.dataOraFine) : ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{accesso.beneficiarioNome ?? "-"}</div>
                    <div className="text-xs text-muted-foreground">{accesso.beneficiarioCodice ?? "-"}</div>
                    {accesso.accessoForzato && <Badge variant="secondary" className="mt-1">{t("accessiEmporio.accessoForzatoDaCassa")}</Badge>}
                  </TableCell>
                  <TableCell>{accesso.centroAscoltoNome ?? "-"}</TableCell>
                  <TableCell>{accesso.magazzinoEmporioNome ?? "-"}</TableCell>
                  <TableCell><Badge variant="outline" className={statusClass(accesso.statoAccessoEmporio)}>{t(`accessiEmporio.${accesso.statoAccessoEmporio ?? "pianificato"}`)}</Badge></TableCell>
                  <TableCell>{formatCredito(accesso.saldoCreditoSolidale)}</TableCell>
                  <TableCell>{formatCredito(accesso.quotaMensileAssegnata)}</TableCell>
                  <TableCell className="max-w-48 truncate">{accesso.noteAccessoEmporio ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(accesso)} disabled={!emporioAbilitato || pending} title={t("accessiEmporio.modificaAccesso")}><Edit className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => changeStatus(accesso, "confermato")} disabled={!emporioAbilitato || pending || accesso.statoAccessoEmporio === "confermato"} title={t("accessiEmporio.confermaAccesso")}><UserCheck className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => changeStatus(accesso, "effettuato")} disabled={!emporioAbilitato || pending || accesso.statoAccessoEmporio === "effettuato"} title={t("accessiEmporio.segnoEffettuato")}><CheckCircle2 className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => changeStatus(accesso, "non_presentato")} disabled={!emporioAbilitato || pending || accesso.statoAccessoEmporio === "non_presentato"} title={t("accessiEmporio.segnoNonPresentato")}><UserX className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setAnnullando(accesso)} disabled={!emporioAbilitato || pending || accesso.statoAccessoEmporio === "annullato"} title={t("accessiEmporio.annullaAccesso")}><XCircle className="h-4 w-4" /></Button>
                      <Button variant="outline" size="icon" asChild title={t("accessiEmporio.apriCassa")}>
                        <Link href={`/emporio/cassa?accessoEmporioId=${accesso.id}`}><Play className="h-4 w-4" /></Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t(editing?.mode === "edit" ? "accessiEmporio.modificaAccesso" : "accessiEmporio.nuovoAccesso")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("accessiEmporio.cercaBeneficiario")}</label>
              <Input placeholder={t("accessiEmporio.cercaBeneficiarioPlaceholder")} value={beneficiarioSearch} onChange={(event) => setBeneficiarioSearch(event.target.value)} disabled={!emporioAbilitato} />
            </div>
            <Select value={form.beneficiarioId || ""} onValueChange={(value) => {
              const selected = (beneficiari ?? []).find((b) => String(b.beneficiarioId) === value);
              setForm((current) => ({
                ...current,
                beneficiarioId: value,
                magazzinoEmporioId: selected?.magazzinoEmporioPreferitoId != null ? String(selected.magazzinoEmporioPreferitoId) : current.magazzinoEmporioId,
              }));
              if (selected) setBeneficiarioSearch(`${selected.beneficiarioNome} ${selected.beneficiarioCodice}`);
            }} disabled={!emporioAbilitato}>
              <SelectTrigger><SelectValue placeholder={t("accessiEmporio.beneficiario")} /></SelectTrigger>
              <SelectContent>
                {(beneficiari ?? []).map((b) => (
                  <SelectItem key={b.beneficiarioId} value={String(b.beneficiarioId)}>
                    {b.beneficiarioNome} · {b.beneficiarioCodice}
                    {b.centroAscoltoNome ? ` · ${b.centroAscoltoNome}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {beneficiarioSelezionato && (
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">{beneficiarioSelezionato.beneficiarioNome}</div>
                <div>{beneficiarioSelezionato.beneficiarioCodice}</div>
                <div>{beneficiarioSelezionato.centroAscoltoNome ?? "-"}</div>
                <div>{t(`creditoSolidale.stato.${beneficiarioSelezionato.creditoSolidaleStato}`)}</div>
              </div>
            )}
            {eligibilityError && <p className="text-sm font-medium text-destructive">{t(eligibilityError)}</p>}
            <Select value={form.magazzinoEmporioId || ""} onValueChange={(value) => setForm((current) => ({ ...current, magazzinoEmporioId: value }))} disabled={!emporioAbilitato}>
              <SelectTrigger><SelectValue placeholder={t("accessiEmporio.emporio")} /></SelectTrigger>
              <SelectContent>
                {empori.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-3">
              <Input type="date" value={form.data} onChange={(event) => setForm((current) => ({ ...current, data: event.target.value }))} disabled={!emporioAbilitato} />
              <Input type="time" value={form.oraInizio} onChange={(event) => setForm((current) => ({ ...current, oraInizio: event.target.value }))} disabled={!emporioAbilitato} />
              <Input type="time" value={form.oraFine} onChange={(event) => setForm((current) => ({ ...current, oraFine: event.target.value }))} disabled={!emporioAbilitato} />
            </div>
            <Select value={form.statoAccessoEmporio} onValueChange={(value) => setForm((current) => ({ ...current, statoAccessoEmporio: value as AccessoEmporioStato }))} disabled={!emporioAbilitato}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATI_ACCESSO.map((stato) => <SelectItem key={stato} value={stato}>{t(`accessiEmporio.${stato}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea rows={3} placeholder={t("accessiEmporio.note")} value={form.noteAccessoEmporio} onChange={(event) => setForm((current) => ({ ...current, noteAccessoEmporio: event.target.value }))} disabled={!emporioAbilitato} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={submit} disabled={!emporioAbilitato || pending}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={annullando != null} onOpenChange={(open) => !open && setAnnullando(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("accessiEmporio.annullaAccesso")}</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder={t("accessiEmporio.motivoAnnullamento")} value={motivoAnnullamento} onChange={(event) => setMotivoAnnullamento(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnullando(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" disabled={!motivoAnnullamento.trim() || pending || !annullando} onClick={() => annullando && changeStatus(annullando, "annullato", motivoAnnullamento)}>{t("accessiEmporio.annullaAccesso")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {initialBeneficiarioId && (
        <Button variant="link" asChild className="px-0">
          <Link href={`/beneficiari/${initialBeneficiarioId}`}>{t("accessiEmporio.tornaBeneficiario")}</Link>
        </Button>
      )}
    </div>
  );
}
