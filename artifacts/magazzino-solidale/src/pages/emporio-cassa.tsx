import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessioneCassaEmporioQueryKey,
  searchBeneficiariCassaEmporio,
  searchProdottiCassaEmporio,
  useAddSessioneCassaEmporioRiga,
  useAnnullaSessioneCassaEmporio,
  useApriSessioneCassaEmporio,
  useDeleteSessioneCassaEmporioRiga,
  useGetSessioneCassaEmporio,
  useListCitta,
  useListMagazzini,
  useListSessioniCassaEmporio,
  usePreparaChiusuraSessioneCassaEmporio,
  useRiprendiSessioneCassaEmporio,
  useSearchBeneficiariCassaEmporio,
  useSearchProdottiCassaEmporio,
  useSospendiSessioneCassaEmporio,
  useUpdateSessioneCassaEmporioRiga,
  type SessioneCassaEmporio,
  type SessioneCassaEmporioAccessoValido,
  type SessioneCassaEmporioRicercaBeneficiarioResult,
  type SessioneCassaEmporioRicercaProdottoResult,
  type SessioneCassaEmporioStato,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Barcode, CheckCircle2, Minus, Pause, Play, Plus, Search, ShieldAlert, ShoppingCart, Trash2, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useModuloFlags } from "@/lib/use-moduli";

const ALL = "__all__";
const STATI_SESSIONE: SessioneCassaEmporioStato[] = ["aperta", "sospesa", "pronta_per_chiusura"];

function formatCredito(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function optionalId(value: string): number | undefined {
  return value === ALL ? undefined : Number(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data ?? (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function sessioneModificabile(sessione: SessioneCassaEmporio | undefined): boolean {
  return sessione?.statoSessione === "aperta" || sessione?.statoSessione === "sospesa";
}

function statusClass(stato: string | null | undefined): string {
  if (stato === "aperta") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (stato === "sospesa") return "bg-amber-500/10 text-amber-700 border-amber-200";
  if (stato === "pronta_per_chiusura") return "bg-sky-500/10 text-sky-700 border-sky-200";
  if (stato === "annullata") return "bg-red-500/10 text-red-700 border-red-200";
  return "bg-muted text-muted-foreground";
}

export default function EmporioCassa() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { emporioAbilitato } = useModuloFlags();

  const [beneficiarioSearch, setBeneficiarioSearch] = useState("");
  const [selectedBeneficiario, setSelectedBeneficiario] = useState<SessioneCassaEmporioRicercaBeneficiarioResult | null>(null);
  const [selectedSessioneId, setSelectedSessioneId] = useState<number | null>(null);
  const [cassaDate, setCassaDate] = useState(todayInput());
  const [areaFilter, setAreaFilter] = useState(ALL);
  const [emporioFilter, setEmporioFilter] = useState(ALL);
  const [sessioneSearch, setSessioneSearch] = useState("");
  const [statoFilter, setStatoFilter] = useState<string>(ALL);
  const [prodottoSearch, setProdottoSearch] = useState("");
  const [annullaOpen, setAnnullaOpen] = useState(false);
  const [motivoAnnullamento, setMotivoAnnullamento] = useState("");

  const beneficiarioQuery = beneficiarioSearch.trim();
  const prodottoQuery = prodottoSearch.trim();

  const { data: citta = [] } = useListCitta();
  const { data: magazzini = [] } = useListMagazzini();
  const empori = useMemo(
    () => magazzini.filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );

  const searchContext = {
    data: cassaDate || undefined,
    cittaId: optionalId(areaFilter),
    magazzinoEmporioId: optionalId(emporioFilter),
  };

  const { data: beneficiari = [] } = useSearchBeneficiariCassaEmporio({
    search: beneficiarioQuery || undefined,
    ...searchContext,
  });
  const { data: sessioni = [] } = useListSessioniCassaEmporio({
    statoSessione: statoFilter === ALL ? undefined : (statoFilter as SessioneCassaEmporioStato),
    beneficiarioSearch: sessioneSearch.trim() || undefined,
    ...searchContext,
  });
  const sessioneQuery = useGetSessioneCassaEmporio(selectedSessioneId ?? 0);
  const sessione = sessioneQuery.data;
  const { data: prodotti = [] } = useSearchProdottiCassaEmporio({
    search: prodottoQuery || undefined,
    magazzinoEmporioId: sessione?.magazzinoEmporioId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries();
  };

  const refreshSessione = () => {
    invalidate();
    if (selectedSessioneId != null) void sessioneQuery.refetch();
  };

  const onError = (err: unknown) => {
    toast({ variant: "destructive", title: extractError(err, t("common.error")) });
  };

  const apriSessione = useApriSessioneCassaEmporio({
    mutation: {
      onSuccess: (data) => {
        setSelectedSessioneId(data.id);
        queryClient.setQueryData(getGetSessioneCassaEmporioQueryKey(data.id), data);
        invalidate();
        toast({ title: t("cassaEmporio.sessioneAperta") });
      },
      onError,
    },
  });
  const addRiga = useAddSessioneCassaEmporioRiga({
    mutation: {
      onSuccess: () => {
        setProdottoSearch("");
        refreshSessione();
      },
      onError,
    },
  });
  const updateRiga = useUpdateSessioneCassaEmporioRiga({ mutation: { onSuccess: refreshSessione, onError } });
  const deleteRiga = useDeleteSessioneCassaEmporioRiga({ mutation: { onSuccess: refreshSessione, onError } });
  const sospendi = useSospendiSessioneCassaEmporio({ mutation: { onSuccess: invalidate, onError } });
  const riprendi = useRiprendiSessioneCassaEmporio({ mutation: { onSuccess: invalidate, onError } });
  const annulla = useAnnullaSessioneCassaEmporio({
    mutation: {
      onSuccess: () => {
        setAnnullaOpen(false);
        setMotivoAnnullamento("");
        invalidate();
      },
      onError,
    },
  });
  const prepara = usePreparaChiusuraSessioneCassaEmporio({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: t("cassaEmporio.sessioneProntaPerChiusura") });
      },
      onError,
    },
  });

  const activeAccessi = useMemo(
    () => selectedBeneficiario?.accessi.filter((a) => a.statoAccessoEmporio !== "annullato" && a.statoAccessoEmporio !== "non_presentato") ?? [],
    [selectedBeneficiario],
  );
  const activeSessione = sessione ?? undefined;
  const canEdit = emporioAbilitato && sessioneModificabile(activeSessione);
  const saldoInsufficiente = (activeSessione?.creditoResiduoPrevisto ?? 0) < 0;

  const selectBeneficiario = (b: SessioneCassaEmporioRicercaBeneficiarioResult) => {
    setSelectedBeneficiario(b);
    setBeneficiarioSearch(b.beneficiarioCodice);
  };

  const openAccesso = (accesso: SessioneCassaEmporioAccessoValido) => {
    if (!emporioAbilitato || accesso.id == null) return;
    apriSessione.mutate({ accessoEmporioId: accesso.id, data: {} });
  };

  const addProduct = (prodotto: SessioneCassaEmporioRicercaProdottoResult) => {
    if (!activeSessione || !canEdit) return;
    addRiga.mutate({ id: activeSessione.id, data: { prodottoId: prodotto.prodottoId, quantita: 1 } });
  };

  const updateQuantity = (rigaId: number, quantita: number) => {
    if (!activeSessione || !canEdit || quantita < 1) return;
    updateRiga.mutate({ id: activeSessione.id, rigaId, data: { quantita } });
  };

  const onBeneficiarioKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const currentSearch = event.currentTarget.value.trim();
    const liveResults = await searchBeneficiariCassaEmporio({
      search: currentSearch || undefined,
      ...searchContext,
    }).catch(() => beneficiari);
    const exact = liveResults.find((b) => b.beneficiarioCodice.toLowerCase() === currentSearch.toLowerCase()) ?? liveResults[0];
    if (exact) selectBeneficiario(exact);
  };

  const onProdottoKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !activeSessione || !canEdit) return;
    const currentSearch = event.currentTarget.value.trim();
    const liveResults = await searchProdottiCassaEmporio({
      search: currentSearch || undefined,
      magazzinoEmporioId: activeSessione.magazzinoEmporioId,
    }).catch(() => prodotti);
    if (liveResults.length === 1) addProduct(liveResults[0]);
  };

  const resetContextSelection = () => {
    setSelectedBeneficiario(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">{t("cassaEmporio.titolo")}</h1>
          <p className="text-sm text-muted-foreground">{t("cassaEmporio.chiusuraDisponibileFase47")}</p>
        </div>
        {activeSessione && <Badge variant="outline" className={statusClass(activeSessione.statoSessione)}>{t(`cassaEmporio.${activeSessione.statoSessione}`)}</Badge>}
      </div>

      {!emporioAbilitato && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>{t("cassaEmporio.emporioDisabilitato")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("cassaEmporio.contestoCassa")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.dataCassa")}</label>
                <Input
                  type="date"
                  value={cassaDate}
                  onChange={(e) => {
                    setCassaDate(e.target.value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.area")}</label>
                <Select
                  value={areaFilter}
                  onValueChange={(value) => {
                    setAreaFilter(value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("cassaEmporio.tutteLeAree")}</SelectItem>
                    {citta.map((area) => <SelectItem key={area.id} value={String(area.id)}>{area.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.emporio")}</label>
                <Select
                  value={emporioFilter}
                  onValueChange={(value) => {
                    setEmporioFilter(value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("cassaEmporio.tuttiGliEmpori")}</SelectItem>
                    {empori.map((emporio) => <SelectItem key={emporio.id} value={String(emporio.id)}>{emporio.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Barcode className="h-4 w-4" />{t("cassaEmporio.scansionaBeneficiario")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={beneficiarioSearch}
                onChange={(e) => setBeneficiarioSearch(e.target.value)}
                onKeyDown={onBeneficiarioKeyDown}
                placeholder={t("cassaEmporio.cercaBeneficiarioPlaceholder")}
                disabled={!emporioAbilitato}
              />
              <div className="max-h-64 space-y-2 overflow-auto">
                {beneficiari.map((b) => (
                  <button
                    key={b.beneficiarioId}
                    type="button"
                    className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
                    onClick={() => selectBeneficiario(b)}
                    disabled={!emporioAbilitato}
                  >
                    <div className="font-medium">{b.beneficiarioNome}</div>
                    <div className="text-muted-foreground">{b.beneficiarioCodice}</div>
                    <div className="mt-1 text-xs">{t("cassaEmporio.saldoCreditoDisponibile")}: {formatCredito(b.saldoCreditoSolidale)}</div>
                  </button>
                ))}
                {beneficiarioQuery && beneficiari.length === 0 && <p className="text-sm text-muted-foreground">{t("cassaEmporio.nessunRisultato")}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("cassaEmporio.accessoEmporio")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedBeneficiario ? (
                <>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="font-medium">{selectedBeneficiario.beneficiarioNome}</div>
                    <div className="text-muted-foreground">{selectedBeneficiario.beneficiarioCodice}</div>
                    <div>{t("cassaEmporio.saldoCreditoDisponibile")}: {formatCredito(selectedBeneficiario.saldoCreditoSolidale)}</div>
                    {selectedBeneficiario.saldoCreditoSolidale === 0 && <div className="mt-1 text-amber-700">{t("cassaEmporio.saldoZero")}</div>}
                  </div>
                  <div className="space-y-2">
                    {activeAccessi.map((accesso) => (
                      <div key={accesso.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{formatDateTime(accesso.dataOraInizio)}</div>
                            <div className="text-muted-foreground">{accesso.magazzinoEmporioNome ?? "-"}</div>
                          </div>
                          {isToday(accesso.dataOraInizio) && <Badge variant="secondary">{t("cassaEmporio.oggi")}</Badge>}
                        </div>
                        <Button className="mt-3 w-full" size="sm" onClick={() => openAccesso(accesso)} disabled={!emporioAbilitato || apriSessione.isPending}>
                          {t("cassaEmporio.apriSessione")}
                        </Button>
                      </div>
                    ))}
                    {activeAccessi.length === 0 && (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>{t("cassaEmporio.nessunAccessoValido")}</p>
                        <Button variant="outline" className="w-full" disabled>{t("cassaEmporio.accessoStraordinario")}</Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("cassaEmporio.cercaBeneficiario")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("cassaEmporio.sessioniRecenti")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <Input value={sessioneSearch} onChange={(e) => setSessioneSearch(e.target.value)} placeholder={t("cassaEmporio.cercaBeneficiarioPlaceholder")} />
                <Select value={statoFilter} onValueChange={setStatoFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("common.all")}</SelectItem>
                    {STATI_SESSIONE.map((stato) => <SelectItem key={stato} value={stato}>{t(`cassaEmporio.${stato}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto">
                {sessioni.map((s) => (
                  <button key={s.id} type="button" className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted" onClick={() => setSelectedSessioneId(s.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.beneficiarioNome ?? "-"}</span>
                      <Badge variant="outline" className={statusClass(s.statoSessione)}>{t(`cassaEmporio.${s.statoSessione}`)}</Badge>
                    </div>
                    <div className="text-muted-foreground">{formatDateTime(s.dataUltimaModifica)}</div>
                  </button>
                ))}
                {sessioni.length === 0 && <p className="text-sm text-muted-foreground">{t("cassaEmporio.nessunaSessione")}</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {activeSessione ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("cassaEmporio.sessioneAperta")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div><div className="text-muted-foreground">{t("cassaEmporio.beneficiario")}</div><div className="font-medium">{activeSessione.beneficiarioNome ?? "-"}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.codice")}</div><div className="font-medium">{activeSessione.beneficiarioCodice ?? "-"}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.emporio")}</div><div className="font-medium">{activeSessione.magazzinoEmporioNome ?? "-"}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.accessoEmporio")}</div><div className="font-medium">{formatDateTime(activeSessione.dataOraAccesso)}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.saldoCreditoDisponibile")}</div><div className="font-medium">{formatCredito(activeSessione.saldoCreditoIniziale)}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.totaleCreditoPrevisto")}</div><div className="font-medium">{formatCredito(activeSessione.totaleCreditoPrevisto)}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.creditoResiduoPrevisto")}</div><div className={saldoInsufficiente ? "font-medium text-red-700" : "font-medium"}>{formatCredito(activeSessione.creditoResiduoPrevisto)}</div></div>
                  <div><div className="text-muted-foreground">{t("cassaEmporio.statoSessione")}</div><Badge variant="outline" className={statusClass(activeSessione.statoSessione)}>{t(`cassaEmporio.${activeSessione.statoSessione}`)}</Badge></div>
                </CardContent>
              </Card>

              {saldoInsufficiente && (
                <Alert variant="destructive">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertDescription>{t("cassaEmporio.saldoInsufficiente")}</AlertDescription>
                </Alert>
              )}
              {!canEdit && activeSessione.statoSessione !== "aperta" && activeSessione.statoSessione !== "sospesa" && (
                <Alert>
                  <AlertDescription>{t("cassaEmporio.soloLettura")}</AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4" />{t("cassaEmporio.scansionaProdotto")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input value={prodottoSearch} onChange={(e) => setProdottoSearch(e.target.value)} onKeyDown={onProdottoKeyDown} placeholder={t("cassaEmporio.cercaProdottoPlaceholder")} disabled={!canEdit} />
                  <div className="grid gap-2 md:grid-cols-2">
                    {prodotti.map((p) => (
                      <div key={p.prodottoId} className="rounded-md border p-3 text-sm">
                        <div className="font-medium">{p.nome}</div>
                        <div className="text-muted-foreground">{p.codiceBarre ?? p.codice}</div>
                        <div>{t("cassaEmporio.creditoUnitario")}: {formatCredito(p.creditoSolidaleValore)}</div>
                        <div>{t("cassaEmporio.giacenzaDisponibile")}: {p.giacenzaDisponibile ?? "-"}</div>
                        <Button className="mt-3 w-full" size="sm" onClick={() => addProduct(p)} disabled={!canEdit || addRiga.isPending}>{t("cassaEmporio.aggiungiProdotto")}</Button>
                      </div>
                    ))}
                    {prodottoQuery && prodotti.length === 0 && <p className="text-sm text-muted-foreground">{t("cassaEmporio.prodottoNonTrovato")}</p>}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-4 w-4" />{t("cassaEmporio.carrello")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("cassaEmporio.prodotto")}</TableHead>
                          <TableHead>{t("cassaEmporio.quantita")}</TableHead>
                          <TableHead>{t("cassaEmporio.creditoUnitario")}</TableHead>
                          <TableHead>{t("cassaEmporio.creditoTotale")}</TableHead>
                          <TableHead>{t("cassaEmporio.giacenzaDisponibile")}</TableHead>
                          <TableHead>{t("cassaEmporio.limiti")}</TableHead>
                          <TableHead className="text-right">{t("cassaEmporio.azioni")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeSessione.righe.map((riga) => (
                          <TableRow key={riga.id}>
                            <TableCell>
                              <div className="font-medium">{riga.descrizioneProdotto}</div>
                              <div className="text-xs text-muted-foreground">{riga.codiceProdotto ?? "-"}</div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="icon" onClick={() => updateQuantity(riga.id, riga.quantita - 1)} disabled={!canEdit || riga.quantita <= 1}><Minus className="h-4 w-4" /></Button>
                                <Input className="h-9 w-16 text-center" value={riga.quantita} onChange={(e) => updateQuantity(riga.id, Number(e.target.value))} disabled={!canEdit} />
                                <Button variant="outline" size="icon" onClick={() => updateQuantity(riga.id, riga.quantita + 1)} disabled={!canEdit}><Plus className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                            <TableCell>{formatCredito(riga.creditoUnitario)}</TableCell>
                            <TableCell>{formatCredito(riga.creditoTotale)}</TableCell>
                            <TableCell>{riga.giacenzaDisponibileAlMomento ?? "-"}</TableCell>
                            <TableCell className="text-xs">
                              <div>{t("cassaEmporio.limitePerSpesa")}: {riga.limitePerSpesa ?? "-"}</div>
                              <div>{t("cassaEmporio.limiteMensile")}: {riga.limiteMensile ?? "-"}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => deleteRiga.mutate({ id: activeSessione.id, rigaId: riga.id })} disabled={!canEdit}><Trash2 className="h-4 w-4" /></Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {activeSessione.righe.length === 0 && (
                          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("cassaEmporio.carrelloVuoto")}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                    <Button variant="outline" onClick={() => sospendi.mutate({ id: activeSessione.id })} disabled={!canEdit || activeSessione.statoSessione === "sospesa"}><Pause className="mr-2 h-4 w-4" />{t("cassaEmporio.sospendiSessione")}</Button>
                    <Button variant="outline" onClick={() => riprendi.mutate({ id: activeSessione.id })} disabled={!emporioAbilitato || activeSessione.statoSessione !== "sospesa"}><Play className="mr-2 h-4 w-4" />{t("cassaEmporio.riprendiSessione")}</Button>
                    <Button variant="outline" onClick={() => setAnnullaOpen(true)} disabled={!emporioAbilitato || activeSessione.statoSessione === "annullata"}><XCircle className="mr-2 h-4 w-4" />{t("cassaEmporio.annullaSessione")}</Button>
                    <Button onClick={() => prepara.mutate({ id: activeSessione.id })} disabled={!canEdit || activeSessione.righe.length === 0 || saldoInsufficiente}><CheckCircle2 className="mr-2 h-4 w-4" />{t("cassaEmporio.preparaChiusura")}</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">{t("cassaEmporio.selezionaSessione")}</CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={annullaOpen} onOpenChange={setAnnullaOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("cassaEmporio.confermaAnnullamento")}</DialogTitle></DialogHeader>
          <Textarea value={motivoAnnullamento} onChange={(e) => setMotivoAnnullamento(e.target.value)} placeholder={t("cassaEmporio.motivoAnnullamento")} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnullaOpen(false)}>{t("cassaEmporio.annulla")}</Button>
            <Button
              onClick={() => activeSessione && annulla.mutate({ id: activeSessione.id, data: { motivoAnnullamento } })}
              disabled={!motivoAnnullamento.trim() || annulla.isPending}
            >
              {t("cassaEmporio.salvaMotivo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
