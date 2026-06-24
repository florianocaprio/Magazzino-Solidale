import { useState } from "react";
import { useListCentriAscolto, useCreateCentroAscolto, useUpdateCentroAscolto, useDeleteCentroAscolto, getListCentriAscoltoQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreHorizontal, Plus, Pencil, Trash2, Building2, Users } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  nome: z.string().min(2, "Nome obbligatorio"),
  indirizzo: z.string().optional(),
  comune: z.string().optional(),
  responsabile: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  attivo: z.boolean().default(true),
  note: z.string().optional()
});

export default function CentriAscolto() {
  const { data: centri, isLoading } = useListCentriAscolto();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createCentro = useCreateCentroAscolto();
  const updateCentro = useUpdateCentroAscolto();
  const deleteCentro = useDeleteCentroAscolto();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", indirizzo: "", comune: "", responsabile: "", telefono: "", email: "", attivo: true, note: ""
    }
  });

  const handleCreate = () => {
    setEditingId(null);
    form.reset({ nome: "", indirizzo: "", comune: "", responsabile: "", telefono: "", email: "", attivo: true, note: "" });
    setIsFormOpen(true);
  };

  const handleEdit = (c: any) => {
    setEditingId(c.id);
    form.reset({
      nome: c.nome,
      indirizzo: c.indirizzo || "",
      comune: c.comune || "",
      responsabile: c.responsabile || "",
      telefono: c.telefono || "",
      email: c.email || "",
      attivo: c.attivo,
      note: c.note || ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateCentro.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
          toast({ title: "Centro aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createCentro.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
          toast({ title: "Centro creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteCentro.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCentriAscoltoQueryKey() });
        toast({ title: "Centro eliminato" });
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centri di Ascolto</h1>
          <p className="text-muted-foreground">Punti di riferimento territoriali a cui sono associati i beneficiari.</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuovo Centro
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Comune</TableHead>
                <TableHead>Responsabile</TableHead>
                <TableHead>Contatti</TableHead>
                <TableHead className="text-center">Beneficiari</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(3).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : centri?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun centro di ascolto registrato.
                  </TableCell>
                </TableRow>
              ) : centri?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      <Building2 className="h-4 w-4 text-muted-foreground" /> {c.nome}
                    </div>
                    {c.indirizzo && <div className="text-xs text-muted-foreground ml-6">{c.indirizzo}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{c.comune || '-'}</TableCell>
                  <TableCell className="text-sm">{c.responsabile || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.telefono && <div>{c.telefono}</div>}
                    {c.email && <div className="text-xs">{c.email}</div>}
                    {!c.telefono && !c.email && '-'}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex items-center gap-1 text-sm font-medium">
                      <Users className="h-3 w-3 text-muted-foreground" /> {c.beneficiariCount}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={c.attivo ? 'bg-green-500/10 text-green-700 border-none' : 'bg-muted text-muted-foreground'}>
                      {c.attivo ? 'Attivo' : 'Inattivo'}
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
                        <DropdownMenuItem onClick={() => handleEdit(c)}>
                          <Pencil className="mr-2 h-4 w-4" /> Modifica
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(c.id)}>
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
            <SheetTitle>{editingId ? "Modifica Centro" : "Nuovo Centro di Ascolto"}</SheetTitle>
          </SheetHeader>
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="indirizzo" render={({ field }) => (
                  <FormItem><FormLabel>Indirizzo</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="comune" render={({ field }) => (
                  <FormItem><FormLabel>Comune</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="responsabile" render={({ field }) => (
                  <FormItem><FormLabel>Responsabile</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem><FormLabel>Telefono</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem><FormLabel>Note</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="attivo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <FormLabel className="m-0">Centro attivo</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createCentro.isPending || updateCentro.isPending}>Salva</Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
            <AlertDialogDescription>
              I beneficiari associati a questo centro verranno scollegati (non eliminati).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
