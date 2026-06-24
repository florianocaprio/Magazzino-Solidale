import { useState } from "react";
import { useListBolle, useCreateBolla, useListBeneficiari, useListMagazzini, getListBolleQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FileText, Download } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  beneficiarioId: z.coerce.number().min(1),
  magazzinoId: z.coerce.number().min(1)
});

export default function Bolle() {
  const { data: bolle, isLoading } = useListBolle();
  const { data: beneficiari } = useListBeneficiari();
  const { data: magazzini } = useListMagazzini();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);

  const createBolla = useCreateBolla();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { beneficiarioId: 0, magazzinoId: 0 }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createBolla.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() });
        toast({ title: "Bolla creata" });
        setIsFormOpen(false);
      }
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bolle di Consegna</h1>
          <p className="text-muted-foreground">Documenti di accompagnamento per le uscite.</p>
        </div>
        <Button onClick={() => setIsFormOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Genera Bolla</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Numero Documento</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Beneficiario</TableHead>
                <TableHead>Magazzino</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ml-auto rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : bolle?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nessuna bolla emessa.</TableCell>
                </TableRow>
              ) : bolle?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-sm font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" /> {b.numeroBolla}
                  </TableCell>
                  <TableCell className="text-sm">
                    {format(new Date(b.dataBolla), "dd MMM yyyy", { locale: it })}
                  </TableCell>
                  <TableCell className="font-medium">{b.beneficiarioNome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.magazzinoNome}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={b.stato === 'consegnato' ? 'default' : b.stato === 'confermato' ? 'outline' : 'secondary'}
                           className={b.stato === 'consegnato' ? 'bg-green-500' : b.stato === 'confermato' ? 'border-blue-200 text-blue-700 bg-blue-50' : ''}>
                      {b.stato}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Scarica PDF (Stub)">
                      <Download className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={isFormOpen} onOpenChange={setIsFormOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>Genera Bolla</SheetTitle></SheetHeader>
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
                <FormField control={form.control} name="magazzinoId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Magazzino di Uscita</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ? String(field.value) : undefined}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {magazzini?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createBolla.isPending}>Genera</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
