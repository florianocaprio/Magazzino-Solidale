import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import {
  useListBolle,
  useCreateBolla,
  useGetBolla,
  useAddBollaRiga,
  useDeleteBollaRiga,
  useConfermaBolla,
  useConsegnaBolla,
  useAnnullaBolla,
  useUpdateBolla,
  useListBeneficiari,
  useListCentriAscolto,
  useListMagazzini,
  useListGiacenze,
  useListLotti,
  useListProdotti,
  useListVolontari,
  useListMezzi,
  useGetImpostazioniStampa,
  useListTrasferimenti,
  useListScarichi,
  useListConsegne,
  useAssociaBolla,
  getBolla,
  getListBolleQueryKey,
  getGetBollaQueryKey,
  getListGiacenzeQueryKey,
  getListConsegneQueryKey,
  getListVolontariQueryKey,
  type Trasferimento,
  type Scarico,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarcodeScannerButton } from "@/components/barcode-scanner-button";
import { BeneficiarioCombobox } from "@/components/beneficiario-combobox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { volontarioLabel } from "@/lib/volontari-label";
import { Plus, FileText, Trash2, PackagePlus, PackageMinus, CheckCircle, Truck, ChevronRight, XCircle, Pencil, User, Download, ArrowRight, ArrowLeft, ArrowRightLeft, ScanLine, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateBollaPdf, loadAssociationLogo, BOLLA_TEMPLATES, type BollaTemplate } from "@/lib/bolla-pdf";
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";
import { generateScaricoPdf, causaleLabel } from "@/lib/scarico-pdf";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";

function statoBadge(stato: string) {
  if (stato === "consegnato") return <Badge className="bg-green-500 text-white">{i18n.t("bolle.statoConsegnato")}</Badge>;
  if (stato === "confermato") return <Badge className="border-blue-300 text-blue-700 bg-blue-50">{i18n.t("bolle.statoConfermato")}</Badge>;
  if (stato === "annullato") return <Badge variant="destructive">{i18n.t("bolle.statoAnnullato")}</Badge>;
  return <Badge variant="secondary">{i18n.t("bolle.statoBozza")}</Badge>;
}

// ─── Helper download PDF bolla (riusabile da bolle + consegne) ───────────────

type CentroLite = { id: number; nome: string; indirizzo?: string | null; comune?: string | null; logoUrl?: string | null };
type BeneficiarioLite = { id: number; centroAscoltoId?: number | null };

export async function downloadBollaPdf(
  bollaId: number,
  opts: {
    beneficiari?: BeneficiarioLite[];
    centri?: CentroLite[];
    footer?: string | null;
    template?: BollaTemplate;
  },
): Promise<void> {
  const bolla = await getBolla(bollaId);
  if (!bolla) throw new Error("bolla non trovata");
  const benef = opts.beneficiari?.find((b) => b.id === bolla.beneficiarioId);
  const centro = benef?.centroAscoltoId
    ? opts.centri?.find((c) => c.id === benef.centroAscoltoId)
    : undefined;
  const associationLogoDataUrl = await loadAssociationLogo();
  await generateBollaPdf({
    bolla,
    centro: centro
      ? { nome: centro.nome, indirizzo: centro.indirizzo, comune: centro.comune, logoUrl: centro.logoUrl }
      : null,
    footer: opts.footer ?? null,
    template: opts.template ?? "standard",
    associationLogoDataUrl,
  });
}

// ─── Form crea bolla ─────────────────────────────────────────────────────────

export function CreaiBollaDialog({ open, onClose, consegnaId, lockedBeneficiario, onCreated }: {
  open: boolean;
  onClose: () => void;
  consegnaId?: number;
  lockedBeneficiario?: { id: number; nome: string } | null;
  onCreated?: (bollaId?: number) => void;
}) {
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const [beneficiarioId, setBeneficiarioId] = useState("");
  const [magazzinoId, setMagazzinoId] = useState("");
  const [centroId, setCentroId] = useState("all");
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreAltro, setTrasportatoreAltro] = useState("");
  const [mezzo, setMezzo] = useState("");
  const [scanCode, setScanCode] = useState("");
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setCentroId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);
  useEffect(() => {
    if (open && lockedBeneficiario) setBeneficiarioId(String(lockedBeneficiario.id));
  }, [open, lockedBeneficiario]);
  useEffect(() => {
    if (!open) {
      setMagazzinoId("");
      setTrasportatore("");
      setTrasportatoreAltro("");
      setMezzo("");
      setScanCode("");
      if (!lockedBeneficiario) setBeneficiarioId("");
    }
  }, [open, lockedBeneficiario]);
  const { data: centri } = useListCentriAscolto();
  const { data: beneficiari } = useListBeneficiari({
    attivo: true,
    ...(centroId !== "all" ? { centroAscoltoId: parseInt(centroId) } : {}),
  });
  const { data: allBeneficiari } = useListBeneficiari({ attivo: true });
  const selectedBenef = allBeneficiari?.find(b => String(b.id) === beneficiarioId);
  const volontariParams = selectedBenef?.centroAscoltoId != null ? { centroAscoltoId: selectedBenef.centroAscoltoId } : undefined;
  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari(volontariParams, { query: { queryKey: getListVolontariQueryKey(volontariParams), enabled: selectedBenef != null } });
  const { data: mezzi } = useListMezzi();
  const { data: consegne } = useListConsegne();
  const createBolla = useCreateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleScan = () => {
    const code = scanCode.trim();
    if (!code) return;
    const b = allBeneficiari?.find((x) => x.codice.toLowerCase() === code.toLowerCase());
    if (!b) {
      toast({ title: t("bolle.scanNotFound"), variant: "destructive" });
      return;
    }
    setCentroId(isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : (b.centroAscoltoId ? String(b.centroAscoltoId) : "all"));
    setBeneficiarioId(String(b.id));
    setScanCode("");
    toast({ title: t("bolle.scanFound", { name: `${b.cognome} ${b.nome}` }) });
  };

  const consegnaSource = consegne?.find((c) => c.id === consegnaId);
  useEffect(() => {
    if (!open || !consegnaSource) return;
    if (consegnaSource.volontarioId != null) {
      setTrasportatore(String(consegnaSource.volontarioId));
      setTrasportatoreAltro("");
    } else if (consegnaSource.volontarioAltro) {
      setTrasportatore("__altro__");
      setTrasportatoreAltro(consegnaSource.volontarioAltro);
    }
    if (consegnaSource.mezzoId != null) setMezzo(String(consegnaSource.mezzoId));
    else if (consegnaSource.mezzoAltro) setMezzo("altro");
  }, [open, consegnaSource]);
  // Il trasportatore (un volontario del centro) si indica SOLO per i beneficiari con
  // consegna a domicilio. Negli altri casi vale il ritiro presso il magazzino.
  // Mezzo e conteggio del carico vivono ora sulla pianificazione consegne, non sulla bolla.
  const requiresTrasportatore = selectedBenef?.consegnaDomicilio === true;
  const trasportatoreMissing = requiresTrasportatore && (!trasportatore || (trasportatore === "__altro__" && !trasportatoreAltro.trim()));

  const onSubmit = () => {
    if (!beneficiarioId || !magazzinoId || trasportatoreMissing) return;
    const data: {
      beneficiarioId: number;
      magazzinoId: number;
      consegnaId?: number;
      volontarioConsegnaId?: number;
      mezzoId?: number;
      mezzoAltro?: boolean;
      trasportatoreNome?: string;
    } = { beneficiarioId: parseInt(beneficiarioId), magazzinoId: parseInt(magazzinoId) };
    if (consegnaId != null) data.consegnaId = consegnaId;
    if (requiresTrasportatore && trasportatore) {
      if (trasportatore === "__altro__") data.trasportatoreNome = trasportatoreAltro.trim();
      else data.volontarioConsegnaId = parseInt(trasportatore);
      if (mezzo === "altro") data.mezzoAltro = true;
      else if (mezzo) data.mezzoId = parseInt(mezzo);
    }
    createBolla.mutate(
      { data },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: t("bolle.bollaCreata") });
          setBeneficiarioId("");
          setMagazzinoId("");
          setCentroId(isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : "all");
          setTrasportatore("");
          onCreated?.((created as { id?: number } | undefined)?.id);
          onClose();
        },
        onError: () => toast({ title: t("bolle.error"), description: t("bolle.createError"), variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("bolle.createTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {lockedBeneficiario ? (
            <div className="space-y-2">
              <Label>{t("bolle.beneficiarioLabel")}</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{lockedBeneficiario.nome}</div>
            </div>
          ) : (<>
          <div className="space-y-2">
            <Label>{t("bolle.scanLabel")}</Label>
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder={t("bolle.scanPlaceholder")}
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan();
                  }
                }}
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={handleScan} disabled={!scanCode.trim()}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.centroFilterLabel")}</Label>
            <Select value={centroId} onValueChange={(v) => { setCentroId(v); setBeneficiarioId(""); }} disabled={isCentroLocked}>
              <SelectTrigger><SelectValue placeholder={t("bolle.allCentriPlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("bolle.allBeneficiari")}</SelectItem>
                {centri?.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.beneficiarioLabel")}</Label>
            <BeneficiarioCombobox
              items={(beneficiari ?? []).map(b => ({ id: b.id, nome: b.nome, cognome: b.cognome, codice: b.codice }))}
              value={beneficiarioId}
              onChange={setBeneficiarioId}
              placeholder={t("bolle.beneficiarioPlaceholder")}
              emptyText={t("bolle.noBeneficiarioForCentro")}
            />
          </div>
          </>)}
          <div className="space-y-2">
            <Label>{t("bolle.magazzinoUscitaLabel")}</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger><SelectValue placeholder={t("bolle.magazzinoPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {magazzini?.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {consegnaSource && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t("bolle.daPianificazioneInfo", { defaultValue: "Volontario e mezzo sono precompilati dalla pianificazione collegata, se presenti." })}
            </div>
          )}
          {requiresTrasportatore ? (
            <div className="space-y-2">
              <Label>{t("bolle.trasportatoreLabel")}</Label>
              <Select value={trasportatore} onValueChange={(v) => { setTrasportatore(v); setTrasportatoreAltro(""); setMezzo(""); }}>
                <SelectTrigger><SelectValue placeholder={t("bolle.trasportatorePlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {volontari?.filter(v => v.attivo && (v.statoApprovazione ?? "approvato") === "approvato").map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {volontarioLabel(v)}
                    </SelectItem>
                  ))}
                  <SelectItem value="__altro__">{t("consegne.volontarioAltro", { defaultValue: "Altro" })}</SelectItem>
                </SelectContent>
              </Select>
              {trasportatore === "__altro__" && (
                <Input
                  value={trasportatoreAltro}
                  onChange={(e) => setTrasportatoreAltro(e.target.value)}
                  placeholder={t("consegne.volontarioAltroPlaceholder", { defaultValue: "Es. familiare delegato, vicino di casa..." })}
                />
              )}
              {trasportatoreMissing && (
                <p className="text-sm text-destructive">{t("bolle.trasportatoreObbligatorioDomicilio")}</p>
              )}
              {trasportatore && (
                <div className="space-y-2 pt-2">
                  <Label>{t("bolle.mezzoLabel")}</Label>
                  <Select value={mezzo || "0"} onValueChange={(v) => setMezzo(v === "0" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={t("bolle.mezzoPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{t("common.none")}</SelectItem>
                      {mezzi?.filter(m => {
                        if (m.stato !== "disponibile" || (m.statoApprovazione ?? "approvato") !== "approvato") return false;
                        if (m.effectiveCentroId == null) return true;
                        const benefCentro = allBeneficiari?.find(b => String(b.id) === beneficiarioId)?.centroAscoltoId ?? null;
                        return benefCentro != null && m.effectiveCentroId === benefCentro;
                      }).map(m => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.codice}{m.targa ? ` (${m.targa})` : ""} — {m.tipo}
                        </SelectItem>
                      ))}
                      <SelectItem value="altro">{t("bolle.mezzoAltro")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("bolle.ritiroMagazzinoInfo")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={onSubmit} disabled={!beneficiarioId || !magazzinoId || trasportatoreMissing || createBolla.isPending}>
            {t("bolle.createBolla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog modifica intestazione (beneficiario / magazzino) ────────────────

function ModificaBollaDialog({
  open, onClose, bollaId, beneficiarioId, magazzinoId, hasRighe,
}: {
  open: boolean; onClose: () => void; bollaId: number;
  beneficiarioId: number; magazzinoId: number; hasRighe: boolean;
}) {
  const [bId, setBId] = useState(String(beneficiarioId));
  const [mId, setMId] = useState(String(magazzinoId));
  const [scanCode, setScanCode] = useState("");
  const { data: beneficiari } = useListBeneficiari({ attivo: true });
  const { data: magazzini } = useListMagazzini();
  const updateBolla = useUpdateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleScan = () => {
    const code = scanCode.trim();
    if (!code) return;
    if (!beneficiari) {
      toast({ title: t("common.loading") });
      return;
    }
    const b = beneficiari.find((x) => x.codice.toLowerCase() === code.toLowerCase());
    if (!b) {
      toast({ title: t("bolle.scanNotFound"), variant: "destructive" });
      return;
    }
    setBId(String(b.id));
    setScanCode("");
    toast({ title: t("bolle.scanFound", { name: `${b.cognome} ${b.nome}` }) });
  };

  const magazzinoCambiato = parseInt(mId) !== magazzinoId;

  const onSubmit = () => {
    if (magazzinoCambiato && hasRighe) {
      const ok = window.confirm(
        t("bolle.cambioMagazzinoConfirm")
      );
      if (!ok) return;
    }
    updateBolla.mutate(
      { id: bollaId, data: { beneficiarioId: parseInt(bId), magazzinoId: parseInt(mId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey({ magazzinoId: parseInt(mId) }) });
          toast({ title: t("bolle.bollaAggiornata") });
          onClose();
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t("bolle.updateError");
          toast({ title: t("bolle.error"), description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("bolle.modificaTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("bolle.scanLabel")}</Label>
            <div className="flex gap-2">
              <Input
                placeholder={t("bolle.scanPlaceholder")}
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan();
                  }
                }}
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={handleScan} disabled={!scanCode.trim()}>
                <ScanLine className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.beneficiarioLabel")}</Label>
            <Select value={bId} onValueChange={setBId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {beneficiari?.map(b => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.cognome} {b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("bolle.magazzinoUscitaLabel")}</Label>
            <Select value={mId} onValueChange={setMId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {magazzini?.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {magazzinoCambiato && hasRighe && (
              <p className="text-xs text-amber-600">
                {t("bolle.cambioMagazzinoWarning")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
          <Button onClick={onSubmit} disabled={updateBolla.isPending}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog aggiungi prodotto ────────────────────────────────────────────────

function AggiungiProdottoDialog({
  open, onClose, bollaId, magazzinoId,
}: {
  open: boolean; onClose: () => void; bollaId: number; magazzinoId: number;
}) {
  const [prodottoId, setProdottoId] = useState("");
  const [lottoId, setLottoId] = useState("");
  const [quantita, setQuantita] = useState("");
  const [unitaMisura, setUnitaMisura] = useState("pz");
  const [scanProdotto, setScanProdotto] = useState("");

  const { data: giacenze } = useListGiacenze({ magazzinoId });
  const { data: prodotti } = useListProdotti();
  const { data: lotti } = useListLotti({ magazzinoId, prodottoId: prodottoId ? parseInt(prodottoId) : undefined });
  const { data: bollaCorrente } = useGetBolla(bollaId, {
    query: { enabled: open, queryKey: getGetBollaQueryKey(bollaId) },
  });

  const addRiga = useAddBollaRiga();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleScanProdotto = (codeOverride?: string) => {
    const code = (codeOverride ?? scanProdotto).trim();
    if (!code) return;
    if (!prodotti) {
      toast({ title: t("common.loading") });
      return;
    }
    const lc = code.toLowerCase();
    const p = prodotti.find(
      x => (x.codiceBarre && x.codiceBarre.toLowerCase() === lc) || x.codice.toLowerCase() === lc,
    );
    if (!p) {
      toast({ title: t("bolle.scanProdottoNotFound"), variant: "destructive" });
      return;
    }
    const g = giacenze?.find(x => x.prodottoId === p.id);
    if (!g) {
      toast({ title: t("bolle.scanProdottoNoStock", { name: p.nome }), variant: "destructive" });
      return;
    }
    setProdottoId(String(p.id));
    setLottoId("");
    setQuantita("");
    setScanProdotto("");
    toast({ title: t("bolle.scanProdottoFound", { name: p.nome }) });
  };

  const giacenzaSelezionata = giacenze?.find(g => g.prodottoId === parseInt(prodottoId));
  const lottiDisponibili = lotti?.filter(l => l.magazzinoId === magazzinoId && l.quantitaResidua > 0) ?? [];

  // quantità già inserita in questa bolla: va sottratta solo in bozza
  // (in una bolla confermata la giacenza/lotto è già stata scalata)
  const isBozza = bollaCorrente?.stato === "bozza";
  const giaInBollaProdotto = isBozza && prodottoId
    ? (bollaCorrente?.righe ?? [])
        .filter(r => r.prodottoId === parseInt(prodottoId))
        .reduce((acc, r) => acc + r.quantita, 0)
    : 0;
  const giaInBollaLotto = (lid: number) =>
    isBozza
      ? (bollaCorrente?.righe ?? [])
          .filter(r => r.lottoId === lid)
          .reduce((acc, r) => acc + r.quantita, 0)
      : 0;

  // limite massimo: lotto specifico oppure giacenza totale, al netto di quanto già in bolla
  const lottoSelezionato = lottiDisponibili.find(l => l.id === parseInt(lottoId));
  const maxBase = lottoSelezionato
    ? lottoSelezionato.quantitaResidua
    : giacenzaSelezionata?.quantitaTotale ?? 0;
  const giaUsato = lottoSelezionato ? giaInBollaLotto(lottoSelezionato.id) : giaInBollaProdotto;
  const maxDisponibile = Math.max(0, Math.round((maxBase - giaUsato) * 100) / 100);
  const quantitaNum = parseFloat(quantita || "0");
  const eccedeDisponibilita = quantitaNum > maxDisponibile;

  const onSubmit = () => {
    if (!prodottoId || !quantita || eccedeDisponibilita) return;
    addRiga.mutate(
      {
        id: bollaId,
        data: {
          prodottoId: parseInt(prodottoId),
          lottoId: lottoId ? parseInt(lottoId) : undefined,
          quantita: quantitaNum,
          unitaMisura,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey({ magazzinoId }) });
          toast({ title: t("bolle.prodottoAggiunto") });
          // mantieni il dialog aperto per aggiungere altri prodotti: resetta i campi
          setProdottoId(""); setLottoId(""); setQuantita(""); setUnitaMisura("pz");
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t("bolle.addError");
          toast({ title: t("bolle.error"), description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("bolle.addProdottoTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("bolle.scanProdottoLabel")}</Label>
            <div className="flex gap-2">
              <Input
                value={scanProdotto}
                onChange={e => setScanProdotto(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScanProdotto(); } }}
                placeholder={t("bolle.scanProdottoPlaceholder")}
                autoFocus
              />
              <Button type="button" variant="secondary" onClick={() => handleScanProdotto()} disabled={!scanProdotto.trim()}>
                {t("bolle.scanProdottoButton")}
              </Button>
              <BarcodeScannerButton onScan={(v) => { setScanProdotto(v); handleScanProdotto(v); }} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("bolle.prodottoDisponibileLabel")}</Label>
            <Select value={prodottoId} onValueChange={v => { setProdottoId(v); setLottoId(""); setQuantita(""); }}>
              <SelectTrigger><SelectValue placeholder={t("bolle.prodottoPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {giacenze && giacenze.length > 0 ? giacenze.map(g => (
                  <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                    {g.prodottoNome} — {g.quantitaTotale} {g.unitaMisura} {t("bolle.disponibili")}
                  </SelectItem>
                )) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    {t("bolle.noProdottoInMagazzino")}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {prodottoId && lottiDisponibili.length > 0 && (
            <div className="space-y-2">
              <Label>{t("bolle.lottoLabel")}</Label>
              <Select value={lottoId} onValueChange={v => { setLottoId(v); setQuantita(""); }}>
                <SelectTrigger><SelectValue placeholder={t("bolle.lottoPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {lottiDisponibili.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.codiceLotto ?? `${t("bolle.lottoPrefix")}${l.id}`}
                      {l.dataScadenza ? ` — ${t("bolle.scadAbbr")} ${l.dataScadenza}` : ""}
                      {` — ${l.quantitaResidua} ${t("bolle.dispAbbr")}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("bolle.lottoHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("common.quantity")}</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={maxDisponibile || undefined}
                value={quantita}
                onChange={e => setQuantita(e.target.value)}
                placeholder={t("bolle.quantitaPlaceholder")}
                className={eccedeDisponibilita ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {prodottoId && (
                <p className={`text-xs ${eccedeDisponibilita ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {eccedeDisponibilita
                    ? t("bolle.massimoDisponibile", { max: maxDisponibile })
                    : t("bolle.disponibileQta", { max: maxDisponibile, um: giacenzaSelezionata?.unitaMisura ?? "" })}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("bolle.unitaMisuraLabel")}</Label>
              <Select value={unitaMisura} onValueChange={setUnitaMisura}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["pz", "kg", "g", "lt", "ml", "conf", "scatola", "busta"].map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
          <Button onClick={onSubmit} disabled={!prodottoId || !quantita || eccedeDisponibilita || addRiga.isPending}>
            {t("common.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dettaglio bolla ─────────────────────────────────────────────────────────

export function BollaDettaglio({ bollaId, onClose, onCloseLabel, hideConsegnaActions }: { bollaId: number; onClose?: () => void; onCloseLabel?: string; hideConsegnaActions?: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [annullaOpen, setAnnullaOpen] = useState(false);
  const [assegnaOpen, setAssegnaOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printTemplate, setPrintTemplate] = useState<BollaTemplate>("standard");
  const [printing, setPrinting] = useState(false);
  const { data: bolla, isLoading } = useGetBolla(bollaId);
  const { data: beneficiari } = useListBeneficiari();
  const bollaCentroId = beneficiari?.find((b) => b.id === bolla?.beneficiarioId)?.centroAscoltoId ?? null;
  const volontariDettaglioParams = bollaCentroId != null ? { centroAscoltoId: bollaCentroId } : undefined;
  const { data: volontari } = useListVolontari(volontariDettaglioParams, { query: { queryKey: getListVolontariQueryKey(volontariDettaglioParams), enabled: bolla != null && beneficiari != null } });
  const { data: centri } = useListCentriAscolto();
  const { data: impostazioni } = useGetImpostazioniStampa();
  const deleteRiga = useDeleteBollaRiga();
  const confermaBolla = useConfermaBolla();
  const consegnaBolla = useConsegnaBolla();
  const annullaBolla = useAnnullaBolla();
  const updateBolla = useUpdateBolla();
  const associaBolla = useAssociaBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const consegneParams = bollaCentroId != null ? { centroAscoltoId: bollaCentroId } : {};
  const { data: consegnePianificabili } = useListConsegne(consegneParams, {
    query: { enabled: assegnaOpen && beneficiari != null, queryKey: getListConsegneQueryKey(consegneParams) },
  });
  // Beneficiari del centro della bolla (gestisce anche il caso centro nullo,
  // dato che Consegna non espone centroAscoltoId): filtra le consegne lato client.
  const centroBeneficiarioIds = new Set(
    (beneficiari ?? []).filter((b) => (b.centroAscoltoId ?? null) === bollaCentroId).map((b) => b.id)
  );
  const pianificabili = (consegnePianificabili ?? []).filter(
    (c) => c.stato === "pianificata" && c.bollaId == null && centroBeneficiarioIds.has(c.beneficiarioId)
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
    queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
  };

  const errMsg = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

  const onDeleteRiga = (rigaId: number) => {
    deleteRiga.mutate(
      { id: bollaId, rigaId },
      {
        onSuccess: () => { invalidateAll(); toast({ title: t("bolle.prodottoRimosso") }); },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.rimuoviError")), variant: "destructive" }),
      }
    );
  };

  const onConferma = () => {
    confermaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => { invalidateAll(); toast({ title: t("bolle.bollaConfermataTitle"), description: t("bolle.bollaConfermataDesc") }); },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.confermaError")), variant: "destructive" }),
      }
    );
  };

  const onConsegna = () => {
    consegnaBolla.mutate(
      { id: bollaId, data: { confermaRicezione: true } },
      {
        onSuccess: () => { invalidateAll(); toast({ title: t("bolle.bollaConsegnataTitle"), description: t("bolle.bollaConsegnataDesc") }); },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.consegnaError")), variant: "destructive" }),
      }
    );
  };

  const onAnnulla = () => {
    annullaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => {
          invalidateAll();
          queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
          toast({ title: t("bolle.bollaAnnullataTitle"), description: t("bolle.bollaAnnullataDesc") });
          setAnnullaOpen(false);
        },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.annullaError")), variant: "destructive" }),
      }
    );
  };

  const onAssegna = (consegnaId: number) => {
    associaBolla.mutate(
      { id: consegnaId, data: { bollaId } },
      {
        onSuccess: () => {
          invalidateAll();
          queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
          setAssegnaOpen(false);
          toast({ title: t("bolle.bollaAssegnataTitle"), description: t("bolle.bollaAssegnataDesc") });
        },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.assegnaError")), variant: "destructive" }),
      }
    );
  };

  const onChangeVolontario = (value: string) => {
    const data =
      value === "__centro__"
        ? { volontarioConsegnaId: null, trasportatoreNome: null, noteConsegna: "Consegna presso il centro" }
        : value === "__altro__"
          ? { volontarioConsegnaId: null, trasportatoreNome: "Ritiro presso il magazzino", noteConsegna: null }
          : { volontarioConsegnaId: parseInt(value), trasportatoreNome: null, noteConsegna: null };
    updateBolla.mutate(
      { id: bollaId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          toast({ title: t("bolle.consegnaAggiornata") });
        },
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.aggiornaError")), variant: "destructive" }),
      }
    );
  };

  const onChangeTrasportatoreNome = (value: string) => {
    updateBolla.mutate(
      { id: bollaId, data: { trasportatoreNome: value.trim() || "Ritiro presso il magazzino" } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) }),
        onError: (err) => toast({ title: t("bolle.error"), description: errMsg(err, t("bolle.aggiornaError")), variant: "destructive" }),
      }
    );
  };

  const consegnaValue = bolla?.volontarioConsegnaId
    ? String(bolla.volontarioConsegnaId)
    : bolla?.trasportatoreNome
      ? "__altro__"
      : bolla?.noteConsegna
        ? "__centro__"
        : "";

  const openPrint = () => {
    setPrintTemplate((impostazioni?.templateBolla as BollaTemplate) ?? "standard");
    setPrintOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!bolla) return;
    setPrinting(true);
    try {
      const benef = beneficiari?.find((b) => b.id === bolla.beneficiarioId);
      const centro = benef?.centroAscoltoId
        ? centri?.find((c) => c.id === benef.centroAscoltoId)
        : undefined;
      const associationLogoDataUrl = await loadAssociationLogo();
      await generateBollaPdf({
        bolla,
        centro: centro
          ? { nome: centro.nome, indirizzo: centro.indirizzo, comune: centro.comune, logoUrl: centro.logoUrl }
          : null,
        footer: impostazioni?.footerBolla ?? null,
        template: printTemplate,
        associationLogoDataUrl,
      });
      setPrintOpen(false);
    } catch {
      toast({ title: t("bolle.error"), description: t("bolle.pdfError"), variant: "destructive" });
    } finally {
      setPrinting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!bolla) return <p className="text-muted-foreground mt-4">{t("bolle.bollaNonTrovata")}</p>;

  const isBozza = bolla.stato === "bozza";
  const isConfermato = bolla.stato === "confermato";
  const isConsegnato = bolla.stato === "consegnato";
  const isAnnullato = bolla.stato === "annullato";
  const modificabile = isBozza || isConfermato; // si possono gestire i prodotti

  return (
    <div className="mt-4 space-y-5">
      {/* Header info */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-lg">{bolla.numeroBolla}</span>
            {statoBadge(bolla.stato)}
          </div>
          <p className="text-sm text-muted-foreground">
            {format(new Date(bolla.dataBolla), "dd MMMM yyyy", { locale: it })}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 shrink-0" onClick={openPrint}>
          <Download className="h-3.5 w-3.5" /> {t("bolle.scaricaPdf")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">{t("bolle.beneficiarioLabel")}</p>
          <p className="font-medium">{bolla.beneficiarioNome ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">{t("bolle.magazzinoLabel")}</p>
          <p className="font-medium">{bolla.magazzinoNome ?? "—"}</p>
        </div>
      </div>

      {isBozza && (
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" /> {t("bolle.modificaIntestazione")}
        </Button>
      )}

      <Separator />

      {/* Consegna: volontario o presso centro */}
      {!isAnnullato && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> {t("bolle.chiEffettuaConsegna")}
          </Label>
          {bolla.daPianificazione && (
            <p className="text-xs text-muted-foreground">
              {t("bolle.daPianificazioneDettaglio", { defaultValue: "Dati ripresi dalla pianificazione collegata; puoi modificarli se necessario." })}
            </p>
          )}
          {isConsegnato ? (
            <p className="text-sm font-medium">{bolla.volontarioNome ?? bolla.trasportatoreNome ?? bolla.noteConsegna ?? "—"}</p>
          ) : (
            <>
              <Select
                value={consegnaValue}
                onValueChange={onChangeVolontario}
                disabled={updateBolla.isPending}
              >
                <SelectTrigger><SelectValue placeholder={t("bolle.consegnaPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__centro__">{t("bolle.consegnaPressoCentro")}</SelectItem>
                  {volontari?.filter(v => v.attivo && (v.statoApprovazione ?? "approvato") === "approvato").map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{volontarioLabel(v)}</SelectItem>
                  ))}
                  <SelectItem value="__altro__">{t("bolle.altroRitiro")}</SelectItem>
                </SelectContent>
              </Select>
              {consegnaValue === "__altro__" && (
                <Input
                  className="mt-2"
                  defaultValue={bolla.trasportatoreNome ?? ""}
                  placeholder={t("bolle.trasportatoreNomePlaceholder")}
                  onBlur={(e) => onChangeTrasportatoreNome(e.target.value)}
                  disabled={updateBolla.isPending}
                />
              )}
            </>
          )}
        </div>
      )}

      <Separator />

      {/* Righe prodotti */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">{t("bolle.prodottiNellaBolla")}</h3>
          {modificabile && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setAddOpen(true)}>
              <PackagePlus className="h-4 w-4" />
              {t("bolle.aggiungiProdotto")}
            </Button>
          )}
        </div>

        {bolla.righe.length === 0 ? (
          <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
            <PackagePlus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("bolle.nessunProdotto")}</p>
            {modificabile && (
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> {t("bolle.aggiungiPrimoProdotto")}
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">{t("bolle.thProdotto")}</TableHead>
                  <TableHead className="text-xs">{t("bolle.thLotto")}</TableHead>
                  <TableHead className="text-xs text-right">{t("common.quantity")}</TableHead>
                  {modificabile && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolla.righe.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-sm">
                      {r.prodottoNome ?? t("bolle.prodottoFallback", { id: r.prodottoId })}
                      {r.fsePlus && (
                        <span className="ml-1 font-bold text-primary" title={t("bolle.fsePlusTitle")}>*</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.codiceLotto ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.quantita} {r.unitaMisura}</TableCell>
                    {modificabile && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => onDeleteRiga(r.id)}
                          disabled={deleteRiga.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {bolla.righe.some(r => r.fsePlus) && (
              <p className="mt-2 text-xs text-muted-foreground">{t("bolle.fsePlusLegend")}</p>
            )}
          </div>
        )}
      </div>

      {/* Azioni stato */}
      {!isAnnullato && (
        <>
          <Separator />
          <div className="space-y-2">
            {isBozza && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 mb-3">
                <strong>{t("bolle.confermaInfoTitle")}</strong>{t("bolle.confermaInfoText")}
              </div>
            )}
            {isConfermato && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 mb-3">
                <strong>{t("bolle.prontaTitle")}</strong>{t("bolle.prontaText")}
              </div>
            )}
            {isBozza && (
              <Button
                className="w-full gap-2"
                onClick={onConferma}
                disabled={bolla.righe.length === 0 || confermaBolla.isPending}
              >
                <CheckCircle className="h-4 w-4" />
                {confermaBolla.isPending ? t("bolle.confermaInCorso") : t("bolle.confermaBolla")}
              </Button>
            )}
            {isConfermato && !hideConsegnaActions && (
              <>
                <Button
                  className="w-full gap-2 bg-green-600 hover:bg-green-700"
                  onClick={onConsegna}
                  disabled={consegnaBolla.isPending}
                >
                  <Truck className="h-4 w-4" />
                  {consegnaBolla.isPending ? t("bolle.registrazione") : t("bolle.segnaConsegnata")}
                </Button>
                {bolla.consegnaId != null && (
                  <p className="text-xs text-muted-foreground text-center">{t("bolle.giaAssegnata")}</p>
                )}
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setAssegnaOpen(true)}
                >
                  <CalendarClock className="h-4 w-4" />
                  {t("bolle.assegnaPianificazione")}
                </Button>
              </>
            )}
            {/* Annulla */}
            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setAnnullaOpen(true)}
              disabled={annullaBolla.isPending}
            >
              <XCircle className="h-4 w-4" />
              {t("bolle.annullaBolla")}
            </Button>
          </div>
        </>
      )}

      {isConsegnato && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          {t("bolle.consegnaCompletata")}
        </div>
      )}

      {isAnnullato && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {t("bolle.bollaAnnullataInfo")}
        </div>
      )}

      {onClose && (
        <>
          <Separator />
          <Button variant="outline" className="w-full gap-2" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" /> {onCloseLabel ?? t("bolle.tornaAlleBolle")}
          </Button>
        </>
      )}

      {addOpen && bolla.magazzinoId && (
        <AggiungiProdottoDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          bollaId={bollaId}
          magazzinoId={bolla.magazzinoId}
        />
      )}

      {editOpen && (
        <ModificaBollaDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          bollaId={bollaId}
          beneficiarioId={bolla.beneficiarioId}
          magazzinoId={bolla.magazzinoId}
          hasRighe={bolla.righe.length > 0}
        />
      )}

      <AlertDialog open={annullaOpen} onOpenChange={setAnnullaOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bolle.annullareTitle", { numero: bolla.numeroBolla })}</AlertDialogTitle>
            <AlertDialogDescription>
              {isConsegnato
                ? t("bolle.annullaDescConsegnato")
                : isConfermato
                  ? t("bolle.annullaDescConfermato")
                  : t("bolle.annullaDescBozza")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("bolle.noMantieni")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onAnnulla}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("bolle.siAnnulla")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={assegnaOpen} onOpenChange={setAssegnaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bolle.assegnaPianificazioneTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("bolle.assegnaPianificazioneDesc")}</p>
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {pianificabili.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("bolle.nessunaPianificata")}</p>
            ) : (
              pianificabili.map((c) => {
                const assegnabile = c.beneficiarioId === bolla.beneficiarioId;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.beneficiarioNome ?? c.codice}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.codice} · {format(new Date(c.dataPrevista), "dd/MM/yyyy", { locale: it })}
                        {c.fasciaOraria ? ` · ${c.fasciaOraria}` : ""}
                      </p>
                    </div>
                    {assegnabile ? (
                      <Button
                        size="sm"
                        onClick={() => onAssegna(c.id)}
                        disabled={associaBolla.isPending}
                      >
                        {t("bolle.assegna")}
                      </Button>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">{t("bolle.altroBeneficiario")}</Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssegnaOpen(false)}>
              {t("bolle.tornaIndietro")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bolle.printTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-sm">{t("bolle.modello")}</Label>
            <div className="grid gap-2">
              {BOLLA_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.value}
                  type="button"
                  onClick={() => setPrintTemplate(tpl.value)}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    printTemplate === tpl.value ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-muted-foreground/40"
                  }`}
                >
                  <p className="font-medium text-sm">{tpl.label}</p>
                  <p className="text-xs text-muted-foreground">{tpl.description}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("bolle.modelloHint1")}<span className="font-medium">{t("bolle.modelloHintBold")}</span>{t("bolle.modelloHint2")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleDownloadPdf} disabled={printing} className="gap-1.5">
              <Download className="h-4 w-4" /> {printing ? t("bolle.generazione") : t("bolle.scaricaPdf")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pagina principale ───────────────────────────────────────────────────────

function trasferimentoStatoBadge(stato: string) {
  if (stato === "completato") return <Badge className="bg-green-500 text-white">{i18n.t("bolle.trasfCompletato")}</Badge>;
  if (stato === "in_transito") return <Badge className="bg-amber-500 text-white">{i18n.t("bolle.trasfInTransito")}</Badge>;
  if (stato === "annullato") return <Badge variant="destructive">{i18n.t("bolle.statoAnnullato")}</Badge>;
  return <Badge variant="secondary">{stato.replace("_", " ")}</Badge>;
}

export default function Bolle() {
  const { user } = useAuth();
  const lockedCentroId = user?.centroAscoltoId ?? null;
  const isCentroLocked = lockedCentroId != null;
  const isGlobal = !isCentroLocked;
  const [filterMagazzinoId, setFilterMagazzinoId] = useState("all");
  const [filterCentroId, setFilterCentroId] = useState("all");
  const [filterStato, setFilterStato] = useState("all");
  useEffect(() => {
    if (isCentroLocked && lockedCentroId != null) {
      setFilterCentroId(String(lockedCentroId));
    }
  }, [isCentroLocked, lockedCentroId]);

  const bolleParams: { magazzinoId?: number; centroAscoltoId?: number; stato?: string } = {};
  if (filterMagazzinoId !== "all") bolleParams.magazzinoId = parseInt(filterMagazzinoId);
  if (filterCentroId !== "all") bolleParams.centroAscoltoId = parseInt(filterCentroId);
  if (filterStato !== "all") bolleParams.stato = filterStato;
  const hasBolleParams = Object.keys(bolleParams).length > 0;

  const { data: bolle, isLoading } = useListBolle(hasBolleParams ? bolleParams : undefined);
  const { data: trasferimenti, isLoading: loadingTrasf } = useListTrasferimenti();
  const { data: scarichi, isLoading: loadingScar } = useListScarichi();
  const { data: centri } = useListCentriAscolto();
  const { data: magazzini } = useListMagazzini();
  const { data: beneficiari } = useListBeneficiari();
  const { data: impostazioni } = useGetImpostazioniStampa();
  const consegnaBolla = useConsegnaBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBollaId, setSelectedBollaId] = useState<number | null>(null);
  const [downloadingTrasfId, setDownloadingTrasfId] = useState<number | null>(null);
  const [downloadingScarId, setDownloadingScarId] = useState<number | null>(null);
  const [downloadingBollaId, setDownloadingBollaId] = useState<number | null>(null);
  const [consegnandoBollaId, setConsegnandoBollaId] = useState<number | null>(null);

  const downloadBolla = async (e: React.MouseEvent, bollaId: number) => {
    e.stopPropagation();
    setDownloadingBollaId(bollaId);
    try {
      await downloadBollaPdf(bollaId, {
        beneficiari,
        centri,
        footer: impostazioni?.footerBolla ?? null,
        template: (impostazioni?.templateBolla as BollaTemplate) ?? "standard",
      });
    } catch {
      toast({ title: t("bolle.error"), description: t("bolle.genBollaError"), variant: "destructive" });
    } finally {
      setDownloadingBollaId(null);
    }
  };

  const markConsegnato = (e: React.MouseEvent, bollaId: number) => {
    e.stopPropagation();
    setConsegnandoBollaId(bollaId);
    consegnaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
          toast({ title: t("bolle.consegnaCompletata") });
        },
        onError: () => toast({ title: t("bolle.error"), description: t("bolle.consegnaError"), variant: "destructive" }),
        onSettled: () => setConsegnandoBollaId(null),
      }
    );
  };

  const downloadTrasf = async (e: React.MouseEvent, trasf: Trasferimento) => {
    e.stopPropagation();
    setDownloadingTrasfId(trasf.id);
    try {
      const associationLogoDataUrl = await loadAssociationLogo();
      await generateTrasferimentoPdf({
        trasferimento: trasf,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl,
      });
    } catch {
      toast({ title: t("bolle.error"), description: t("bolle.genBollaError"), variant: "destructive" });
    } finally {
      setDownloadingTrasfId(null);
    }
  };

  const downloadScar = async (e: React.MouseEvent, s: Scarico) => {
    e.stopPropagation();
    setDownloadingScarId(s.id);
    try {
      const associationLogoDataUrl = await loadAssociationLogo();
      await generateScaricoPdf({
        scarico: s,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl,
      });
    } catch {
      toast({ title: t("bolle.error"), description: t("bolle.genBollaError"), variant: "destructive" });
    } finally {
      setDownloadingScarId(null);
    }
  };

  type Row =
    | { kind: "bolla"; date: string; bolla: NonNullable<typeof bolle>[number] }
    | { kind: "trasf"; date: string; trasf: Trasferimento }
    | { kind: "scar"; date: string; scar: Scarico };

  const magId = filterMagazzinoId !== "all" ? parseInt(filterMagazzinoId) : null;
  // Trasferimenti e scarichi non hanno un centro di ascolto: se è attivo quel
  // filtro li nascondiamo; il filtro magazzino invece si applica anche a loro.
  const showInterni = filterCentroId === "all" && filterStato === "all";
  const trasfFiltered = showInterni
    ? (trasferimenti ?? []).filter(
        (t) => magId === null || t.magazzinoOrigineId === magId || t.magazzinoDestinoId === magId,
      )
    : [];
  const scarFiltered = showInterni
    ? (scarichi ?? []).filter((s) => magId === null || s.magazzinoId === magId)
    : [];

  const rows: Row[] = [
    ...(bolle ?? []).map((b): Row => ({ kind: "bolla", date: b.dataCreazione, bolla: b })),
    ...trasfFiltered.map((t): Row => ({ kind: "trasf", date: t.dataCreazione, trasf: t })),
    ...scarFiltered.map((s): Row => ({ kind: "scar", date: s.dataCreazione, scar: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filtersActive = filterMagazzinoId !== "all" || filterCentroId !== "all" || filterStato !== "all";

  const loading = isLoading || loadingTrasf || loadingScar;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("bolle.title")}</h1>
          <p className="text-muted-foreground">{t("bolle.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> {t("bolle.newBolla")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("bolle.magazzinoLabel")}</Label>
          <Select value={filterMagazzinoId} onValueChange={setFilterMagazzinoId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder={t("bolle.allMagazzini")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("bolle.allMagazzini")}</SelectItem>
              {(magazzini ?? []).map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isGlobal && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("bolle.centroLabel")}</Label>
            <Select value={filterCentroId} onValueChange={setFilterCentroId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t("bolle.allCentriPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("bolle.allCentriPlaceholder")}</SelectItem>
                {(centri ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("common.status")}</Label>
          <Select value={filterStato} onValueChange={setFilterStato}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t("bolle.allStati")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("bolle.allStati")}</SelectItem>
              <SelectItem value="bozza">{t("bolle.statoBozza")}</SelectItem>
              <SelectItem value="confermato">{t("bolle.statoConfermato")}</SelectItem>
              <SelectItem value="consegnato">{t("bolle.statoConsegnato")}</SelectItem>
              <SelectItem value="annullato">{t("bolle.statoAnnullato")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => { setFilterMagazzinoId("all"); setFilterCentroId(isCentroLocked && lockedCentroId != null ? String(lockedCentroId) : "all"); setFilterStato("all"); }}
          >
            <XCircle className="h-4 w-4" /> {t("bolle.azzeraFiltri")}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bolle.numero")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("bolle.beneficiarioLabel")}</TableHead>
                <TableHead>{t("bolle.magazzinoLabel")}</TableHead>
                {isGlobal && <TableHead>{t("common.centro")}</TableHead>}
                <TableHead className="text-center">{t("common.status")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(isGlobal ? 7 : 6).fill(0).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isGlobal ? 7 : 6} className="h-32 text-center text-muted-foreground">
                    {filtersActive
                      ? t("bolle.noDocFiltri")
                      : t("bolle.noBolle")}
                  </TableCell>
                </TableRow>
              ) : rows.map(row => row.kind === "scar" ? (
                <TableRow key={`s-${row.scar.id}`} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <PackageMinus className="h-4 w-4 text-red-600" />
                      {row.scar.codice}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(row.scar.dataScarico), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      {t("bolle.scaricoMagazzino")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{row.scar.magazzinoNome ?? "—"}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>{causaleLabel(row.scar)}</span>
                    </div>
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">{row.scar.centroAscoltoNome ?? "—"}</TableCell>
                  )}
                  <TableCell className="text-center">
                    <Badge variant="secondary">{t("bolle.articoli", { count: row.scar.righe?.length ?? 0 })}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={(e) => downloadScar(e, row.scar)}
                      disabled={downloadingScarId === row.scar.id}
                    >
                      <Download className="h-3.5 w-3.5" /> {t("bolle.bollaBtn")}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : row.kind === "bolla" ? (
                <TableRow
                  key={`b-${row.bolla.id}`}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelectedBollaId(row.bolla.id)}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {row.bolla.numeroBolla}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(row.bolla.dataBolla), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="font-medium">{row.bolla.beneficiarioNome ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.bolla.magazzinoNome ?? "—"}</TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">{row.bolla.centroAscoltoNome ?? "—"}</TableCell>
                  )}
                  <TableCell className="text-center">{statoBadge(row.bolla.stato)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {row.bolla.stato === "confermato" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-green-700 border-green-300 hover:bg-green-50 hover:text-green-700"
                          onClick={(e) => markConsegnato(e, row.bolla.id)}
                          disabled={consegnandoBollaId === row.bolla.id}
                        >
                          <Truck className="h-3.5 w-3.5" />
                          {t("bolle.segnaConsegnata")}
                        </Button>
                      )}
                      {(row.bolla.stato === "confermato" || row.bolla.stato === "consegnato" || row.bolla.stato === "annullato") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          title={t("common.exportPdf")}
                          onClick={(e) => downloadBolla(e, row.bolla.id)}
                          disabled={downloadingBollaId === row.bolla.id}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={`t-${row.trasf.id}`} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-emerald-600" />
                      {row.trasf.codice}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(row.trasf.dataRichiesta), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      {t("bolle.trasferimentoInterno")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{row.trasf.magazzinoOrigineNome ?? "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                      <span>{row.trasf.magazzinoDestinoNome ?? "—"}</span>
                    </div>
                  </TableCell>
                  {isGlobal && (
                    <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  )}
                  <TableCell className="text-center">{trasferimentoStatoBadge(row.trasf.stato)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={(e) => downloadTrasf(e, row.trasf)}
                      disabled={downloadingTrasfId === row.trasf.id}
                    >
                      <Download className="h-3.5 w-3.5" /> {t("bolle.bollaBtn")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreaiBollaDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <Sheet open={selectedBollaId !== null} onOpenChange={open => { if (!open) setSelectedBollaId(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("bolle.dettaglioBolla")}</SheetTitle>
          </SheetHeader>
          {selectedBollaId !== null && (
            <BollaDettaglio bollaId={selectedBollaId} onClose={() => setSelectedBollaId(null)} />
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}
