import { useState } from "react";
import { useListMagazzini, useCreateMagazzino, useUpdateMagazzino, useDeleteMagazzino, getListMagazziniQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MoreHorizontal, Plus, Pencil, Trash2, MapPin, Building, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const formSchema = z.object({
  codice: z.string().min(2, "Codice troppo corto"),
  nome: z.string().min(3, "Nome troppo corto"),
  indirizzo: z.string().optional(),
  comune: z.string().optional(),
  zona: z.string().optional(),
  responsabile: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email("Email non valida").optional().or(z.literal("")),
  stato: z.string().default("attivo"),
  note: z.string().optional()
});

export default function Magazzini() {
  const { data: magazzini, isLoading } = useListMagazzini();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createMagazzino = useCreateMagazzino();
  const updateMagazzino = useUpdateMagazzino();
  const deleteMagazzino = useDeleteMagazzino();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      codice: "", nome: "", indirizzo: "", comune: "", zona: "",
      responsabile: "", telefono: "", email: "", stato: "attivo", note: ""
    }
  });

  const handleEdit = (magazzino: any) => {
    setEditingId(magazzino.id);
    form.reset({
      codice: magazzino.codice,
      nome: magazzino.nome,
      indirizzo: magazzino.indirizzo || "",
      comune: magazzino.comune || "",
      zona: magazzino.zona || "",
      responsabile: magazzino.responsabile || "",
      telefono: magazzino.telefono || "",
      email: magazzino.email || "",
      stato: magazzino.stato,
      note: magazzino.note || ""
    });
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setEditingId(null);
    form.reset({
      codice: "", nome: "", indirizzo: "", comune: "", zona: "",
      responsabile: "", telefono: "", email: "", stato: "attivo", note: ""
    });
    setIsFormOpen(true);
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingId) {
      updateMagazzino.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
          toast({ title: "Magazzino aggiornato" });
          setIsFormOpen(false);
        }
      });
    } else {
      createMagazzino.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
          toast({ title: "Magazzino creato" });
          setIsFormOpen(false);
        }
      });
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    deleteMagazzino.mutate({ id: deletingId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMagazziniQueryKey() });
        toast({ title: "Magazzino eliminato" });
        setDeletingId(null);
      }
    });
  };

  const filtered = magazzini?.filter(m => 
    m.nome.toLowerCase().includes(search.toLowerCase()) || 
    m.codice.toLowerCase().includes(search.toLowerCase()) ||
    m.comune?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Magazzini</h1>
          <p className="text-muted-foreground">Gestisci le sedi e i punti di stoccaggio dell'associazione.</p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nuovo Magazzino
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex justify-between items-center">
            <Input 
              placeholder="Cerca per nome, codice o comune..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Codice</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Luogo</TableHead>
                <TableHead>Responsabile</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
                  </TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Nessun magazzino trovato.
                  </TableCell>
                </TableRow>
              ) : filtered?.map((magazzino) => (
                <TableRow key={magazzino.id}>
                  <TableCell className="font-medium text-xs font-mono">{magazzino.codice}</TableCell>
                  <TableCell>
                    <div className="font-medium">{magazzino.nome}</div>
                    {magazzino.note && <div className="text-xs text-muted-foreground truncate max-w-[200px]">{magazzino.note}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {magazzino.comune && (
                        <div className="flex items-center gap-1 text-sm">
                          <Building className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{magazzino.comune} {magazzino.zona ? `(${magazzino.zona})` : ''}</span>
                        </div>
                      )}
                      {magazzino.indirizzo && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          <span className="truncate max-w-[200px]">{magazzino.indirizzo}</span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {magazzino.responsabile ? (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{magazzino.responsabile}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Non assegnato</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={magazzino.stato === 'attivo' ? 'default' : 'secondary'} 
                           className={magazzino.stato === 'attivo' ? 'bg-green-500/10 text-green-700 hover:bg-green-500/20' : ''}>
                      {magazzino.stato === 'attivo' ? 'Attivo' : 'Inattivo'}
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
                        <DropdownMenuItem onClick={() => handleEdit(magazzino)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifica
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingId(magazzino.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Elimina
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
            <SheetTitle>{editingId ? "Modifica Magazzino" : "Nuovo Magazzino"}</SheetTitle>
            <SheetDescription>
              Compila i dettagli della sede o punto di stoccaggio.
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="codice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Codice</FormLabel>
                      <FormControl><Input placeholder="Es: MAG01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="stato" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stato</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona stato" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="attivo">Attivo</SelectItem>
                          <SelectItem value="inattivo">Inattivo</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                
                <FormField control={form.control} name="nome" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl><Input placeholder="Sede Centrale..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="indirizzo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Indirizzo</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="comune" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Comune</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="zona" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zona</FormLabel>
                      <FormControl><Input placeholder="Es: Nord" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-4 border-t">
                  <h4 className="text-sm font-medium mb-4">Contatti</h4>
                  <FormField control={form.control} name="responsabile" render={({ field }) => (
                    <FormItem className="mb-4">
                      <FormLabel>Responsabile</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
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
                </div>

                <div className="pt-4 border-t">
                  <FormField control={form.control} name="note" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="pt-6 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                    Annulla
                  </Button>
                  <Button type="submit" disabled={createMagazzino.isPending || updateMagazzino.isPending}>
                    {editingId ? "Salva Modifiche" : "Crea Magazzino"}
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
            <AlertDialogDescription>
              Questa azione non può essere annullata. Il magazzino verrà eliminato permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
