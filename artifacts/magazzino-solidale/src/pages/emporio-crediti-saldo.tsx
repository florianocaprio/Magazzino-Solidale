import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getListBeneficiariQueryKey,
  getListCreditoSolidaleBeneficiarioMovimentiQueryKey,
  useCreateCreditoSolidaleRettifica,
  useCreateCreditoSolidaleRicaricaManuale,
  useExecuteCreditoSolidaleRicaricaMensile,
  useListBeneficiari,
  useListCentriAscolto,
  useListCitta,
  useListCreditoSolidaleBeneficiarioMovimenti,
  useListCreditoSolidaleMovimenti,
  useListMagazzini,
  usePreviewCreditoSolidaleRicaricaMensile,
  useStornaCreditoSolidaleMovimento,
  type Beneficiario,
  type CreditoSolidaleMovimento,
  type CreditoSolidaleRicaricaMensilePreview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CreditCard, Eye, History, RefreshCw, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useModuloFlags } from "@/lib/use-moduli";

const ALL = "__all__";
const NONE = "__none__";
const STATI_CREDITO_SOLIDALE = ["non_abilitato", "attivo", "sospeso", "revocato"] as const;
type StatoCreditoSolidale = (typeof STATI_CREDITO_SOLIDALE)[number];

type ActionState = {
  tipo: "ricarica" | "rettifica";
  beneficiario: Beneficiario;
} | null;

const statusClasses: Record<StatoCreditoSolidale, string> = {
  non_abilitato: "bg-muted text-muted-foreground",
  attivo: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  sospeso: "bg-amber-500/10 text-amber-700 border-amber-200",
  revocato: "bg-red-500/10 text-red-700 border-red-200",
};

function currentPeriodo(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function optionalId(value: string): number | undefined {
  return value === ALL || value === NONE ? undefined : Number(value);
}

function formatCredito(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function extractError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown })?.data ?? (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function statoKey(stato: string | null | undefined): StatoCreditoSolidale {
  return STATI_CREDITO_SOLIDALE.includes(stato as StatoCreditoSolidale)
    ? (stato as StatoCreditoSolidale)
    : "non_abilitato";
}

function matchesTesseraCode(b: Beneficiario, normalized: string): boolean {
  return b.codice.toLowerCase() === normalized || (b.codiceFiscale?.toLowerCase() ?? "") === normalized;
}

export default function EmporioCreditiSaldo() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { emporioAbilitato } = useModuloFlags();
  const initialBeneficiarioId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("beneficiarioId");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? String(id) : "";
  }, []);

  const [search, setSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState(ALL);
  const [cittaFilter, setCittaFilter] = useState(ALL);
  const [statoFilter, setStatoFilter] = useState(ALL);
  const [emporioFilter, setEmporioFilter] = useState(ALL);
  const [soloSaldoPositivo, setSoloSaldoPositivo] = useState(false);
  const [soloQuotaAssegnata, setSoloQuotaAssegnata] = useState(false);
  const [selectedBeneficiarioId, setSelectedBeneficiarioId] = useState(initialBeneficiarioId);
  const [action, setAction] = useState<ActionState>(null);
  const [variazione, setVariazione] = useState("");
  const [motivo, setMotivo] = useState("");
  const [note, setNote] = useState("");
  const [periodo, setPeriodo] = useState(currentPeriodo());
  const [ricaricaCentro, setRicaricaCentro] = useState(ALL);
  const [ricaricaCitta, setRicaricaCitta] = useState(ALL);
  const [ricaricaNote, setRicaricaNote] = useState("");
  const [preview, setPreview] = useState<CreditoSolidaleRicaricaMensilePreview | null>(null);
  const [confirmRicaricaOpen, setConfirmRicaricaOpen] = useState(false);
  const [stornoMovimento, setStornoMovimento] = useState<CreditoSolidaleMovimento | null>(null);
  const [stornoMotivo, setStornoMotivo] = useState("");
  const normalizedSearch = search.trim();

  const beneficiariParams = {
    search: normalizedSearch || undefined,
    centroAscoltoId: optionalId(centroFilter),
    cittaId: optionalId(cittaFilter),
  };
  const { data: beneficiari, isLoading } = useListBeneficiari(beneficiariParams);
  const { data: centri } = useListCentriAscolto();
  const { data: citta } = useListCitta();
  const { data: magazzini } = useListMagazzini();
  const empori = useMemo(
    () => (magazzini ?? []).filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );

  const selectedId = selectedBeneficiarioId ? Number(selectedBeneficiarioId) : undefined;
  const selectedBeneficiario = useMemo(
    () => (beneficiari ?? []).find((b) => b.id === selectedId) ?? null,
    [beneficiari, selectedId],
  );
  useEffect(() => {
    if (selectedBeneficiarioId || !normalizedSearch) return;
    const normalized = normalizedSearch.toLowerCase();
    const exact = (beneficiari ?? []).find((b) => matchesTesseraCode(b, normalized));
    if (exact) setSelectedBeneficiarioId(String(exact.id));
  }, [beneficiari, normalizedSearch, selectedBeneficiarioId]);
  const { data: selectedMovimenti } = useListCreditoSolidaleBeneficiarioMovimenti(selectedId ?? 0, {
    query: { queryKey: getListCreditoSolidaleBeneficiarioMovimentiQueryKey(selectedId ?? 0), enabled: selectedId != null },
  });
  const { data: movimentiRecenti } = useListCreditoSolidaleMovimenti({
    beneficiarioId: selectedId,
    centroAscoltoId: optionalId(centroFilter),
    cittaId: optionalId(cittaFilter),
  });

  const createRicarica = useCreateCreditoSolidaleRicaricaManuale();
  const createRettifica = useCreateCreditoSolidaleRettifica();
  const previewRicarica = usePreviewCreditoSolidaleRicaricaMensile();
  const executeRicarica = useExecuteCreditoSolidaleRicaricaMensile();
  const stornaMovimento = useStornaCreditoSolidaleMovimento();

  const filteredBeneficiari = useMemo(() => {
    return (beneficiari ?? [])
      .filter((b) => b.creditoSolidaleAbilitato || b.creditoSolidaleStato !== "non_abilitato" || b.creditoSolidaleSaldo > 0 || b.creditoSolidaleMensileAssegnato != null)
      .filter((b) => statoFilter === ALL || b.creditoSolidaleStato === statoFilter)
      .filter((b) => emporioFilter === ALL || String(b.magazzinoEmporioPreferitoId ?? NONE) === emporioFilter)
      .filter((b) => !soloSaldoPositivo || b.creditoSolidaleSaldo > 0)
      .filter((b) => !soloQuotaAssegnata || (b.creditoSolidaleMensileAssegnato ?? 0) > 0)
      .filter((b) => !selectedBeneficiarioId || b.id === Number(selectedBeneficiarioId));
  }, [beneficiari, emporioFilter, selectedBeneficiarioId, soloQuotaAssegnata, soloSaldoPositivo, statoFilter]);

  const saldoTotale = filteredBeneficiari.reduce((sum, b) => sum + b.creditoSolidaleSaldo, 0);
  const quotaTotale = filteredBeneficiari.reduce((sum, b) => sum + (b.creditoSolidaleMensileAssegnato ?? 0), 0);

  const selectBeneficiarioFromSearch = () => {
    const q = normalizedSearch.toLowerCase();
    if (!q) return;
    const matches = beneficiari ?? [];
    const exact = matches.find((b) =>
      matchesTesseraCode(b, q) ||
      `${b.cognome} ${b.nome}`.toLowerCase() === q ||
      `${b.nome} ${b.cognome}`.toLowerCase() === q
    );
    const match = exact ?? (matches.length === 1 ? matches[0] : null);
    if (match) setSelectedBeneficiarioId(String(match.id));
  };

  const invalidateCredito = (beneficiarioId?: number) => {
    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = String(query.queryKey[0] ?? "");
        return first.includes("/api/credito-solidale") || (beneficiarioId != null && first.includes(`/api/beneficiari/${beneficiarioId}`));
      },
    });
  };

  const openAction = (tipo: "ricarica" | "rettifica", beneficiario: Beneficiario) => {
    setAction({ tipo, beneficiario });
    setVariazione("");
    setMotivo("");
    setNote("");
  };

  const submitAction = () => {
    if (!action) return;
    const parsed = Number(variazione.replace(",", "."));
    if (!Number.isFinite(parsed) || (action.tipo === "ricarica" ? parsed <= 0 : parsed === 0)) {
      toast({ title: t("creditoSolidale.rettificaCreditoSolidale"), description: t("creditoSolidale.valoreRichiesto"), variant: "destructive" });
      return;
    }
    const cleanMotivo = motivo.trim();
    const cleanNote = note.trim();
    if (action.tipo === "rettifica" && !cleanMotivo) {
      toast({ title: t("creditoSolidale.rettificaCreditoSolidale"), description: t("creditoSolidale.motivoRichiesto"), variant: "destructive" });
      return;
    }

    const onSuccess = () => {
      invalidateCredito(action.beneficiario.id);
      toast({ title: t("creditoSolidale.movimentoCreato") });
      setAction(null);
    };
    const onError = (err: unknown) => toast({
      title: t("creditoSolidale.operazioneNonRiuscita"),
      description: extractError(err, t("creditoSolidale.operazioneNonRiuscita")),
      variant: "destructive",
    });

    if (action.tipo === "ricarica") {
      createRicarica.mutate({
        beneficiarioId: action.beneficiario.id,
        data: { variazioneCredito: parsed, motivo: cleanMotivo || null, note: cleanNote || null },
      }, { onSuccess, onError });
      return;
    }

    createRettifica.mutate({
      beneficiarioId: action.beneficiario.id,
      data: { variazioneCredito: parsed, motivo: cleanMotivo, note: cleanNote || null },
    }, { onSuccess, onError });
  };

  const previewPayload = () => ({
    periodoRiferimento: periodo,
    centroAscoltoId: optionalId(ricaricaCentro) ?? null,
    cittaId: optionalId(ricaricaCitta) ?? null,
  });

  const handlePreview = () => {
    previewRicarica.mutate({ data: previewPayload() }, {
      onSuccess: (data) => {
        setPreview(data);
        toast({ title: t("creditoSolidale.previewAggiornata") });
      },
      onError: (err) => toast({
        title: t("creditoSolidale.ricaricaMensile"),
        description: extractError(err, t("creditoSolidale.operazioneNonRiuscita")),
        variant: "destructive",
      }),
    });
  };

  const handleExecute = () => {
    executeRicarica.mutate({
      data: { ...previewPayload(), note: ricaricaNote.trim() || null },
    }, {
      onSuccess: () => {
        invalidateCredito();
        toast({ title: t("creditoSolidale.ricaricaMensileCompletata") });
        setConfirmRicaricaOpen(false);
        handlePreview();
      },
      onError: (err) => toast({
        title: t("creditoSolidale.ricaricaMensile"),
        description: extractError(err, t("creditoSolidale.operazioneNonRiuscita")),
        variant: "destructive",
      }),
    });
  };

  const handleStorno = () => {
    if (!stornoMovimento) return;
    const cleanMotivo = stornoMotivo.trim();
    if (!cleanMotivo) {
      toast({ title: t("creditoSolidale.stornaMovimento"), description: t("creditoSolidale.motivoRichiesto"), variant: "destructive" });
      return;
    }
    stornaMovimento.mutate({
      id: stornoMovimento.id,
      data: { motivo: cleanMotivo, note: null },
    }, {
      onSuccess: () => {
        invalidateCredito(stornoMovimento.beneficiarioId);
        toast({ title: t("creditoSolidale.stornoCompletato") });
        setStornoMovimento(null);
        setStornoMotivo("");
      },
      onError: (err) => toast({
        title: t("creditoSolidale.stornaMovimento"),
        description: extractError(err, t("creditoSolidale.operazioneNonRiuscita")),
        variant: "destructive",
      }),
    });
  };

  const actionDisabled = !emporioAbilitato || createRicarica.isPending || createRettifica.isPending;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-7 w-7 text-muted-foreground" />
            {t("creditoSolidale.saldoPageTitle")}
          </h1>
          <p className="text-muted-foreground">{t("creditoSolidale.saldoPageSubtitle")}</p>
          {!emporioAbilitato && <p className="text-sm text-muted-foreground mt-1">{t("creditoSolidale.readOnlyDisabled")}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm text-muted-foreground">{t("creditoSolidale.beneficiariCreditoSolidale")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{filteredBeneficiari.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm text-muted-foreground">{t("creditoSolidale.saldoCreditoSolidale")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatCredito(saldoTotale)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm text-muted-foreground">{t("creditoSolidale.quotaMensileAssegnata")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">{formatCredito(quotaTotale)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            {t("creditoSolidale.filters")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("creditoSolidale.cercaBeneficiarioNomeCodiceBarcode")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedBeneficiarioId("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectBeneficiarioFromSearch();
                }
              }}
            />
          </div>
          <Select value={centroFilter} onValueChange={setCentroFilter}>
            <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tuttiCentri")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiCentri")}</SelectItem>
              {centri?.map((centro) => <SelectItem key={centro.id} value={String(centro.id)}>{centro.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cittaFilter} onValueChange={setCittaFilter}>
            <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tutteLeAree")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tutteLeAree")}</SelectItem>
              {citta?.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statoFilter} onValueChange={setStatoFilter}>
            <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tuttiStati")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiStati")}</SelectItem>
              {STATI_CREDITO_SOLIDALE.map((stato) => <SelectItem key={stato} value={stato}>{t(`creditoSolidale.stato.${stato}`)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emporioFilter} onValueChange={setEmporioFilter}>
            <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tuttiEmpori")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiEmpori")}</SelectItem>
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {empori.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Checkbox checked={soloSaldoPositivo} onCheckedChange={(checked) => setSoloSaldoPositivo(checked === true)} />
            {t("creditoSolidale.soloSaldoPositivo")}
          </label>
          <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Checkbox checked={soloQuotaAssegnata} onCheckedChange={(checked) => setSoloQuotaAssegnata(checked === true)} />
            {t("creditoSolidale.soloQuotaAssegnata")}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("creditoSolidale.beneficiario")}</TableHead>
                <TableHead>{t("creditoSolidale.saldoCreditoSolidale")}</TableHead>
                <TableHead>{t("creditoSolidale.quotaMensileAssegnata")}</TableHead>
                <TableHead>{t("creditoSolidale.statoCreditoSolidale")}</TableHead>
                <TableHead>{t("creditoSolidale.emporio")}</TableHead>
                <TableHead>{t("creditoSolidale.ultimoMovimento")}</TableHead>
                <TableHead className="text-right">{t("creditoSolidale.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : filteredBeneficiari.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">{t("creditoSolidale.nessunBeneficiarioSaldo")}</TableCell>
                </TableRow>
              ) : filteredBeneficiari.map((b) => {
                const stato = statoKey(b.creditoSolidaleStato);
                const canOperate = emporioAbilitato && b.attivo && b.creditoSolidaleAbilitato && b.creditoSolidaleStato === "attivo";
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-medium">{b.cognome} {b.nome}</div>
                      <div className="text-xs text-muted-foreground">{b.codice}</div>
                    </TableCell>
                    <TableCell className="font-medium">{formatCredito(b.creditoSolidaleSaldo)}</TableCell>
                    <TableCell>{formatCredito(b.creditoSolidaleMensileAssegnato)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusClasses[stato]}>{t(`creditoSolidale.stato.${stato}`)}</Badge>
                    </TableCell>
                    <TableCell>{b.magazzinoEmporioPreferitoNome ?? "-"}</TableCell>
                    <TableCell>{formatDateTime(b.creditoSolidaleDataUltimoMovimento)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="ghost" size="icon" onClick={() => setSelectedBeneficiarioId(String(b.id))} title={t("creditoSolidale.apriMovimenti")}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openAction("ricarica", b)} disabled={!canOperate}>
                          <RefreshCw className="h-4 w-4 mr-1" /> {t("creditoSolidale.ricaricaCreditoSolidale")}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openAction("rettifica", b)} disabled={!canOperate}>
                          {t("creditoSolidale.rettificaCreditoSolidale")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              {selectedBeneficiario ? `${t("creditoSolidale.movimentiCreditoSolidale")} - ${selectedBeneficiario.cognome} ${selectedBeneficiario.nome}` : t("creditoSolidale.movimentiCreditoSolidale")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedBeneficiario && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/beneficiari/${selectedBeneficiario.id}`}>{t("creditoSolidale.apriScheda")}</Link>
              </Button>
            )}
            {(selectedMovimenti ?? movimentiRecenti ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("creditoSolidale.nessunMovimento")}</p>
            ) : (
              <div className="max-h-[380px] overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("creditoSolidale.dataMovimento")}</TableHead>
                      <TableHead>{t("creditoSolidale.movimentiCreditoSolidale")}</TableHead>
                      <TableHead>{t("creditoSolidale.variazioneCredito")}</TableHead>
                      <TableHead>{t("creditoSolidale.saldoDopo")}</TableHead>
                      <TableHead className="text-right">{t("creditoSolidale.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedMovimenti ?? movimentiRecenti ?? []).slice(0, 20).map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>{formatDateTime(m.dataMovimento)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{t(`creditoSolidale.movements.${m.tipoMovimento}`)}</div>
                          {m.annullato && <Badge variant="outline">{t("creditoSolidale.movimentoAnnullato")}</Badge>}
                        </TableCell>
                        <TableCell className={m.variazioneCredito < 0 ? "text-red-700" : "text-emerald-700"}>{formatCredito(m.variazioneCredito)}</TableCell>
                        <TableCell>{formatCredito(m.saldoDopo)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title={t("creditoSolidale.stornaMovimento")}
                            disabled={!emporioAbilitato || m.annullato || m.tipoMovimento === "storno"}
                            onClick={() => setStornoMovimento(m)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              {t("creditoSolidale.ricaricaMensile")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input type="month" value={periodo} onChange={(event) => setPeriodo(event.target.value)} />
              <Select value={ricaricaCentro} onValueChange={setRicaricaCentro}>
                <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tuttiCentri")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("creditoSolidale.tuttiCentri")}</SelectItem>
                  {centri?.map((centro) => <SelectItem key={centro.id} value={String(centro.id)}>{centro.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ricaricaCitta} onValueChange={setRicaricaCitta}>
                <SelectTrigger><SelectValue placeholder={t("creditoSolidale.tutteLeAree")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("creditoSolidale.tutteLeAree")}</SelectItem>
                  {citta?.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Textarea rows={2} value={ricaricaNote} onChange={(event) => setRicaricaNote(event.target.value)} placeholder={t("creditoSolidale.noteOperative")} disabled={!emporioAbilitato} />
            <div className="flex flex-wrap gap-2 justify-end">
              <Button type="button" variant="outline" onClick={handlePreview} disabled={previewRicarica.isPending}>
                {t("creditoSolidale.aggiornaPreview")}
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmRicaricaOpen(true)}
                disabled={!emporioAbilitato || !preview || preview.totaleRicaricabili === 0 || executeRicarica.isPending}
              >
                {t("creditoSolidale.eseguiRicaricaMensile")}
              </Button>
            </div>
            {preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{t("creditoSolidale.ricaricabili")}</div>
                    <div className="text-xl font-semibold">{preview.totaleRicaricabili}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{t("creditoSolidale.giaRicaricati")}</div>
                    <div className="text-xl font-semibold">{preview.totaleGiaRicaricati}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{t("creditoSolidale.esclusi")}</div>
                    <div className="text-xl font-semibold">{preview.totaleEsclusi}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{t("creditoSolidale.creditoDaRicaricare")}</div>
                    <div className="text-xl font-semibold">{formatCredito(preview.totaleCreditoDaRicaricare)}</div>
                  </div>
                </div>
                <div className="max-h-[300px] overflow-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("creditoSolidale.beneficiario")}</TableHead>
                        <TableHead>{t("creditoSolidale.quotaMensileAssegnata")}</TableHead>
                        <TableHead>{t("creditoSolidale.saldoAttuale")}</TableHead>
                        <TableHead>{t("creditoSolidale.saldoPrevisto")}</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.righe.map((riga) => (
                        <TableRow key={riga.beneficiarioId}>
                          <TableCell>{riga.beneficiarioNome}</TableCell>
                          <TableCell>{formatCredito(riga.creditoSolidaleMensileAssegnato)}</TableCell>
                          <TableCell>{formatCredito(riga.saldoAttuale)}</TableCell>
                          <TableCell>{formatCredito(riga.saldoPrevistoDopoRicarica)}</TableCell>
                          <TableCell>
                            {riga.ricaricabile ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">{t("creditoSolidale.ricaricabili")}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">{riga.motivoEsclusione ?? t("creditoSolidale.esclusi")}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={action != null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.tipo === "ricarica" ? t("creditoSolidale.ricaricaCreditoSolidale") : t("creditoSolidale.rettificaCreditoSolidale")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {action && <p className="text-sm text-muted-foreground">{action.beneficiario.cognome} {action.beneficiario.nome}</p>}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.variazioneCredito")}</label>
              <Input type="number" step="0.01" value={variazione} onChange={(event) => setVariazione(event.target.value)} disabled={actionDisabled} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.motivo")}</label>
              <Textarea rows={2} value={motivo} onChange={(event) => setMotivo(event.target.value)} disabled={actionDisabled} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.noteOperative")}</label>
              <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} disabled={actionDisabled} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAction(null)}>{t("creditoSolidale.annulla")}</Button>
            <Button type="button" onClick={submitAction} disabled={actionDisabled}>
              {action?.tipo === "ricarica" ? t("creditoSolidale.salvaRicarica") : t("creditoSolidale.salvaRettifica")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRicaricaOpen} onOpenChange={setConfirmRicaricaOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("creditoSolidale.confermaEsecuzioneTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("creditoSolidale.confermaEsecuzioneDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("creditoSolidale.annulla")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecute}>{t("creditoSolidale.conferma")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stornoMovimento != null} onOpenChange={(open) => !open && setStornoMovimento(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("creditoSolidale.confermaStornoTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("creditoSolidale.confermaStornoDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("creditoSolidale.motivoStorno")}</label>
            <Textarea rows={2} value={stornoMotivo} onChange={(event) => setStornoMotivo(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("creditoSolidale.annulla")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleStorno}>{t("creditoSolidale.conferma")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
