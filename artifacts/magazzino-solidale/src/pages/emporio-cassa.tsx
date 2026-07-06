import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getBollaStampaSpesaEmporio,
  getGetSpesaEmporioQueryKey,
  getGetSessioneCassaEmporioQueryKey,
  getListAccessiEmporioQueryKey,
  getListSpeseEmporioQueryKey,
  getListSessioniCassaEmporioQueryKey,
  getSearchBeneficiariCassaEmporioQueryKey,
  getSearchProdottiCassaEmporioQueryKey,
  listSessioniCassaEmporio,
  searchBeneficiariCassaEmporio,
  searchProdottiCassaEmporio,
  useAddSessioneCassaEmporioRiga,
  useAnnullaSessioneCassaEmporio,
  useApriSessioneCassaEmporio,
  useChiudiSessioneCassaEmporio,
  useDeleteSessioneCassaEmporioRiga,
  useForzaAccessoEmporioCassa,
  useGetSessioneCassaEmporio,
  useGetImpostazioniStampa,
  useListCitta,
  useListMagazzini,
  useListSessioniCassaEmporio,
  usePreparaChiusuraSessioneCassaEmporio,
  useRegistraInvioManualeBollaSpesaEmporio,
  useRefreshCreditoSolidaleBeneficiario,
  useRiprendiSessioneCassaEmporio,
  useSearchBeneficiariCassaEmporio,
  useSearchProdottiCassaEmporio,
  useSospendiSessioneCassaEmporio,
  useUpdateSessioneCassaEmporioRiga,
  type BollaEmporioEmailResult,
  type BollaEmporioStampa,
  type SessioneCassaEmporio,
  type SessioneCassaEmporioAccessoValido,
  type SessioneCassaEmporioRicercaBeneficiarioResult,
  type SessioneCassaEmporioRicercaProdottoResult,
  type SessioneCassaEmporioStato,
  type SpesaEmporio,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Barcode, CheckCircle2, Copy, Download, FileText, Mail, Minus, Pause, Play, Plus, RefreshCw, Search, ShieldAlert, ShoppingCart, Trash2, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
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
import { downloadBollaPdf } from "@/pages/bolle";
import type { BollaTemplate } from "@/lib/bolla-pdf";

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

function normalizeSearchToken(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildBollaPrintHtml(data: BollaEmporioStampa): string {
  const rows = data.righe.map((riga) => `
    <tr>
      <td>${escapeHtml(riga.descrizioneProdotto)}</td>
      <td>${escapeHtml(riga.codiceProdotto ?? "")}</td>
      <td>${escapeHtml(riga.codiceLotto ?? "")}</td>
      <td class="num">${escapeHtml(riga.quantita)}</td>
      <td class="num">${escapeHtml(formatCredito(riga.creditoUnitario))}</td>
      <td class="num">${escapeHtml(formatCredito(riga.creditoTotale))}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Bolla Emporio ${escapeHtml(data.numeroBolla ?? "")}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 16px; margin: 24px 0 8px; }
    .muted { color: #6b7280; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-top: 18px; }
    .label { color: #6b7280; font-size: 12px; }
    .value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #f3f4f6; }
    .num { text-align: right; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
    .line { border-top: 1px solid #111827; padding-top: 8px; color: #6b7280; }
    @media print { body { margin: 18mm; } button { display: none; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.intestazione)}</h1>
  <div class="muted">Bolla Emporio</div>
  <div class="grid">
    <div><div class="label">Numero Bolla</div><div class="value">${escapeHtml(data.numeroBolla ?? "-")}</div></div>
    <div><div class="label">Numero Spesa</div><div class="value">${escapeHtml(data.numeroSpesa)}</div></div>
    <div><div class="label">Data chiusura</div><div class="value">${escapeHtml(formatDateTime(data.dataChiusura))}</div></div>
    <div><div class="label">Beneficiario</div><div class="value">${escapeHtml(data.beneficiario ?? "-")}</div></div>
    <div><div class="label">Codice beneficiario</div><div class="value">${escapeHtml(data.beneficiarioCodice ?? "-")}</div></div>
    <div><div class="label">Centro di Ascolto</div><div class="value">${escapeHtml(data.centroAscolto ?? "-")}</div></div>
    <div><div class="label">Emporio</div><div class="value">${escapeHtml(data.emporio ?? "-")}</div></div>
    <div><div class="label">Operatore</div><div class="value">${escapeHtml(data.operatore ?? "-")}</div></div>
  </div>
  <h2>Prodotti consegnati</h2>
  <table>
    <thead><tr><th>Prodotto</th><th>Codice</th><th>Lotto</th><th>Quantità</th><th>Valore Credito Solidale prodotto</th><th>Credito consumato</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="grid">
    <div><div class="label">Totale Credito consumato</div><div class="value">${escapeHtml(formatCredito(data.totaleCreditoConsumati))}</div></div>
    <div><div class="label">Saldo precedente</div><div class="value">${escapeHtml(formatCredito(data.saldoPrima))}</div></div>
    <div><div class="label">Saldo residuo</div><div class="value">${escapeHtml(formatCredito(data.saldoDopo))}</div></div>
    <div><div class="label">Note</div><div class="value">${escapeHtml(data.note ?? "-")}</div></div>
  </div>
  <div class="signatures">
    <div class="line">Firma operatore</div>
    <div class="line">Firma beneficiario / delegato</div>
  </div>
  <script>window.addEventListener("load", () => window.print());</script>
</body>
</html>`;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function downloadHtmlFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildBollaLink(spesa: SpesaEmporio): string {
  const path = `/api/spese-emporio/${spesa.id}/bolla-stampa`;
  return `${window.location.origin}${path}`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function sessioneModificabile(sessione: SessioneCassaEmporio | undefined): boolean {
  return sessione?.statoSessione === "aperta" || sessione?.statoSessione === "sospesa" || sessione?.statoSessione === "pronta_per_chiusura";
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
  const { data: impostazioniStampa } = useGetImpostazioniStampa();
  const initialAccessoEmporioId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("accessoEmporioId");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  }, []);

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
  const [forzaOpen, setForzaOpen] = useState(false);
  const [motivoForzatura, setMotivoForzatura] = useState("");
  const [forzaEmporioId, setForzaEmporioId] = useState("");
  const [chiudiOpen, setChiudiOpen] = useState(false);
  const [chiusuraSpesa, setChiusuraSpesa] = useState<SpesaEmporio | null>(null);
  const [emailDraftBolla, setEmailDraftBolla] = useState<BollaEmporioEmailResult | null>(null);
  const [autoAccessoOpened, setAutoAccessoOpened] = useState(false);

  const beneficiarioQuery = beneficiarioSearch.trim();
  const prodottoQuery = prodottoSearch.trim();

  const { data: citta = [] } = useListCitta();
  const { data: magazzini = [] } = useListMagazzini();
  const empori = useMemo(
    () => magazzini.filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );
  const areaId = optionalId(areaFilter);
  const emporiFiltrati = useMemo(
    () => areaId == null ? empori : empori.filter((m) => m.cittaId === areaId),
    [areaId, empori],
  );
  const contestoCassaCompleto = areaFilter !== ALL && emporioFilter !== ALL;
  const contestoSelezioneBloccato = selectedBeneficiario != null || selectedSessioneId != null || chiusuraSpesa != null;

  useEffect(() => {
    if (emporioFilter === ALL) return;
    if (!emporiFiltrati.some((m) => String(m.id) === emporioFilter)) {
      setEmporioFilter(ALL);
      resetContextSelection();
    }
  }, [emporiFiltrati, emporioFilter]);

  const searchContext = {
    data: cassaDate || undefined,
    cittaId: areaId,
    magazzinoEmporioId: optionalId(emporioFilter),
  };
  const beneficiariSearchParams = {
    search: beneficiarioQuery || undefined,
    ...searchContext,
  };
  const sessioniSearchParams = {
    statoSessione: statoFilter === ALL ? undefined : (statoFilter as SessioneCassaEmporioStato),
    beneficiarioSearch: sessioneSearch.trim() || undefined,
    ...searchContext,
  };

  const { data: beneficiari = [] } = useSearchBeneficiariCassaEmporio(beneficiariSearchParams, {
    query: {
      queryKey: getSearchBeneficiariCassaEmporioQueryKey(beneficiariSearchParams),
      enabled: emporioAbilitato && contestoCassaCompleto && !contestoSelezioneBloccato,
    },
  });
  const { data: sessioni = [] } = useListSessioniCassaEmporio(sessioniSearchParams, {
    query: {
      queryKey: getListSessioniCassaEmporioQueryKey(sessioniSearchParams),
      refetchInterval: 5000,
    },
  });
  const sessioneQuery = useGetSessioneCassaEmporio(selectedSessioneId ?? 0, {
    query: {
      queryKey: getGetSessioneCassaEmporioQueryKey(selectedSessioneId ?? 0),
      enabled: selectedSessioneId != null,
      refetchInterval: selectedSessioneId != null ? 2500 : false,
    },
  });
  const sessione = sessioneQuery.data;
  const prodottiSearchParams = {
    search: prodottoQuery || undefined,
    magazzinoEmporioId: sessione?.magazzinoEmporioId,
  };
  const { data: prodotti = [] } = useSearchProdottiCassaEmporio(prodottiSearchParams, {
    query: {
      queryKey: getSearchProdottiCassaEmporioQueryKey(prodottiSearchParams),
      enabled: emporioAbilitato && sessione != null && sessioneModificabile(sessione),
    },
  });
  const beneficiariVisibili = contestoSelezioneBloccato ? [] : beneficiari;

  const invalidate = () => {
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: getListAccessiEmporioQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSpeseEmporioQueryKey() });
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
        if (data.cittaId != null && areaFilter === ALL) setAreaFilter(String(data.cittaId));
        if (data.magazzinoEmporioId != null && emporioFilter === ALL) setEmporioFilter(String(data.magazzinoEmporioId));
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
  const deleteRiga = useDeleteSessioneCassaEmporioRiga({
    mutation: {
      onSuccess: (data) => {
        setSelectedSessioneId(data.id);
        queryClient.setQueryData(getGetSessioneCassaEmporioQueryKey(data.id), data);
        refreshSessione();
      },
      onError,
    },
  });
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
  const forzaAccesso = useForzaAccessoEmporioCassa({
    mutation: {
      onSuccess: (data) => {
        setForzaOpen(false);
        setMotivoForzatura("");
        setForzaEmporioId("");
        setSelectedSessioneId(data.sessione.id);
        queryClient.setQueryData(getGetSessioneCassaEmporioQueryKey(data.sessione.id), data.sessione);
        invalidate();
        toast({ title: data.messaggio ?? t("cassaEmporio.accessoForzatoCreato") });
      },
      onError,
    },
  });
  const chiudi = useChiudiSessioneCassaEmporio({
    mutation: {
      onSuccess: (data) => {
        setChiudiOpen(false);
        setChiusuraSpesa(data.spesa ?? null);
        if (data.sessione?.id) {
          setSelectedSessioneId(data.sessione.id);
          queryClient.setQueryData(getGetSessioneCassaEmporioQueryKey(data.sessione.id), data.sessione);
        }
        invalidate();
        toast({ title: data.messaggio ?? t("cassaEmporio.spesaChiusa") });
      },
      onError,
    },
  });
  const registraInvioManualeBolla = useRegistraInvioManualeBollaSpesaEmporio();
  const refreshCredito = useRefreshCreditoSolidaleBeneficiario();

  useEffect(() => {
    setEmailDraftBolla(null);
  }, [chiusuraSpesa?.id]);

  useEffect(() => {
    if (!emporioAbilitato || autoAccessoOpened || initialAccessoEmporioId == null) return;
    setAutoAccessoOpened(true);
    apriSessione.mutate({ accessoEmporioId: initialAccessoEmporioId, data: {} });
  }, [apriSessione, autoAccessoOpened, emporioAbilitato, initialAccessoEmporioId]);

  const activeAccessi = useMemo(
    () => selectedBeneficiario?.accessi.filter((a) => a.statoAccessoEmporio !== "annullato" && a.statoAccessoEmporio !== "non_presentato") ?? [],
    [selectedBeneficiario],
  );
  const activeSessione = sessione ?? undefined;
  const canEdit = emporioAbilitato && sessioneModificabile(activeSessione);
  const saldoInsufficiente = (activeSessione?.creditoResiduoPrevisto ?? 0) < 0;

  const findExistingOpenSession = async (b: SessioneCassaEmporioRicercaBeneficiarioResult) => {
    const liveSessioni = await listSessioniCassaEmporio({
      beneficiarioSearch: b.beneficiarioCodice,
      magazzinoEmporioId: optionalId(emporioFilter),
      cittaId: areaId ?? b.cittaId ?? undefined,
    }).catch(() => sessioni);
    return liveSessioni.find((s) =>
      s.beneficiarioId === b.beneficiarioId &&
      ["aperta", "sospesa", "pronta_per_chiusura"].includes(s.statoSessione)
    );
  };

  const selectBeneficiario = async (b: SessioneCassaEmporioRicercaBeneficiarioResult) => {
    if (!contestoCassaCompleto) {
      toast({ variant: "destructive", title: t("cassaEmporio.selezionaEmporioPrima") });
      return;
    }
    setSelectedBeneficiario(b);
    setBeneficiarioSearch(b.beneficiarioCodice);
    const existing = await findExistingOpenSession(b);
    if (existing) {
      setSelectedSessioneId(existing.id);
      void queryClient.invalidateQueries({ queryKey: getGetSessioneCassaEmporioQueryKey(existing.id) });
      toast({ title: t("cassaEmporio.sessioneGiaApertaUtente") });
    }
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
    if (!contestoCassaCompleto) {
      toast({ variant: "destructive", title: t("cassaEmporio.selezionaEmporioPrima") });
      return;
    }
    const liveResults = await searchBeneficiariCassaEmporio({
      search: currentSearch || undefined,
      ...searchContext,
    }).catch(() => beneficiari);
    const normalized = normalizeSearchToken(currentSearch);
    const exact = liveResults.find((b) =>
      normalizeSearchToken(b.beneficiarioCodice) === normalized ||
      normalizeSearchToken(b.beneficiarioCodiceFiscale) === normalized
    ) ?? liveResults[0];
    if (exact) void selectBeneficiario(exact);
  };

  const onBeneficiarioScan = (value: string) => {
    if (!contestoCassaCompleto) {
      toast({ variant: "destructive", title: t("cassaEmporio.selezionaEmporioPrima") });
      return;
    }
    setBeneficiarioSearch(value);
    void searchBeneficiariCassaEmporio({
      search: value.trim() || undefined,
      ...searchContext,
    })
      .then((results) => {
        const normalized = normalizeSearchToken(value);
        const exact = results.find((b) =>
          normalizeSearchToken(b.beneficiarioCodice) === normalized ||
          normalizeSearchToken(b.beneficiarioCodiceFiscale) === normalized
        ) ?? results[0];
        if (exact) void selectBeneficiario(exact);
        else toast({ title: t("cassaEmporio.nessunRisultato"), variant: "destructive" });
      })
      .catch(() => toast({ title: t("common.error"), variant: "destructive" }));
  };

  const addProductBySearch = async (value: string) => {
    if (!activeSessione || !canEdit) return;
    const currentSearch = value.trim();
    if (!currentSearch) return;
    const liveResults = await searchProdottiCassaEmporio({
      search: currentSearch,
      magazzinoEmporioId: activeSessione.magazzinoEmporioId,
    }).catch(() => prodotti);
    const normalized = normalizeSearchToken(currentSearch);
    const exact = liveResults.find((p) =>
      normalizeSearchToken(p.codice) === normalized ||
      normalizeSearchToken(p.codiceBarre) === normalized ||
      normalizeSearchToken(p.nome) === normalized
    );
    const prodotto = exact ?? liveResults[0];
    if (prodotto) {
      addProduct(prodotto);
      return;
    }
    toast({ title: t("cassaEmporio.prodottoNonTrovato"), variant: "destructive" });
  };

  const onProdottoKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void addProductBySearch(event.currentTarget.value);
  };

  const onProdottoScan = (value: string) => {
    setProdottoSearch(value);
    void addProductBySearch(value);
  };

  const resetContextSelection = () => {
    setSelectedBeneficiario(null);
    setSelectedSessioneId(null);
    setChiusuraSpesa(null);
    setProdottoSearch("");
  };

  const exitCassaContext = () => {
    resetContextSelection();
    setBeneficiarioSearch("");
  };

  const openForzaDialog = () => {
    const currentEmporioId = optionalId(emporioFilter);
    if (!currentEmporioId) {
      toast({ variant: "destructive", title: t("cassaEmporio.selezionaEmporioPrima") });
      return;
    }
    setForzaEmporioId(String(currentEmporioId));
    setMotivoForzatura("");
    setForzaOpen(true);
  };

  const submitForzaAccesso = () => {
    if (!selectedBeneficiario || !forzaEmporioId || !motivoForzatura.trim()) return;
    forzaAccesso.mutate({
      data: {
        beneficiarioId: selectedBeneficiario.beneficiarioId,
        magazzinoEmporioId: Number(forzaEmporioId),
        data: cassaDate,
        motivoAccessoForzato: motivoForzatura.trim(),
        noteAccessoEmporio: t("cassaEmporio.accessoForzatoDaCassa"),
      },
    });
  };

  const refreshCreditoBeneficiario = async (beneficiarioId: number) => {
    try {
      const result = await refreshCredito.mutateAsync({
        beneficiarioId,
        data: { note: t("cassaEmporio.refreshCreditoNote") },
      });
      if (result.saldo && selectedBeneficiario?.beneficiarioId === beneficiarioId) {
        setSelectedBeneficiario({
          ...selectedBeneficiario,
          saldoCreditoSolidale: result.saldo.saldoAttuale,
        });
      }
      void queryClient.invalidateQueries({ queryKey: getSearchBeneficiariCassaEmporioQueryKey(beneficiariSearchParams) });
      void queryClient.invalidateQueries({ queryKey: getListSessioniCassaEmporioQueryKey(sessioniSearchParams) });
      void queryClient.invalidateQueries({
        predicate: (query) => String(query.queryKey[0] ?? "").includes("/api/credito-solidale"),
      });
      refreshSessione();
      toast({ title: result.messaggio ?? t("cassaEmporio.creditoAggiornato") });
    } catch (err) {
      toast({ variant: "destructive", title: extractError(err, t("cassaEmporio.creditoRefreshErrore")) });
    }
  };

  const downloadBolla = async (spesa: SpesaEmporio) => {
    try {
      if (spesa.bollaId != null) {
        await downloadBollaPdf(spesa.bollaId, {
          footer: impostazioniStampa?.footerBolla ?? null,
          template: (impostazioniStampa?.templateBolla as BollaTemplate) ?? "standard",
        });
        return;
      }
      const data = await getBollaStampaSpesaEmporio(spesa.id);
      downloadHtmlFile(buildBollaPrintHtml(data), `${safeFilename(data.numeroBolla ?? data.numeroSpesa)}.html`);
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const prepareEmailBolla = async (spesa: SpesaEmporio, openClient: boolean): Promise<BollaEmporioEmailResult | null> => {
    try {
      const result = await registraInvioManualeBolla.mutateAsync({
        id: spesa.id,
        data: { linkBolla: buildBollaLink(spesa) },
      });
      setEmailDraftBolla(result);
      if (result.spesa) {
        setChiusuraSpesa(result.spesa);
        queryClient.setQueryData(getGetSpesaEmporioQueryKey(spesa.id), result.spesa);
      }
      void queryClient.invalidateQueries({ queryKey: getListSpeseEmporioQueryKey() });
      if (openClient && result.mailtoHref) {
        window.location.href = result.mailtoHref;
        toast({ title: t("cassaEmporio.emailClientAperto") });
      } else if (openClient) {
        toast({
          title: t("cassaEmporio.nessunDestinatarioEmail"),
          description: result.messaggio,
          variant: "destructive",
        });
      }
      return result;
    } catch (err) {
      toast({ variant: "destructive", title: extractError(err, t("cassaEmporio.emailPreparazioneErrore")) });
      return null;
    }
  };

  const copyBollaLink = async (spesa: SpesaEmporio) => {
    await copyText(emailDraftBolla?.linkBolla ?? buildBollaLink(spesa));
    toast({ title: t("cassaEmporio.linkBollaCopiato") });
  };

  const copyEmailText = async (spesa: SpesaEmporio) => {
    const draft = emailDraftBolla?.corpo ? emailDraftBolla : await prepareEmailBolla(spesa, false);
    if (!draft?.corpo) return;
    await copyText(draft.corpo);
    toast({ title: t("cassaEmporio.testoEmailCopiato") });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">{t("cassaEmporio.titolo")}</h1>
          <p className="text-sm text-muted-foreground">{t("cassaEmporio.sottotitolo")}</p>
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
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.area")}</label>
                <Select
                  value={areaFilter}
                  onValueChange={(value) => {
                    setAreaFilter(value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato || contestoSelezioneBloccato}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("cassaEmporio.tutteLeAree")}</SelectItem>
                    {citta.map((area) => <SelectItem key={area.id} value={String(area.id)}>{area.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.dataCassa")}</label>
                <Input
                  type="date"
                  value={cassaDate}
                  onChange={(e) => {
                    setCassaDate(e.target.value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato || contestoSelezioneBloccato}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cassaEmporio.emporio")}</label>
                <Select
                  value={emporioFilter}
                  onValueChange={(value) => {
                    setEmporioFilter(value);
                    resetContextSelection();
                  }}
                  disabled={!emporioAbilitato || contestoSelezioneBloccato}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("cassaEmporio.tuttiGliEmpori")}</SelectItem>
                    {emporiFiltrati.map((emporio) => <SelectItem key={emporio.id} value={String(emporio.id)}>{emporio.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {contestoSelezioneBloccato && (
                <Button type="button" variant="outline" onClick={exitCassaContext}>
                  {t("cassaEmporio.esciCassa")}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Barcode className="h-4 w-4" />{t("cassaEmporio.scansionaBeneficiario")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={beneficiarioSearch}
                  onChange={(e) => setBeneficiarioSearch(e.target.value)}
                  onKeyDown={onBeneficiarioKeyDown}
                  placeholder={!contestoCassaCompleto ? t("cassaEmporio.selezionaEmporioPrima") : t("cassaEmporio.cercaBeneficiarioPlaceholder")}
                  disabled={!emporioAbilitato || !contestoCassaCompleto || contestoSelezioneBloccato}
                />
                <BarcodeScannerButton
                  onScan={onBeneficiarioScan}
                  disabled={!emporioAbilitato || !contestoCassaCompleto || contestoSelezioneBloccato}
                />
              </div>
              <div className="max-h-64 space-y-2 overflow-auto">
                {beneficiariVisibili.map((b) => (
                  <button
                    key={b.beneficiarioId}
                    type="button"
                    className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
                    onClick={() => { void selectBeneficiario(b); }}
                    disabled={!emporioAbilitato}
                  >
                    <div className="font-medium">{b.beneficiarioNome}</div>
                    <div className="text-muted-foreground">{b.beneficiarioCodice}</div>
                    <div className="mt-1 text-xs">{t("cassaEmporio.saldoCreditoDisponibile")}: {formatCredito(b.saldoCreditoSolidale)}</div>
                  </button>
                ))}
                {!contestoCassaCompleto && <p className="text-sm text-muted-foreground">{t("cassaEmporio.selezionaEmporioPrima")}</p>}
                {contestoSelezioneBloccato && <p className="text-sm text-muted-foreground">{t("cassaEmporio.contestoCassaBloccato")}</p>}
                {beneficiarioQuery && beneficiariVisibili.length === 0 && contestoCassaCompleto && !contestoSelezioneBloccato && <p className="text-sm text-muted-foreground">{t("cassaEmporio.nessunRisultato")}</p>}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => { void refreshCreditoBeneficiario(selectedBeneficiario.beneficiarioId); }}
                      disabled={!emporioAbilitato || refreshCredito.isPending}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />{t("cassaEmporio.refreshCredito")}
                    </Button>
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
                        <Button className="mt-3 w-full" size="sm" onClick={() => openAccesso(accesso)} disabled={!emporioAbilitato || !contestoCassaCompleto || apriSessione.isPending}>
                          {t("cassaEmporio.apriSessione")}
                        </Button>
                      </div>
                    ))}
                    {activeAccessi.length === 0 && (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>{t("cassaEmporio.nessunAccessoValido")}</p>
                        <Button variant="outline" className="w-full" onClick={openForzaDialog} disabled={!emporioAbilitato || !selectedBeneficiario || !contestoCassaCompleto}>
                          {t("cassaEmporio.forzaAccesso")}
                        </Button>
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
                  <div className="md:col-span-2 xl:col-span-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void refreshCreditoBeneficiario(activeSessione.beneficiarioId); }}
                      disabled={!emporioAbilitato || refreshCredito.isPending || activeSessione.statoSessione === "chiusa"}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />{t("cassaEmporio.refreshCredito")}
                    </Button>
                  </div>
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
                  <div className="flex gap-2">
                    <Input
                      value={prodottoSearch}
                      onChange={(e) => setProdottoSearch(e.target.value)}
                      onKeyDown={onProdottoKeyDown}
                      placeholder={t("cassaEmporio.cercaProdottoPlaceholder")}
                      disabled={!canEdit}
                    />
                    <BarcodeScannerButton onScan={onProdottoScan} disabled={!canEdit} />
                  </div>
                  <div className="rounded-md border">
                    {prodotti.map((p) => (
                      <button
                        key={p.prodottoId}
                        type="button"
                        className="flex w-full items-start justify-between gap-3 border-b p-3 text-left text-sm last:border-b-0 hover:bg-muted"
                        onClick={() => addProduct(p)}
                        disabled={!canEdit || addRiga.isPending}
                      >
                        <span>
                          <span className="block font-medium">{p.nome}</span>
                          <span className="block text-muted-foreground">{p.codiceBarre ?? p.codice}</span>
                          <span className="block text-xs text-muted-foreground">{t("cassaEmporio.creditoUnitario")}: {formatCredito(p.creditoSolidaleValore)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline">{t("cassaEmporio.giacenzaDisponibile")}: {p.giacenzaDisponibile ?? "-"}</Badge>
                          <Plus className="h-4 w-4 text-muted-foreground" />
                        </span>
                      </button>
                    ))}
                    {prodottoQuery && prodotti.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("cassaEmporio.prodottoNonTrovato")}</p>}
                    {!prodottoQuery && prodotti.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("cassaEmporio.nessunProdottoEmporio")}</p>}
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
                    {activeSessione.statoSessione === "pronta_per_chiusura" && (
                      <Button onClick={() => setChiudiOpen(true)} disabled={!emporioAbilitato || chiudi.isPending}>
                        <FileText className="mr-2 h-4 w-4" />{t("cassaEmporio.chiudiSpesa")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {chiusuraSpesa && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t("cassaEmporio.spesaChiusa")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div><div className="text-muted-foreground">{t("cassaEmporio.numeroSpesa")}</div><div className="font-medium">{chiusuraSpesa.numeroSpesa}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.numeroBolla")}</div><div className="font-medium">{chiusuraSpesa.bollaNumero ?? "-"}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.creditoConsumati")}</div><div className="font-medium">{formatCredito(chiusuraSpesa.totaleCreditoConsumati)}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.saldoResiduo")}</div><div className="font-medium">{formatCredito(chiusuraSpesa.saldoDopo)}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.statoInvioEmailBolla")}</div><div className="font-medium">{t(`cassaEmporio.email.${chiusuraSpesa.emailBollaStato}`)}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.emailDataUltimoClick")}</div><div className="font-medium">{formatDateTime(chiusuraSpesa.emailBollaDataUltimoClick)}</div></div>
                      <div><div className="text-muted-foreground">{t("cassaEmporio.emailOperatore")}</div><div className="font-medium">{chiusuraSpesa.emailBollaOperatoreId ?? "-"}</div></div>
                      <div className="xl:col-span-2"><div className="text-muted-foreground">{t("cassaEmporio.emailOggetto")}</div><div className="font-medium">{chiusuraSpesa.emailBollaOggetto ?? emailDraftBolla?.oggetto ?? "-"}</div></div>
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row">
                      <Button type="button" variant="outline" onClick={() => { void downloadBolla(chiusuraSpesa); }}>
                        <Download className="mr-2 h-4 w-4" />{t("cassaEmporio.stampaBolla")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => { void prepareEmailBolla(chiusuraSpesa, true); }} disabled={registraInvioManualeBolla.isPending}>
                        <Mail className="mr-2 h-4 w-4" />{t("cassaEmporio.ritentaInvioEmailBolla")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => { void copyBollaLink(chiusuraSpesa); }}>
                        <Copy className="mr-2 h-4 w-4" />{t("cassaEmporio.copiaLinkBolla")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => { void copyEmailText(chiusuraSpesa); }} disabled={registraInvioManualeBolla.isPending}>
                        <Copy className="mr-2 h-4 w-4" />{t("cassaEmporio.copiaTestoEmail")}
                      </Button>
                      <Button type="button" variant="outline" asChild>
                        <Link href={`/emporio/spese?spesaId=${chiusuraSpesa.id}`}>{t("cassaEmporio.apriDettaglioSpesa")}</Link>
                      </Button>
                    </div>
                    {chiusuraSpesa.emailBollaErrore && (
                      <p className="text-sm font-medium text-red-600">{chiusuraSpesa.emailBollaErrore}</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">{t("cassaEmporio.selezionaSessione")}</CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={forzaOpen} onOpenChange={setForzaOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("cassaEmporio.pianificazioneNonPresente")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={forzaEmporioId} onValueChange={setForzaEmporioId}>
              <SelectTrigger><SelectValue placeholder={t("cassaEmporio.selezionaEmporio")} /></SelectTrigger>
              <SelectContent>
                {emporiFiltrati.map((emporio) => <SelectItem key={emporio.id} value={String(emporio.id)}>{emporio.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea
              value={motivoForzatura}
              onChange={(e) => setMotivoForzatura(e.target.value)}
              placeholder={t("cassaEmporio.motivoAccessoForzato")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForzaOpen(false)}>{t("common.no")}</Button>
            <Button onClick={submitForzaAccesso} disabled={!forzaEmporioId || !motivoForzatura.trim() || forzaAccesso.isPending}>
              {t("cassaEmporio.forzaAccesso")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={chiudiOpen} onOpenChange={setChiudiOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("cassaEmporio.confermaChiusuraTitolo")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("cassaEmporio.confermaChiusuraDescrizione")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChiudiOpen(false)}>{t("common.cancel")}</Button>
            <Button
              onClick={() => activeSessione && chiudi.mutate({ id: activeSessione.id, data: {} })}
              disabled={!activeSessione || chiudi.isPending}
            >
              {t("cassaEmporio.chiudiSpesa")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
