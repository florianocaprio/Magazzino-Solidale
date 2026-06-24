import { useState } from "react";
import { useListApprovvigionamenti, useCreateApprovvigionamento, useListFornitori, getListApprovvigionamentiQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ShoppingCart } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  fornitoreId: z.coerce.number().optional(),
  dataRichiesta: z.string().min(1),
  dataPrevista: z.string().optional(),
  note: z.string().optional()
});

export default function Approvvigionamenti() {
  const { data: approvvigionamenti, isLoading } = useListApprovvigionamenti();
  const { data: fornitori } = useListFornitori();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);

  const createApprovvigionamento = useCreateApprovvigionamento();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dataRichiesta: new Date().toISOString().substring(0, 10),
      note: ""
    }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    // Note: The API requires righe[], we pass an empty array here for the stub
    createApprovvigionamento.mutate({ data: { ...data, righe: [] } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListApprovvigionamentiQueryKey() });
        toast({ title: "Ordine creato" });
        setIsFormOpen(false);
      }
    });
  };

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'bozza': return <Badge variant="secondary">Bozza</Badge>;
      case 'inviata': return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Inviata</Badge>;
      case 'confermata': return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Confermata</Badge>;
      case 'completata': return <Badge variant="outline" className="bg-green-500/10 text-green-700 border-none">Completata</Badge>;
      default: return <Badge>{stato}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ordini & Approvvigionamenti</h1>
          <p className="text-muted-foreground">Gestisci gli ordini in entrata e le donazioni programmate.</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nuovo Ordine</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Data Richiesta</TableHead>
                <TableHead>Fornitore</TableHead>
                <TableHead>Data Prevista</TableHead>
                <TableHead className="text-center">Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : approvvigionamenti?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Nessun ordine registrato.</TableCell>
                </TableRow>
              ) : approvvigionamenti?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm font-medium flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" /> {a.codice}
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(a.dataRichiesta), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="font-medium">{a.fornitoreNome || <span className="text-muted-foreground italic">Non specificato</span>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.dataPrevista ? format(new Date(a.dataPrevista), "dd/MM/yyyy") : "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    {getStatusBadge(a.stato)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Nuovo Ordine</SheetTitle><SheetDescription>Crea l'intestazione dell'ordine di approvvigionamento.</SheetDescription></SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="fornitoreId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fornitore / Donatore</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {fornitori?.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="dataRichiesta" render={({ field }) => (
                    <FormItem><FormLabel>Data Richiesta</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="dataPrevista" render={({ field }) => (
                    <FormItem><FormLabel>Data Prevista Consegna</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>Note</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createApprovvigionamento.isPending}>Crea Ordine</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
