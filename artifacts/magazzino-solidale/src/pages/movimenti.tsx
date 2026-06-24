import { useState } from "react";
import { useListMovimenti, useCreateMovimento, useListMagazzini, useListProdotti, getListMovimentiQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, ArrowDownRight, ArrowUpRight, Filter } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  tipoMovimento: z.string().min(1),
  tipoDettaglio: z.string().min(1),
  dataMovimento: z.string().min(1),
  magazzinoId: z.coerce.number().min(1),
  prodottoId: z.coerce.number().min(1),
  quantita: z.coerce.number().min(0.01),
  unitaMisura: z.string().default("pz"),
  note: z.string().optional()
});

export default function Movimenti() {
  const [tipoFilter, setTipoFilter] = useState("all");
  const { data: movimenti, isLoading } = useListMovimenti({ tipo: tipoFilter !== "all" ? tipoFilter : undefined });
  const { data: magazzini } = useListMagazzini();
  const { data: prodotti } = useListProdotti();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);

  const createMovimento = useCreateMovimento();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tipoMovimento: "carico",
      tipoDettaglio: "acquisto",
      dataMovimento: new Date().toISOString().substring(0, 10),
      magazzinoId: 0,
      prodottoId: 0,
      quantita: 1,
      unitaMisura: "pz",
      note: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMovimento.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMovimentiQueryKey() });
        toast({ title: "Movimento registrato" });
        setIsFormOpen(false);
      }
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Movimenti</h1>
          <p className="text-muted-foreground">Registro carichi e scarichi di magazzino.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={movimenti ?? []}
            columns={[
              { header: "Data", accessor: (m) => m.dataMovimento ? new Date(m.dataMovimento).toLocaleDateString("it-IT") : "" },
              { header: "Tipo", accessor: (m) => m.tipoMovimento },
              { header: "Causale", accessor: (m) => m.tipoDettaglio },
              { header: "Prodotto", accessor: (m) => m.prodottoNome },
              { header: "Magazzino", accessor: (m) => m.magazzinoNome },
              { header: "Quantità", accessor: (m) => m.quantita != null ? parseFloat(String(m.quantita)) : "" },
              { header: "U.M.", accessor: (m) => m.unitaMisura },
              { header: "Note", accessor: (m) => m.note },
            ]}
            filename="movimenti"
            title="Movimenti di Magazzino"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Registra Movimento</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tutti i movimenti" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i movimenti</SelectItem>
                <SelectItem value="carico">Solo Carichi</SelectItem>
                <SelectItem value="scarico">Solo Scarichi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Prodotto</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead className="text-right">Quantità</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : movimenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Nessun movimento trovato.</TableCell>
                </TableRow>
              ) : movimenti?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    {format(new Date(m.dataMovimento), "dd MMM yyyy, HH:mm", { locale: it })}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {m.tipoMovimento === 'carico' ? (
                        <ArrowDownRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-amber-500" />
                      )}
                      <Badge variant="outline" className="capitalize">
                        {m.tipoDettaglio.replace('_', ' ')}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{m.prodottoNome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.magazzinoNome}</TableCell>
                  <TableCell className={`text-right font-bold ${m.tipoMovimento === 'carico' ? 'text-green-600' : 'text-amber-600'}`}>
                    {m.tipoMovimento === 'carico' ? '+' : '-'}{m.quantita} <span className="text-xs font-normal text-muted-foreground">{m.unitaMisura}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Registra Movimento</SheetTitle>
            <SheetDescription>Aggiungi un carico o scarico manuale.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="tipoMovimento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Direzione</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="carico">Carico</SelectItem>
                          <SelectItem value="scarico">Scarico</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="tipoDettaglio" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Causale</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="acquisto">Acquisto</SelectItem>
                          <SelectItem value="donazione">Donazione</SelectItem>
                          <SelectItem value="rettifica_inventario">Rettifica (+/-)</SelectItem>
                          <SelectItem value="scadenza">Scadenza</SelectItem>
                          <SelectItem value="smaltimento">Smaltimento</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="dataMovimento" render={({ field }) => (
                  <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                )} />

                <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Magazzino</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={form.control} name="prodottoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prodotto</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {prodotti?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="quantita" render={({ field }) => (
                    <FormItem><FormLabel>Quantità</FormLabel><FormControl><Input type="number" step="0.01" min="0.01" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="unitaMisura" render={({ field }) => (
                    <FormItem><FormLabel>U.M.</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>Note</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createMovimento.isPending}>Registra</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
