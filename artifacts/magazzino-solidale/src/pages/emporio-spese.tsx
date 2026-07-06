import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getBollaStampaSpesaEmporio,
  getGetSpesaEmporioQueryKey,
  getListSpeseEmporioQueryKey,
  useGetSpesaEmporio,
  useGetImpostazioniStampa,
  useListCentriAscolto,
  useListMagazzini,
  useListSpeseEmporio,
  useRegistraInvioManualeBollaSpesaEmporio,
  type BollaEmporioEmailResult,
  type BollaEmporioStampa,
  type SpesaEmporio,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Copy, Download, Mail, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { downloadBollaPdf } from "@/pages/bolle";
import type { BollaTemplate } from "@/lib/bolla-pdf";

const ALL = "__all__";

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function optionalId(value: string): number | undefined {
  return value === ALL ? undefined : Number(value);
}

function formatCredito(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function buildPrintHtml(data: BollaEmporioStampa): string {
  const rows = data.righe.map((riga) => `
    <tr><td>${escapeHtml(riga.descrizioneProdotto)}</td><td>${escapeHtml(riga.codiceProdotto ?? "")}</td><td>${escapeHtml(riga.quantita)}</td><td>${escapeHtml(formatCredito(riga.creditoUnitario))}</td><td>${escapeHtml(formatCredito(riga.creditoTotale))}</td></tr>
  `).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8" /><title>Bolla Emporio ${escapeHtml(data.numeroBolla ?? "")}</title><style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#111827} h1{font-size:22px;margin:0 0 4px}.muted{color:#6b7280}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-top:18px}.label{font-size:12px;color:#6b7280}.value{font-weight:600} table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d1d5db;padding:8px;font-size:13px;text-align:left}th{background:#f3f4f6}.sign{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:48px}.line{border-top:1px solid #111827;padding-top:8px;color:#6b7280}@media print{body{margin:18mm}}
  </style></head><body>
    <h1>${escapeHtml(data.intestazione)}</h1><div class="muted">Bolla Emporio</div>
    <div class="grid">
      <div><div class="label">Numero Bolla</div><div class="value">${escapeHtml(data.numeroBolla ?? "-")}</div></div>
      <div><div class="label">Numero Spesa</div><div class="value">${escapeHtml(data.numeroSpesa)}</div></div>
      <div><div class="label">Data chiusura</div><div class="value">${escapeHtml(formatDateTime(data.dataChiusura))}</div></div>
      <div><div class="label">Beneficiario</div><div class="value">${escapeHtml(data.beneficiario ?? "-")}</div></div>
      <div><div class="label">Centro di Ascolto</div><div class="value">${escapeHtml(data.centroAscolto ?? "-")}</div></div>
      <div><div class="label">Emporio</div><div class="value">${escapeHtml(data.emporio ?? "-")}</div></div>
    </div>
    <table><thead><tr><th>Prodotto</th><th>Codice</th><th>Quantità</th><th>Valore Credito Solidale prodotto</th><th>Credito consumato</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="grid">
      <div><div class="label">Totale Credito consumato</div><div class="value">${escapeHtml(formatCredito(data.totaleCreditoConsumati))}</div></div>
      <div><div class="label">Saldo precedente</div><div class="value">${escapeHtml(formatCredito(data.saldoPrima))}</div></div>
      <div><div class="label">Saldo residuo</div><div class="value">${escapeHtml(formatCredito(data.saldoDopo))}</div></div>
    </div>
    <div class="sign"><div class="line">Firma operatore</div><div class="line">Firma beneficiario / delegato</div></div>
    <script>window.addEventListener("load",()=>window.print());</script>
  </body></html>`;
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
  return `${window.location.origin}/api/spese-emporio/${spesa.id}/bolla-stampa`;
}

function openMailClient(mailtoHref: string): void {
  const link = document.createElement("a");
  link.href = mailtoHref;
  document.body.appendChild(link);
  link.click();
  link.remove();
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

function emailBadgeClass(stato: string): string {
  if (stato === "invio_manuale_avviato") return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
  if (stato === "nessun_destinatario") return "bg-amber-500/10 text-amber-700 border-amber-200";
  if (stato === "errore") return "bg-red-500/10 text-red-700 border-red-200";
  return "bg-muted text-muted-foreground";
}

export default function EmporioSpese() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: impostazioniStampa } = useGetImpostazioniStampa();
  const initialSpesaId = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("spesaId");
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  }, []);
  const [dataDa, setDataDa] = useState(todayInput());
  const [dataA, setDataA] = useState(todayInput());
  const [beneficiarioSearch, setBeneficiarioSearch] = useState("");
  const [centroFilter, setCentroFilter] = useState(ALL);
  const [emporioFilter, setEmporioFilter] = useState(ALL);
  const [selectedId, setSelectedId] = useState<number | null>(initialSpesaId);
  const [emailDraftBolla, setEmailDraftBolla] = useState<BollaEmporioEmailResult | null>(null);

  const { data: centri = [] } = useListCentriAscolto();
  const { data: magazzini = [] } = useListMagazzini();
  const empori = useMemo(() => magazzini.filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"), [magazzini]);
  const params = {
    dataDa: dataDa || undefined,
    dataA: dataA || undefined,
    beneficiarioSearch: beneficiarioSearch.trim() || undefined,
    centroAscoltoId: optionalId(centroFilter),
    magazzinoEmporioId: optionalId(emporioFilter),
  };
  const { data: spese = [] } = useListSpeseEmporio(params);
  const { data: dettaglio } = useGetSpesaEmporio(selectedId ?? 0, {
    query: { enabled: selectedId != null, queryKey: getGetSpesaEmporioQueryKey(selectedId ?? 0) },
  });
  const registraInvioManualeBolla = useRegistraInvioManualeBollaSpesaEmporio();

  useEffect(() => {
    setEmailDraftBolla(null);
  }, [selectedId]);

  const printBolla = async (spesa: SpesaEmporio) => {
    try {
      if (spesa.bollaId != null) {
        await downloadBollaPdf(spesa.bollaId, {
          footer: impostazioniStampa?.footerBolla ?? null,
          template: (impostazioniStampa?.templateBolla as BollaTemplate) ?? "standard",
        });
        return;
      }
      const data = await getBollaStampaSpesaEmporio(spesa.id);
      downloadHtmlFile(buildPrintHtml(data), `${safeFilename(data.numeroBolla ?? data.numeroSpesa)}.html`);
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
      if (result.spesa) queryClient.setQueryData(getGetSpesaEmporioQueryKey(spesa.id), result.spesa);
      void queryClient.invalidateQueries({ queryKey: getListSpeseEmporioQueryKey() });
      if (openClient && result.mailtoHref) {
        openMailClient(result.mailtoHref);
        toast({ title: t("speseEmporio.emailClientAperto"), description: t("speseEmporio.emailClientApertoDescrizione") });
      } else if (openClient) {
        toast({
          title: t("speseEmporio.nessunDestinatarioEmail"),
          description: result.messaggio,
          variant: "destructive",
        });
      }
      return result;
    } catch {
      toast({ title: t("speseEmporio.emailPreparazioneErrore"), variant: "destructive" });
      return null;
    }
  };

  const copyBollaLink = async (spesa: SpesaEmporio) => {
    await copyText(emailDraftBolla?.linkBolla ?? buildBollaLink(spesa));
    toast({ title: t("speseEmporio.linkBollaCopiato") });
  };

  const copyEmailText = async (spesa: SpesaEmporio) => {
    const draft = emailDraftBolla?.corpo ? emailDraftBolla : await prepareEmailBolla(spesa, false);
    if (!draft?.corpo) return;
    await copyText(draft.corpo);
    toast({ title: t("speseEmporio.testoEmailCopiato") });
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("speseEmporio.titolo")}</h1>
        <p className="text-sm text-muted-foreground">{t("speseEmporio.sottotitolo")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4" />{t("speseEmporio.filtri")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Input type="date" value={dataDa} onChange={(e) => setDataDa(e.target.value)} />
          <Input type="date" value={dataA} onChange={(e) => setDataA(e.target.value)} />
          <Input value={beneficiarioSearch} onChange={(e) => setBeneficiarioSearch(e.target.value)} placeholder={t("speseEmporio.cercaBeneficiario")} />
          <Select value={centroFilter} onValueChange={setCentroFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiCentri")}</SelectItem>
              {centri.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={emporioFilter} onValueChange={setEmporioFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("creditoSolidale.tuttiEmpori")}</SelectItem>
              {empori.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("speseEmporio.dataChiusura")}</TableHead>
                  <TableHead>{t("speseEmporio.numeroSpesa")}</TableHead>
                  <TableHead>{t("speseEmporio.beneficiario")}</TableHead>
                  <TableHead>{t("speseEmporio.emporio")}</TableHead>
                  <TableHead>{t("speseEmporio.creditoConsumati")}</TableHead>
                  <TableHead>{t("speseEmporio.statoEmailBolla")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spese.map((spesa) => (
                  <TableRow key={spesa.id} className="cursor-pointer" onClick={() => setSelectedId(spesa.id)}>
                    <TableCell>{formatDateTime(spesa.dataChiusura)}</TableCell>
                    <TableCell>{spesa.numeroSpesa}<div className="text-xs text-muted-foreground">{spesa.bollaNumero ?? "-"}</div></TableCell>
                    <TableCell>{spesa.beneficiarioNome ?? "-"}</TableCell>
                    <TableCell>{spesa.magazzinoEmporioNome ?? "-"}</TableCell>
                    <TableCell>{formatCredito(spesa.totaleCreditoConsumati)}</TableCell>
                    <TableCell><Badge variant="outline" className={emailBadgeClass(spesa.emailBollaStato)}>{t(`speseEmporio.email.${spesa.emailBollaStato}`)}</Badge></TableCell>
                  </TableRow>
                ))}
                {spese.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("speseEmporio.nessunaSpesa")}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">{t("speseEmporio.dettaglio")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {dettaglio ? (
              <>
                <div className="grid gap-2">
                  <div><span className="text-muted-foreground">{t("speseEmporio.numeroSpesa")}: </span><span className="font-medium">{dettaglio.numeroSpesa}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.numeroBolla")}: </span><span className="font-medium">{dettaglio.bollaNumero ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.beneficiario")}: </span><span className="font-medium">{dettaglio.beneficiarioNome ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.saldoPrima")}: </span><span className="font-medium">{formatCredito(dettaglio.saldoPrima)}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.saldoDopo")}: </span><span className="font-medium">{formatCredito(dettaglio.saldoDopo)}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.statoEmailBolla")}: </span><span className="font-medium">{t(`speseEmporio.email.${dettaglio.emailBollaStato}`)}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.emailDataUltimoClick")}: </span><span className="font-medium">{formatDateTime(dettaglio.emailBollaDataUltimoClick)}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.emailOperatore")}: </span><span className="font-medium">{dettaglio.emailBollaOperatoreId ?? "-"}</span></div>
                  <div><span className="text-muted-foreground">{t("speseEmporio.emailOggetto")}: </span><span className="font-medium">{dettaglio.emailBollaOggetto ?? emailDraftBolla?.oggetto ?? "-"}</span></div>
                </div>
                <div className="space-y-2">
                  {dettaglio.righe.map((riga) => (
                    <div key={riga.id} className="rounded-md border p-3">
                      <div className="font-medium">{riga.descrizioneProdotto}</div>
                      <div className="text-muted-foreground">{riga.codiceProdotto ?? "-"}</div>
                      <div>{t("speseEmporio.quantita")}: {riga.quantita}</div>
                      <div>{t("speseEmporio.creditoConsumati")}: {formatCredito(riga.creditoTotale)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="outline" onClick={() => printBolla(dettaglio)}><Download className="mr-2 h-4 w-4" />{t("speseEmporio.stampaBolla")}</Button>
                  {emailDraftBolla?.mailtoHref ? (
                    <Button variant="outline" asChild>
                      <a href={emailDraftBolla.mailtoHref} onClick={() => toast({ title: t("speseEmporio.emailClientAperto") })}>
                        <Mail className="mr-2 h-4 w-4" />{t("speseEmporio.ritentaInvioEmail")}
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => { void prepareEmailBolla(dettaglio, true); }} disabled={registraInvioManualeBolla.isPending}>
                      <Mail className="mr-2 h-4 w-4" />{t("speseEmporio.ritentaInvioEmail")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { void copyBollaLink(dettaglio); }}>
                    <Copy className="mr-2 h-4 w-4" />{t("speseEmporio.copiaLinkBolla")}
                  </Button>
                  <Button variant="outline" onClick={() => { void copyEmailText(dettaglio); }} disabled={registraInvioManualeBolla.isPending}>
                    <Copy className="mr-2 h-4 w-4" />{t("speseEmporio.copiaTestoEmail")}
                  </Button>
                </div>
                {dettaglio.emailBollaErrore && (
                  <p className="text-sm font-medium text-red-600">{dettaglio.emailBollaErrore}</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{t("speseEmporio.selezionaSpesa")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
