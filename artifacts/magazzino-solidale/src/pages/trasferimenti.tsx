import { useState } from "react";
import {
  useListTrasferimenti,
  useCreateTrasferimento,
  useAvviaTrasferimento,
  useConfermaTrasferimento,
  useListMagazzini,
  useListGiacenze,
  useListVolontari,
  useGetImpostazioniStampa,
  getListTrasferimentiQueryKey,
  getListGiacenzeQueryKey,
  type Trasferimento,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, ArrowRight, Play, CheckCircle2, Trash2, Download, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateTrasferimentoPdf, loadAssociationLogo } from "@/lib/trasferimento-pdf";

interface RigaDraft {
  key: string;
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
}

function newRiga(): RigaDraft {
  return { key: Math.random().toString(36).slice(2), prodottoId: "", quantita: "", unitaMisura: "pz" };
}

// ─── Editor righe (dipende dal magazzino origine) ────────────────────────────

function RigheEditor({
  magazzinoId,
  righe,
  setRighe,
}: {
  magazzinoId: number;
  righe: RigaDraft[];
  setRighe: (r: RigaDraft[]) => void;
}) {
  const { data: giacenze } = useListGiacenze({ magazzinoId });

  const update = (key: string, patch: Partial<RigaDraft>) =>
    setRighe(righe.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRighe(righe.filter((r) => r.key !== key));

  const usedIds = righe.map((r) => r.prodottoId).filter(Boolean);

  return (
    <div className="space-y-3">
      {(!giacenze || giacenze.length === 0) && (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
          Nessun prodotto disponibile nel magazzino di origine selezionato.
        </p>
      )}

      {righe.map((r) => {
        const giac = giacenze?.find((g) => g.prodottoId === parseInt(r.prodottoId));
        const max = giac?.quantitaTotale ?? 0;
        const qNum = parseFloat(r.quantita || "0");
        const eccede = !!r.prodottoId && qNum > max;
        return (
          <div key={r.key} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2">
                <Label className="text-xs">Prodotto</Label>
                <Select
                  value={r.prodottoId}
                  onValueChange={(v) => {
                    const g = giacenze?.find((x) => x.prodottoId === parseInt(v));
                    update(r.key, { prodottoId: v, unitaMisura: g?.unitaMisura ?? "pz", quantita: "" });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona prodotto..." /></SelectTrigger>
                  <SelectContent>
                    {giacenze
                      ?.filter((g) => g.prodottoId === parseInt(r.prodottoId) || !usedIds.includes(String(g.prodottoId)))
                      .map((g) => (
                        <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                          {g.prodottoNome} — {g.quantitaTotale} {g.unitaMisura} disp.
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => remove(r.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Quantità</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={max || undefined}
                  value={r.quantita}
                  onChange={(e) => update(r.key, { quantita: e.target.value })}
                  placeholder="0"
                  className={eccede ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {r.prodottoId && (
                  <p className={`text-xs ${eccede ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    {eccede ? `Massimo disponibile: ${max}` : `Disponibile: ${max} ${giac?.unitaMisura ?? ""}`}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Unità di misura</Label>
                <Select value={r.unitaMisura} onValueChange={(v) => update(r.key, { unitaMisura: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["pz", "kg", "g", "lt", "ml", "conf", "scatola", "busta"].map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={() => setRighe([...righe, newRiga()])}
        disabled={!giacenze || giacenze.length === 0}
      >
        <Plus className="h-4 w-4" /> Aggiungi prodotto
      </Button>
    </div>
  );
}

// ─── Form nuovo trasferimento ────────────────────────────────────────────────

function NuovoTrasferimentoForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (t: Trasferimento) => void;
}) {
  const [origineId, setOrigineId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [trasportatore, setTrasportatore] = useState("");
  const [trasportatoreAltro, setTrasportatoreAltro] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([newRiga()]);

  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari();
  const createTrasferimento = useCreateTrasferimento();
  const { toast } = useToast();

  const origineIdNum = origineId ? parseInt(origineId) : 0;
  const { data: origineGiacenze } = useListGiacenze(
    { magazzinoId: origineIdNum },
    { query: { enabled: !!origineId, queryKey: getListGiacenzeQueryKey({ magazzinoId: origineIdNum }) } },
  );

  const reset = () => {
    setOrigineId("");
    setDestinoId("");
    setTrasportatore("");
    setTrasportatoreAltro("");
    setNote("");
    setRighe([newRiga()]);
  };

  const righeValide = righe.filter((r) => r.prodottoId && parseFloat(r.quantita || "0") > 0);
  const hasEccesso = righeValide.some((r) => {
    const giac = origineGiacenze?.find((g) => g.prodottoId === parseInt(r.prodottoId));
    return parseFloat(r.quantita) > (giac?.quantitaTotale ?? 0);
  });
  const trasportatoreValido =
    (!!trasportatore && trasportatore !== "altro") ||
    (trasportatore === "altro" && trasportatoreAltro.trim().length > 0);
  const canSubmit =
    !!origineId &&
    !!destinoId &&
    origineId !== destinoId &&
    righeValide.length > 0 &&
    !hasEccesso &&
    trasportatoreValido &&
    !createTrasferimento.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    createTrasferimento.mutate(
      {
        data: {
          magazzinoOrigineId: parseInt(origineId),
          magazzinoDestinoId: parseInt(destinoId),
          dataRichiesta: new Date().toISOString().split("T")[0],
          trasportatoreVolontarioId:
            trasportatore && trasportatore !== "altro" ? parseInt(trasportatore) : undefined,
          trasportatoreNome:
            trasportatore === "altro" ? (trasportatoreAltro.trim() || undefined) : undefined,
          note: note || undefined,
          righe: righeValide.map((r) => ({
            prodottoId: parseInt(r.prodottoId),
            quantita: parseFloat(r.quantita),
            unitaMisura: r.unitaMisura,
          })),
        },
      },
      {
        onSuccess: (t) => {
          reset();
          onClose();
          onCreated(t);
        },
        onError: () =>
          toast({ title: "Errore", description: "Impossibile creare il trasferimento", variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nuovo Trasferimento</SheetTitle>
          <SheetDescription>
            Seleziona i magazzini e i prodotti da spostare. Verrà generata una bolla di trasferimento.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label>Magazzino di partenza</Label>
              <Select value={origineId} onValueChange={(v) => { setOrigineId(v); setRighe([newRiga()]); }}>
                <SelectTrigger><SelectValue placeholder="Seleziona origine..." /></SelectTrigger>
                <SelectContent>
                  {magazzini?.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Magazzino di destinazione</Label>
              <Select value={destinoId} onValueChange={setDestinoId}>
                <SelectTrigger><SelectValue placeholder="Seleziona destinazione..." /></SelectTrigger>
                <SelectContent>
                  {magazzini?.filter((m) => String(m.id) !== origineId).map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {origineId && destinoId && origineId === destinoId && (
                <p className="text-xs text-destructive">Origine e destinazione devono essere diverse.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Trasportatore <span className="text-destructive">*</span></Label>
            <Select value={trasportatore} onValueChange={(v) => { setTrasportatore(v); if (v !== "altro") setTrasportatoreAltro(""); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona trasportatore..." /></SelectTrigger>
              <SelectContent>
                {volontari?.filter((v) => v.attivo).map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.nome} {v.cognome}</SelectItem>
                ))}
                <SelectItem value="altro">Altro…</SelectItem>
              </SelectContent>
            </Select>
            {trasportatore === "altro" && (
              <Input
                value={trasportatoreAltro}
                onChange={(e) => setTrasportatoreAltro(e.target.value)}
                placeholder="Nome del trasportatore"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Prodotti da trasferire</Label>
            {origineId ? (
              <RigheEditor magazzinoId={parseInt(origineId)} righe={righe} setRighe={setRighe} />
            ) : (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
                Seleziona prima il magazzino di partenza.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Note (opzionale)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Eventuali note sul trasferimento" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            <Plus className="h-4 w-4" /> Crea e genera bolla
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function Trasferimenti() {
  const { data: trasferimenti, isLoading } = useListTrasferimenti();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: impostazioni } = useGetImpostazioniStampa();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [created, setCreated] = useState<Trasferimento | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const avviaTrasferimento = useAvviaTrasferimento();
  const confermaTrasferimento = useConfermaTrasferimento();

  const handleAction = (t: Trasferimento) => {
    if (t.stato === "richiesto" || t.stato === "preparato") {
      avviaTrasferimento.mutate({ id: t.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
          toast({ title: "Trasferimento avviato" });
        },
      });
    } else if (t.stato === "in_transito") {
      confermaTrasferimento.mutate({ id: t.id, data: { dataConferma: new Date().toISOString() } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
          toast({ title: "Ricezione confermata" });
        },
      });
    }
  };

  const downloadBolla = async (t: Trasferimento) => {
    setDownloadingId(t.id);
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
      setDownloadingId(null);
    }
  };

  const handleCreated = (t: Trasferimento) => {
    queryClient.invalidateQueries({ queryKey: getListTrasferimentiQueryKey() });
    setCreated(t);
  };

  const getStatusBadge = (stato: string) => {
    switch (stato) {
      case "richiesto": return <Badge variant="secondary" className="bg-gray-100 text-gray-800">Richiesto</Badge>;
      case "preparato": return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Preparato</Badge>;
      case "in_transito": return <Badge variant="outline" className="bg-amber-500 text-white border-amber-600 shadow-sm animate-pulse">In Transito</Badge>;
      case "completato": return <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Completato</Badge>;
      case "annullato": return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Annullato</Badge>;
      default: return <Badge>{stato}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Trasferimenti</h1>
          <p className="text-muted-foreground">Sposta merce tra i diversi magazzini dell'associazione.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={trasferimenti ?? []}
            columns={[
              { header: "Codice", accessor: (t) => t.codice },
              { header: "Data Richiesta", accessor: (t) => t.dataRichiesta ? new Date(t.dataRichiesta).toLocaleDateString("it-IT") : "" },
              { header: "Origine", accessor: (t) => t.magazzinoOrigineNome },
              { header: "Destinazione", accessor: (t) => t.magazzinoDestinoNome },
              { header: "Articoli", accessor: (t) => t.righe?.length ?? 0 },
              { header: "Stato", accessor: (t) => t.stato?.replace("_", " ") },
            ]}
            filename="trasferimenti"
            title="Trasferimenti"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nuovo</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Percorso</TableHead>
                <TableHead>Dettaglio</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="text-right w-[230px]">Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : trasferimenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nessun trasferimento registrato.</TableCell>
                </TableRow>
              ) : trasferimenti?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-sm font-medium">{t.codice}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(t.dataRichiesta), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{t.magazzinoOrigineNome}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{t.magazzinoDestinoNome}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.righe?.length || 0} articoli
                  </TableCell>
                  <TableCell className="text-center">
                    {getStatusBadge(t.stato)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => downloadBolla(t)}
                        disabled={downloadingId === t.id}
                      >
                        <Download className="h-3.5 w-3.5" /> Bolla
                      </Button>
                      {(t.stato === "richiesto" || t.stato === "preparato") && (
                        <Button size="sm" variant="outline" className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => handleAction(t)} disabled={avviaTrasferimento.isPending}>
                          <Play className="h-3.5 w-3.5" /> Avvia
                        </Button>
                      )}
                      {t.stato === "in_transito" && (
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => handleAction(t)} disabled={confermaTrasferimento.isPending}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Conferma Ric.
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NuovoTrasferimentoForm open={isFormOpen} onClose={() => setIsFormOpen(false)} onCreated={handleCreated} />

      {/* Conferma creazione + download bolla */}
      <Dialog open={!!created} onOpenChange={(o) => { if (!o) setCreated(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" /> Bolla creata
            </DialogTitle>
          </DialogHeader>
          {created && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Trasferimento <span className="font-mono font-medium text-foreground">{created.codice}</span> registrato.
                È stata generata la bolla di trasferimento interno.
              </p>
              <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
                <span className="font-medium">{created.magazzinoOrigineNome}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{created.magazzinoDestinoNome}</span>
                <span className="ml-auto text-muted-foreground">{created.righe?.length || 0} articoli</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreated(null)}>Chiudi</Button>
            <Button
              className="gap-2"
              disabled={!created || downloadingId === created.id}
              onClick={() => created && downloadBolla(created)}
            >
              <Download className="h-4 w-4" /> Scarica bolla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
