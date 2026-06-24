import { useState } from "react";
import { useListConsegne, useCreateConsegna, useCompletaConsegna, useAssociaBolla, useListBolle, useListBeneficiari, useListMagazzini, useListVolontari, useListCentriAscolto, getListConsegneQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, MapPin, Truck, CheckCircle2, Filter, FileText, FileClock, Link2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  tipoConsegna: z.string().min(1),
  dataPrevista: z.string().min(1),
  fasciaOraria: z.string().optional(),
  indirizzoConsegna: z.string().optional(),
  zona: z.string().optional(),
  magazzinoId: z.coerce.number().min(1),
  volontarioId: z.coerce.number().optional(),
  noteOperative: z.string().optional()
});

export default function Consegne() {
  const [centroFilter, setCentroFilter] = useState("all");
  const [statoFilter, setStatoFilter] = useState("all");
  const consegneParams: { centroAscoltoId?: number; stato?: string } = {};
  if (centroFilter !== "all") consegneParams.centroAscoltoId = parseInt(centroFilter);
  if (statoFilter !== "all") consegneParams.stato = statoFilter;
  const { data: consegne, isLoading } = useListConsegne(
    Object.keys(consegneParams).length > 0 ? consegneParams : undefined
  );
  const { data: beneficiari } = useListBeneficiari();
  const { data: magazzini } = useListMagazzini();
  const { data: volontari } = useListVolontari();
  const { data: centri } = useListCentriAscolto();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [associatingId, setAssociatingId] = useState<number | null>(null);
  const [selectedBollaId, setSelectedBollaId] = useState<string>("");

  const { data: bolle } = useListBolle();

  const createConsegna = useCreateConsegna();
  const completaConsegna = useCompletaConsegna();
  const associaBolla = useAssociaBolla();

  const associatingConsegna = consegne?.find(c => c.id === associatingId) ?? null;
  // bolle selezionabili: stesso beneficiario, non annullate, non già legate ad altra consegna
  const bolleDisponibili = (bolle ?? []).filter(b =>
    associatingConsegna != null &&
    b.beneficiarioId === associatingConsegna.beneficiarioId &&
    b.stato !== "annullato" &&
    (b.consegnaId == null || b.consegnaId === associatingConsegna.id)
  );

  const handleAssocia = (bollaId: number | null) => {
    if (!associatingId) return;
    associaBolla.mutate({ id: associatingId, data: { bollaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: bollaId ? "Bolla associata alla consegna" : "Bolla scollegata" });
        setAssociatingId(null);
        setSelectedBollaId("");
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Operazione non riuscita", description: msg ?? "Errore", variant: "destructive" });
      },
    });
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      beneficiarioId: 0, tipoConsegna: "in_sede", dataPrevista: new Date().toISOString().substring(0, 10),
      fasciaOraria: "Mattina", magazzinoId: 0, noteOperative: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createConsegna.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: "Consegna programmata" });
        setIsFormOpen(false);
      }
    });
  };

  const handleCompleta = () => {
    if (!completingId) return;
    completaConsegna.mutate({ id: completingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() });
        toast({ title: "Consegna registrata come consegnata", description: "L'evento è stato annotato negli interventi del beneficiario." });
        setCompletingId(null);
      },
      onError: (e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast({ title: "Impossibile completare", description: msg ?? "Errore", variant: "destructive" });
        setCompletingId(null);
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pianificazione Consegne</h1>
          <p className="text-muted-foreground">Gestisci le distribuzioni in sede e a domicilio.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={consegne ?? []}
            columns={[
              { header: "Codice", accessor: (c) => c.codice },
              { header: "Data Prevista", accessor: (c) => c.dataPrevista ? new Date(c.dataPrevista).toLocaleDateString("it-IT") : "" },
              { header: "Fascia Oraria", accessor: (c) => c.fasciaOraria },
              { header: "Beneficiario", accessor: (c) => c.beneficiarioNome },
              { header: "Tipo", accessor: (c) => c.tipoConsegna?.replace('_', ' ') },
              { header: "Indirizzo", accessor: (c) => c.indirizzoConsegna },
              { header: "Zona", accessor: (c) => c.zona },
              { header: "Magazzino", accessor: (c) => c.magazzinoNome },
              { header: "Volontario", accessor: (c) => c.volontarioNome },
              { header: "Stato", accessor: (c) => c.stato },
            ]}
            filename="consegne"
            title="Consegne"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Pianifica Consegna</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={centroFilter} onValueChange={setCentroFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tutti i centri" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i centri</SelectItem>
                {centri?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statoFilter} onValueChange={setStatoFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tutti gli stati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                <SelectItem value="pianificata">Pianificata</SelectItem>
                <SelectItem value="effettuata">Effettuata</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Data & Fascia</TableHead>
                <TableHead>Beneficiario</TableHead>
                <TableHead>Dettagli</TableHead>
                <TableHead>Bolla</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="text-right">Azione</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : consegne?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nessuna consegna pianificata.</TableCell>
                </TableRow>
              ) : consegne?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{format(new Date(c.dataPrevista), "dd MMM yyyy", { locale: it })}</div>
                    <div className="text-xs text-muted-foreground">{c.fasciaOraria}</div>
                  </TableCell>
                  <TableCell className="font-medium">{c.beneficiarioNome}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm">
                      {c.tipoConsegna === 'domicilio' ? (
                        <div className="flex items-center gap-1 text-blue-600">
                          <MapPin className="h-3 w-3" /> {c.indirizzoConsegna || 'Domicilio'} {c.zona ? `(${c.zona})` : ''}
                        </div>
                      ) : c.tipoConsegna === 'diretta' ? (
                        <div className="flex items-center gap-1 text-emerald-600">
                          <Truck className="h-3 w-3" /> Consegna diretta dal centro di ascolto
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-purple-600">
                          <Truck className="h-3 w-3" /> Ritiro in {c.magazzinoNome}
                        </div>
                      )}
                      {c.volontarioNome && <div className="text-xs text-muted-foreground">Volontario: {c.volontarioNome}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const consegnata = c.stato === 'effettuata';
                      const pronta = c.bollaStato === 'confermato' || c.bollaStato === 'consegnato';
                      const badge = c.bollaStato == null ? (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> In preparazione
                        </Badge>
                      ) : pronta ? (
                        <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700">
                          <FileText className="h-3 w-3" /> {c.bollaNumero} · Pronta
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                          <FileClock className="h-3 w-3" /> {c.bollaNumero} · In preparazione
                        </Badge>
                      );
                      return (
                        <button
                          type="button"
                          disabled={consegnata}
                          onClick={() => { setAssociatingId(c.id); setSelectedBollaId(c.bollaId ? String(c.bollaId) : ""); }}
                          className="text-left disabled:cursor-default disabled:opacity-100 enabled:hover:opacity-80"
                          title={consegnata ? undefined : "Gestisci bolla associata"}
                        >
                          {badge}
                        </button>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.stato === 'effettuata' ? 'default' : 'outline'}
                           className={c.stato === 'effettuata' ? 'bg-green-500' : 'border-blue-200 text-blue-700 bg-blue-50'}>
                      {c.stato === 'effettuata' ? 'Consegnata' : 'Pianificata'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.stato !== 'effettuata' && (
                      (c.bollaStato === 'confermato' || c.bollaStato === 'consegnato') ? (
                        <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700" onClick={() => setCompletingId(c.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Consegnato
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => { setAssociatingId(c.id); setSelectedBollaId(c.bollaId ? String(c.bollaId) : ""); }}>
                          <Link2 className="h-3.5 w-3.5" /> Associa bolla
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Pianifica Consegna</SheetTitle></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="beneficiarioId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beneficiario</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {beneficiari?.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.cognome} {b.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataPrevista" render={({ field }) => (
                    <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="fasciaOraria" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fascia</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Mattina">Mattina (9-13)</SelectItem>
                          <SelectItem value="Pomeriggio">Pomeriggio (14-18)</SelectItem>
                          <SelectItem value="Sera">Sera (18-20)</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="tipoConsegna" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modalità</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="in_sede">Ritiro in Sede</SelectItem>
                        <SelectItem value="domicilio">A Domicilio</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                {form.watch("tipoConsegna") === "domicilio" && (
                  <div className="space-y-4 pt-2 border-t">
                    <FormField control={form.control} name="indirizzoConsegna" render={({ field }) => (
                      <FormItem><FormLabel>Indirizzo di Consegna</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="zona" render={({ field }) => (
                      <FormItem><FormLabel>Zona / Quartiere</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="volontarioId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assegna Volontario (Opzionale)</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Nessuno" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="0">Nessuno</SelectItem>
                            {volontari?.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.nome} {v.cognome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                )}

                <div className="pt-2 border-t">
                  <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Magazzino di Partenza</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createConsegna.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!completingId} onOpenChange={(open) => !open && setCompletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Segna come Consegnato</AlertDialogTitle>
          <AlertDialogDescription>
            Confermi che la merce è stata consegnata? La bolla associata verrà chiusa e l'evento sarà registrato negli interventi del beneficiario.
          </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleCompleta} className="bg-green-600 hover:bg-green-700">Conferma Consegna</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!associatingId} onOpenChange={(open) => { if (!open) { setAssociatingId(null); setSelectedBollaId(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Associa Bolla alla Consegna</AlertDialogTitle>
            <AlertDialogDescription>
              Collega una bolla a questa consegna. Finché la bolla è in bozza risulta "in preparazione"; una volta confermata (merce preparata) diventa "pronta" e potrai segnare la consegna come consegnata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-3">
            {bolleDisponibili.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessuna bolla disponibile per questo beneficiario. Crea prima una bolla dalla sezione <span className="font-medium">Bolle</span>.
              </p>
            ) : (
              <Select value={selectedBollaId} onValueChange={setSelectedBollaId}>
                <SelectTrigger><SelectValue placeholder="Seleziona una bolla..." /></SelectTrigger>
                <SelectContent>
                  {bolleDisponibili.map(b => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.numeroBolla} · {b.stato === 'confermato' ? 'pronta' : b.stato === 'consegnato' ? 'consegnata' : 'in preparazione'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            {associatingConsegna?.bollaId != null && (
              <Button variant="outline" className="mr-auto text-destructive" disabled={associaBolla.isPending} onClick={() => handleAssocia(null)}>
                Scollega bolla
              </Button>
            )}
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <Button
              disabled={!selectedBollaId || associaBolla.isPending}
              onClick={() => handleAssocia(selectedBollaId ? parseInt(selectedBollaId) : null)}
            >
              Associa
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
