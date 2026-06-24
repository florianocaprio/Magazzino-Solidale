import { useState } from "react";
import {
  useListScarichi,
  useCreateScarico,
  useListMagazzini,
  useListGiacenze,
  useGetImpostazioniStampa,
  getListScarichiQueryKey,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
  type Scarico,
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
import { Plus, Trash2, Download, CheckCircle, PackageMinus } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { generateScaricoPdf, loadAssociationLogo, causaleLabel } from "@/lib/scarico-pdf";

const CAUSALI = [
  { value: "deteriorata", label: "Merce deteriorata" },
  { value: "rubata", label: "Merce rubata" },
  { value: "scaduta", label: "Merce scaduta" },
  { value: "altro", label: "Altra causale" },
] as const;

interface RigaDraft {
  key: string;
  prodottoId: string;
  quantita: string;
  unitaMisura: string;
}

function newRiga(): RigaDraft {
  return { key: Math.random().toString(36).slice(2), prodottoId: "", quantita: "", unitaMisura: "pz" };
}

// ─── Editor righe (dipende dal magazzino) ────────────────────────────────────

function RigheEditor({
  magazzinoId,
  righe,
  setRighe,
}: {
  magazzinoId: number;
  righe: RigaDraft[];
  setRighe: (r: RigaDraft[]) => void;
}) {
  const { data: giacenze } = useListGiacenze(
    { magazzinoId },
    { query: { enabled: !!magazzinoId, queryKey: getListGiacenzeQueryKey({ magazzinoId }) } },
  );

  const update = (key: string, patch: Partial<RigaDraft>) =>
    setRighe(righe.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRighe(righe.filter((r) => r.key !== key));

  const usedIds = righe.map((r) => r.prodottoId).filter(Boolean);

  return (
    <div className="space-y-3">
      {(!giacenze || giacenze.length === 0) && (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
          Nessun prodotto disponibile nel magazzino selezionato.
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

// ─── Form nuovo scarico ──────────────────────────────────────────────────────

function NuovoScaricoForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: Scarico) => void;
}) {
  const [magazzinoId, setMagazzinoId] = useState("");
  const [causale, setCausale] = useState("");
  const [causaleAltro, setCausaleAltro] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaDraft[]>([newRiga()]);

  const { data: magazzini } = useListMagazzini();
  const createScarico = useCreateScarico();
  const { toast } = useToast();

  const magazzinoIdNum = magazzinoId ? parseInt(magazzinoId) : 0;
  const { data: giacenze } = useListGiacenze(
    { magazzinoId: magazzinoIdNum },
    { query: { enabled: !!magazzinoId, queryKey: getListGiacenzeQueryKey({ magazzinoId: magazzinoIdNum }) } },
  );

  const reset = () => {
    setMagazzinoId("");
    setCausale("");
    setCausaleAltro("");
    setNote("");
    setRighe([newRiga()]);
  };

  const righeValide = righe.filter((r) => r.prodottoId && parseFloat(r.quantita || "0") > 0);
  const hasEccesso = righeValide.some((r) => {
    const giac = giacenze?.find((g) => g.prodottoId === parseInt(r.prodottoId));
    return parseFloat(r.quantita) > (giac?.quantitaTotale ?? 0);
  });
  const canSubmit =
    !!magazzinoId &&
    !!causale &&
    (causale !== "altro" || !!causaleAltro.trim()) &&
    righeValide.length > 0 &&
    !hasEccesso &&
    !createScarico.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    createScarico.mutate(
      {
        data: {
          magazzinoId: parseInt(magazzinoId),
          dataScarico: new Date().toISOString().split("T")[0],
          causale: causale as "deteriorata" | "rubata" | "scaduta" | "altro",
          causaleAltro: causale === "altro" ? causaleAltro.trim() : undefined,
          note: note || undefined,
          righe: righeValide.map((r) => ({
            prodottoId: parseInt(r.prodottoId),
            quantita: parseFloat(r.quantita),
            unitaMisura: r.unitaMisura,
          })),
        },
      },
      {
        onSuccess: (s) => {
          reset();
          onClose();
          onCreated(s);
        },
        onError: () =>
          toast({ title: "Errore", description: "Impossibile registrare lo scarico", variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nuovo Scarico</SheetTitle>
          <SheetDescription>
            Registra l'uscita di merce dal magazzino. Verrà generata una bolla di scarico.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div className="space-y-2">
            <Label>Magazzino</Label>
            <Select value={magazzinoId} onValueChange={(v) => { setMagazzinoId(v); setRighe([newRiga()]); }}>
              <SelectTrigger><SelectValue placeholder="Seleziona magazzino..." /></SelectTrigger>
              <SelectContent>
                {magazzini?.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Causale</Label>
            <Select value={causale} onValueChange={setCausale}>
              <SelectTrigger><SelectValue placeholder="Seleziona causale..." /></SelectTrigger>
              <SelectContent>
                {CAUSALI.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {causale === "altro" && (
              <Input
                value={causaleAltro}
                onChange={(e) => setCausaleAltro(e.target.value)}
                placeholder="Specifica la causale dello scarico"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Prodotti da scaricare</Label>
            {magazzinoId ? (
              <RigheEditor magazzinoId={parseInt(magazzinoId)} righe={righe} setRighe={setRighe} />
            ) : (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3 text-center">
                Seleziona prima il magazzino.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Note (opzionale)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Eventuali note sullo scarico" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            <PackageMinus className="h-4 w-4" /> Registra e genera bolla
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function Scarichi() {
  const { data: scarichi, isLoading } = useListScarichi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: impostazioni } = useGetImpostazioniStampa();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [created, setCreated] = useState<Scarico | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const downloadBolla = async (s: Scarico) => {
    setDownloadingId(s.id);
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
      setDownloadingId(null);
    }
  };

  const handleCreated = (s: Scarico) => {
    queryClient.invalidateQueries({ queryKey: getListScarichiQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
    setCreated(s);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scarichi</h1>
          <p className="text-muted-foreground">Registra le uscite di merce per deterioramento, furto, scadenza o altre cause.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={scarichi ?? []}
            columns={[
              { header: "Codice", accessor: (s) => s.codice },
              { header: "Data", accessor: (s) => s.dataScarico ? new Date(s.dataScarico).toLocaleDateString("it-IT") : "" },
              { header: "Magazzino", accessor: (s) => s.magazzinoNome },
              { header: "Causale", accessor: (s) => causaleLabel(s) },
              { header: "Articoli", accessor: (s) => s.righe?.length ?? 0 },
            ]}
            filename="scarichi"
            title="Scarichi di Magazzino"
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
                <TableHead>Magazzino</TableHead>
                <TableHead>Causale</TableHead>
                <TableHead>Dettaglio</TableHead>
                <TableHead className="text-right w-[140px]">Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : scarichi?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nessuno scarico registrato.</TableCell>
                </TableRow>
              ) : scarichi?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-sm font-medium">{s.codice}</TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(s.dataScarico), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{s.magazzinoNome}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      {causaleLabel(s)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.righe?.length || 0} articoli
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => downloadBolla(s)}
                      disabled={downloadingId === s.id}
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

      <NuovoScaricoForm open={isFormOpen} onClose={() => setIsFormOpen(false)} onCreated={handleCreated} />

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
                Scarico <span className="font-mono font-medium text-foreground">{created.codice}</span> registrato.
                La giacenza è stata aggiornata ed è stata generata la bolla di scarico.
              </p>
              <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
                <span className="font-medium">{created.magazzinoNome}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{causaleLabel(created)}</span>
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
