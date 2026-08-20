import { useEffect, useState, useMemo } from "react";
import { Link, useParams } from "wouter";
import { useGetBeneficiario, getGetBeneficiarioQueryKey, getListAccessiEmporioQueryKey, useListAccessiEmporio, useListCentriAscolto, useListMagazzini, useUpdateBeneficiario, useAddNucleoFamiliare, useDeleteNucleoFamiliare, useListAreeOperative, useListZoneUds, useCalcolaCreditoSolidaleBeneficiario, getCalcolaCreditoSolidaleBeneficiarioQueryKey, getGetCreditoSolidaleBeneficiarioSaldoQueryKey, getListBeneficiariQueryKey, getListAreeOperativeQueryKey, getListCreditoSolidaleBeneficiarioMovimentiQueryKey, useCreateCreditoSolidaleRettifica, useCreateCreditoSolidaleRicaricaManuale, useGetCreditoSolidaleBeneficiarioSaldo, useListCreditoSolidaleBeneficiarioMovimenti, useUpdateCreditoSolidaleBeneficiarioConfigurazione, useCreateTesseraBeneficiarioDaAnagrafica, useListTessereBeneficiarioDaAnagrafica, getListTessereBeneficiarioDaAnagraficaQueryKey, type TesseraBeneficiario, type BeneficiarioDettaglio as BeneficiarioDettaglioType, type CreditoSolidaleMovimento, type Intervento, type NucleoFamiliareInputSesso } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useAuthorizeBeneficiariExport } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ExportButtons } from "@/components/export-buttons";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Calendar, Home, MapPin, Phone, Mail, User, Info, Users, Truck, ClipboardList, Building2, Pencil, Plus, Trash2, CreditCard, History, RefreshCw } from "lucide-react";
import { generateTesseraPdf, buildTesseraLabels } from "@/lib/tessera-pdf";
import { SchedaExportButtons } from "@/components/scheda-export";
import { loadTesseraBrandingForPdf } from "@/lib/branding-ambiente";
import { EMPORIO_DISABLED_MESSAGE, UNITA_STRADA_DISABLED_MESSAGE, useModuloFlags } from "@/lib/use-moduli";
import { SESSO_OPTIONS } from "@/lib/sesso-options";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { isNotFutureDateOnly, todayDateOnly } from "@/lib/date-only";
import { fasciaEtaLabel, fasciaEtaOrigineLabel } from "@/lib/fascia-eta";
import { InterventoStatoBadge, interventoDataLabel } from "@/components/intervento-workflow";
import { BeneficiarioMensaSection } from "@/components/beneficiario-mensa-card";

const NONE_VALUE = "__none__";
const STATI_CREDITO_SOLIDALE = ["non_abilitato", "attivo", "sospeso", "revocato"] as const;

function calcEta(dataNascita?: string | null): number | null {
  if (!dataNascita) return null;
  const d = new Date(dataNascita);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let eta = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) eta--;
  return eta;
}

const SESSO_LABEL: Record<string, string> = { M: "Maschio", F: "Femmina", ALTRO: "Altro" };

const apiErrorMessage = (e: unknown, fallback: string) =>
  (e as { data?: { error?: string } })?.data?.error ??
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
  fallback;

const formatCreditoQuota = (v: number | null | undefined): string =>
  v == null ? "-" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(v);

export default function BeneficiarioDettaglio() {
  const { t } = useTranslation();
  const { id } = useParams();
  const numId = Number(id);
  const { data: b, isLoading } = useGetBeneficiario(numId, { query: { enabled: !!id, queryKey: getGetBeneficiarioQueryKey(numId) } });
  const { data: centri } = useListCentriAscolto();
  const updateBeneficiario = useUpdateBeneficiario();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission("beneficiari.manage");
  const canViewSensitive = hasPermission("beneficiari.sensitive.view");
  const canExport = hasPermission("beneficiari.export");
  const canViewEmporioAccess = hasPermission("emporio.access.view");
  const canManageEmporioAccess = hasPermission("emporio.access.manage");
  const authorizeExport = useAuthorizeBeneficiariExport();
  const createTessera = useCreateTesseraBeneficiarioDaAnagrafica();
  const { emporioAbilitato, unitaStradaAbilitata } = useModuloFlags();
  const [editing, setEditing] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionCentroId, setCompletionCentroId] = useState("");
  const [replaceCardOpen, setReplaceCardOpen] = useState(false);
  const [replacementReason, setReplacementReason] = useState("");
  const { data: tessereBeneficiario, isLoading: tessereLoading } = useListTessereBeneficiarioDaAnagrafica(numId, {
    query: {
      queryKey: getListTessereBeneficiarioDaAnagraficaQueryKey(numId),
      enabled: Number.isInteger(numId) && numId > 0 && hasPermission("beneficiari.cards.manage"),
    },
  });
  const activeTessera = useMemo(() => (tessereBeneficiario ?? []).find((tessera) => tessera.stato === "attiva") ?? null, [tessereBeneficiario]);
  const { data: accessiEmporio } = useListAccessiEmporio(
    { beneficiarioId: numId },
    { query: { queryKey: getListAccessiEmporioQueryKey({ beneficiarioId: numId }), enabled: Number.isInteger(numId) && numId > 0 && canViewEmporioAccess } },
  );
  const prossimoAccesso = useMemo(() => {
    const now = Date.now();
    return (accessiEmporio ?? [])
      .filter((a) => a.dataOraInizio && new Date(a.dataOraInizio).getTime() >= now && a.statoAccessoEmporio !== "annullato" && a.statoAccessoEmporio !== "non_presentato")
      .sort((a, b) => new Date(a.dataOraInizio!).getTime() - new Date(b.dataOraInizio!).getTime())[0] ?? null;
  }, [accessiEmporio]);
  const ultimoAccesso = useMemo(() => {
    return (accessiEmporio ?? [])
      .filter((a) => a.statoAccessoEmporio === "effettuato")
      .sort((a, b) => new Date(b.dataOraInizio ?? 0).getTime() - new Date(a.dataOraInizio ?? 0).getTime())[0] ?? null;
  }, [accessiEmporio]);

  const onChangeCentro = (value: string) => {
    const next = value === NONE_VALUE ? null : parseInt(value);
    if (next === (b?.centroAscoltoId ?? null)) return;
    updateBeneficiario.mutate(
      { id: numId, data: { centroAscoltoId: next, versione: b?.versione ?? 0 } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          toast({ title: t("beneficiarioDettaglio.toastCentroUpdated") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorCentro"), variant: "destructive" }),
      },
    );
  };

  const onToggleUds = (next: boolean) => {
    if (next && b?.areaOperativaId == null && user?.areaOperativaId == null) {
      setEditing(true);
      toast({ title: t("beneficiarioDettaglio.error"), description: t("common.requiredField"), variant: "destructive" });
      return;
    }
    const data: Record<string, unknown> = { uds: next, versione: b?.versione };
    if (next) {
      if (b?.areaOperativaId != null) data.areaOperativaId = b.areaOperativaId;
      if (b?.zonaUdsId != null) data.zonaUdsId = b.zonaUdsId;
    }
    updateBeneficiario.mutate(
      { id: numId, data: data as never },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          toast({ title: t("beneficiarioDettaglio.toastUdsUpdated") });
        },
        onError: (e) => toast({
          title: t("beneficiarioDettaglio.error"),
          description: apiErrorMessage(e, t("beneficiarioDettaglio.errorUds")),
          variant: "destructive",
        }),
      },
    );
  };

  const printTessera = async (card: TesseraBeneficiario) => {
    if (!b) return;
    const { branding, logoDataUrl } = await loadTesseraBrandingForPdf();
    await generateTesseraPdf({
      beneficiario: { codice: card.codice, nome: b.nome, cognome: b.cognome, codiceFiscale: b.codiceFiscale },
      labels: buildTesseraLabels(t), associationLogoDataUrl: logoDataUrl, branding,
    });
  };

  const emitTessera = (motivoSostituzione?: string) => {
    createTessera.mutate({ id: numId, data: { motivoSostituzione: motivoSostituzione || null } }, {
      onSuccess: async (card) => {
        await queryClient.invalidateQueries({ queryKey: getListTessereBeneficiarioDaAnagraficaQueryKey(numId) });
        setReplaceCardOpen(false); setReplacementReason("");
        await printTessera(card);
        toast({ title: motivoSostituzione ? "Tessera sostituita e pronta per la stampa" : "Tessera emessa e pronta per la stampa" });
      },
      onError: (error) => toast({ title: "Tessera non emessa", description: apiErrorMessage(error, "Operazione non riuscita"), variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="p-6 space-y-6 max-w-7xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!b) return <div className="p-6">{t("beneficiarioDettaglio.notFound")}</div>;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">{b.cognome} {b.nome}</h1>
            <Badge variant="outline" className="font-mono text-muted-foreground">{b.codice}</Badge>
            {b.statoAnagrafica === "provvisoria" && <Badge variant="secondary">Anagrafica provvisoria</Badge>}
            {activeTessera && <Badge variant="outline">Tessera attiva {activeTessera.codice.startsWith("MS-") ? "MS" : "legacy"}</Badge>}
            {!b.attivo && <Badge variant="destructive">{t("common.inactive")}</Badge>}
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            {b.priorita === 'urgente' && <AlertCircle className="w-4 h-4 text-red-500" />}
            {t("beneficiarioDettaglio.priorityLabel")} <span className="font-medium capitalize">{b.priorita}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && b.statoAnagrafica === "provvisoria" && (
            <Button variant="outline" onClick={() => {
              setCompletionCentroId(String(b.centroAscoltoId ?? user?.centroAscoltoId ?? ""));
              setCompletionOpen(true);
            }}>Completa anagrafica</Button>
          )}
          {hasPermission("beneficiari.cards.manage") && b.statoAnagrafica === "completa" && (
            tessereLoading ? <Button variant="outline" disabled>Verifica tessera…</Button>
              : activeTessera ? <>
                <Button variant="outline" className="gap-2" onClick={() => void printTessera(activeTessera)}><CreditCard className="w-4 h-4" /> Stampa tessera attiva</Button>
                <Button variant="outline" className="gap-2" onClick={() => setReplaceCardOpen(true)}><RefreshCw className="w-4 h-4" /> Sostituisci tessera</Button>
              </> : <Button variant="outline" className="gap-2" disabled={createTessera.isPending} onClick={() => emitTessera()}>
                <CreditCard className="w-4 h-4" /> {t("tessera.generate")}
              </Button>
          )}
          {canExport && <SchedaExportButtons b={b} size="default" />}
          {canManage && <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}>
            <Pencil className="w-4 h-4" /> {t("beneficiarioDettaglio.editAnagrafica")}
          </Button>}
        </div>
      </div>

      <Dialog open={completionOpen} onOpenChange={setCompletionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Completa anagrafica provvisoria</DialogTitle>
            <DialogDescription>Associa la persona a un Centro di Ascolto e conferma i dati anagrafici minimi.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">La conferma associa la persona a un Centro di Ascolto ed è registrata nell’audit.</p>
            <Select value={completionCentroId} onValueChange={setCompletionCentroId}>
              <SelectTrigger><SelectValue placeholder="Seleziona il Centro di Ascolto" /></SelectTrigger>
              <SelectContent>{centri?.filter((centro) => centro.attivo).map((centro) => <SelectItem key={centro.id} value={String(centro.id)}>{centro.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletionOpen(false)}>Annulla</Button>
            <Button disabled={!completionCentroId || updateBeneficiario.isPending} onClick={() => updateBeneficiario.mutate(
              { id: numId, data: { statoAnagrafica: "completa", centroAscoltoId: Number(completionCentroId), versione: b.versione } }, {
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
                  queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
                  setCompletionOpen(false); toast({ title: "Anagrafica completata" });
                },
                onError: (error) => toast({ title: "Anagrafica non aggiornata", description: apiErrorMessage(error, "Controlla i dati obbligatori"), variant: "destructive" }),
              },
            )}>Conferma completamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replaceCardOpen} onOpenChange={setReplaceCardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sostituisci tessera attiva</DialogTitle>
            <DialogDescription>Revoca la tessera corrente e genera una nuova tessera trasversale.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">La tessera attuale verrà revocata e ne verrà generata una nuova con token opaco MS-*.</p>
            <Textarea value={replacementReason} onChange={(event) => setReplacementReason(event.target.value)} placeholder="Motivo obbligatorio della sostituzione" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceCardOpen(false)}>Annulla</Button>
            <Button disabled={!replacementReason.trim() || createTessera.isPending} onClick={() => emitTessera(replacementReason.trim())}>Revoca e genera nuova tessera</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <EditBeneficiarioSheet
          b={b}
          onClose={() => setEditing(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) });
            queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
            toast({ title: t("beneficiarioDettaglio.toastUpdated") });
            setEditing(false);
          }}
        />
      )}

      {hasPermission("credito.view") && <CreditoSolidaleSaldoPanel b={b} emporioAbilitato={emporioAbilitato} />}

      <BeneficiarioMensaSection beneficiario={b} />

      {canViewEmporioAccess && b.creditoSolidaleAbilitato && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {t("accessiEmporio.titolo")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
            <div>
              <div className="text-xs text-muted-foreground">{t("accessiEmporio.prossimoAccesso")}</div>
              <div className="font-medium">{prossimoAccesso?.dataOraInizio ? new Date(prossimoAccesso.dataOraInizio).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "-"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("accessiEmporio.ultimoAccesso")}</div>
              <div className="font-medium">{ultimoAccesso?.dataOraInizio ? new Date(ultimoAccesso.dataOraInizio).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "-"}</div>
            </div>
            {canManageEmporioAccess && <Button asChild className="gap-2">
              <Link href={`/emporio/accessi?beneficiarioId=${b.id}`}>{t("accessiEmporio.pianificaDaBeneficiario")}</Link>
            </Button>}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{t("beneficiarioDettaglio.anagraficaContatti")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <div className="font-medium">{b.domicilio || b.residenza || t("beneficiarioDettaglio.addressNotSpecified")}</div>
                  <div className="text-muted-foreground">{b.comune} {b.zonaMunicipio ? `(${b.zonaMunicipio})` : ''}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{b.telefono || "-"}</span>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span>{b.email || "-"}</span>
              </div>
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <span>{b.cittadinanza || t("beneficiarioDettaglio.cittadinanzaNotSpec")}</span>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>{t("beneficiarioDettaglio.bornOn", { date: b.dataNascita ? format(new Date(b.dataNascita), "dd/MM/yyyy") : "-" })}</span>
              </div>
              <div className="flex items-start gap-3">
                <Info className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <div>{fasciaEtaLabel(t, b.fasciaEtaCorrente)}</div>
                  <div className="text-xs text-muted-foreground">
                    {fasciaEtaOrigineLabel(t, b.fasciaEtaOrigine)}
                  </div>
                </div>
              </div>
            </div>

            {canManage && <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" /> {t("beneficiarioDettaglio.centroRiferimento")}
              </h4>
              <Select
                value={b.centroAscoltoId ? String(b.centroAscoltoId) : NONE_VALUE}
                onValueChange={onChangeCentro}
                disabled={updateBeneficiario.isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("common.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
                  {centri?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">{t("beneficiarioDettaglio.centroHelp")}</p>

              <div className="flex items-center justify-between mt-4">
                <div className="space-y-0.5 pr-3">
                  <span className="text-sm font-medium">{t("beneficiarioDettaglio.udsLabel")}</span>
                  <p className="text-xs text-muted-foreground">{t("beneficiarioDettaglio.udsHelp")}</p>
                </div>
                <Switch
                  checked={b.uds}
                  onCheckedChange={onToggleUds}
                  disabled={updateBeneficiario.isPending || !unitaStradaAbilitata}
                />
              </div>
              {!unitaStradaAbilitata && (
                <p className="text-xs text-muted-foreground mt-2">{UNITA_STRADA_DISABLED_MESSAGE}</p>
              )}
            </div>}

            {canViewSensitive && <div className="pt-4 border-t border-border mt-4">
              <h4 className="text-sm font-semibold mb-2">{t("beneficiarioDettaglio.noteAssistenziali")}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("beneficiarioDettaglio.consegnaDomicilioLabel")}</span>
                  <span className="font-medium">{b.consegnaDomicilio ? t("common.yes") : t("common.no")}</span>
                </div>
                {b.motivoConsegnaDomicilio && (
                  <p className="text-xs text-muted-foreground italic ml-2 border-l-2 pl-2 border-primary/20">{b.motivoConsegnaDomicilio}</p>
                )}
                {b.restrizioniAlimentari && (
                  <div className="bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 p-2 rounded text-xs">
                    <strong>{t("beneficiarioDettaglio.restrizioni")}</strong> {b.restrizioniAlimentari}
                  </div>
                )}
              </div>
            </div>}
          </CardContent>
        </Card>

        {canViewSensitive && <div className="md:col-span-2">
          <Tabs defaultValue="nucleo">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="nucleo" className="gap-2"><Users className="w-4 h-4" /> {t("beneficiarioDettaglio.tabNucleo", { count: b.numComponenti })}</TabsTrigger>
              <TabsTrigger value="interventi" className="gap-2"><ClipboardList className="w-4 h-4" /> {t("beneficiarioDettaglio.tabInterventi")}</TabsTrigger>
              <TabsTrigger value="consegne" className="gap-2"><Truck className="w-4 h-4" /> {t("beneficiarioDettaglio.tabConsegne")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="nucleo" className="mt-4">
              <NucleoSection
                b={b}
                onChanged={() => queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(numId) })}
              />
            </TabsContent>
            
            <TabsContent value="interventi" className="mt-4">
              <Card>
                <CardHeader className="py-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{t("beneficiarioDettaglio.storicoInterventi")}</CardTitle>
                  {canExport && <ExportButtons
                    rows={b.interventi ?? []}
                    columns={[
                      { header: t("common.date"), accessor: (i: Intervento) => interventoDataLabel(i) },
                      { header: t("beneficiarioDettaglio.colTipoIntervento"), accessor: (i) => i.tipoIntervento },
                      { header: t("beneficiarioDettaglio.colDescrizione"), accessor: (i) => i.descrizione },
                      { header: t("beneficiarioDettaglio.colEsito"), accessor: (i) => i.esito },
                      { header: t("beneficiarioDettaglio.colProssimaAzione"), accessor: (i) => i.prossimAzione },
                    ]}
                    filename={`interventi_${b.cognome}`}
                    title={t("beneficiarioDettaglio.exportInterventiTitle", { name: `${b.cognome} ${b.nome}` })}
                    orientation="landscape"
                    beforeExport={() => authorizeExport.mutateAsync({ data: { tipo: "interventi", beneficiarioId: b.id, numeroRecord: b.interventi?.length ?? 0 } }).then(() => undefined)}
                  />}
                </CardHeader>
                <CardContent className="pt-6">
                  {b.interventi && b.interventi.length > 0 ? (
                    <div className="space-y-4 border-l-2 border-muted pl-4 ml-2">
                      {b.interventi.map((i) => (
                        <div key={i.id} className="relative">
                          <div className="absolute -left-6 mt-1.5 w-3 h-3 bg-primary rounded-full ring-4 ring-background"></div>
                          <div className="text-sm font-medium text-muted-foreground mb-1">
                            {interventoDataLabel(i)}
                          </div>
                          <div className="bg-muted/30 p-3 rounded-md border">
                            <div className="flex justify-between items-start mb-2 gap-2">
                              <Badge className="capitalize bg-primary/10 text-primary hover:bg-primary/20">{i.tipoIntervento.replace('_', ' ')}</Badge>
                              <InterventoStatoBadge stato={i.stato} />
                            </div>
                            <p className="text-sm">{i.descrizione}</p>
                            {i.esito && <p className="text-xs text-muted-foreground mt-2 border-t pt-2"><strong>{t("beneficiarioDettaglio.esito")}</strong> {i.esito}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noInterventi")}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="consegne" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {b.consegne && b.consegne.length > 0 ? (
                    <div className="space-y-3">
                      {b.consegne.map((c) => (
                        <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="font-medium text-sm flex items-center gap-2">
                              {c.codice} 
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {c.tipoConsegna.replace('_', ' ')}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {t("beneficiarioDettaglio.prevista", { date: format(new Date(c.dataPrevista), "dd/MM/yyyy") })}
                            </div>
                          </div>
                          <Badge variant={
                            c.stato === 'effettuata' ? 'default' : 
                            c.stato === 'annullata' ? 'destructive' : 'secondary'
                          } className={c.stato === 'effettuata' ? 'bg-green-500 hover:bg-green-600' : ''}>
                            {c.stato === 'effettuata' ? t("beneficiarioDettaglio.statoConsegnata") : c.stato === 'pianificata' ? t("beneficiarioDettaglio.statoPianificata") : c.stato}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noConsegne")}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>}
      </div>
    </div>
  );
}

const makeEditSchema = (t: (k: string) => string) => z.object({
  cognome: z.string().min(1, t("beneficiarioDettaglio.required")),
  nome: z.string().min(1, t("beneficiarioDettaglio.required")),
  codiceFiscale: z.string().optional(),
  dataNascita: z.string().optional().refine(isNotFutureDateOnly, "La data di nascita non può essere successiva alla data odierna."),
  sesso: z.string().min(1, t("beneficiari.sessoRequired")),
  cittadinanza: z.string().optional(),
  areaProvenienza: z.string().min(1, t("beneficiarioDettaglio.required")),
  residenza: z.string().optional(),
  domicilio: z.string().optional(),
  comune: z.string().optional(),
  zonaMunicipio: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  priorita: z.string(),
  numComponenti: z.coerce.number().min(1),
  consegnaDomicilio: z.boolean(),
  motivoConsegnaDomicilio: z.string().optional(),
  restrizioniAlimentari: z.string().optional(),
  centroAscoltoId: z.string().optional(),
  creditoSolidaleAbilitato: z.boolean().default(false),
  creditoSolidaleStato: z.enum(STATI_CREDITO_SOLIDALE).default("non_abilitato"),
  creditoSolidaleNote: z.string().optional(),
  magazzinoEmporioPreferitoId: z.string().optional(),
  uds: z.boolean().default(false),
  areaOperativaId: z.string().optional(),
  zonaUdsId: z.string().optional(),
});

type EditValues = z.infer<ReturnType<typeof makeEditSchema>>;

function CreditoSolidaleCalcoloPanel({ beneficiarioId, enabled }: { beneficiarioId: number; enabled: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCalcolaCreditoSolidaleBeneficiario(beneficiarioId, {
    query: { queryKey: getCalcolaCreditoSolidaleBeneficiarioQueryKey(beneficiarioId), enabled },
  });

  if (!enabled) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div>
        <h5 className="text-sm font-medium">{t("creditoSolidale.simulationTitle")}</h5>
        <p className="text-xs text-muted-foreground">{t("creditoSolidale.simulationSubtitle")}</p>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t("creditoSolidale.calculateError")}</p>
      ) : data ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("creditoSolidale.politicaApplicata")}</span>
            <span className="text-right font-medium">
              {data.politicaNome} · {t(`creditoSolidale.origin.${data.politicaOrigine}`)}
            </span>
          </div>
          {[
            ["creditoSolidale.creditoBaseNucleo", data.dettaglio.creditoBaseNucleo],
            ["creditoSolidale.quotaComponenti", data.dettaglio.quotaComponenti],
            ["creditoSolidale.quotaMinori", data.dettaglio.quotaMinori],
            ["creditoSolidale.quotaAnziani", data.dettaglio.quotaAnziani],
            ["creditoSolidale.quotaDisabili", data.dettaglio.quotaDisabili],
            ["creditoSolidale.totalePrimaDeiLimiti", data.dettaglio.totalePrimaDeiLimiti],
            ["creditoSolidale.creditoMinimoApplicato", data.dettaglio.creditoMinimoApplicato],
            ["creditoSolidale.creditoMassimoApplicato", data.dettaglio.creditoMassimoApplicato],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t(label as string)}</span>
              <span className="font-medium">{formatCreditoQuota(value as number | null)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t("creditoSolidale.arrotondamentoApplicato")}</span>
            <span className="font-medium">{t(`creditoSolidale.rounding.${data.dettaglio.arrotondamentoApplicato}`)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-2">
            <span className="font-medium">{t("creditoSolidale.totaleSuggerito")}</span>
            <span className="text-lg font-semibold">{formatCreditoQuota(data.totaleSuggerito)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreditoSolidaleQuotaPanel({
  b,
  enabled,
  emporioAbilitato,
}: {
  b: BeneficiarioDettaglioType;
  enabled: boolean;
  emporioAbilitato: boolean;
}) {
  const { t } = useTranslation();
  const updateCredito = useUpdateCreditoSolidaleBeneficiarioConfigurazione();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useCalcolaCreditoSolidaleBeneficiario(b.id, {
    query: { queryKey: getCalcolaCreditoSolidaleBeneficiarioQueryKey(b.id), enabled: enabled && emporioAbilitato },
  });
  const suggested = data?.totaleSuggerito ?? null;
  const [assegnato, setAssegnato] = useState(
    b.creditoSolidaleMensileAssegnato == null ? "" : String(b.creditoSolidaleMensileAssegnato),
  );
  const [motivo, setMotivo] = useState(b.creditoSolidaleMotivoModifica ?? "");

  useEffect(() => {
    if (b.creditoSolidaleMensileAssegnato == null && suggested != null) {
      setAssegnato(String(suggested));
    }
  }, [b.creditoSolidaleMensileAssegnato, suggested]);

  if (!enabled) return null;

  const assignedNumber = assegnato === "" ? null : Number(assegnato);
  const isManuale = assignedNumber != null && suggested != null
    ? Math.round(assignedNumber * 100) !== Math.round(suggested * 100)
    : b.creditoSolidaleMensileManuale;
  const disabled = !emporioAbilitato || updateCredito.isPending;

  const onSave = () => {
    updateCredito.mutate(
      {
        beneficiarioId: b.id,
        data: {
          creditoSolidaleMensileAssegnato: assegnato === "" ? null : Number(assegnato),
          creditoSolidaleMensileSuggerito: suggested,
          creditoSolidaleMotivoModifica: motivo.trim() ? motivo.trim() : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(b.id) });
          queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
          toast({ title: t("creditoSolidale.quotaAssegnataSalvata") });
        },
        onError: (e) => toast({
          title: t("creditoSolidale.title"),
          description: apiErrorMessage(e, t("creditoSolidale.quotaAssegnataSaveError")),
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <div className="rounded-md border bg-background p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-medium">{t("creditoSolidale.quotaMensileAssegnata")}</h5>
          <p className="text-xs text-muted-foreground">{t("creditoSolidale.suggeritoDalCalcolo")}: {formatCreditoQuota(suggested)}</p>
        </div>
        <Badge variant="outline" className={isManuale ? "bg-amber-500/10 text-amber-700" : "bg-emerald-500/10 text-emerald-700"}>
          {isManuale ? t("creditoSolidale.modificatoManualmente") : t("creditoSolidale.allineatoAlCalcolo")}
        </Badge>
      </div>
      {!emporioAbilitato && <p className="text-xs text-muted-foreground">{EMPORIO_DISABLED_MESSAGE}</p>}
      <div className="space-y-2">
        <label className="text-sm font-medium leading-none">{t("creditoSolidale.quotaMensileAssegnata")}</label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={assegnato}
          onChange={(event) => setAssegnato(event.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium leading-none">{t("creditoSolidale.motivoModificaQuota")}</label>
        <Textarea rows={2} value={motivo} onChange={(event) => setMotivo(event.target.value)} disabled={disabled} />
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={disabled}>
          {t("creditoSolidale.salvaQuotaAssegnata")}
        </Button>
      </div>
    </div>
  );
}

function CreditoSolidaleSaldoPanel({
  b,
  emporioAbilitato,
}: {
  b: BeneficiarioDettaglioType;
  emporioAbilitato: boolean;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canAdjust = hasPermission("credito.adjust");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const visible = b.creditoSolidaleAbilitato || b.creditoSolidaleStato !== "non_abilitato" || (b.creditoSolidaleSaldo ?? 0) > 0 || b.creditoSolidaleMensileAssegnato != null;
  const canOperate = canAdjust && emporioAbilitato && b.attivo && b.creditoSolidaleAbilitato && b.creditoSolidaleStato === "attivo";
  const { data: saldo } = useGetCreditoSolidaleBeneficiarioSaldo(b.id, {
    query: { queryKey: getGetCreditoSolidaleBeneficiarioSaldoQueryKey(b.id), enabled: visible },
  });
  const { data: movimenti } = useListCreditoSolidaleBeneficiarioMovimenti(b.id, {
    query: { queryKey: getListCreditoSolidaleBeneficiarioMovimentiQueryKey(b.id), enabled: visible },
  });
  const createRicarica = useCreateCreditoSolidaleRicaricaManuale();
  const createRettifica = useCreateCreditoSolidaleRettifica();
  const [action, setAction] = useState<"ricarica" | "rettifica" | null>(null);
  const [variazione, setVariazione] = useState("");
  const [motivo, setMotivo] = useState("");
  const [note, setNote] = useState("");

  if (!visible) return null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetBeneficiarioQueryKey(b.id) });
    queryClient.invalidateQueries({ queryKey: getListBeneficiariQueryKey() });
    queryClient.invalidateQueries({
      predicate: (query) => String(query.queryKey[0] ?? "").includes("/api/credito-solidale"),
    });
  };

  const openAction = (next: "ricarica" | "rettifica") => {
    setAction(next);
    setVariazione("");
    setMotivo("");
    setNote("");
  };

  const submitAction = () => {
    if (!action) return;
    const parsed = Number(variazione.replace(",", "."));
    if (!Number.isFinite(parsed) || (action === "ricarica" ? parsed <= 0 : parsed === 0)) {
      toast({ title: t("creditoSolidale.operazioneNonRiuscita"), description: t("creditoSolidale.valoreRichiesto"), variant: "destructive" });
      return;
    }
    const cleanMotivo = motivo.trim();
    const cleanNote = note.trim();
    if (action === "rettifica" && !cleanMotivo) {
      toast({ title: t("creditoSolidale.operazioneNonRiuscita"), description: t("creditoSolidale.motivoRichiesto"), variant: "destructive" });
      return;
    }

    const onSuccess = () => {
      invalidate();
      toast({ title: t("creditoSolidale.movimentoCreato") });
      setAction(null);
    };
    const onError = (err: unknown) => toast({
      title: t("creditoSolidale.operazioneNonRiuscita"),
      description: apiErrorMessage(err, t("creditoSolidale.operazioneNonRiuscita")),
      variant: "destructive",
    });

    if (action === "ricarica") {
      createRicarica.mutate({
        beneficiarioId: b.id,
        data: { variazioneCredito: parsed, motivo: cleanMotivo || null, note: cleanNote || null },
      }, { onSuccess, onError });
      return;
    }

    createRettifica.mutate({
      beneficiarioId: b.id,
      data: { variazioneCredito: parsed, motivo: cleanMotivo, note: cleanNote || null },
    }, { onSuccess, onError });
  };

  const saldoAttuale = saldo?.saldoAttuale ?? b.creditoSolidaleSaldo ?? 0;
  const ultimiMovimenti = (movimenti ?? []).slice(0, 5);
  const pending = createRicarica.isPending || createRettifica.isPending;

  const renderMovimento = (movimento: CreditoSolidaleMovimento) => (
    <div key={movimento.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{t(`creditoSolidale.movements.${movimento.tipoMovimento}`)}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(movimento.dataMovimento).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
        </div>
        {movimento.motivo && <div className="text-xs text-muted-foreground mt-1">{movimento.motivo}</div>}
      </div>
      <div className="text-right">
        <div className={movimento.variazioneCredito < 0 ? "text-sm font-medium text-red-700" : "text-sm font-medium text-emerald-700"}>
          {formatCreditoQuota(movimento.variazioneCredito)}
        </div>
        <div className="text-xs text-muted-foreground">{t("creditoSolidale.saldoDopo")}: {formatCreditoQuota(movimento.saldoDopo)}</div>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          {t("creditoSolidale.saldoCreditoSolidale")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!emporioAbilitato && <p className="text-sm text-muted-foreground">{t("creditoSolidale.readOnlyDisabled")}</p>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{t("creditoSolidale.saldoAttuale")}</div>
            <div className="text-2xl font-semibold">{formatCreditoQuota(saldoAttuale)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{t("creditoSolidale.quotaMensileAssegnata")}</div>
            <div className="text-2xl font-semibold">{formatCreditoQuota(saldo?.creditoSolidaleMensileAssegnato ?? b.creditoSolidaleMensileAssegnato)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{t("creditoSolidale.statoCreditoSolidale")}</div>
            <div className="text-sm font-medium">{t(`creditoSolidale.stato.${saldo?.creditoSolidaleStato ?? b.creditoSolidaleStato}`)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{t("creditoSolidale.ultimoMovimento")}</div>
            <div className="text-sm font-medium">
              {(saldo?.dataUltimoMovimento ?? b.creditoSolidaleDataUltimoMovimento)
                ? new Date((saldo?.dataUltimoMovimento ?? b.creditoSolidaleDataUltimoMovimento) as string).toLocaleDateString("it-IT")
                : "-"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button asChild variant="outline">
            <Link href={`/emporio/crediti-saldo?beneficiarioId=${b.id}`}>{t("creditoSolidale.tornaSaldo")}</Link>
          </Button>
          {canAdjust && <Button type="button" variant="outline" onClick={() => openAction("ricarica")} disabled={!canOperate}>
            <RefreshCw className="h-4 w-4 mr-2" /> {t("creditoSolidale.ricaricaCreditoSolidale")}
          </Button>}
          {canAdjust && <Button type="button" variant="outline" onClick={() => openAction("rettifica")} disabled={!canOperate}>
            {t("creditoSolidale.rettificaCreditoSolidale")}
          </Button>}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            {t("creditoSolidale.ultimiMovimenti")}
          </h4>
          {ultimiMovimenti.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("creditoSolidale.nessunMovimento")}</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">{ultimiMovimenti.map(renderMovimento)}</div>
          )}
        </div>
      </CardContent>

      <Dialog open={action != null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action === "ricarica" ? t("creditoSolidale.ricaricaCreditoSolidale") : t("creditoSolidale.rettificaCreditoSolidale")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.variazioneCredito")}</label>
              <Input type="number" step="0.01" value={variazione} onChange={(event) => setVariazione(event.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.motivo")}</label>
              <Textarea rows={2} value={motivo} onChange={(event) => setMotivo(event.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("creditoSolidale.noteOperative")}</label>
              <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} disabled={pending} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAction(null)}>{t("creditoSolidale.annulla")}</Button>
            <Button type="button" onClick={submitAction} disabled={pending}>
              {action === "ricarica" ? t("creditoSolidale.salvaRicarica") : t("creditoSolidale.salvaRettifica")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function EditBeneficiarioSheet({ b, onClose, onSaved }: { b: BeneficiarioDettaglioType; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const updateBeneficiario = useUpdateBeneficiario();
  const updateCredito = useUpdateCreditoSolidaleBeneficiarioConfigurazione();
  const { toast } = useToast();
  const editSchema = useMemo(() => makeEditSchema(t), [t]);
  const { user, hasPermission } = useAuth();
  const canManageCredito = hasPermission("credito.quota.manage");
  const isAreaOperativaGlobal = user?.areaOperativaId == null;
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const { data: areaOperativaList } = useListAreeOperative({ query: { queryKey: getListAreeOperativeQueryKey(), enabled: isAreaOperativaGlobal } });
  const { data: centri } = useListCentriAscolto();
  const { data: magazzini } = useListMagazzini();
  const { emporioAbilitato, unitaStradaAbilitata } = useModuloFlags();
  const emporiDisponibili = useMemo(
    () => (magazzini ?? []).filter((m) => m.tipoMagazzino === "emporio" || m.tipoMagazzino === "misto"),
    [magazzini],
  );

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      cognome: b.cognome ?? "",
      nome: b.nome ?? "",
      codiceFiscale: b.codiceFiscale ?? "",
      dataNascita: b.dataNascita ? b.dataNascita.slice(0, 10) : "",
      sesso: b.sesso ?? "",
      cittadinanza: b.cittadinanza ?? "",
      areaProvenienza: b.areaProvenienza ?? "",
      residenza: b.residenza ?? "",
      domicilio: b.domicilio ?? "",
      comune: b.comune ?? "",
      zonaMunicipio: b.zonaMunicipio ?? "",
      telefono: b.telefono ?? "",
      email: b.email ?? "",
      priorita: b.priorita ?? "media",
      numComponenti: b.numComponenti ?? 1,
      consegnaDomicilio: b.consegnaDomicilio ?? false,
      motivoConsegnaDomicilio: b.motivoConsegnaDomicilio ?? "",
      restrizioniAlimentari: b.restrizioniAlimentari ?? "",
      centroAscoltoId: b.centroAscoltoId != null ? String(b.centroAscoltoId) : isCentroLocked ? String(lockedCentroId) : NONE_VALUE,
      creditoSolidaleAbilitato: b.creditoSolidaleAbilitato ?? false,
      creditoSolidaleStato: b.creditoSolidaleStato ?? "non_abilitato",
      creditoSolidaleNote: b.creditoSolidaleNote ?? "",
      magazzinoEmporioPreferitoId: b.magazzinoEmporioPreferitoId != null ? String(b.magazzinoEmporioPreferitoId) : NONE_VALUE,
      uds: b.uds ?? false,
      areaOperativaId: b.areaOperativaId != null ? String(b.areaOperativaId) : "",
      zonaUdsId: b.zonaUdsId != null ? String(b.zonaUdsId) : "",
    },
  });

  const watchUds = form.watch("uds");
  const creditoSolidaleAbilitato = form.watch("creditoSolidaleAbilitato");
  const centroAscoltoIdSelezionato = form.watch("centroAscoltoId");
  const centroAscoltoMancantePerCredito =
    creditoSolidaleAbilitato &&
    !isCentroLocked &&
    (!centroAscoltoIdSelezionato || centroAscoltoIdSelezionato === NONE_VALUE);
  const formAreaOperativa = isAreaOperativaGlobal
    ? (form.watch("areaOperativaId") ? parseInt(form.watch("areaOperativaId")!) : undefined)
    : (user?.areaOperativaId ?? undefined);
  const { data: udsZone } = useListZoneUds(
    formAreaOperativa ? { areaOperativaId: formAreaOperativa } : undefined,
    { query: { queryKey: ["zoneUds", "editBenefForm", formAreaOperativa], enabled: watchUds && formAreaOperativa != null } },
  );

  const onSubmit = async (data: EditValues) => {
    const { uds, areaOperativaId, zonaUdsId, centroAscoltoId, magazzinoEmporioPreferitoId, creditoSolidaleAbilitato: creditoAbilitato, creditoSolidaleStato: creditoStato, creditoSolidaleNote, ...rest } = data;
    // A area operativa-global admin must pin a area operativa when flagging a person as UDS.
    if (uds && isAreaOperativaGlobal && !areaOperativaId) {
      form.setError("areaOperativaId", { type: "manual", message: t("common.requiredField") });
      return;
    }
    const centroAscoltoIdFinale =
      centroAscoltoId && centroAscoltoId !== NONE_VALUE
        ? parseInt(centroAscoltoId)
        : isCentroLocked
          ? lockedCentroId
          : null;
    if (canManageCredito && creditoAbilitato && centroAscoltoIdFinale == null) {
      form.setError("centroAscoltoId", { type: "manual", message: t("beneficiari.creditoSolidaleCentroAscoltoRichiesto") });
      toast({
        title: t("beneficiari.creditoSolidaleSection"),
        description: t("beneficiari.creditoSolidaleCentroAscoltoRichiesto"),
        variant: "destructive",
      });
      return;
    }
    const payload: Record<string, unknown> = {
      ...rest,
      uds,
      dataNascita: data.dataNascita || null,
      sesso: data.sesso,
      areaProvenienza: data.areaProvenienza || undefined,
      codiceFiscale: data.codiceFiscale?.trim() ? data.codiceFiscale.trim().toUpperCase() : null,
      centroAscoltoId: centroAscoltoIdFinale,
      versione: b.versione,
      magazzinoEmporioPreferitoId:
        magazzinoEmporioPreferitoId && magazzinoEmporioPreferitoId !== NONE_VALUE
          ? parseInt(magazzinoEmporioPreferitoId)
          : null,
    };
    if (uds) {
      if (isAreaOperativaGlobal && areaOperativaId) payload.areaOperativaId = parseInt(areaOperativaId);
      payload.zonaUdsId = zonaUdsId && zonaUdsId !== NONE_VALUE ? parseInt(zonaUdsId) : null;
    }
    try {
      await updateBeneficiario.mutateAsync({ id: b.id, data: payload as never });
      if (canManageCredito) {
        await updateCredito.mutateAsync({
          beneficiarioId: b.id,
          data: {
            creditoSolidaleAbilitato: creditoAbilitato,
            creditoSolidaleStato: creditoAbilitato ? creditoStato : "non_abilitato",
            creditoSolidaleNote: creditoSolidaleNote?.trim() ? creditoSolidaleNote.trim() : null,
          },
        });
      }
      onSaved();
    } catch (err) {
      const message = apiErrorMessage(err, t("beneficiarioDettaglio.errorSave"));
      toast({ title: t("beneficiarioDettaglio.error"), description: message, variant: "destructive" });
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{t("beneficiarioDettaglio.editAnagrafica")}</SheetTitle></SheetHeader>
        <div className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.surname")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <FormField control={form.control} name="codiceFiscale" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.codiceFiscale")}</FormLabel><FormControl><Input {...field} className="font-mono uppercase" maxLength={16} /></FormControl></FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dataNascita" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.dataNascita")}</FormLabel><FormControl><Input type="date" max={todayDateOnly()} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sesso" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.sesso")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {SESSO_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(`beneficiarioDettaglio.${option.beneficiarioLabelKey}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="cittadinanza" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.cittadinanza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")} *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="UE">UE</SelectItem>
                        <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="residenza" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.residenza")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="domicilio" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.domicilio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="comune" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.comune")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="zonaMunicipio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.zonaMunicipio")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="telefono" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.phone")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.email")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="numComponenti" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.numComponenti")}</FormLabel><FormControl><Input type="number" min="1" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="priorita" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.prioritaAssistenziale")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="bassa">{t("beneficiarioDettaglio.prioBassa")}</SelectItem>
                        <SelectItem value="media">{t("beneficiarioDettaglio.prioMedia")}</SelectItem>
                        <SelectItem value="alta">{t("beneficiarioDettaglio.prioAlta")}</SelectItem>
                        <SelectItem value="urgente">{t("beneficiarioDettaglio.prioUrgente")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="centroAscoltoId" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("beneficiari.centroRiferimento")}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.clearErrors("centroAscoltoId");
                    }}
                    value={field.value || NONE_VALUE}
                    disabled={isCentroLocked}
                  >
                    <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
                      {centri?.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="consegnaDomicilio" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel className="mb-0">{t("beneficiarioDettaglio.consegnaDomicilio")}</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              {form.watch("consegnaDomicilio") && (
                <FormField control={form.control} name="motivoConsegnaDomicilio" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.motivoConsegna")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                )} />
              )}
              <FormField control={form.control} name="restrizioniAlimentari" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.restrizioniAlimentari")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />

              {canManageCredito && <div className="rounded-md border p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-medium">{t("beneficiari.creditoSolidaleSection")}</h4>
                  <p className="text-xs text-muted-foreground">{t("beneficiari.creditoSolidaleHelp")}</p>
                  {!emporioAbilitato && (
                    <p className="text-xs text-muted-foreground mt-1">{EMPORIO_DISABLED_MESSAGE}</p>
                  )}
                </div>
                {centroAscoltoMancantePerCredito && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t("beneficiari.creditoSolidaleCentroAscoltoRichiesto")}</span>
                  </div>
                )}
                <FormField control={form.control} name="creditoSolidaleAbilitato" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <FormLabel className="!mt-0">{t("beneficiari.creditoSolidaleAbilitato")}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        disabled={!emporioAbilitato}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          form.setValue("creditoSolidaleStato", checked ? "attivo" : "non_abilitato");
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="creditoSolidaleStato" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.creditoSolidaleStato")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!emporioAbilitato || !creditoSolidaleAbilitato}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="non_abilitato">{t("beneficiari.creditoSolidaleStatoNonAbilitato")}</SelectItem>
                        <SelectItem value="attivo">{t("beneficiari.creditoSolidaleStatoAttivo")}</SelectItem>
                        <SelectItem value="sospeso">{t("beneficiari.creditoSolidaleStatoSospeso")}</SelectItem>
                        <SelectItem value="revocato">{t("beneficiari.creditoSolidaleStatoRevocato")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="magazzinoEmporioPreferitoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.magazzinoEmporioPreferito")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || NONE_VALUE} disabled={!emporioAbilitato || !creditoSolidaleAbilitato}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("common.none")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>{t("common.none")}</SelectItem>
                        {emporiDisponibili.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">{t("beneficiari.creditoSolidaleDataAbilitazione")}</label>
                  <Input
                    disabled
                    readOnly
                    value={b.creditoSolidaleDataAbilitazione ? new Date(b.creditoSolidaleDataAbilitazione).toLocaleDateString("it-IT") : ""}
                    placeholder={t("beneficiari.creditoSolidaleDataAutomatica")}
                  />
                </div>
                <FormField control={form.control} name="creditoSolidaleNote" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiari.creditoSolidaleNote")}</FormLabel>
                    <FormControl><Textarea rows={2} disabled={!emporioAbilitato} {...field} /></FormControl>
                  </FormItem>
                )} />
                <CreditoSolidaleCalcoloPanel beneficiarioId={b.id} enabled={creditoSolidaleAbilitato && emporioAbilitato} />
                <CreditoSolidaleQuotaPanel b={b} enabled={creditoSolidaleAbilitato} emporioAbilitato={emporioAbilitato} />
              </div>}

              <BeneficiarioMensaSection beneficiario={b} compact />

              <div className="rounded-md border p-3 space-y-3">
                {!unitaStradaAbilitata && (
                  <p className="text-xs text-muted-foreground">{UNITA_STRADA_DISABLED_MESSAGE}</p>
                )}
                <FormField control={form.control} name="uds" render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel className="!mt-0">{t("beneficiari.udsToggle")}</FormLabel>
                      <p className="text-xs text-muted-foreground">{t("beneficiari.udsToggleHint")}</p>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={!unitaStradaAbilitata} /></FormControl>
                  </FormItem>
                )} />
                {watchUds && (
                  <>
                    {isAreaOperativaGlobal && (
                      <FormField control={form.control} name="areaOperativaId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("udsAnagrafica.fAreaOperativa")}</FormLabel>
                          <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); form.setValue("zonaUdsId", NONE_VALUE); }} disabled={!unitaStradaAbilitata}>
                            <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.fAreaOperativa")} /></SelectTrigger></FormControl>
                            <SelectContent>
                              {areaOperativaList?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                    <FormField control={form.control} name="zonaUdsId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("udsAnagrafica.fZona")}</FormLabel>
                        <Select value={field.value || NONE_VALUE} onValueChange={field.onChange} disabled={!unitaStradaAbilitata}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t("udsAnagrafica.allZone")} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>{t("udsAnagrafica.allZone")}</SelectItem>
                            {udsZone?.map(z => <SelectItem key={z.id} value={String(z.id)}>{z.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </>
                )}
              </div>

              <div className="pt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={updateBeneficiario.isPending || updateCredito.isPending}>{t("common.save")}</Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const makeMembroSchema = (t: (k: string) => string) => z.object({
  nome: z.string().min(1, t("beneficiarioDettaglio.required")),
  cognome: z.string().optional(),
  relazione: z.string().optional(),
  dataNascita: z.string().optional(),
  sesso: z.string().optional(),
  areaProvenienza: z.string().optional(),
  note: z.string().optional(),
});
type MembroValues = z.infer<ReturnType<typeof makeMembroSchema>>;

function NucleoSection({ b, onChanged }: { b: BeneficiarioDettaglioType; onChanged: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const addMembro = useAddNucleoFamiliare();
  const deleteMembro = useDeleteNucleoFamiliare();
  const membroSchema = useMemo(() => makeMembroSchema(t), [t]);

  const form = useForm<MembroValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { nome: "", cognome: "", relazione: "", dataNascita: "", sesso: "", areaProvenienza: "", note: "" },
  });

  const onAdd = (data: MembroValues) => {
    addMembro.mutate(
      {
        id: b.id,
        data: {
          nome: data.nome,
          cognome: data.cognome || undefined,
          relazione: data.relazione || undefined,
          dataNascita: data.dataNascita || undefined,
          sesso: data.sesso ? data.sesso as NucleoFamiliareInputSesso : undefined,
          areaProvenienza: data.areaProvenienza || undefined,
          note: data.note || undefined,
        },
      },
      {
        onSuccess: () => {
          setAdding(false);
          form.reset();
          onChanged();
          toast({ title: t("beneficiarioDettaglio.toastMembroAdded") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorMembroAdd"), variant: "destructive" }),
      },
    );
  };

  const onDelete = (membroId: number) => {
    deleteMembro.mutate(
      { id: b.id, membroId },
      {
        onSuccess: () => {
          onChanged();
          toast({ title: t("beneficiarioDettaglio.toastMembroRemoved") });
        },
        onError: () => toast({ title: t("beneficiarioDettaglio.error"), description: t("beneficiarioDettaglio.errorMembroRemove"), variant: "destructive" }),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="py-4 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("beneficiarioDettaglio.composizione")}</CardTitle>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> {t("beneficiarioDettaglio.aggiungiComponente")}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-6">
          <Badge variant="secondary">{t("beneficiarioDettaglio.minori")}: {b.numMinori}</Badge>
          <Badge variant="secondary">{t("beneficiarioDettaglio.anziani")}: {b.numAnziani}</Badge>
          <Badge variant="secondary">{t("beneficiarioDettaglio.disabili")}: {b.numDisabili}</Badge>
        </div>

        {b.nucleo && b.nucleo.length > 0 ? (
          <div className="space-y-4">
            {b.nucleo.map((m) => {
              const eta = calcEta(m.dataNascita);
              return (
                <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {m.nome} {m.cognome}
                      {m.sesso && <Badge variant="outline" className="text-[10px]">{SESSO_LABEL[m.sesso] ?? m.sesso}</Badge>}
                      {m.areaProvenienza && <Badge variant="outline" className="text-[10px]">{m.areaProvenienza}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3">
                      <span>{t("beneficiarioDettaglio.relazione")}: {m.relazione || '-'}</span>
                      {eta !== null && <span>{t("beneficiarioDettaglio.eta", { eta })}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs space-y-1">
                      {m.tagliiaVestiti && <div>{t("beneficiarioDettaglio.taglia")}: <span className="font-medium">{m.tagliiaVestiti}</span></div>}
                      {m.numeroScarpe && <div>{t("beneficiarioDettaglio.scarpe")}: <span className="font-medium">{m.numeroScarpe}</span></div>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(m.id)}
                      disabled={deleteMembro.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">{t("beneficiarioDettaglio.noComponenti")}</p>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={(open) => { if (!open) { setAdding(false); form.reset(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("beneficiarioDettaglio.aggiungiComponente")}</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onAdd)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.name")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="cognome" render={({ field }) => (
                  <FormItem><FormLabel>{t("common.surname")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="relazione" render={({ field }) => (
                <FormItem><FormLabel>{t("beneficiarioDettaglio.relazione")}</FormLabel><FormControl><Input placeholder={t("beneficiarioDettaglio.relazionePlaceholder")} {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="dataNascita" render={({ field }) => (
                  <FormItem><FormLabel>{t("beneficiarioDettaglio.dataNascita")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="sesso" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("beneficiarioDettaglio.sesso")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {SESSO_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(`beneficiarioDettaglio.${option.beneficiarioLabelKey}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="areaProvenienza" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("beneficiarioDettaglio.areaProvenienza")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger><SelectValue placeholder="-" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="UE">UE</SelectItem>
                      <SelectItem value="Extra-UE">Extra-UE</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="note" render={({ field }) => (
                <FormItem><FormLabel>{t("common.notes")}</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setAdding(false); form.reset(); }}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={addMembro.isPending}>{t("common.add")}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
