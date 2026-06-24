import { useState } from "react";
import { useListInterventi, useCreateIntervento, useListBeneficiari, getListInterventiQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { Plus, Filter, ClipboardList, Calendar } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  tipoIntervento: z.string().min(1),
  dataIntervento: z.string().min(1),
  descrizione: z.string().min(1),
  esito: z.string().optional(),
  prossimAzione: z.string().optional(),
  dataFollowup: z.string().optional()
});

export default function Interventi() {
  const [tipoFilter, setTipoFilter] = useState("all");
  const { data: interventi, isLoading } = useListInterventi({ tipo: tipoFilter !== "all" ? tipoFilter : undefined });
  const { data: beneficiari } = useListBeneficiari();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);

  const createIntervento = useCreateIntervento();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      beneficiarioId: 0,
      tipoIntervento: "colloquio",
      dataIntervento: new Date().toISOString().substring(0, 10),
      descrizione: "",
      esito: "",
      prossimAzione: "",
      dataFollowup: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createIntervento.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInterventiQueryKey() });
        toast({ title: "Intervento registrato" });
        setIsFormOpen(false);
      }
    });
  };

  const getSingleBadge = (tipo: string) => {
    switch(tipo) {
      case 'colloquio': return <Badge key={tipo} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Colloquio</Badge>;
      case 'pacco_alimentare': return <Badge key={tipo} variant="outline" className="bg-green-50 text-green-700 border-green-200">Pacco Alimentare</Badge>;
      case 'vestiti':
      case 'vestiario': return <Badge key={tipo} variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Vestiti</Badge>;
      case 'igiene': return <Badge key={tipo} variant="outline" className="bg-cyan-50 text-cyan-700 border-cyan-200">Igiene</Badge>;
      case 'medicinali': return <Badge key={tipo} variant="outline" className="bg-red-50 text-red-700 border-red-200">Medicinali</Badge>;
      default: return <Badge key={tipo} variant="outline" className="capitalize">{tipo.replace('_', ' ')}</Badge>;
    }
  };

  const getTipoBadge = (tipo: string) => {
    const tipi = tipo.split(",").map(t => t.trim()).filter(Boolean);
    return <div className="flex flex-wrap gap-1">{tipi.map(getSingleBadge)}</div>;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Interventi Sociali</h1>
          <p className="text-muted-foreground">Registro dei colloqui e delle azioni di supporto.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={interventi ?? []}
            columns={[
              { header: "Beneficiario", accessor: (i) => i.beneficiarioNome },
              { header: "Data", accessor: (i) => i.dataIntervento ? new Date(i.dataIntervento).toLocaleDateString("it-IT") : "" },
              { header: "Tipo Intervento", accessor: (i) => i.tipoIntervento },
              { header: "Descrizione", accessor: (i) => i.descrizione },
              { header: "Esito", accessor: (i) => i.esito },
            ]}
            filename="interventi"
            title="Registro Interventi"
            orientation="landscape"
          />
          <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Registra Intervento</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tutti i tipi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i tipi</SelectItem>
                <SelectItem value="colloquio">Colloqui</SelectItem>
                <SelectItem value="pacco_alimentare">Pacco Alimentare</SelectItem>
                <SelectItem value="vestiario">Vestiario</SelectItem>
                <SelectItem value="orientamento">Orientamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Beneficiario</TableHead>
                <TableHead>Tipo Intervento</TableHead>
                <TableHead>Descrizione</TableHead>
                <TableHead>Follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : interventi?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Nessun intervento registrato.</TableCell>
                </TableRow>
              ) : interventi?.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-sm font-medium">
                    {format(new Date(i.dataIntervento), "dd/MM/yyyy")}
                  </TableCell>
                  <TableCell className="font-medium">{i.beneficiarioNome}</TableCell>
                  <TableCell>{getTipoBadge(i.tipoIntervento)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                    {i.descrizione}
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.dataFollowup ? (
                      <div className="flex items-center gap-1 text-amber-600">
                        <Calendar className="h-3 w-3" /> {format(new Date(i.dataFollowup), "dd/MM")}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
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
          <SheetHeader>
            <SheetTitle>Nuovo Intervento</SheetTitle>
          </SheetHeader>
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
                  <FormField control={form.control} name="tipoIntervento" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="colloquio">Colloquio</SelectItem>
                          <SelectItem value="pacco_alimentare">Pacco Alimentare</SelectItem>
                          <SelectItem value="vestiario">Vestiario</SelectItem>
                          <SelectItem value="orientamento">Orientamento</SelectItem>
                          <SelectItem value="altro">Altro</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="dataIntervento" render={({ field }) => (
                    <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="descrizione" render={({ field }) => (
                  <FormItem><FormLabel>Descrizione / Note del colloquio</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="esito" render={({ field }) => (
                  <FormItem><FormLabel>Esito</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                
                <div className="pt-4 border-t space-y-4">
                  <FormField control={form.control} name="prossimAzione" render={({ field }) => (
                    <FormItem><FormLabel>Prossima Azione</FormLabel><FormControl><Input placeholder="Es: Rinnovo ISEE" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="dataFollowup" render={({ field }) => (
                    <FormItem><FormLabel>Data di Follow-up</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createIntervento.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
