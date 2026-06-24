import { useState } from "react";
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
  useListVolontari,
  useGetImpostazioniStampa,
  useListTrasferimenti,
  useListScarichi,
  getListBolleQueryKey,
  getGetBollaQueryKey,
  getListGiacenzeQueryKey,
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Trash2, PackagePlus, PackageMinus, CheckCircle, Truck, ChevronRight, XCircle, Pencil, User, Download, ArrowRight, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateBollaPdf, loadAssociationLogo, BOLLA_TEMPLATES, type BollaTemplate } from "@/lib/bolla-pdf";
import { generateTrasferimentoPdf } from "@/lib/trasferimento-pdf";
import { generateScaricoPdf, causaleLabel } from "@/lib/scarico-pdf";

function statoBadge(stato: string) {
  if (stato === "consegnato") return <Badge className="bg-green-500 text-white">Consegnato</Badge>;
  if (stato === "confermato") return <Badge className="border-blue-300 text-blue-700 bg-blue-50">Confermato</Badge>;
  if (stato === "annullato") return <Badge variant="destructive">Annullato</Badge>;
  return <Badge variant="secondary">Bozza</Badge>;
}

// ─── Form crea bolla ─────────────────────────────────────────────────────────

function CreaiBollaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [beneficiarioId, setBeneficiarioId] = useState("");
  const [magazzinoId, setMagazzinoId] = useState("");
  const [centroId, setCentroId] = useState("all");
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreNome, setTrasportatoreNome] = useState("");
  const { data: centri } = useListCentriAscolto();
  const { data: beneficiari } = useListBeneficiari(
    centroId !== "all" ? { centroAscoltoId: parseInt(centroId) } : undefined
  );
  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari();
  const createBolla = useCreateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const onSubmit = () => {
    if (!beneficiarioId || !magazzinoId) return;
    const data: {
      beneficiarioId: number;
      magazzinoId: number;
      volontarioConsegnaId?: number;
      trasportatoreNome?: string;
    } = { beneficiarioId: parseInt(beneficiarioId), magazzinoId: parseInt(magazzinoId) };
    if (trasportatore === "__altro__") {
      data.trasportatoreNome = trasportatoreNome.trim() || "Ritiro presso il magazzino";
    } else if (trasportatore) {
      data.volontarioConsegnaId = parseInt(trasportatore);
    }
    createBolla.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: "Bolla creata" });
          setBeneficiarioId("");
          setMagazzinoId("");
          setCentroId("all");
          setTrasportatore("");
          setTrasportatoreNome("");
          onClose();
        },
        onError: () => toast({ title: "Errore", description: "Impossibile creare la bolla", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nuova Bolla di Consegna</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Centro di Ascolto (filtro)</Label>
            <Select value={centroId} onValueChange={(v) => { setCentroId(v); setBeneficiarioId(""); }}>
              <SelectTrigger><SelectValue placeholder="Tutti i centri" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i beneficiari</SelectItem>
                {centri?.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Beneficiario</Label>
            <Select value={beneficiarioId} onValueChange={setBeneficiarioId}>
              <SelectTrigger><SelectValue placeholder="Seleziona beneficiario..." /></SelectTrigger>
              <SelectContent>
                {beneficiari?.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Nessun beneficiario per questo centro</div>
                ) : beneficiari?.map(b => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.cognome} {b.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Magazzino di Uscita</Label>
            <Select value={magazzinoId} onValueChange={setMagazzinoId}>
              <SelectTrigger><SelectValue placeholder="Seleziona magazzino..." /></SelectTrigger>
              <SelectContent>
                {magazzini?.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Trasportatore</Label>
            <Select value={trasportatore} onValueChange={setTrasportatore}>
              <SelectTrigger><SelectValue placeholder="Seleziona trasportatore..." /></SelectTrigger>
              <SelectContent>
                {volontari?.filter(v => v.attivo).map(v => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.cognome} {v.nome}</SelectItem>
                ))}
                <SelectItem value="__altro__">Altro (ritiro a mano presso il magazzino)</SelectItem>
              </SelectContent>
            </Select>
            {trasportatore === "__altro__" && (
              <Input
                placeholder="Nome trasportatore (opzionale)"
                value={trasportatoreNome}
                onChange={(e) => setTrasportatoreNome(e.target.value)}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={onSubmit} disabled={!beneficiarioId || !magazzinoId || createBolla.isPending}>
            Crea Bolla
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
  const { data: beneficiari } = useListBeneficiari();
  const { data: magazzini } = useListMagazzini();
  const updateBolla = useUpdateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const magazzinoCambiato = parseInt(mId) !== magazzinoId;

  const onSubmit = () => {
    if (magazzinoCambiato && hasRighe) {
      const ok = window.confirm(
        "Cambiando magazzino i prodotti già aggiunti alla bolla verranno rimossi (appartengono al magazzino precedente). Continuare?"
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
          toast({ title: "Bolla aggiornata" });
          onClose();
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Errore durante l'aggiornamento";
          toast({ title: "Errore", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Modifica intestazione bolla</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Beneficiario</Label>
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
            <Label>Magazzino di Uscita</Label>
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
                Cambiando magazzino i prodotti già aggiunti verranno rimossi (appartengono al magazzino precedente).
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Chiudi</Button>
          <Button onClick={onSubmit} disabled={updateBolla.isPending}>Salva</Button>
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

  const { data: giacenze } = useListGiacenze({ magazzinoId });
  const { data: lotti } = useListLotti({ magazzinoId, prodottoId: prodottoId ? parseInt(prodottoId) : undefined });

  const addRiga = useAddBollaRiga();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const giacenzaSelezionata = giacenze?.find(g => g.prodottoId === parseInt(prodottoId));
  const lottiDisponibili = lotti?.filter(l => l.magazzinoId === magazzinoId && l.quantitaResidua > 0) ?? [];

  // limite massimo: lotto specifico oppure giacenza totale
  const lottoSelezionato = lottiDisponibili.find(l => l.id === parseInt(lottoId));
  const maxDisponibile = lottoSelezionato
    ? lottoSelezionato.quantitaResidua
    : giacenzaSelezionata?.quantitaTotale ?? 0;
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
          toast({ title: "Prodotto aggiunto" });
          // mantieni il dialog aperto per aggiungere altri prodotti: resetta i campi
          setProdottoId(""); setLottoId(""); setQuantita(""); setUnitaMisura("pz");
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Errore durante l'aggiunta";
          toast({ title: "Errore", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Aggiungi Prodotto alla Bolla</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Prodotto disponibile in magazzino</Label>
            <Select value={prodottoId} onValueChange={v => { setProdottoId(v); setLottoId(""); setQuantita(""); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona prodotto..." /></SelectTrigger>
              <SelectContent>
                {giacenze && giacenze.length > 0 ? giacenze.map(g => (
                  <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                    {g.prodottoNome} — {g.quantitaTotale} {g.unitaMisura} disponibili
                  </SelectItem>
                )) : (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    Nessun prodotto disponibile in questo magazzino
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {prodottoId && lottiDisponibili.length > 0 && (
            <div className="space-y-2">
              <Label>Lotto (FEFO — opzionale)</Label>
              <Select value={lottoId} onValueChange={v => { setLottoId(v); setQuantita(""); }}>
                <SelectTrigger><SelectValue placeholder="Automatico (prima scadenza)" /></SelectTrigger>
                <SelectContent>
                  {lottiDisponibili.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.codiceLotto ?? `Lotto #${l.id}`}
                      {l.dataScadenza ? ` — scad. ${l.dataScadenza}` : ""}
                      {` — ${l.quantitaResidua} disp.`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Lascia vuoto per scaricare automaticamente i lotti in scadenza per primi.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Quantità</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={maxDisponibile || undefined}
                value={quantita}
                onChange={e => setQuantita(e.target.value)}
                placeholder="0"
                className={eccedeDisponibilita ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {prodottoId && (
                <p className={`text-xs ${eccedeDisponibilita ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {eccedeDisponibilita
                    ? `Massimo disponibile: ${maxDisponibile}`
                    : `Disponibile: ${maxDisponibile} ${giacenzaSelezionata?.unitaMisura ?? ""}`}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Unità di misura</Label>
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
          <Button variant="outline" onClick={onClose}>Chiudi</Button>
          <Button onClick={onSubmit} disabled={!prodottoId || !quantita || eccedeDisponibilita || addRiga.isPending}>
            Aggiungi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dettaglio bolla ─────────────────────────────────────────────────────────

function BollaDettaglio({ bollaId }: { bollaId: number }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [annullaOpen, setAnnullaOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printTemplate, setPrintTemplate] = useState<BollaTemplate>("standard");
  const [printing, setPrinting] = useState(false);
  const { data: bolla, isLoading } = useGetBolla(bollaId);
  const { data: volontari } = useListVolontari();
  const { data: beneficiari } = useListBeneficiari();
  const { data: centri } = useListCentriAscolto();
  const { data: impostazioni } = useGetImpostazioniStampa();
  const deleteRiga = useDeleteBollaRiga();
  const confermaBolla = useConfermaBolla();
  const consegnaBolla = useConsegnaBolla();
  const annullaBolla = useAnnullaBolla();
  const updateBolla = useUpdateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
        onSuccess: () => { invalidateAll(); toast({ title: "Prodotto rimosso" }); },
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Impossibile rimuovere"), variant: "destructive" }),
      }
    );
  };

  const onConferma = () => {
    confermaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => { invalidateAll(); toast({ title: "Bolla confermata", description: "Prodotti scaricati dal magazzino." }); },
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Errore durante la conferma"), variant: "destructive" }),
      }
    );
  };

  const onConsegna = () => {
    consegnaBolla.mutate(
      { id: bollaId, data: { confermaRicezione: true } },
      {
        onSuccess: () => { invalidateAll(); toast({ title: "Bolla consegnata", description: "Consegna registrata." }); },
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Errore durante la consegna"), variant: "destructive" }),
      }
    );
  };

  const onAnnulla = () => {
    annullaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => {
          invalidateAll();
          toast({ title: "Bolla annullata", description: "Eventuali scarichi sono stati ripristinati a magazzino." });
          setAnnullaOpen(false);
        },
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Impossibile annullare"), variant: "destructive" }),
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
          toast({ title: "Consegna aggiornata" });
        },
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Impossibile aggiornare"), variant: "destructive" }),
      }
    );
  };

  const onChangeTrasportatoreNome = (value: string) => {
    updateBolla.mutate(
      { id: bollaId, data: { trasportatoreNome: value.trim() || "Ritiro presso il magazzino" } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) }),
        onError: (err) => toast({ title: "Errore", description: errMsg(err, "Impossibile aggiornare"), variant: "destructive" }),
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
      toast({ title: "Errore", description: "Impossibile generare il PDF.", variant: "destructive" });
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

  if (!bolla) return <p className="text-muted-foreground mt-4">Bolla non trovata.</p>;

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
          <Download className="h-3.5 w-3.5" /> Scarica PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Beneficiario</p>
          <p className="font-medium">{bolla.beneficiarioNome ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide mb-0.5">Magazzino</p>
          <p className="font-medium">{bolla.magazzinoNome ?? "—"}</p>
        </div>
      </div>

      {isBozza && (
        <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" /> Modifica beneficiario/magazzino
        </Button>
      )}

      <Separator />

      {/* Consegna: volontario o presso centro */}
      {!isAnnullato && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Chi effettua la consegna
          </Label>
          {isConsegnato ? (
            <p className="text-sm font-medium">{bolla.volontarioNome ?? bolla.trasportatoreNome ?? bolla.noteConsegna ?? "—"}</p>
          ) : (
            <>
              <Select
                value={consegnaValue}
                onValueChange={onChangeVolontario}
                disabled={updateBolla.isPending}
              >
                <SelectTrigger><SelectValue placeholder="Seleziona trasportatore o centro..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__centro__">📍 Consegna presso il centro</SelectItem>
                  {volontari?.filter(v => v.attivo).map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.cognome} {v.nome}</SelectItem>
                  ))}
                  <SelectItem value="__altro__">Altro (ritiro a mano presso il magazzino)</SelectItem>
                </SelectContent>
              </Select>
              {consegnaValue === "__altro__" && (
                <Input
                  className="mt-2"
                  defaultValue={bolla.trasportatoreNome ?? ""}
                  placeholder="Nome trasportatore (opzionale)"
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
          <h3 className="font-semibold text-sm">Prodotti nella bolla</h3>
          {modificabile && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setAddOpen(true)}>
              <PackagePlus className="h-4 w-4" />
              Aggiungi prodotto
            </Button>
          )}
        </div>

        {bolla.righe.length === 0 ? (
          <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
            <PackagePlus className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nessun prodotto aggiunto.</p>
            {modificabile && (
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Aggiungi il primo prodotto
              </Button>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Prodotto</TableHead>
                  <TableHead className="text-xs">Lotto</TableHead>
                  <TableHead className="text-xs text-right">Quantità</TableHead>
                  {modificabile && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolla.righe.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-sm">{r.prodottoNome ?? `Prodotto #${r.prodottoId}`}</TableCell>
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
          </div>
        )}
      </div>

      {/* Azioni stato */}
      {modificabile && (
        <>
          <Separator />
          <div className="space-y-2">
            {isBozza && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 mb-3">
                <strong>Conferma bolla</strong> — I prodotti verranno scaricati dal magazzino (lotti in scadenza per primi) e verrà creato un movimento di uscita.
              </div>
            )}
            {isConfermato && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 mb-3">
                <strong>Pronta per la consegna.</strong> Puoi ancora aggiungere o rimuovere prodotti (il magazzino si aggiorna in tempo reale). Segna come consegnata quando il beneficiario ha ricevuto la merce.
              </div>
            )}
            {isBozza && (
              <Button
                className="w-full gap-2"
                onClick={onConferma}
                disabled={bolla.righe.length === 0 || confermaBolla.isPending}
              >
                <CheckCircle className="h-4 w-4" />
                {confermaBolla.isPending ? "Conferma in corso..." : "Conferma bolla e scarica magazzino"}
              </Button>
            )}
            {isConfermato && (
              <Button
                className="w-full gap-2 bg-green-600 hover:bg-green-700"
                onClick={onConsegna}
                disabled={consegnaBolla.isPending}
              >
                <Truck className="h-4 w-4" />
                {consegnaBolla.isPending ? "Registrazione..." : "Segna come consegnata"}
              </Button>
            )}
            {/* Annulla */}
            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
              onClick={() => setAnnullaOpen(true)}
              disabled={annullaBolla.isPending}
            >
              <XCircle className="h-4 w-4" />
              Annulla bolla
            </Button>
          </div>
        </>
      )}

      {isConsegnato && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          ✓ Consegna completata. Merce scaricata dal magazzino.
        </div>
      )}

      {isAnnullato && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          ✕ Bolla annullata. Eventuali prodotti scaricati sono stati ripristinati a magazzino.
        </div>
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
            <AlertDialogTitle>Annullare la bolla {bolla.numeroBolla}?</AlertDialogTitle>
            <AlertDialogDescription>
              {isConfermato
                ? "I prodotti già scaricati verranno ripristinati a magazzino e i movimenti di uscita verranno annullati. L'operazione non è reversibile."
                : "La bolla verrà contrassegnata come annullata. L'operazione non è reversibile."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, mantieni</AlertDialogCancel>
            <AlertDialogAction
              onClick={onAnnulla}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sì, annulla bolla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scarica bolla in PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label className="text-sm">Modello</Label>
            <div className="grid gap-2">
              {BOLLA_TEMPLATES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPrintTemplate(t.value)}
                  className={`text-left rounded-lg border p-3 transition-colors ${
                    printTemplate === t.value ? "border-primary ring-2 ring-primary/30 bg-primary/5" : "hover:border-muted-foreground/40"
                  }`}
                >
                  <p className="font-medium text-sm">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Il modello predefinito si imposta in <span className="font-medium">Impostazioni Stampa</span>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOpen(false)}>Annulla</Button>
            <Button onClick={handleDownloadPdf} disabled={printing} className="gap-1.5">
              <Download className="h-4 w-4" /> {printing ? "Generazione..." : "Scarica PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Pagina principale ───────────────────────────────────────────────────────

function trasferimentoStatoBadge(stato: string) {
  if (stato === "completato") return <Badge className="bg-green-500 text-white">Completato</Badge>;
  if (stato === "in_transito") return <Badge className="bg-amber-500 text-white">In transito</Badge>;
  if (stato === "annullato") return <Badge variant="destructive">Annullato</Badge>;
  return <Badge variant="secondary">{stato.replace("_", " ")}</Badge>;
}

export default function Bolle() {
  const [filterMagazzinoId, setFilterMagazzinoId] = useState("all");
  const [filterCentroId, setFilterCentroId] = useState("all");
  const [filterStato, setFilterStato] = useState("all");

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
  const { data: impostazioni } = useGetImpostazioniStampa();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBollaId, setSelectedBollaId] = useState<number | null>(null);
  const [downloadingTrasfId, setDownloadingTrasfId] = useState<number | null>(null);
  const [downloadingScarId, setDownloadingScarId] = useState<number | null>(null);

  const downloadTrasf = async (e: React.MouseEvent, t: Trasferimento) => {
    e.stopPropagation();
    setDownloadingTrasfId(t.id);
    try {
      const associationLogoDataUrl = await loadAssociationLogo();
      await generateTrasferimentoPdf({
        trasferimento: t,
        footer: impostazioni?.footerBolla ?? null,
        associationLogoDataUrl,
      });
    } catch {
      toast({ title: "Errore", description: "Impossibile generare la bolla.", variant: "destructive" });
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
      toast({ title: "Errore", description: "Impossibile generare la bolla.", variant: "destructive" });
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
    ...(bolle ?? []).map((b): Row => ({ kind: "bolla", date: b.dataBolla, bolla: b })),
    ...trasfFiltered.map((t): Row => ({ kind: "trasf", date: t.dataRichiesta, trasf: t })),
    ...scarFiltered.map((s): Row => ({ kind: "scar", date: s.dataScarico, scar: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filtersActive = filterMagazzinoId !== "all" || filterCentroId !== "all" || filterStato !== "all";

  const loading = isLoading || loadingTrasf || loadingScar;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bolle di Consegna</h1>
          <p className="text-muted-foreground">Documenti di accompagnamento per le uscite merce.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nuova Bolla
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Magazzino</Label>
          <Select value={filterMagazzinoId} onValueChange={setFilterMagazzinoId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Tutti i magazzini" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i magazzini</SelectItem>
              {(magazzini ?? []).map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Centro di Ascolto</Label>
          <Select value={filterCentroId} onValueChange={setFilterCentroId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Tutti i centri" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i centri</SelectItem>
              {(centri ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Stato</Label>
          <Select value={filterStato} onValueChange={setFilterStato}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tutti gli stati" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="bozza">Bozza</SelectItem>
              <SelectItem value="confermato">Confermato</SelectItem>
              <SelectItem value="consegnato">Consegnato</SelectItem>
              <SelectItem value="annullato">Annullato</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={() => { setFilterMagazzinoId("all"); setFilterCentroId("all"); setFilterStato("all"); }}
          >
            <XCircle className="h-4 w-4" /> Azzera filtri
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Numero</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Beneficiario</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(6).fill(0).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {filtersActive
                      ? "Nessun documento corrisponde ai filtri selezionati."
                      : "Nessuna bolla emessa. Crea la prima bolla con il pulsante in alto a destra."}
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
                      Scarico Magazzino
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{row.scar.magazzinoNome ?? "—"}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>{causaleLabel(row.scar)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{row.scar.righe?.length ?? 0} art.</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={(e) => downloadScar(e, row.scar)}
                      disabled={downloadingScarId === row.scar.id}
                    >
                      <Download className="h-3.5 w-3.5" /> Bolla
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
                  <TableCell className="text-center">{statoBadge(row.bolla.stato)}</TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
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
                      Trasferimento Interno
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{row.trasf.magazzinoOrigineNome ?? "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                      <span>{row.trasf.magazzinoDestinoNome ?? "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{trasferimentoStatoBadge(row.trasf.stato)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={(e) => downloadTrasf(e, row.trasf)}
                      disabled={downloadingTrasfId === row.trasf.id}
                    >
                      <Download className="h-3.5 w-3.5" /> Bolla
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
            <SheetTitle>Dettaglio Bolla</SheetTitle>
          </SheetHeader>
          {selectedBollaId !== null && (
            <BollaDettaglio bollaId={selectedBollaId} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
