import { useState } from "react";
import { useListVolontari, useCreateVolontario, useUpdateVolontario, useDeleteVolontario, getListVolontariQueryKey } from "@workspace/api-client-react";
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
import { Switch } from "@/components/ui/switch";
import { ExportButtons } from "@/components/export-buttons";
import { MoreHorizontal, Plus, Pencil, Trash2, Mail, Phone, CheckCircle2, XCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  nome: z.string().min(2, "Nome troppo corto"),
  cognome: z.string().min(2, "Cognome troppo corto"),
  telefono: z.string().optional(),
  email: z.string().email("Email non valida").optional().or(z.literal("")),
  ruolo: z.string().min(1, "Ruolo obbligatorio"),
  patente: z.boolean().default(false),
  mezzoPersonale: z.boolean().default(false),
  maxConsegneTurno: z.coerce.number().min(1).default(5),
  note: z.string().optional()
});

export default function Volontari() {
  const { data: volontari, isLoading } = useListVolontari();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createVolontario = useCreateVolontario();
  const updateVolontario = useUpdateVolontario();
  const deleteVolontario = useDeleteVolontario();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nome: "", cognome: "", telefono: "", email: "",
      ruolo: "magazziniere", patente: false, mezzoPersonale: false,
      maxConsegneTurno: 5, note: ""
    }
  });

  const handleEdit = (volontario: any) => {
    setEditingId(volontario.id);
    form.reset({
      nome: volontario.nome,
      cognome: volontario.cognome,
      telefono: volontario.telefono || "",
      email: volontario.email || "",
      ruolo: volontario.ruolo,
      patente: volontario.patente,
      mezzoPersonale: volontario.mezzoPersonale,
      maxConsegneTurno: volontario.maxConsegneTurno,
      note: volontario.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      nome: "", cognome: "", telefono: "", email: "",
      ruolo: "magazziniere", patente: false, mezzoPersonale: false,
      maxConsegneTurno: 5, note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateVolontario.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ title: "Volontario aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createVolontario.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
          toast({ title: "Volontario creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteVolontario.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
        toast({ title: "Volontario eliminato" });
        setDeletingId(null);
      }
    });
  };

  const toggleStatus = (volontario: any) => {
    updateVolontario.mutate({ id: volontario.id, data: { attivo: !volontario.attivo } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVolontariQueryKey() });
      }
    });
  };

  const filtered = volontari?.filter(v => 
    v.nome.toLowerCase().includes(search.toLowerCase()) || 
    v.cognome.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Volontari</h1>
          <p className="text-muted-foreground">Gestisci il team operativo, ruoli e disponibilità.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            rows={volontari ?? []}
            columns={[
              { header: "Nome", accessor: (v) => v.nome },
              { header: "Cognome", accessor: (v) => v.cognome },
              { header: "Email", accessor: (v) => v.email },
              { header: "Telefono", accessor: (v) => v.telefono },
              { header: "Ruolo", accessor: (v) => v.ruolo },
              { header: "Patente", accessor: (v) => (v.patente ? "Sì" : "No") },
              { header: "Attivo", accessor: (v) => (v.attivo ? "Sì" : "No") },
            ]}
            filename="volontari"
            title="Elenco Volontari"
            orientation="landscape"
          />
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" /> Nuovo Volontario
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <Input 
            placeholder="Cerca per nome o cognome..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Contatti</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead className="text-center">Patente</TableHead>
                <TableHead className="text-center">Mezzo Proprio</TableHead>
                <TableHead className="text-center">Stato</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Nessun volontario trovato.
                  </TableCell>
                </TableRow>
              ) : filtered?.map((v) => (
                <TableRow key={v.id} className={!v.attivo ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="font-medium">{v.nome} {v.cognome}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      {v.telefono && <div className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {v.telefono}</div>}
                      {v.email && <div className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {v.email}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {v.ruolo.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {v.patente ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    {v.mezzoPersonale ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <XCircle className="h-4 w-4 text-muted mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={v.attivo} onCheckedChange={() => toggleStatus(v)} />
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
                        <DropdownMenuItem onClick={() => handleEdit(v)}>
                          <Pencil className="mr-2 h-4 w-4" /> Modifica
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(v.id)}>
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
            <SheetTitle>{editingId ? "Modifica Volontario" : "Nuovo Volontario"}</SheetTitle>
            <SheetDescription>Dettagli operativi per i turni.</SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="cognome" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cognome</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="telefono" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefono</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="ruolo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ruolo Principale</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="magazziniere">Magazziniere</SelectItem>
                        <SelectItem value="autista">Autista</SelectItem>
                        <SelectItem value="operatore_sportello">Operatore Sportello</SelectItem>
                        <SelectItem value="coordinatore">Coordinatore</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="space-y-4 pt-4 border-t">
                  <FormField control={form.control} name="patente" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>Possiede la Patente B</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="mezzoPersonale" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>Disponibile a usare mezzo personale</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="maxConsegneTurno" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max consegne per turno</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Annulla</Button>
                  <Button type="submit" disabled={createVolontario.isPending || updateVolontario.isPending}>
                    {editingId ? "Salva Modifiche" : "Crea Volontario"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sei sicuro?</AlertDialogTitle>
            <AlertDialogDescription>Questa azione non può essere annullata.</AlertDialogDescription>
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
