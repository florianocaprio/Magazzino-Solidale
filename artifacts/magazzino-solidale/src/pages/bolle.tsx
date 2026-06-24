import { useState } from "react";
import {
  useListBolle,
  useCreateBolla,
  useGetBolla,
  useAddBollaRiga,
  useDeleteBollaRiga,
  useConfermaBolla,
  useConsegnaBolla,
  useListBeneficiari,
  useListMagazzini,
  useListGiacenze,
  useListLotti,
  getListBolleQueryKey,
  getGetBollaQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Trash2, PackagePlus, CheckCircle, Truck, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";

function statoBadge(stato: string) {
  if (stato === "consegnato") return <Badge className="bg-green-500 text-white">Consegnato</Badge>;
  if (stato === "confermato") return <Badge className="border-blue-300 text-blue-700 bg-blue-50">Confermato</Badge>;
  return <Badge variant="secondary">Bozza</Badge>;
}

// ─── Form crea bolla ─────────────────────────────────────────────────────────

function CreaiBollaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [beneficiarioId, setBeneficiarioId] = useState("");
  const [magazzinoId, setMagazzinoId] = useState("");
  const { data: beneficiari } = useListBeneficiari();
  const { data: magazzini } = useListMagazzini();
  const createBolla = useCreateBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const onSubmit = () => {
    if (!beneficiarioId || !magazzinoId) return;
    createBolla.mutate(
      { data: { beneficiarioId: parseInt(beneficiarioId), magazzinoId: parseInt(magazzinoId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: "Bolla creata" });
          setBeneficiarioId("");
          setMagazzinoId("");
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
            <Label>Beneficiario</Label>
            <Select value={beneficiarioId} onValueChange={setBeneficiarioId}>
              <SelectTrigger><SelectValue placeholder="Seleziona beneficiario..." /></SelectTrigger>
              <SelectContent>
                {beneficiari?.map(b => (
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

// ─── Dialog aggiungi prodotto ────────────────────────────────────────────────

function AggiungiProdottoDialog({
  open,
  onClose,
  bollaId,
  magazzinoId,
}: {
  open: boolean;
  onClose: () => void;
  bollaId: number;
  magazzinoId: number;
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

  const onSubmit = () => {
    if (!prodottoId || !quantita) return;
    addRiga.mutate(
      {
        id: bollaId,
        data: {
          prodottoId: parseInt(prodottoId),
          lottoId: lottoId ? parseInt(lottoId) : undefined,
          quantita: parseFloat(quantita),
          unitaMisura,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          toast({ title: "Prodotto aggiunto" });
          setProdottoId("");
          setLottoId("");
          setQuantita("");
          setUnitaMisura("pz");
          onClose();
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
            <Select value={prodottoId} onValueChange={v => { setProdottoId(v); setLottoId(""); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona prodotto..." /></SelectTrigger>
              <SelectContent>
                {giacenze?.map(g => (
                  <SelectItem key={g.prodottoId} value={String(g.prodottoId)}>
                    {g.prodottoNome} — {g.quantitaTotale} {g.unitaMisura} disponibili
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {prodottoId && lottiDisponibili.length > 0 && (
            <div className="space-y-2">
              <Label>Lotto (FEFO — seleziona per tracciabilità)</Label>
              <Select value={lottoId} onValueChange={setLottoId}>
                <SelectTrigger><SelectValue placeholder="Seleziona lotto (opzionale)..." /></SelectTrigger>
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
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Quantità</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={quantita}
                onChange={e => setQuantita(e.target.value)}
                placeholder="0"
              />
              {giacenzaSelezionata && (
                <p className="text-xs text-muted-foreground">
                  Disponibile: {giacenzaSelezionata.quantitaTotale} {giacenzaSelezionata.unitaMisura}
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
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={onSubmit} disabled={!prodottoId || !quantita || addRiga.isPending}>
            Aggiungi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dettaglio bolla ─────────────────────────────────────────────────────────

function BollaDettaglio({ bollaId, onClose }: { bollaId: number; onClose: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const { data: bolla, isLoading } = useGetBolla(bollaId);
  const deleteRiga = useDeleteBollaRiga();
  const confermaBolla = useConfermaBolla();
  const consegnaBolla = useConsegnaBolla();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const onDeleteRiga = (rigaId: number) => {
    deleteRiga.mutate(
      { id: bollaId, rigaId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          toast({ title: "Prodotto rimosso" });
        },
      }
    );
  };

  const onConferma = () => {
    confermaBolla.mutate(
      { id: bollaId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: "Bolla confermata", description: "I prodotti sono stati scaricati dal magazzino." });
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Errore durante la conferma";
          toast({ title: "Errore", description: msg, variant: "destructive" });
        },
      }
    );
  };

  const onConsegna = () => {
    consegnaBolla.mutate(
      { id: bollaId, data: { confermaRicezione: true } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) });
          queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
          toast({ title: "Bolla consegnata", description: "La consegna è stata registrata." });
        },
      }
    );
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

  return (
    <div className="mt-4 space-y-5">
      {/* Header info */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-lg">{bolla.numeroBolla}</span>
          {statoBadge(bolla.stato)}
        </div>
        <p className="text-sm text-muted-foreground">
          {format(new Date(bolla.dataBolla), "dd MMMM yyyy", { locale: it })}
        </p>
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

      <Separator />

      {/* Righe prodotti */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Prodotti nella bolla</h3>
          {isBozza && (
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
            {isBozza && (
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
                  {isBozza && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolla.righe.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-sm">{r.prodottoNome ?? `Prodotto #${r.prodottoId}`}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.codiceLotto ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{r.quantita} {r.unitaMisura}</TableCell>
                    {isBozza && (
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
      {(isBozza || isConfermato) && (
        <>
          <Separator />
          <div className="space-y-2">
            {isBozza && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 mb-3">
                <strong>Conferma bolla</strong> — I prodotti verranno scaricati dal magazzino e verrà creato un movimento di uscita.
              </div>
            )}
            {isConfermato && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 mb-3">
                <strong>Pronta per la consegna.</strong> Segna come consegnata quando il beneficiario ha ricevuto la merce.
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
          </div>
        </>
      )}

      {isConsegnato && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          ✓ Consegna completata. Merce scaricata dal magazzino.
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
    </div>
  );
}

// ─── Pagina principale ───────────────────────────────────────────────────────

export default function Bolle() {
  const { data: bolle, isLoading } = useListBolle();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBollaId, setSelectedBollaId] = useState<number | null>(null);

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
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    {Array(6).fill(0).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : bolle?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Nessuna bolla emessa. Crea la prima bolla con il pulsante in alto a destra.
                  </TableCell>
                </TableRow>
              ) : bolle?.map(b => (
                <TableRow
                  key={b.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelectedBollaId(b.id)}
                >
                  <TableCell className="font-mono text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {b.numeroBolla}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(b.dataBolla), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="font-medium">{b.beneficiarioNome ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.magazzinoNome ?? "—"}</TableCell>
                  <TableCell className="text-center">{statoBadge(b.stato)}</TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
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
            <BollaDettaglio
              bollaId={selectedBollaId}
              onClose={() => setSelectedBollaId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
