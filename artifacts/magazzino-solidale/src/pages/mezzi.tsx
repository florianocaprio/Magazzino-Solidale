import { useState } from "react";
import { useListMezzi, useCreateMezzo, useUpdateMezzo, useDeleteMezzo, getListMezziQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { it } from "date-fns/locale";

const formSchema = z.object({
  codice: z.string().min(2, "Codice obbligatorio"),
  tipo: z.string().min(1, "Tipo obbligatorio"),
  targa: z.string().optional(),
  proprieta: z.string().default("associazione"),
  proprietarioNome: z.string().optional(),
  capacitaColli: z.coerce.number().optional(),
  capacitaKg: z.coerce.number().optional(),
  scadenzaAssicurazione: z.string().optional(),
  scadenzaRevisione: z.string().optional(),
  note: z.string().optional()
});

export default function Mezzi() {
  const { data: mezzi, isLoading } = useListMezzi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createMezzo = useCreateMezzo();
  const updateMezzo = useUpdateMezzo();
  const deleteMezzo = useDeleteMezzo();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", tipo: "furgone", targa: "", proprieta: "associazione", proprietarioNome: "", note: ""
    }
  });

  const handleEdit = (mezzo: any) => {
    setEditingId(mezzo.id);
    form.reset({
      codice: mezzo.codice,
      tipo: mezzo.tipo,
      targa: mezzo.targa || "",
      proprieta: mezzo.proprieta,
      proprietarioNome: mezzo.proprietarioNome || "",
      capacitaColli: mezzo.capacitaColli || 0,
      capacitaKg: mezzo.capacitaKg || 0,
      scadenzaAssicurazione: mezzo.scadenzaAssicurazione ? mezzo.scadenzaAssicurazione.substring(0, 10) : "",
      scadenzaRevisione: mezzo.scadenzaRevisione ? mezzo.scadenzaRevisione.substring(0, 10) : "",
      note: mezzo.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", tipo: "furgone", targa: "", proprieta: "associazione", proprietarioNome: "", note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateMezzo.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
          toast({ title: "Mezzo aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createMezzo.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
          toast({ title: "Mezzo creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteMezzo.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMezziQueryKey() });
        toast({ title: "Mezzo eliminato" });
        setDeletingId(null);
      }
    });
  };

  const isExpiringSoon = (dateStr?: string | null) => {
    if (!dateStr) return false;
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    return diff < 30 * 24 * 60 * 60 * 1000;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mezzi</h1>
          <p className="text-muted-foreground">Flotta veicoli per trasporti e consegne.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={mezzi ?? []}
            columns={[
              { header: "Codice", accessor: (m) => m.codice },
              { header: "Tipo", accessor: (m) => m.tipo?.replace('_', ' ') },
              { header: "Targa", accessor: (m) => m.targa },
              { header: "Proprietà", accessor: (m) => m.proprieta?.replace('_', ' ') },
              { header: "Proprietario", accessor: (m) => m.proprietarioNome },
              { header: "Capacità Colli", accessor: (m) => m.capacitaColli != null ? m.capacitaColli : "" },
              { header: "Capacità Kg", accessor: (m) => m.capacitaKg != null ? m.capacitaKg : "" },
              { header: "Scad. Assicurazione", accessor: (m) => m.scadenzaAssicurazione ? new Date(m.scadenzaAssicurazione).toLocaleDateString("it-IT") : "" },
              { header: "Scad. Revisione", accessor: (m) => m.scadenzaRevisione ? new Date(m.scadenzaRevisione).toLocaleDateString("it-IT") : "" },
              { header: "Stato", accessor: (m) => m.stato?.replace('_', ' ') },
            ]}
            filename="mezzi"
            title="Parco Mezzi"
            orientation="landscape"
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Nuovo Mezzo
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Codice</TableHead>
                <TableHead>Tipo & Targa</TableHead>
                <TableHead>Proprietà</TableHead>
                <TableHead>Capacità</TableHead>
                <TableHead>Scadenze</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : mezzi?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun mezzo registrato.
                  </TableCell>
                </TableRow>
              ) : mezzi?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm font-medium">{m.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium capitalize">{m.tipo.replace('_', ' ')}</div>
                    {m.targa && <div className="text-xs font-mono text-muted-foreground uppercase">{m.targa}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="capitalize text-sm">{m.proprieta.replace('_', ' ')}</div>
                    {m.proprietarioNome && <div className="text-xs text-muted-foreground">{m.proprietarioNome}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.capacitaColli ? `${m.capacitaColli} colli` : '-'} / {m.capacitaKg ? `${m.capacitaKg} kg` : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-xs">
                      {m.scadenzaAssicurazione && (
                        <div className={`flex items-center gap-1 ${isExpiringSoon(m.scadenzaAssicurazione) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          <Calendar className="h-3 w-3" /> Assic. {format(new Date(m.scadenzaAssicurazione), "dd/MM/yy")}
                        </div>
                      )}
                      {m.scadenzaRevisione && (
                        <div className={`flex items-center gap-1 ${isExpiringSoon(m.scadenzaRevisione) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          <Calendar className="h-3 w-3" /> Revis. {format(new Date(m.scadenzaRevisione), "dd/MM/yy")}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={m.stato === 'disponibile' ? 'outline' : 'secondary'} className={
                      m.stato === 'disponibile' ? 'bg-green-500/10 text-green-700 border-none' : 
                      m.stato === 'in_uso' ? 'bg-blue-500/10 text-blue-700' : 'bg-destructive/10 text-destructive'
                    }>
                      {m.stato.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Apri menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(m)}>
                          <Pencil className="mr-2 h-4 w-4" /> Modifica
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(m.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Elimina
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
            <SheetTitle>{editingId ? "Modifica Mezzo" : "Nuovo Mezzo"}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem><FormLabel>Codice</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="targa" render={({ field }) => (
                    <FormItem><FormLabel>Targa</FormLabel><FormControl><Input className="uppercase" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="tipo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo Veicolo</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="furgone">Furgone</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="cargo_bike">Cargo Bike</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                
                <div className="pt-4 border-t space-y-4">
                  <FormField control={form.control} name="proprieta" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proprietà</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="associazione">Associazione</SelectItem>
                          <SelectItem value="noleggio">Noleggio / Leasing</SelectItem>
                          <SelectItem value="volontario">Volontario</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="proprietarioNome" render={({ field }) => (
                    <FormItem><FormLabel>Nome Proprietario (se non associazione)</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <FormField control={form.control} name="scadenzaAssicurazione" render={({ field }) => (
                    <FormItem><FormLabel>Scadenza Assicurazione</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="scadenzaRevisione" render={({ field }) => (
                    <FormItem><FormLabel>Scadenza Revisione</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createMezzo.isPending || updateMezzo.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Conferma eliminazione</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
