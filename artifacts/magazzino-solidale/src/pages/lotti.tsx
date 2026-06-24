import { useState } from "react";
import {
  useListLotti,
  useListMagazzini,
  useListProdotti,
  useCreateLotto,
  useCreateMovimento,
  getListGiacenzeQueryKey,
  getListLottiQueryKey,
  getListMovimentiQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ExportButtons } from "@/components/export-buttons";
import { Calendar, Filter, Plus, Info } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { it } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const nuovoLottoSchema = z.object({
  prodottoId: z.string().min(1, "Seleziona un prodotto"),
  magazzinoId: z.string().min(1, "Seleziona un magazzino"),
  quantita: z.coerce.number().positive("La quantità deve essere maggiore di zero"),
  dataCarico: z.string().min(1, "Campo obbligatorio"),
  causale: z.string().min(1, "Campo obbligatorio"),
  codiceLotto: z.string().optional(),
  dataScadenza: z.string().optional(),
  note: z.string().optional(),
});

function NuovoLottoDialog({ onClose }: { onClose: () => void }) {
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  const createLotto = useCreateLotto();
  const createMovimento = useCreateMovimento();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof nuovoLottoSchema>>({
    resolver: zodResolver(nuovoLottoSchema),
    defaultValues: {
      prodottoId: "",
      magazzinoId: "",
      quantita: 0,
      dataCarico: new Date().toISOString().split("T")[0],
      causale: "donazione",
      codiceLotto: "",
      dataScadenza: "",
      note: "",
    },
  });

  const submitting = createLotto.isPending || createMovimento.isPending;

  const onSubmit = (data: z.infer<typeof nuovoLottoSchema>) => {
    const prodotto = prodotti?.find((p) => p.id.toString() === data.prodottoId);
    if (!prodotto) {
      toast({ title: "Errore", description: "Prodotto non valido", variant: "destructive" });
      return;
    }
    createLotto.mutate(
      {
        data: {
          prodottoId: prodotto.id,
          magazzinoId: parseInt(data.magazzinoId),
          dataCarico: data.dataCarico,
          quantitaCaricata: data.quantita,
          codiceLotto: data.codiceLotto || undefined,
          dataScadenza: data.dataScadenza || undefined,
          note: data.note || undefined,
        },
      },
      {
        onSuccess: (lotto) => {
          const invalidateStock = () => {
            queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListLottiQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
          };
          createMovimento.mutate(
            {
              data: {
                tipoMovimento: "carico",
                tipoDettaglio: data.causale,
                dataMovimento: data.dataCarico,
                magazzinoId: parseInt(data.magazzinoId),
                prodottoId: prodotto.id,
                lottoId: lotto.id,
                quantita: data.quantita,
                unitaMisura: prodotto.unitaMisura,
                note: data.note || undefined,
              },
            },
            {
              onSuccess: () => {
                invalidateStock();
                toast({
                  title: "Lotto caricato",
                  description: `${data.quantita} ${prodotto.unitaMisura} di ${prodotto.nome} caricati in magazzino.`,
                });
                onClose();
              },
              onError: () => {
                invalidateStock();
                toast({
                  title: "Lotto creato, log incompleto",
                  description: "La giacenza è stata aggiornata, ma la registrazione del movimento è fallita.",
                  variant: "destructive",
                });
                onClose();
              },
            },
          );
        },
        onError: () =>
          toast({ title: "Errore", description: "Impossibile creare il lotto", variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Nuovo Lotto</SheetTitle>
          <SheetDescription>
            Carica un lotto di prodotto assegnandolo a un singolo magazzino.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Un lotto appartiene a un solo magazzino e non può essere diviso. Per spostare parte
            della quantità in un altro magazzino usa un <strong>Trasferimento Interno</strong>.
          </span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <FormField control={form.control} name="prodottoId" render={({ field }) => (
              <FormItem>
                <FormLabel>Prodotto</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Seleziona prodotto..." /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {prodotti?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="magazzinoId" render={({ field }) => (
              <FormItem>
                <FormLabel>Magazzino</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Seleziona magazzino..." /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {magazzini?.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="quantita" render={({ field }) => (
              <FormItem>
                <FormLabel>Quantità</FormLabel>
                <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="dataCarico" render={({ field }) => (
              <FormItem>
                <FormLabel>Data carico</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="causale" render={({ field }) => (
              <FormItem>
                <FormLabel>Causale</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="donazione">Donazione</SelectItem>
                    <SelectItem value="acquisto">Acquisto</SelectItem>
                    <SelectItem value="rettifica_inventario">Rettifica inventario</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="codiceLotto" render={({ field }) => (
              <FormItem>
                <FormLabel>Codice lotto <span className="text-muted-foreground font-normal">(opzionale)</span></FormLabel>
                <FormControl><Input placeholder="Es. LOT-2026-001" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="dataScadenza" render={({ field }) => (
              <FormItem>
                <FormLabel>Data scadenza <span className="text-muted-foreground font-normal">(opzionale)</span></FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>Note <span className="text-muted-foreground font-normal">(opzionale)</span></FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Salvataggio…" : "Carica lotto"}</Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

export default function Lotti() {
  const [magazzinoId, setMagazzinoId] = useState<string>("all");
  const [prodottoId, setProdottoId] = useState<string>("all");
  const [inScadenza, setInScadenza] = useState(false);
  const [nuovoOpen, setNuovoOpen] = useState(false);
  
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  
  const { data: lotti, isLoading } = useListLotti({
    magazzinoId: magazzinoId !== "all" ? Number(magazzinoId) : undefined,
    prodottoId: prodottoId !== "all" ? Number(prodottoId) : undefined,
    inScadenza: inScadenza || undefined
  });

  const getExpiryStatus = (dateStr: string | null | undefined) => {
    if (!dateStr) return { label: "No Scadenza", color: "text-muted-foreground", badge: "bg-gray-100 text-gray-800" };
    
    const expiryDate = new Date(dateStr);
    const daysLeft = differenceInDays(expiryDate, new Date());
    
    if (daysLeft < 0) return { label: "Scaduto", color: "text-destructive font-bold", badge: "bg-destructive text-destructive-foreground" };
    if (daysLeft <= 7) return { label: "Critico", color: "text-destructive font-semibold", badge: "bg-destructive/90 text-destructive-foreground" };
    if (daysLeft <= 30) return { label: "Attenzione", color: "text-amber-600 font-medium", badge: "bg-amber-500 text-white" };
    return { label: "Regolare", color: "text-green-600", badge: "bg-green-500/20 text-green-700" };
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tracciamento Lotti e Scadenze</h1>
          <p className="text-muted-foreground">Monitora le date di scadenza per prevenire gli sprechi alimentari.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={lotti ?? []}
            columns={[
              { header: "Cod. Lotto", accessor: (l) => l.codiceLotto },
              { header: "Prodotto", accessor: (l) => l.prodottoNome },
              { header: "Magazzino", accessor: (l) => l.magazzinoNome },
              { header: "Data Scadenza", accessor: (l) => l.dataScadenza ? new Date(l.dataScadenza).toLocaleDateString("it-IT") : "" },
              { header: "Q.tà Iniziale", accessor: (l) => l.quantitaCaricata != null ? parseFloat(String(l.quantitaCaricata)) : "" },
              { header: "Q.tà Residua", accessor: (l) => l.quantitaResidua != null ? parseFloat(String(l.quantitaResidua)) : "" },
            ]}
            filename="lotti"
            title="Elenco Lotti"
            orientation="landscape"
          />
          <Button onClick={() => setNuovoOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nuovo Lotto
          </Button>
        </div>
      </div>

      {nuovoOpen && <NuovoLottoDialog onClose={() => setNuovoOpen(false)} />}

      <Card>
        <CardHeader className="py-4 border-b bg-muted/20">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={magazzinoId} onValueChange={setMagazzinoId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Tutti i magazzini" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i magazzini</SelectItem>
                  {magazzini?.map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center gap-2">
              <Select value={prodottoId} onValueChange={setProdottoId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Tutti i prodotti" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i prodotti</SelectItem>
                  {prodotti?.filter(p => p.gestioneScadenza || p.gestioneLotto).map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2 ml-auto bg-amber-500/10 px-3 py-1.5 rounded-md border border-amber-500/20">
              <Switch id="scadenza" checked={inScadenza} onCheckedChange={setInScadenza} />
              <Label htmlFor="scadenza" className="text-amber-700 font-medium cursor-pointer">
                Solo in scadenza (≤ 30gg)
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod. Lotto</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead>Data Scadenza</TableHead>
                <TableHead className="text-right">Q.tà Iniziale</TableHead>
                <TableHead className="text-right">Q.tà Residua</TableHead>
                <TableHead className="w-[100px] text-center">Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : lotti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun lotto trovato con questi filtri.
                  </TableCell>
                </TableRow>
              ) : lotti?.map((lotto) => {
                const status = getExpiryStatus(lotto.dataScadenza);
                // Highlight row if critical
                const isCritical = status.label === "Critico" || status.label === "Scaduto";
                const isWarning = status.label === "Attenzione";
                
                return (
                  <TableRow key={lotto.id} className={isCritical ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-950/20" : isWarning ? "bg-amber-50/30 hover:bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <TableCell className="font-mono text-xs font-medium">
                      {lotto.codiceLotto || <span className="text-muted-foreground italic">N/D</span>}
                    </TableCell>
                    <TableCell className="font-medium">{lotto.prodottoNome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lotto.magazzinoNome}</TableCell>
                    <TableCell>
                      {lotto.dataScadenza ? (
                        <div className={`flex items-center gap-2 text-sm ${status.color}`}>
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(lotto.dataScadenza), "dd MMM yyyy", { locale: it })}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm italic">Non prevista</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{lotto.quantitaCaricata}</TableCell>
                    <TableCell className="text-right font-bold">{lotto.quantitaResidua}</TableCell>
                    <TableCell className="text-center">
                      {lotto.dataScadenza && (
                        <Badge variant="outline" className={`border-none ${status.badge}`}>
                          {status.label}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
